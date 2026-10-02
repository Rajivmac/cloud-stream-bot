const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { LiveChat } = require('youtube-chat');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const DATA_FILE = path.join(__dirname, 'stream_data.json');
const MAIN_CHANNEL_ID = 'UCjckDwkpw4xQAPlF5NEm2tQ'; // Aapka Main Channel

let streamData = {
    deathCount: 0,
    gameTimeSeconds: 0,
    counterIcon: '💀',
    counterFont: 'Teko',
    clockFont: 'Share Tech Mono',
    timerFont: 'Orbitron',
    themeColor: '#ff4757',

    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    ytAccessToken: '',
    ytRefreshToken: '',
    ytTokenExpiresAt: 0,
    ytAccountName: '',
    ytLiveChatId: '',
    currentVideoId: '',
    enableYTChatSend: true,
    ytMessagesSentToday: 0,
    ytQuotaExhausted: false,

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
    welcomeNewChatters: true,
    reminderMinutes: 15,

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

// TTS Proxy
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

// OAuth Routes
const REDIRECT_URI = "https://stream-bot-hqlh.onrender.com/oauth2callback";

app.get('/auth/google', (req, res) => {
    const clientId = streamData.googleClientId || process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        return res.send("<script>alert('Pehle Dashboard mein Google Client ID daal kar Save karein!'); window.location.href='/admin.html';</script>");
    }

    const scope = encodeURIComponent("https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/userinfo.profile");
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
    res.redirect(authUrl);
});

app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;
    const clientId = streamData.googleClientId || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = streamData.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET;

    if (!code) return res.send("Authorization failed!");

    try {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code: code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: REDIRECT_URI,
                grant_type: "authorization_code"
            })
        });

        const tokenData = await tokenRes.json();

        if (tokenData.access_token) {
            streamData.ytAccessToken = tokenData.access_token;
            if (tokenData.refresh_token) streamData.ytRefreshToken = tokenData.refresh_token;
            streamData.ytTokenExpiresAt = Date.now() + ((tokenData.expires_in || 3600) * 1000);
            streamData.enableYTChatSend = true;
            streamData.ytQuotaExhausted = false;

            try {
                const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
                    headers: { Authorization: `Bearer ${tokenData.access_token}` }
                });
                const userData = await userRes.json();
                streamData.ytAccountName = userData.name || "YouTube Bot Connected";
            } catch (e) {
                streamData.ytAccountName = "Connected Account";
            }

            saveDataToDisk();
            broadcastState();

            const params = new URLSearchParams({
                auth: 'success',
                account: streamData.ytAccountName,
                refresh: streamData.ytRefreshToken || '',
                access: streamData.ytAccessToken || '',
                clientId: streamData.googleClientId || '',
                clientSecret: streamData.googleClientSecret || ''
            });

            res.redirect(`/admin.html?${params.toString()}`);
        } else {
            res.send("Token Exchange Error: " + JSON.stringify(tokenData));
        }
    } catch (err) {
        res.send("OAuth Error: " + err.message);
    }
});

async function ensureValidAccessToken() {
    if (!streamData.ytRefreshToken) return false;

    if (Date.now() > (streamData.ytTokenExpiresAt - 300000)) {
        try {
            const clientId = streamData.googleClientId || process.env.GOOGLE_CLIENT_ID;
            const clientSecret = streamData.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET;

            const res = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    refresh_token: streamData.ytRefreshToken,
                    grant_type: "refresh_token"
                })
            });

            const data = await res.json();
            if (data.access_token) {
                streamData.ytAccessToken = data.access_token;
                streamData.ytTokenExpiresAt = Date.now() + ((data.expires_in || 3600) * 1000);
                saveDataToDisk();
                return true;
            }
        } catch (e) {
            return false;
        }
    }
    return true;
}

