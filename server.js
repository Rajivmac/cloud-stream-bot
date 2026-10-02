const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { LiveChat } = require('youtube-chat');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const DATA_FILE = path.join(__dirname, 'stream_data.json');
const MAIN_CHANNEL_ID = 'UCjckDwkpw4xQAPlF5NEm2tQ'; // Rajiv Pal Main Channel

let streamData = {
    deathCount: 0,
    gameTimeSeconds: 0,
    counterIcon: '💀',
    counterFont: 'Teko',
    clockFont: 'Share Tech Mono',
    timerFont: 'Orbitron',
    themeColor: '#ff4757',

    aiEnabled: true,
    enableBubble: true,
    enableTTS: true,
    ttsVoice: 'female',
    ttsPitch: 1.0,
    ttsRate: 1.0,
    aiCommand: '!ai',
    characterName: 'Ryomen Sukuna',
    characterImage: 'https://images3.alphacoders.com/134/1344406.jpeg',
    characterPersona: "You are the King of Curses, Ryomen Sukuna. Proud, condescending, and majestic. Treat ordinary viewers like mere brats. Reply in 1-2 royal punchy sentences in the viewer's language.",
    currentVideoId: '',

    modSettings: {
        blockLinks: true,
        capsFilter: true,
        maxCapsPercent: 70,
        bannedWords: "mc,bc,bhenchod,madarchod,gandu,chutiya,randi,bsdk"
    },

    coinSettings: {
        currencyName: "Mac-Coins",
        coinsPerMsg: 5,
        cooldownSeconds: 30,
        aiCost: 50
    },

    userCoins: {},
    userDailyClaim: {},
    userHistories: {},

    triggers: [
        { id: "1", name: "Gameplay", type: "scene", sceneName: "Gameplay", cost: 0 },
        { id: "2", name: "BRB Screen", type: "scene", sceneName: "BRB", cost: 0 },
        { id: "3", name: "Wavedash", cmd: "!combo", type: "video", url: "https://res.cloudinary.com/udkv88c7/video/upload/v1790790781/Wavedash.mp4", cost: 30 },
        { id: "4", name: "Vine Boom", cmd: "!boom", type: "sfx", url: "https://www.myinstants.com/media/sounds/vine-boom.mp3", cost: 15 }
    ],

    customCommands: [
        { cmd: "!specs", reply: "PC Specs: Ryzen 7 7800X3D | RTX 4070 | 32GB RAM", bubble: true, tts: false, cost: 0 },
        { cmd: "!rank", reply: "Tekken 8 Main: Kazuya Mishima (Tekken King Rank)!", bubble: true, tts: true, cost: 0 },
        { cmd: "!discord", reply: "Discord community: https://discord.gg/yourlink", bubble: true, tts: false, cost: 0 }
    ]
};

let activeBet = {
    isOpen: false,
    locked: false,
    title: "",
    options: [],
    bets: {}
};

let activeDuels = {};
let userLastAiTime = {};
let currentStatus = 'offline';
let isTimerRunning = false;
let lastEarnedTime = {};

function getDynamicCommandCatalog() {
    const aiCmd = streamData.aiCommand || '!ai';
    const cName = streamData.coinSettings.currencyName || 'Coins';

    const core = [
        { cmd: `${aiCmd} <sawal>`, desc: `Talk to AI character (Cost: ${streamData.coinSettings.aiCost} ${cName})` },
        { cmd: '!tts <message>', desc: 'Speak message in stream voice' },
        { cmd: '!coins / !balance', desc: 'Check your balance' },
        { cmd: '!daily', desc: 'Claim free 50 coins every 24h' },
        { cmd: '!topcoins', desc: 'Top viewers leaderboard' },
        { cmd: '!pay @user <amt>', desc: 'Transfer coins to viewer' }
    ];

    const games = [
        { cmd: '!gamble <amt>', desc: '50/50 Coin Flip game' },
        { cmd: '!slots <amt>', desc: '3-Reel Slots (up to 5x win)' },
        { cmd: '!duel @user <amt>', desc: 'Challenge viewer to duel' },
        { cmd: '!accept', desc: 'Accept duel challenge' },
        { cmd: '!bet <option> <amt>', desc: 'Bet on live predictions' }
    ];

    const redeems = (streamData.triggers || [])
        .filter(t => t.cmd)
        .map(t => ({
            cmd: t.cmd,
            desc: `${t.name} [Cost: ${t.cost > 0 ? t.cost + ' ' + cName : 'FREE'}]`
        }));

    const customs = (streamData.customCommands || []).map(c => ({
        cmd: c.cmd,
        desc: `${c.reply.slice(0, 45)}${c.reply.length > 45 ? '...' : ''} [Cost: ${c.cost > 0 ? c.cost + ' ' + cName : 'FREE'}]`
    }));

    return { core, games, redeems, customs };
}