// ========================================================
// 🤖 ROBUST POST TO YOUTUBE LIVE CHAT (DETAILED ERROR REPORTING)
// ========================================================
async function postToYouTubeChat(messageText) {
    if (!streamData.enableYTChatSend) {
        return { success: false, error: "Chat sending is disabled in settings." };
    }
    if (streamData.ytQuotaExhausted) {
        return { success: false, error: "Daily YouTube quota reached (180 msgs)." };
    }

    const hasToken = await ensureValidAccessToken();
    if (!hasToken || !streamData.ytAccessToken) {
        return { success: false, error: "Bot YouTube account not connected. Please login in AI Persona tab." };
    }

    // If liveChatId is missing, attempt to fetch it
    if (!streamData.ytLiveChatId && streamData.currentVideoId) {
        await fetchLiveChatIdFromVideoId(streamData.currentVideoId);
    }

    if (!streamData.ytLiveChatId) {
        return { success: false, error: "Live Chat ID not found. Ensure stream is online." };
    }

    try {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/liveChatMessages?part=snippet`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${streamData.ytAccessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                snippet: {
                    liveChatId: streamData.ytLiveChatId,
                    type: 'textMessageEvent',
                    textMessageDetails: { messageText: messageText.slice(0, 195) }
                }
            })
        });

        const data = await res.json();

        if (res.ok) {
            streamData.ytMessagesSentToday++;
            saveDataToDisk();
            broadcastState();
            return { success: true };
        } else {
            const errMsg = data.error && data.error.message ? data.error.message : JSON.stringify(data);
            if (res.status === 403 && (errMsg.includes('quota') || errMsg.includes('Quota'))) {
                handleQuotaExceeded();
            }
            return { success: false, error: errMsg };
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function handleQuotaExceeded() {
    streamData.ytQuotaExhausted = true;
    saveDataToDisk();
    broadcastState();
}

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

    if (streamData.enableYTChatSend && !streamData.ytQuotaExhausted) {
        postToYouTubeChat(text);
    }
}

// Zero-Key Fast AI
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
    const cName = streamData.characterName || 'Bot';
    if (userRole === 'owner') {
        const bossReplies = [
            `Streamer Boss, aapka aadesh sar ankhon par! Game par focus karein!`,
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
    if (userRole === 'owner') roleInstructions = `CRITICAL: The person talking is the STREAM OWNER / BOSS. Treat with highest royalty. Call them 'Boss'.`;
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

// ========================================================
// 🔍 AUTOMATIC STREAM & LIVE CHAT ID DETECTOR
// ========================================================
let liveChatInstance = null;
let isSearchingStream = false;

async function fetchLiveChatIdFromVideoId(videoId) {
    if (!streamData.ytAccessToken || !videoId) return false;
    try {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}`, {
            headers: { Authorization: `Bearer ${streamData.ytAccessToken}` }
        });
        const data = await res.json();
        if (data.items && data.items.length > 0 && data.items[0].liveStreamingDetails) {
            const chatId = data.items[0].liveStreamingDetails.activeLiveChatId;
            if (chatId) {
                streamData.ytLiveChatId = chatId;
                saveDataToDisk();
                broadcastState();
                return true;
            }
        }
    } catch(e) {}
    return false;
}

function attachLiveChatStream(videoId) {
    if (liveChatInstance) {
        try { liveChatInstance.stop(); } catch(e) {}
    }

    liveChatInstance = new LiveChat({ liveId: videoId });

    liveChatInstance.on("start", () => {
        currentStatus = 'online';
        streamData.currentVideoId = videoId;
        saveDataToDisk();
        io.emit('stream-status', { status: currentStatus, videoId });
        fetchLiveChatIdFromVideoId(videoId);
    });

    liveChatInstance.on("end", () => {
        currentStatus = 'offline';
        streamData.currentVideoId = '';
        saveDataToDisk();
        io.emit('stream-status', { status: currentStatus });
    });

    liveChatInstance.on("error", () => {
        currentStatus = 'offline';
        io.emit('stream-status', { status: currentStatus });
    });

    liveChatInstance.on("chat", handleChatMessage);

    liveChatInstance.start().then(ok => {
        if (ok) {
            currentStatus = 'online';
            streamData.currentVideoId = videoId;
            saveDataToDisk();
            io.emit('stream-status', { status: currentStatus, videoId });
            fetchLiveChatIdFromVideoId(videoId);
        }
    }).catch(() => {});
}

async function autoDetectStreamLoop() {
    if (isSearchingStream || currentStatus === 'online') return;
    isSearchingStream = true;

    try {
        // 1. Try RSS feed for latest videoId
        const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${MAIN_CHANNEL_ID}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (res.ok) {
            const xml = await res.text();
            const matches = [...xml.matchAll(/<yt:videoId>([a-zA-Z0-9_-]{11})<\/yt:videoId>/g)];
            if (matches.length > 0) {
                const latestId = matches[0][1];
                if (latestId && latestId !== streamData.currentVideoId) {
                    attachLiveChatStream(latestId);
                }
            }
        }
    } catch(e) {}

    isSearchingStream = false;
}

setInterval(autoDetectStreamLoop, 15000);
autoDetectStreamLoop();

// Chat Message Handler
async function handleChatMessage(chatItem) {
    const rawText = chatItem.message.map(m => m.text ? m.text : '').join('').trim();
    const message = rawText.toLowerCase();
    const username = chatItem.author.name || '';
    const authorChannelId = chatItem.author.channelId || '';
    const lowerName = username.toLowerCase();

    // 👑 100% BULLETPROOF STREAMER RECOGNITION (0 COINS, ALWAYS BOSS!)
    const isOwner = (authorChannelId === MAIN_CHANNEL_ID) || 
                    lowerName.includes('rajiv') || 
                    lowerName.includes('mac_s') ||
                    Boolean(chatItem.author.isOwner) || 
                    Boolean(chatItem.author.isChatOwner);

    const isMod = Boolean(chatItem.author.isModerator) || 
                  Boolean(chatItem.author.isChatModerator);

    const userRole = isOwner ? 'owner' : (isMod ? 'mod' : 'viewer');
    const userKey = username.toLowerCase();
    const cName = streamData.coinSettings.currencyName;
    const userAvatar = (chatItem.author && chatItem.author.thumbnailUrl) ? chatItem.author.thumbnailUrl : 'https://cdn-icons-png.flaticon.com/512/847/847969.png';

    // Auto-Moderation
    if (!isOwner && !isMod) {
        const ms = streamData.modSettings || {};
        if (ms.blockLinks && /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(com|in|org|net|io|gg|tv)\b)/i.test(rawText)) {
            broadcastResponse(`⚠️ @${username}, live chat mein links allow nahi hain!`, false);
            return;
        }
        if (ms.bannedWords) {
            const bannedList = ms.bannedWords.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
            for (const bad of bannedList) {
                if (message.includes(bad)) {
                    broadcastResponse(`⚠️ @${username}, inappropriate words allowed nahi hain.`, false);
                    return;
                }
            }
        }
    }

    // Super Chat Detection
    if (chatItem.superchat || chatItem.purchaseAmount) {
        const amount = chatItem.purchaseAmount || (chatItem.superchat && chatItem.superchat.amount) || "Donation";
        const spokenText = rawText 
            ? `${username} ne ${amount} bheje: "${rawText}"` 
            : `Huge shoutout to ${username} for the ${amount} Super Chat!`;

        io.emit('stream-alert', {
            type: 'superchat',
            user: username,
            amount: amount,
            avatar: userAvatar,
            msg: rawText || 'Thank you for supporting the stream!',
            ttsText: spokenText,
            voice: streamData.ttsVoice,
            pitch: streamData.ttsPitch,
            rate: streamData.ttsRate
        });
        return;
    }

    // Coins Accumulator
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
        const redeemsStr = catalog.redeems.map(r => r.cmd).join(', ') || 'None';
        const customsStr = catalog.customs.map(c => c.cmd).join(', ') || 'None';
        broadcastResponse(`📜 Commands 👉 [Core: ${coreStr}] | [Games: ${gamesStr}] | [Redeems: ${redeemsStr}] | [Info: ${customsStr}]`, false);
        return;
    }

    // Daily Claim
    if (message === '!daily' || message === '!claim') {
        if (!streamData.userDailyClaim) streamData.userDailyClaim = {};
        const lastClaim = streamData.userDailyClaim[userKey] || 0;
        const twentyFourHours = 24 * 60 * 60 * 1000;
        const elapsed = now - lastClaim;

        if (elapsed >= twentyFourHours) {
            if (!streamData.userCoins[userKey]) streamData.userCoins[userKey] = 0;
            streamData.userCoins[userKey] += 50;
            streamData.userDailyClaim[userKey] = now;
            saveDataToDisk();
            broadcastState();
            broadcastResponse(`🎁 @${username} ne Daily Bonus 🪙 50 ${cName} claim kiye! Balance: 🪙 ${streamData.userCoins[userKey]}`, false);
        } else {
            const remH = Math.floor((twentyFourHours - elapsed) / (1000 * 60 * 60));
            broadcastResponse(`⏳ @${username}, already claimed! Next in ${remH}h.`, false);
        }
        return;
    }

    // Media Triggers & Redeems (Streamer ke liye 100% FREE!)
    const matchedTrigger = streamData.triggers.find(t => t.cmd && t.cmd.toLowerCase() === message);
    if (matchedTrigger) {
        const cost = parseInt(matchedTrigger.cost) || 0;
        const currentBalance = streamData.userCoins[userKey] || 0;

        if (cost > 0 && !isOwner && currentBalance < cost) {
            broadcastResponse(`@${username}, '${matchedTrigger.name}' ke liye 🪙 ${cost} ${cName} chahiye!`, true);
            return;
        }

        if (cost > 0 && !isOwner) {
            streamData.userCoins[userKey] -= cost;
            saveDataToDisk();
            broadcastState();
        }

        if (matchedTrigger.type === 'video') io.emit('play-meme', { mediaUrl: matchedTrigger.url, name: matchedTrigger.name, redeemedBy: username });
        if (matchedTrigger.type === 'sfx') io.emit('play-sfx', { sfxUrl: matchedTrigger.url, name: matchedTrigger.name, redeemedBy: username });
        return;
    }

    // Custom Commands
    const matchedCustom = streamData.customCommands.find(c => c.cmd.toLowerCase() === message);
    if (matchedCustom) {
        const cost = parseInt(matchedCustom.cost) || 0;
        const currentBalance = streamData.userCoins[userKey] || 0;

        if (cost > 0 && !isOwner && currentBalance < cost) {
            broadcastResponse(`@${username}, '${matchedCustom.cmd}' ke liye 🪙 ${cost} ${cName} chahiye!`, true);
            return;
        }

        if (cost > 0 && !isOwner) {
            streamData.userCoins[userKey] -= cost;
            saveDataToDisk();
            broadcastState();
        }

        const replyPrefix = isOwner ? "Boss" : (isMod ? "Moderator ji" : `@${username}`);
        broadcastResponse(`${replyPrefix}, ${matchedCustom.reply}`, matchedCustom.tts === true);
        return;
    }

    // Direct TTS (Streamer ke liye 100% FREE!)
    if (message.startsWith('!tts ')) {
        const ttsText = rawText.replace(/^!tts\s+/i, '');
        io.emit('ai-speak', {
            characterName: username,
            characterImage: 'https://cdn-icons-png.flaticon.com/512/847/847969.png',
            text: ttsText,
            enableBubble: streamData.enableBubble,
            enableTTS: true,
            voice: streamData.ttsVoice,
            pitch: 1.0,
            rate: 1.0
        });
        return;
    }

    // AI Question (STREAMER KE LIYE 0 COINS - 100% FREE!)
    const activeCommand = (streamData.aiCommand || '!ai').toLowerCase();
    if (streamData.aiEnabled && (message.startsWith(activeCommand + ' ') || message === activeCommand)) {
        if (!isOwner && !isMod) {
            const lastTime = userLastAiTime[userKey] || 0;
            if (Date.now() - lastTime < 15000) {
                broadcastResponse(`⏳ @${username}, cooldown par ho!`, false);
                return;
            }
            userLastAiTime[userKey] = Date.now();
        }

        const question = rawText.slice(activeCommand.length).trim() || 'Kuch interesting batao!';
        const currentCoins = streamData.userCoins[userKey] || 0;
        const cost = streamData.coinSettings.aiCost;

        if (cost > 0 && !isOwner && currentCoins < cost) {
            broadcastResponse(`@${username}, AI se baat karne ke liye 🪙 ${cost} ${cName} chahiye!`, true);
            return;
        }

        if (cost > 0 && !isOwner) {
            streamData.userCoins[userKey] -= cost;
            saveDataToDisk();
            broadcastState();
        }

        const aiAnswer = await askAI(question, username, userRole);
        broadcastResponse(aiAnswer, true);
        return;
    }

    if (isOwner || isMod) {
        if (message === '!death+' || message === '!died') { streamData.deathCount++; broadcastState(); }
        if (message === '!death-') { if (streamData.deathCount > 0) streamData.deathCount--; broadcastState(); }
        if (message === '!deathreset') { streamData.deathCount = 0; broadcastState(); }
    }
}