function getCalculatedBetData() {
    let totalPool = 0;
    let totalVotes = 0;

    activeBet.options.forEach(opt => {
        totalPool += (opt.pool || 0);
        totalVotes += (opt.votes || 0);
    });

    const calculatedOptions = activeBet.options.map(opt => {
        let pct = 0;
        if (totalPool > 0) pct = Math.round(((opt.pool || 0) / totalPool) * 100);
        else if (totalVotes > 0) pct = Math.round(((opt.votes || 0) / totalVotes) * 100);
        else pct = activeBet.options.length > 0 ? Math.round(100 / activeBet.options.length) : 0;
        return { ...opt, pct };
    });

    return { ...activeBet, totalPool, totalVotes, options: calculatedOptions };
}

if (fs.existsSync(DATA_FILE)) {
    try {
        const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        streamData = { ...streamData, ...loaded };
        if (!streamData.userCoins) streamData.userCoins = {};
        if (!streamData.userDailyClaim) streamData.userDailyClaim = {};
        if (!streamData.userHistories) streamData.userHistories = {};
        if (!streamData.triggers) streamData.triggers = [];
        if (!streamData.customCommands) streamData.customCommands = [];
    } catch (e) {}
}

const saveDataToDisk = () => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(streamData, null, 2));
    } catch (e) {}
};

setInterval(() => {
    if (isTimerRunning) {
        streamData.gameTimeSeconds++;
        io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
        if (streamData.gameTimeSeconds % 10 === 0) saveDataToDisk();
    }
}, 1000);