const broadcastState = () => {
    io.emit('update-counter', { count: streamData.deathCount });
    io.emit('stream-status', { status: currentStatus, videoId: streamData.currentVideoId, liveChatId: streamData.ytLiveChatId });
    io.emit('update-styles', streamData);
    io.emit('load-triggers', streamData.triggers);
    io.emit('bet-update', getCalculatedBetData());
    io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
    io.emit('all-commands-catalog', getDynamicCommandCatalog());
    saveDataToDisk();
};

io.on('connection', (socket) => {
    socket.emit('update-counter', { count: streamData.deathCount });
    socket.emit('stream-status', { status: currentStatus, videoId: streamData.currentVideoId, liveChatId: streamData.ytLiveChatId });
    socket.emit('load-triggers', streamData.triggers);
    socket.emit('update-styles', streamData);
    socket.emit('bet-update', getCalculatedBetData());
    socket.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
    socket.emit('all-commands-catalog', getDynamicCommandCatalog());

    // 💬 TEST LIVE CHAT MESSAGE POST FROM DASHBOARD
    socket.on('admin-test-chat-post', async () => {
        const testText = "Yo stream! Bot account is connected and ready to chat!";
        const result = await postToYouTubeChat(testText);
        socket.emit('chat-post-result', result);
    });

    socket.on('admin-sync-local', (local) => {
        let changed = false;
        if (local.googleClientId && !streamData.googleClientId) { streamData.googleClientId = local.googleClientId; changed = true; }
        if (local.googleClientSecret && !streamData.googleClientSecret) { streamData.googleClientSecret = local.googleClientSecret; changed = true; }
        if (local.ytRefreshToken && !streamData.ytRefreshToken) { 
            streamData.ytRefreshToken = local.ytRefreshToken; 
            streamData.enableYTChatSend = true;
            changed = true; 
        }
        if (local.ytAccessToken && !streamData.ytAccessToken) { streamData.ytAccessToken = local.ytAccessToken; changed = true; }
        if (local.ytAccountName && !streamData.ytAccountName) { streamData.ytAccountName = local.ytAccountName; changed = true; }
        if (local.characterName) { streamData.characterName = local.characterName; changed = true; }
        if (local.characterImage) { streamData.characterImage = local.characterImage; changed = true; }
        if (local.ttsVoice) { streamData.ttsVoice = local.ttsVoice; changed = true; }
        if (local.ttsPitch) { streamData.ttsPitch = local.ttsPitch; changed = true; }
        if (local.ttsRate) { streamData.ttsRate = local.ttsRate; changed = true; }
        if (local.characterPersona) { streamData.characterPersona = local.characterPersona; changed = true; }

        if (changed) {
            saveDataToDisk();
            broadcastState();
        }
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
            ? `Namaste! Voice aur overlay bilkul active hain. Main hoon ${streamData.characterName}!` 
            : `Yo! Voice aur overlay bilkul active hain. Main hoon ${streamData.characterName}!`;

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

    socket.on('admin-disconnect-google', () => {
        streamData.ytAccessToken = '';
        streamData.ytRefreshToken = '';
        streamData.ytAccountName = '';
        streamData.ytLiveChatId = '';
        streamData.enableYTChatSend = false;
        saveDataToDisk();
        broadcastState();
    });

    socket.on('admin-reset-yt-quota', () => {
        streamData.ytQuotaExhausted = false;
        streamData.ytMessagesSentToday = 0;
        saveDataToDisk();
        broadcastState();
    });

    socket.on('admin-death-add', () => { streamData.deathCount++; broadcastState(); });
    socket.on('admin-death-sub', () => { if (streamData.deathCount > 0) streamData.deathCount--; broadcastState(); });
    socket.on('admin-death-reset', () => { streamData.deathCount = 0; broadcastState(); });

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
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