// Natural Dual-Voice TTS Proxy
app.get('/api/tts', async (req, res) => {
    try {
        const text = (req.query.text || '').slice(0, 280).trim();
        const voice = (req.query.voice || streamData.ttsVoice || 'female').trim().toLowerCase();
        if (!text) return res.status(400).send("No text provided");

        const isFemale = voice.includes('female');

        if (isFemale) {
            try {
                const gUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=hi&q=${encodeURIComponent(text)}`;
                const gRes = await fetch(gUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                });
                if (gRes.ok) {
                    const buf = Buffer.from(await gRes.arrayBuffer());
                    if (buf.length > 250) {
                        res.setHeader('Content-Type', 'audio/mpeg');
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        return res.send(buf);
                    }
                }
            } catch(e) {}
        } else {
            try {
                const ttRes = await fetch('https://tiktok-tts.weilnet.workers.dev/api/generation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: text.slice(0, 200), voice: 'en_male_narration' })
                });
                if (ttRes.ok) {
                    const ttData = await ttRes.json();
                    if (ttData && ttData.data) {
                        const buf = Buffer.from(ttData.data, 'base64');
                        if (buf.length > 300) {
                            res.setHeader('Content-Type', 'audio/mpeg');
                            res.setHeader('Access-Control-Allow-Origin', '*');
                            return res.send(buf);
                        }
                    }
                }
            } catch(e) {}
        }
        res.status(500).send("TTS Error");
    } catch(err) {
        res.status(500).send("TTS Error: " + err.message);
    }
});

function broadcastResponse(text, isTTS = true) {
    io.emit('ai-speak', {
        characterName: streamData.characterName,
        characterImage: streamData.characterImage,
        text: text,
        enableBubble: streamData.enableBubble,
        enableTTS: isTTS && streamData.enableTTS,
        voice: streamData.ttsVoice,
        pitch: streamData.ttsPitch,
        rate: streamData.ttsRate
    });
}

// Zero-Key Fast AI Engine
async function queryZeroKeyNeuralCloud(systemPrompt, userPrompt) {
    try {
        const fullPrompt = `${systemPrompt}\nUser: ${userPrompt}\nReply in 1-2 punchy sentences.`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2800);
        const res = await fetch(`https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}?model=openai`, {
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (res.ok) {
            const text = await res.text();
            if (text && text.trim().length > 3) return { success: true, text: text.trim() };
        }
    } catch(e) {}
    return { success: false };
}

function generateInstantPersonaReply(userPrompt, username, userRole) {
    if (userRole === 'owner') {
        const bossReplies = [
            `Streamer Boss, aapka hukum sar ankhon par! Game par focus karein!`,
            `Aadab Boss! Match mein enemy ko tabah kardo!`,
            `Boss! Match mein enemy ki dhajjiyan uda do, Sukuna aapke sath hai!`
        ];
        return bossReplies[Math.floor(Math.random() * bossReplies.length)];
    }
    if (userRole === 'mod') {
        return `Moderator ji! Chat discipline mein hai, aap game dekhein!`;
    }
    return `@${username}, tera sawal sun kar maza aaya! Agla round dekh mera.`;
}

async function askAI(userPrompt, username, userRole) {
    let roleInstructions = "";
    if (userRole === 'owner') roleInstructions = `CRITICAL: The person talking is the STREAM OWNER / BOSS (Rajiv Pal). Treat with highest royalty. Call them 'Boss'.`;
    else if (userRole === 'mod') roleInstructions = `CRITICAL: The person talking is a MODERATOR. Call them 'Moderator ji'.`;
    else roleInstructions = `Viewer is named @${username}.`;

    const systemPrompt = `${streamData.characterPersona}\n${roleInstructions}\nKeep answers punchy in 1-2 short sentences.`;

    const neuralRes = await queryZeroKeyNeuralCloud(systemPrompt, userPrompt);
    if (neuralRes.success) {
        recordHistory(username, userPrompt, neuralRes.text);
        return neuralRes.text;
    }

    const instantReply = generateInstantPersonaReply(userPrompt, username, userRole);
    recordHistory(username, userPrompt, instantReply);
    return instantReply;
}

function recordHistory(username, userPrompt, aiReply) {
    if (!streamData.userHistories[username]) streamData.userHistories[username] = [];
    streamData.userHistories[username].push({ role: 'user', text: userPrompt });
    streamData.userHistories[username].push({ role: 'model', text: aiReply });
    if (streamData.userHistories[username].length > 6) streamData.userHistories[username] = streamData.userHistories[username].slice(-6);
    saveDataToDisk();
}

// 👑 Universal Chat Logic Processor (For both youtube-chat & Streamer.bot Webhook)
async function processCoreChatLogic({ rawText, username, authorChannelId, isOwnerOverride, isModOverride, userAvatar }) {
    const message = rawText.toLowerCase().trim();
    const lowerName = (username || '').toLowerCase();

    // 👑 100% BULLETPROOF STREAMER DETECTION (0 COINS, ALWAYS BOSS!)
    const isOwner = isOwnerOverride || 
                    (authorChannelId === MAIN_CHANNEL_ID) || 
                    lowerName.includes('rajiv') || 
                    lowerName.includes('mac_s');

    const isMod = isModOverride || false;
    const userRole = isOwner ? 'owner' : (isMod ? 'mod' : 'viewer');
    const userKey = lowerName;
    const cName = streamData.coinSettings.currencyName;

    // Auto-Moderation
    if (!isOwner && !isMod) {
        const ms = streamData.modSettings || {};
        if (ms.blockLinks && /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(com|in|org|net|io|gg|tv)\b)/i.test(rawText)) {
            broadcastResponse(`⚠️ @${username}, live chat mein links allow nahi hain!`, false);
            return { reply: `@${username}, links allow nahi hain!`, posted: true };
        }
        if (ms.bannedWords) {
            const bannedList = ms.bannedWords.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
            for (const bad of bannedList) {
                if (message.includes(bad)) {
                    broadcastResponse(`⚠️ @${username}, inappropriate words allowed nahi hain.`, false);
                    return { reply: `@${username}, language control karein.`, posted: true };
                }
            }
        }
    }

    // Accumulate coins
    const now = Date.now();
    if (!lastEarnedTime[userKey] || (now - lastEarnedTime[userKey]) >= (streamData.coinSettings.cooldownSeconds * 1000)) {
        if (!streamData.userCoins[userKey]) streamData.userCoins[userKey] = 0;
        streamData.userCoins[userKey] += streamData.coinSettings.coinsPerMsg;
        lastEarnedTime[userKey] = now;
        saveDataToDisk();
    }

    // Commands List
    if (message === '!commands' || message === '!help' || message === '!cmds') {
        const catalog = getDynamicCommandCatalog();
        const coreStr = catalog.core.map(c => c.cmd.split(' ')[0]).join(', ');
        const gamesStr = "!gamble, !slots, !duel, !bet";
        const resText = `📜 Commands 👉 [Core: ${coreStr}] | [Games: ${gamesStr}]`;
        broadcastResponse(resText, false);
        return { reply: resText, posted: true };
    }

    // Daily Claim
    if (message === '!daily' || message === '!claim') {
        if (!streamData.userDailyClaim) streamData.userDailyClaim = {};
        const lastClaim = streamData.userDailyClaim[userKey] || 0;
        const elapsed = now - lastClaim;
        const twentyFourHours = 24 * 60 * 60 * 1000;

        if (elapsed >= twentyFourHours) {
            if (!streamData.userCoins[userKey]) streamData.userCoins[userKey] = 0;
            streamData.userCoins[userKey] += 50;
            streamData.userDailyClaim[userKey] = now;
            saveDataToDisk();
            broadcastState();
            const resText = `🎁 @${username} ne Daily Bonus 🪙 50 ${cName} claim kiye! Balance: 🪙 ${streamData.userCoins[userKey]}`;
            broadcastResponse(resText, false);
            return { reply: resText, posted: true };
        } else {
            const remH = Math.floor((twentyFourHours - elapsed) / (1000 * 60 * 60));
            const resText = `⏳ @${username}, already claimed! Next bonus in ${remH}h.`;
            broadcastResponse(resText, false);
            return { reply: resText, posted: true };
        }
    }

    // Top Coins
    if (message === '!topcoins' || message === '!leaderboard' || message === '!ranks') {
        const entries = Object.entries(streamData.userCoins || {});
        if (entries.length === 0) return { reply: `Abhi kisi ke paas ${cName} nahi hain!` };
        entries.sort((a, b) => b[1] - a[1]);
        const top3 = entries.slice(0, 3).map((e, idx) => `${idx + 1}. @${e[0]} (🪙${e[1]})`).join(' | ');
        const resText = `🏆 Top Rich Viewers 👉 ${top3}`;
        broadcastResponse(resText, false);
        return { reply: resText, posted: true };
    }

    // Mini Game: Gamble
    if (message.startsWith('!gamble ') || message.startsWith('!roulette ')) {
        const parts = rawText.split(' ');
        const amount = parseInt(parts[1]);
        const currentBalance = streamData.userCoins[userKey] || 0;

        if (isNaN(amount) || amount <= 0) return null;
        if (currentBalance < amount) {
            const resText = `@${username}, aapke paas gamble karne ke liye sirf 🪙 ${currentBalance} ${cName} hain!`;
            broadcastResponse(resText, false);
            return { reply: resText, posted: true };
        }

        const isWin = Math.random() < 0.50;
        let resText = "";
        if (isWin) {
            streamData.userCoins[userKey] += amount;
            resText = `🎲 [WIN!] @${username} ne 🪙 ${amount} gamble kiya aur JEET GAYA! Balance: 🪙 ${streamData.userCoins[userKey]} ${cName}`;
        } else {
            streamData.userCoins[userKey] -= amount;
            resText = `💀 [LOSS!] @${username} ne 🪙 ${amount} gamble kiya aur HAAR GAYA! Balance: 🪙 ${streamData.userCoins[userKey]} ${cName}`;
        }
        saveDataToDisk();
        broadcastState();
        broadcastResponse(resText, false);
        return { reply: resText, posted: true };
    }

    // Mini Game: Slots
    if (message.startsWith('!slots ')) {
        const parts = rawText.split(' ');
        const amount = parseInt(parts[1]);
        const currentBalance = streamData.userCoins[userKey] || 0;

        if (isNaN(amount) || amount <= 0) return null;
        if (currentBalance < amount) {
            const resText = `@${username}, aapke paas slots ke liye sirf 🪙 ${currentBalance} ${cName} hain!`;
            broadcastResponse(resText, false);
            return { reply: resText, posted: true };
        }

        const symbols = ['🍒', '🍋', '🍇', '💎', '7️⃣'];
        const s1 = symbols[Math.floor(Math.random() * symbols.length)];
        const s2 = symbols[Math.floor(Math.random() * symbols.length)];
        const s3 = symbols[Math.floor(Math.random() * symbols.length)];

        let resText = "";
        if (s1 === s2 && s2 === s3) {
            const win = amount * 5;
            streamData.userCoins[userKey] += (win - amount);
            resText = `🎰 [${s1} | ${s2} | ${s3}] JACKPOT!! @${username} ne 5x jeeta (+🪙 ${win} ${cName})!`;
        } else if (s1 === s2 || s2 === s3 || s1 === s3) {
            const win = amount * 2;
            streamData.userCoins[userKey] += (win - amount);
            resText = `🎰 [${s1} | ${s2} | ${s3}] 2 MATCH! @${username} ne 2x jeeta (+🪙 ${win} ${cName})!`;
        } else {
            streamData.userCoins[userKey] -= amount;
            resText = `🎰 [${s1} | ${s2} | ${s3}] No match! @${username} lost 🪙 ${amount} ${cName}.`;
        }
        saveDataToDisk();
        broadcastState();
        broadcastResponse(resText, false);
        return { reply: resText, posted: true };
    }

    // Balance Check
    if (message === '!coins' || message === '!balance' || message === '!maccoins') {
        const balance = streamData.userCoins[userKey] || 0;
        const resText = `@${username}, aapke paas 🪙 ${balance} ${cName} hain!`;
        broadcastResponse(resText, false);
        return { reply: resText, posted: true };
    }

    // Triggers / Redeems
    const matchedTrigger = streamData.triggers.find(t => t.cmd && t.cmd.toLowerCase() === message);
    if (matchedTrigger) {
        const cost = parseInt(matchedTrigger.cost) || 0;
        const currentBalance = streamData.userCoins[userKey] || 0;

        if (cost > 0 && !isOwner && currentBalance < cost) {
            const resText = `@${username}, '${matchedTrigger.name}' ke liye 🪙 ${cost} ${cName} chahiye!`;
            broadcastResponse(resText, true);
            return { reply: resText, posted: true };
        }

        if (cost > 0 && !isOwner) {
            streamData.userCoins[userKey] -= cost;
            saveDataToDisk();
            broadcastState();
        }

        if (matchedTrigger.type === 'video') io.emit('play-meme', { mediaUrl: matchedTrigger.url, name: matchedTrigger.name, redeemedBy: username });
        if (matchedTrigger.type === 'sfx') io.emit('play-sfx', { sfxUrl: matchedTrigger.url, name: matchedTrigger.name, redeemedBy: username });
        return { reply: `Redeemed ${matchedTrigger.name}!`, posted: true };
    }

    // Custom Commands
    const matchedCustom = streamData.customCommands.find(c => c.cmd.toLowerCase() === message);
    if (matchedCustom) {
        const replyPrefix = isOwner ? "Boss" : (isMod ? "Moderator ji" : `@${username}`);
        const resText = `${replyPrefix}, ${matchedCustom.reply}`;
        broadcastResponse(resText, matchedCustom.tts === true);
        return { reply: resText, posted: true };
    }

    // AI Question (STREAMER KE LIYE 0 COINS - 100% FREE!)
    const activeCommand = (streamData.aiCommand || '!ai').toLowerCase();
    if (streamData.aiEnabled && (message.startsWith(activeCommand + ' ') || message === activeCommand)) {
        if (!isOwner && !isMod) {
            const lastTime = userLastAiTime[userKey] || 0;
            if (Date.now() - lastTime < 15000) {
                const resText = `⏳ @${username}, AI cooldown par ho!`;
                broadcastResponse(resText, false);
                return { reply: resText, posted: true };
            }
            userLastAiTime[userKey] = Date.now();
        }

        const question = rawText.slice(activeCommand.length).trim() || 'Kuch interesting batao!';
        const currentCoins = streamData.userCoins[userKey] || 0;
        const cost = streamData.coinSettings.aiCost;

        if (cost > 0 && !isOwner && currentCoins < cost) {
            const resText = `@${username}, AI se baat karne ke liye 🪙 ${cost} ${cName} chahiye!`;
            broadcastResponse(resText, true);
            return { reply: resText, posted: true };
        }

        if (cost > 0 && !isOwner) {
            streamData.userCoins[userKey] -= cost;
            saveDataToDisk();
            broadcastState();
        }

        const aiAnswer = await askAI(question, username, userRole);
        broadcastResponse(aiAnswer, true);
        return { reply: aiAnswer, posted: true };
    }

    return null;
}

// 🌐 Streamer.bot Webhook API Endpoint
app.post('/api/streamerbot/chat', async (req, res) => {
    try {
        const { user, message, isOwner, isMod, authorChannelId } = req.body;
        if (!message) return res.status(400).json({ error: "No message" });

        const result = await processCoreChatLogic({
            rawText: message,
            username: user || 'Viewer',
            authorChannelId: authorChannelId || '',
            isOwnerOverride: Boolean(isOwner),
            isModOverride: Boolean(isMod),
            userAvatar: 'https://cdn-icons-png.flaticon.com/512/847/847969.png'
        });

        if (result && result.reply) {
            return res.json({ success: true, reply: result.reply });
        }
        return res.json({ success: true, reply: null });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Broadcast State
const broadcastState = () => {
    io.emit('update-counter', { count: streamData.deathCount });
    io.emit('stream-status', { status: currentStatus, videoId: streamData.currentVideoId });
    io.emit('update-styles', streamData);
    io.emit('load-triggers', streamData.triggers);
    io.emit('bet-update', getCalculatedBetData());
    io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
    io.emit('all-commands-catalog', getDynamicCommandCatalog());
    saveDataToDisk();
};

io.on('connection', (socket) => {
    socket.emit('update-counter', { count: streamData.deathCount });
    socket.emit('stream-status', { status: currentStatus, videoId: streamData.currentVideoId });
    socket.emit('load-triggers', streamData.triggers);
    socket.emit('update-styles', streamData);
    socket.emit('bet-update', getCalculatedBetData());
    socket.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
    socket.emit('all-commands-catalog', getDynamicCommandCatalog());

    // Streamer.bot forward bridge
    socket.on('streamerbot-event', async (data) => {
        try {
            if (data.event.type === 'Message') {
                const item = data.data;
                await processCoreChatLogic({
                    rawText: item.message,
                    username: item.user.name,
                    authorChannelId: item.user.id,
                    isOwnerOverride: Boolean(item.user.isOwner),
                    isModOverride: Boolean(item.user.isModerator),
                    userAvatar: item.user.avatarUrl
                });
            }
        } catch(e) {}
    });

    socket.on('admin-sync-local', (local) => {
        let changed = false;
        if (local.characterName && !streamData.characterName) { streamData.characterName = local.characterName; changed = true; }
        if (local.characterImage && !streamData.characterImage) { streamData.characterImage = local.characterImage; changed = true; }
        if (changed) { saveDataToDisk(); broadcastState(); }
    });

    socket.on('admin-test-voice-preview', (data) => {
        streamData.characterName = data.characterName || streamData.characterName;
        streamData.characterImage = data.characterImage || streamData.characterImage;
        streamData.ttsVoice = data.ttsVoice || streamData.ttsVoice;
        streamData.ttsPitch = data.ttsPitch || streamData.ttsPitch;
        streamData.ttsRate = data.ttsRate || streamData.ttsRate;
        saveDataToDisk();
        broadcastState();

        const testMsg = (streamData.ttsVoice === 'female') 
            ? `Namaste Boss! Voice aur overlay ready hain. Main hoon ${streamData.characterName}!` 
            : `Yo Boss! Voice aur overlay ready hain. Main hoon ${streamData.characterName}!`;

        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: testMsg,
            enableBubble: data.enableBubble !== false,
            enableTTS: data.enableTTS !== false,
            voice: streamData.ttsVoice,
            pitch: streamData.ttsPitch,
            rate: streamData.ttsRate
        });
    });

    socket.on('admin-test-superchat-tier', (tierAmount) => {
        const amt = tierAmount || '₹500';
        io.emit('stream-alert', {
            type: 'superchat',
            user: 'Rahul Gamer',
            amount: amt,
            avatar: 'https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=150',
            msg: 'Bhai gaming level bohot mast hai! Keep grinding!',
            ttsText: `Rahul Gamer ne ${amt} ka Super Chat bheja: Bhai gaming level bohot mast hai!`,
            voice: streamData.ttsVoice,
            pitch: streamData.ttsPitch,
            rate: streamData.ttsRate
        });
    });

    socket.on('admin-test-member', () => {
        io.emit('stream-alert', {
            type: 'member',
            user: 'Amit Sharma',
            amount: 'MEMBER',
            avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
            msg: 'Joined channel membership! Proud Member!',
            ttsText: 'Welcome Amit Sharma to the stream membership family! GG!',
            voice: streamData.ttsVoice,
            pitch: streamData.ttsPitch,
            rate: streamData.ttsRate
        });
    });

    socket.on('admin-test-sub', () => {
        io.emit('stream-alert', {
            type: 'subscriber',
            user: 'Vikram Singh',
            amount: 'NEW SUB',
            avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150',
            msg: 'Subscribed to the channel!',
            ttsText: 'Welcome Vikram Singh to the stream family! Thanks for subscribing!',
            voice: streamData.ttsVoice,
            pitch: streamData.ttsPitch,
            rate: streamData.ttsRate
        });
    });

    socket.on('admin-save-automod', (modConfig) => {
        streamData.modSettings = { ...streamData.modSettings, ...modConfig };
        saveDataToDisk();
        broadcastState();
    });

    socket.on('admin-death-add', () => { streamData.deathCount++; broadcastState(); });
    socket.on('admin-death-sub', () => { if (streamData.deathCount > 0) streamData.deathCount--; broadcastState(); });
    socket.on('admin-death-reset', () => { streamData.deathCount = 0; broadcastState(); });

    socket.on('admin-timer-start', () => { isTimerRunning = true; broadcastState(); });
    socket.on('admin-timer-pause', () => { isTimerRunning = false; broadcastState(); });
    socket.on('admin-timer-reset', () => { streamData.gameTimeSeconds = 0; broadcastState(); });
    socket.on('admin-timer-set', ({ hours, minutes, seconds }) => {
        streamData.gameTimeSeconds = ((parseInt(hours) || 0) * 3600) + ((parseInt(minutes) || 0) * 60) + (parseInt(seconds) || 0);
        broadcastState();
    });

    socket.on('admin-change-styles', (newSettings) => {
        streamData = { ...streamData, ...newSettings };
        saveDataToDisk();
        broadcastState();
    });

    socket.on('admin-save-coins', (newCoinSettings) => {
        streamData.coinSettings = { ...streamData.coinSettings, ...newCoinSettings };
        saveDataToDisk();
        broadcastState();
    });

    socket.on('admin-modify-user-coins', ({ username, amount }) => {
        const u = username.replace('@', '').toLowerCase().trim();
        if (u) {
            if (!streamData.userCoins[u]) streamData.userCoins[u] = 0;
            streamData.userCoins[u] = Math.max(0, streamData.userCoins[u] + parseInt(amount));
            saveDataToDisk();
            broadcastState();
        }
    });

    socket.on('admin-add-trigger', (newTrigger) => {
        newTrigger.id = Date.now().toString();
        streamData.triggers.push(newTrigger);
        broadcastState();
    });

    socket.on('admin-del-trigger', (id) => {
        streamData.triggers = streamData.triggers.filter(t => t.id !== id);
        broadcastState();
    });

    socket.on('admin-start-bet', ({ title, options }) => {
        const parsedOptions = (options && options.length > 0) ? options.map((optName, index) => ({
            id: index + 1,
            name: optName.trim(),
            pool: 0,
            votes: 0
        })) : [
            { id: 1, name: "Option 1", pool: 0, votes: 0 },
            { id: 2, name: "Option 2", pool: 0, votes: 0 }
        ];

        activeBet = { isOpen: true, locked: false, title: title || "Who will win?", options: parsedOptions, bets: {} };
        broadcastState();

        const optionsText = parsedOptions.map(o => `[${o.id}: ${o.name}]`).join(' vs ');
        broadcastResponse(`🚨 POLL OPEN: "${activeBet.title}" 👉 ${optionsText}. Vote: !bet <num> <amount> or !vote <num>`, true);
    });

    socket.on('admin-lock-bet', () => {
        activeBet.locked = true;
        broadcastState();
    });

    socket.on('admin-resolve-bet', ({ winningOptionId }) => {
        if (!activeBet.isOpen) return;
        const totalPool = activeBet.options.reduce((sum, o) => sum + (o.pool || 0), 0);
        const winningOption = activeBet.options.find(o => o.id === parseInt(winningOptionId));
        if (!winningOption) return;

        const winningPool = winningOption.pool || 0;
        if (winningPool > 0) {
            for (const [user, bet] of Object.entries(activeBet.bets)) {
                if (bet.optionId === winningOption.id && bet.amount > 0) {
                    const payout = Math.floor((bet.amount / winningPool) * totalPool);
                    streamData.userCoins[user] = (streamData.userCoins[user] || 0) + payout;
                }
            }
        }

        io.emit('bet-winner', { winnerName: winningOption.name, winnerId: winningOption.id, totalPool });
        broadcastResponse(`🏆 RESULT: "${winningOption.name}" JEET GAYA! Total 🪙 ${totalPool} Mac-Coins distribute ho gaye!`, true);

        setTimeout(() => {
            activeBet = { isOpen: false, locked: false, title: "", options: [], bets: {} };
            saveDataToDisk();
            broadcastState();
        }, 12000);
    });

    socket.on('admin-end-bet', () => {
        for (const [user, bet] of Object.entries(activeBet.bets)) {
            if (bet.amount > 0) streamData.userCoins[user] = (streamData.userCoins[user] || 0) + bet.amount;
        }
        activeBet = { isOpen: false, locked: false, title: "", options: [], bets: {} };
        saveDataToDisk();
        broadcastState();
    });

    socket.on('admin-add-custom-cmd', (newCmd) => {
        streamData.customCommands = streamData.customCommands.filter(c => c.cmd.toLowerCase() !== newCmd.cmd.toLowerCase());
        streamData.customCommands.push(newCmd);
        broadcastState();
    });

    socket.on('admin-del-custom-cmd', (cmdToDelete) => {
        streamData.customCommands = streamData.customCommands.filter(c => c.cmd.toLowerCase() !== cmdToDelete.toLowerCase());
        broadcastState();
    });

    socket.on('admin-play-meme', (data) => io.emit('play-meme', { mediaUrl: data.mediaUrl, name: "Stream Deck", redeemedBy: "Streamer Boss" }));
    socket.on('admin-play-sfx', (data) => io.emit('play-sfx', { sfxUrl: data.sfxUrl, name: "Stream Deck", redeemedBy: "Streamer Boss" }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
