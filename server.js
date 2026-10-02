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
const CHANNEL_ID = 'UCjckDwkpw4xQAPlF5NEm2tQ'; // Aapka Main Streamer Channel

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

    // Auto-Moderation
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
    } catch (e) {
        console.error('Data load error:', e);
    }
}

const saveDataToDisk = () => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(streamData, null, 2));
    } catch (e) {
        console.error('Data save error:', e);
    }
};

let currentStatus = 'offline';
let isTimerRunning = false;
let lastEarnedTime = {};

setInterval(() => {
    if (isTimerRunning) {
        streamData.gameTimeSeconds++;
        io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
        if (streamData.gameTimeSeconds % 10 === 0) saveDataToDisk();
    }
}, 1000);

// ========================================================
// 🎙️ BULLETPROOF AUDIO PROXY
// ========================================================
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

            try {
                const seUrl = `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodeURIComponent(text)}`;
                const seRes = await fetch(seUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                });
                if (seRes.ok) {
                    const buf = Buffer.from(await seRes.arrayBuffer());
                    if (buf.length > 300) {
                        res.setHeader('Content-Type', 'audio/mpeg');
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        return res.send(buf);
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
                streamData.ytAccountName = userData.name || "Connected Channel (Bot)";
            } catch (e) {
                streamData.ytAccountName = "Connected Channel (Bot)";
            }

            await resolveLiveChatId();
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
            console.error("Auto token refresh failed:", e);
            return false;
        }
    }
    return true;
}

// ========================================================
// 🔗 AUTO-DETECT ACTIVE LIVE CHAT ID OF MAIN STREAMER
// ========================================================
async function resolveLiveChatId() {
    if (!streamData.ytAccessToken) return null;
    try {
        let videoId = liveChat.liveId;

        // Agar liveChat se direct ID nahi mili toh channel ke live URL se scrape karo
        if (!videoId) {
            const pageRes = await fetch(`https://www.youtube.com/channel/${CHANNEL_ID}/live`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            const html = await pageRes.text();
            const match = html.match(/"liveStreamability":{"liveStreamabilityRenderer":{"videoId":"([^"]+)"/i) 
                       || html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
            if (match && match[1]) {
                videoId = match[1];
            }
        }

        if (!videoId) return null;

        // YouTube API se activeLiveChatId maango (Bot account se)
        const vidRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}`, {
            headers: { Authorization: `Bearer ${streamData.ytAccessToken}` }
        });
        const vidData = await vidRes.json();
        if (vidData.items && vidData.items.length > 0 && vidData.items[0].liveStreamingDetails?.activeLiveChatId) {
            const foundChatId = vidData.items[0].liveStreamingDetails.activeLiveChatId;
            streamData.ytLiveChatId = foundChatId;
            saveDataToDisk();
            broadcastState();
            console.log(`✅ Live Chat ID linked to Bot: ${foundChatId}`);
            return foundChatId;
        }
    } catch (err) {
        console.error("Error resolving Live Chat ID:", err);
    }
    return null;
}

setInterval(() => {
    if (streamData.enableYTChatSend && streamData.ytAccessToken) {
        if (!streamData.ytLiveChatId) resolveLiveChatId();
    }
}, 45000);

async function postToYouTubeChat(messageText) {
    if (!streamData.enableYTChatSend || streamData.ytQuotaExhausted) return;
    const hasToken = await ensureValidAccessToken();
    if (!hasToken || !streamData.ytAccessToken) return;

    if (!streamData.ytLiveChatId) {
        await resolveLiveChatId();
        if (!streamData.ytLiveChatId) return;
    }

    if (streamData.ytMessagesSentToday >= 180) {
        handleQuotaExceeded();
        return;
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
        if (res.status === 403 || (data.error && data.error.errors && data.error.errors[0].reason === 'quotaExceeded')) {
            handleQuotaExceeded();
            return;
        }

        if (res.ok) {
            streamData.ytMessagesSentToday++;
            saveDataToDisk();
            broadcastState();
        }
    } catch (err) {
        console.error("YouTube Post Error:", err);
    }
}

function handleQuotaExceeded() {
    if (streamData.ytQuotaExhausted) return;
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

// ⚡ ZERO-KEY FAST AI PROCESSOR
async function queryZeroKeyNeuralCloud(systemPrompt, userPrompt) {
    const endpoints = [
        {
            url: "https://text.pollinations.ai/",
            method: "POST",
            body: JSON.stringify({
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                model: "openai",
                seed: Math.floor(Math.random() * 10000)
            })
        },
        {
            url: `https://text.pollinations.ai/${encodeURIComponent(systemPrompt + " | User: " + userPrompt + " | Keep reply under 2 sentences.")}?model=mistral`,
            method: "GET"
        }
    ];

    for (const ep of endpoints) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 2600);
            const options = {
                method: ep.method,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                signal: controller.signal
            };
            if (ep.body) options.body = ep.body;

            const res = await fetch(ep.url, options);
            clearTimeout(timeout);

            if (res.ok) {
                const text = await res.text();
                const clean = text.replace(/<[^>]*>?/gm, '').trim();
                if (clean && clean.length > 3 && !clean.toLowerCase().includes("error") && !clean.includes("<!DOCTYPE")) {
                    return { success: true, text: clean };
                }
            }
        } catch(e) {}
    }
    return { success: false };
}

function generateInstantPersonaReply(userPrompt, username, userRole) {
    const p = userPrompt.toLowerCase();
    const cName = streamData.characterName || 'Bot';

    if (userRole === 'owner') {
        const bossReplies = [
            `Streamer Boss, aapka hukum sar ankhon par! Kahiye kya aadesh hai?`,
            `Boss! Match par poora dhyan do, chat ko main handle kar raha hoon!`,
            `Salam Streamer Sahab! Agle round mein enemy ko tabah kardo!`
        ];
        return bossReplies[Math.floor(Math.random() * bossReplies.length)];
    }

    if (userRole === 'mod') {
        return `Moderator ji! Chat bilkul shanti se chal rahi hai, chill karein.`;
    }

    if (p.includes('hi') || p.includes('hello') || p.includes('namaste') || p.includes('kaisa')) {
        return `Yo @${username}! Main hoon ${cName}, khamosh baitho aur stream ka maza lo.`;
    }
    if (p.includes('khel') || p.includes('game') || p.includes('rank') || p.includes('pro')) {
        return `@${username}, mere streamer ka gameplay dekh, tera dimag hil jayega!`;
    }

    return `@${username}, tum jaise mamooli bando se baat karna mera shaan nahi, par theek hai!`;
}

async function askAI(userPrompt, username, userRole) {
    let roleInstructions = "";
    if (userRole === 'owner') roleInstructions = `CRITICAL: The person talking is the STREAM OWNER / BOSS. Treat them with absolute royalty. Call them 'Boss' or 'Streamer Sahab'.`;
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

// Live Chat Listener
const chatConfig = { channelId: CHANNEL_ID };
const liveChat = new LiveChat(chatConfig);

const startChat = async () => {
    try {
        currentStatus = 'retrying';
        io.emit('stream-status', { status: currentStatus });
        const ok = await liveChat.start();
        if (ok) {
            currentStatus = 'online';
            io.emit('stream-status', { status: currentStatus });
            resolveLiveChatId();
        }
    } catch (error) {
        currentStatus = 'offline';
        io.emit('stream-status', { status: currentStatus });
        setTimeout(startChat, 15000); 
    }
};

liveChat.on("error", () => {
    currentStatus = 'offline';
    io.emit('stream-status', { status: currentStatus });
    liveChat.stop();
    setTimeout(startChat, 15000);
});

startChat();

liveChat.on("chat", async (chatItem) => {
    const rawText = chatItem.message.map(m => m.text ? m.text : '').join('').trim();
    const message = rawText.toLowerCase();
    const username = chatItem.author.name;

    // ========================================================
    // 👑 100% BULLETPROOF STREAMER & MOD RECOGNITION
    // ========================================================
    const authorChannelId = chatItem.author.channelId || '';
    const isMainStreamer = (authorChannelId === CHANNEL_ID) || chatItem.author.isChatOwner;
    const isModerator = chatItem.author.isChatModerator;

    // Streamer ya Moderator ke liye coin system aur cooldown poori tarah BYPASS hai!
    const isVipOrStreamer = isMainStreamer || isModerator;

    const userRole = isMainStreamer ? 'owner' : (isModerator ? 'mod' : 'viewer');
    const userKey = username.toLowerCase();
    const cName = streamData.coinSettings.currencyName;
    const userAvatar = (chatItem.author && chatItem.author.thumbnailUrl) ? chatItem.author.thumbnailUrl : 'https://cdn-icons-png.flaticon.com/512/847/847969.png';

    // Auto-Moderation (Streamer & Mods are exempt)
    if (!isVipOrStreamer) {
        const ms = streamData.modSettings || {};
        if (ms.blockLinks) {
            const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(com|in|org|net|io|gg|tv)\b)/i;
            if (urlRegex.test(rawText)) {
                broadcastResponse(`⚠️ @${username}, live chat mein links allow nahi hain!`, false);
                return;
            }
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

    // Coin Accumulator (For normal chatters)
    const now = Date.now();
    if (!lastEarnedTime[userKey] || (now - lastEarnedTime[userKey]) >= (streamData.coinSettings.cooldownSeconds * 1000)) {
        if (!streamData.userCoins[userKey]) streamData.userCoins[userKey] = 0;
        streamData.userCoins[userKey] += streamData.coinSettings.coinsPerMsg;
        lastEarnedTime[userKey] = now;
        saveDataToDisk();
    }

    // Command Catalog
    if (message === '!commands' || message === '!help' || message === '!cmds') {
        const catalog = getDynamicCommandCatalog();
        const coreStr = catalog.core.map(c => c.cmd.split(' ')[0]).join(', ');
        const gamesStr = "!gamble, !slots, !duel, !bet";
        const redeemsStr = catalog.redeems.map(r => r.cmd).join(', ') || 'None';
        const customsStr = catalog.customs.map(c => c.cmd).join(', ') || 'None';

        const replyMsg = `📜 Commands 👉 [Core: ${coreStr}] | [Games: ${gamesStr}] | [Redeems: ${redeemsStr}] | [Info: ${customsStr}]`;
        broadcastResponse(replyMsg, false);
        return;
    }

    // Daily & Leaderboard
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
            broadcastResponse(`🎁 @${username} ne Daily Bonus 🪙 50 ${cName} claim kiye! New Balance: 🪙 ${streamData.userCoins[userKey]}`, false);
        } else {
            const remMs = twentyFourHours - elapsed;
            const remH = Math.floor(remMs / (1000 * 60 * 60));
            const remM = Math.floor((remMs % (1000 * 60 * 60)) / (1000 * 60));
            broadcastResponse(`⏳ @${username}, aapne already claim kar liya hai! Next claim: ${remH}h ${remM}m baad.`, false);
        }
        return;
    }

    if (message === '!topcoins' || message === '!leaderboard') {
        const entries = Object.entries(streamData.userCoins || {});
        if (entries.length === 0) {
            broadcastResponse(`Abhi kisi ke paas ${cName} nahi hain!`, false);
            return;
        }
        entries.sort((a, b) => b[1] - a[1]);
        const top3 = entries.slice(0, 3).map((e, idx) => `${idx + 1}. @${e[0]} (🪙${e[1]})`).join(' | ');
        broadcastResponse(`🏆 Top Rich Viewers 👉 ${top3}`, false);
        return;
    }

    // Mini-Games
    if (message.startsWith('!gamble ') || message.startsWith('!roulette ')) {
        const parts = rawText.split(' ');
        const amount = parseInt(parts[1]);
        const currentBalance = streamData.userCoins[userKey] || 0;

        if (isNaN(amount) || amount <= 0) return;
        if (currentBalance < amount) {
            broadcastResponse(`@${username}, aapke paas gamble karne ke liye sirf 🪙 ${currentBalance} ${cName} hain!`, false);
            return;
        }

        const isWin = Math.random() < 0.50;
        if (isWin) {
            streamData.userCoins[userKey] += amount;
            broadcastResponse(`🎲 [WIN!] @${username} ne 🪙 ${amount} gamble kiya aur JEET GAYA! Balance: 🪙 ${streamData.userCoins[userKey]} ${cName}`, false);
        } else {
            streamData.userCoins[userKey] -= amount;
            broadcastResponse(`💀 [LOSS!] @${username} ne 🪙 ${amount} gamble kiya aur HAAR GAYA! Balance: 🪙 ${streamData.userCoins[userKey]} ${cName}`, false);
        }
        saveDataToDisk();
        broadcastState();
        return;
    }

    if (message.startsWith('!slots ')) {
        const parts = rawText.split(' ');
        const amount = parseInt(parts[1]);
        const currentBalance = streamData.userCoins[userKey] || 0;

        if (isNaN(amount) || amount <= 0) return;
        if (currentBalance < amount) {
            broadcastResponse(`@${username}, aapke paas slots ke liye sirf 🪙 ${currentBalance} ${cName} hain!`, false);
            return;
        }

        const symbols = ['🍒', '🍋', '🍇', '💎', '7️⃣'];
        const s1 = symbols[Math.floor(Math.random() * symbols.length)];
        const s2 = symbols[Math.floor(Math.random() * symbols.length)];
        const s3 = symbols[Math.floor(Math.random() * symbols.length)];

        if (s1 === s2 && s2 === s3) {
            const win = amount * 5;
            streamData.userCoins[userKey] += (win - amount);
            broadcastResponse(`🎰 [${s1} | ${s2} | ${s3}] JACKPOT!! @${username} ne 5x jeeta (+🪙 ${win} ${cName})!`, false);
        } else if (s1 === s2 || s2 === s3 || s1 === s3) {
            const win = amount * 2;
            streamData.userCoins[userKey] += (win - amount);
            broadcastResponse(`🎰 [${s1} | ${s2} | ${s3}] 2 MATCH! @${username} ne 2x jeeta (+🪙 ${win} ${cName})!`, false);
        } else {
            streamData.userCoins[userKey] -= amount;
            broadcastResponse(`🎰 [${s1} | ${s2} | ${s3}] No match! @${username} lost 🪙 ${amount} ${cName}.`, false);
        }
        saveDataToDisk();
        broadcastState();
        return;
    }

    if (message.startsWith('!duel ')) {
        const parts = rawText.split(' ');
        if (parts.length >= 3) {
            const targetUser = parts[1].replace('@', '').toLowerCase();
            const amount = parseInt(parts[2]);
            const challengerBalance = streamData.userCoins[userKey] || 0;
            const targetBalance = streamData.userCoins[targetUser] || 0;

            if (targetUser === userKey) return;
            if (isNaN(amount) || amount <= 0) return;
            if (challengerBalance < amount || targetBalance < amount) return;

            activeDuels[targetUser] = {
                challenger: username,
                challengerKey: userKey,
                amount: amount,
                expires: Date.now() + 60000
            };

            broadcastResponse(`⚔️ DUEL! @${username} ne @${targetUser} ko 🪙 ${amount} ${cName} duel ka challenge diya! Accept: !accept`, false);
            return;
        }
    }

    if (message === '!accept') {
        const duel = activeDuels[userKey];
        if (duel && Date.now() < duel.expires) {
            const amount = duel.amount;
            const challengerKey = duel.challengerKey;
            const challengerName = duel.challenger;

            if ((streamData.userCoins[challengerKey] || 0) >= amount && (streamData.userCoins[userKey] || 0) >= amount) {
                const challengerWins = Math.random() < 0.5;
                if (challengerWins) {
                    streamData.userCoins[challengerKey] += amount;
                    streamData.userCoins[userKey] -= amount;
                    broadcastResponse(`⚔️ DUEL OVER: @${challengerName} ne @${username} ko hara kar 🪙 ${amount} ${cName} jeet liye!`, true);
                } else {
                    streamData.userCoins[userKey] += amount;
                    streamData.userCoins[challengerKey] -= amount;
                    broadcastResponse(`⚔️ DUEL OVER: @${username} ne @${challengerName} ko hara kar 🪙 ${amount} ${cName} jeet liye!`, true);
                }
                delete activeDuels[userKey];
                saveDataToDisk();
                broadcastState();
                return;
            }
        }
    }

    if (message === '!coins' || message === '!balance' || message === '!maccoins') {
        const balance = streamData.userCoins[userKey] || 0;
        broadcastResponse(`@${username}, aapke paas 🪙 ${balance} ${cName} hain!`, false);
        return;
    }

    if (message.startsWith('!givecoins ') || message.startsWith('!addcoins ')) {
        if (!isVipOrStreamer) return;
        const parts = rawText.split(' ');
        if (parts.length >= 3) {
            const targetUser = parts[1].replace('@', '').toLowerCase();
            const amount = parseInt(parts[2]);
            if (!isNaN(amount) && amount > 0) {
                if (!streamData.userCoins[targetUser]) streamData.userCoins[targetUser] = 0;
                streamData.userCoins[targetUser] += amount;
                saveDataToDisk();
                broadcastState();
                broadcastResponse(`Streamer Boss ne @${targetUser} ko 🪙 ${amount} ${cName} diye!`, true);
                return;
            }
        }
    }

    if (message.startsWith('!pay ') || message.startsWith('!transfer ')) {
        const parts = rawText.split(' ');
        if (parts.length >= 3) {
            const recipient = parts[1].replace('@', '').toLowerCase();
            const amount = parseInt(parts[2]);
            if (recipient !== userKey && !isNaN(amount) && amount > 0) {
                const senderBalance = streamData.userCoins[userKey] || 0;
                if (senderBalance >= amount) {
                    streamData.userCoins[userKey] -= amount;
                    if (!streamData.userCoins[recipient]) streamData.userCoins[recipient] = 0;
                    streamData.userCoins[recipient] += amount;
                    saveDataToDisk();
                    broadcastState();
                    broadcastResponse(`💸 @${username} ne @${recipient} ko 🪙 ${amount} ${cName} transfer kiye!`, true);
                }
            }
            return;
        }
    }

    const matchedTrigger = streamData.triggers.find(t => t.cmd && t.cmd.toLowerCase() === message);
    if (matchedTrigger) {
        const cost = parseInt(matchedTrigger.cost) || 0;
        const currentBalance = streamData.userCoins[userKey] || 0;

        // Streamer & Mods bypass coin requirement
        if (cost > 0 && !isVipOrStreamer && currentBalance < cost) {
            broadcastResponse(`@${username}, '${matchedTrigger.name}' ke liye 🪙 ${cost} ${cName} chahiye! Tere paas sirf ${currentBalance} coins hain.`, true);
            return;
        }

        if (cost > 0 && !isVipOrStreamer) {
            streamData.userCoins[userKey] -= cost;
            saveDataToDisk();
            broadcastState();
        }

        if (matchedTrigger.type === 'video') io.emit('play-meme', { mediaUrl: matchedTrigger.url, name: matchedTrigger.name, redeemedBy: username });
        if (matchedTrigger.type === 'sfx') io.emit('play-sfx', { sfxUrl: matchedTrigger.url, name: matchedTrigger.name, redeemedBy: username });
        return;
    }

    const matchedCustom = streamData.customCommands.find(c => c.cmd.toLowerCase() === message);
    if (matchedCustom) {
        const cost = parseInt(matchedCustom.cost) || 0;
        const currentBalance = streamData.userCoins[userKey] || 0;

        if (cost > 0 && !isVipOrStreamer && currentBalance < cost) {
            broadcastResponse(`@${username}, '${matchedCustom.cmd}' ke liye 🪙 ${cost} ${cName} chahiye!`, true);
            return;
        }

        if (cost > 0 && !isVipOrStreamer) {
            streamData.userCoins[userKey] -= cost;
            saveDataToDisk();
            broadcastState();
        }

        const replyPrefix = isMainStreamer ? "Boss" : (isModerator ? "Moderator ji" : `@${username}`);
        broadcastResponse(`${replyPrefix}, ${matchedCustom.reply}`, matchedCustom.tts === true);
        return;
    }

    // Direct TTS (Streamer & Mods are ALWAYS FREE)
    if (message.startsWith('!tts ')) {
        const ttsText = rawText.replace(/^!tts\s+/i, '');
        io.emit('ai-speak', {
            characterName: username,
            characterImage: userAvatar,
            text: ttsText,
            enableBubble: streamData.enableBubble,
            enableTTS: true,
            voice: streamData.ttsVoice,
            pitch: 1.0,
            rate: 1.0
        });
        return;
    }

    // AI Question Execution (STREAMER & MODS NEVER CHARGED OR RATE-LIMITED)
    const activeCommand = (streamData.aiCommand || '!ai').toLowerCase();
    if (streamData.aiEnabled && (message.startsWith(activeCommand + ' ') || message === activeCommand)) {
        if (!isVipOrStreamer) {
            const lastTime = userLastAiTime[userKey] || 0;
            const diff = Date.now() - lastTime;
            if (diff < 15000) {
                const remSec = Math.ceil((15000 - diff) / 1000);
                broadcastResponse(`⏳ @${username}, cooldown par ho! ${remSec}s baad pooch sakte ho.`, false);
                return;
            }
            userLastAiTime[userKey] = Date.now();
        }

        const question = rawText.slice(activeCommand.length).trim() || 'Kuch interesting batao!';
        const currentCoins = streamData.userCoins[userKey] || 0;
        const cost = streamData.coinSettings.aiCost;

        if (cost > 0 && !isVipOrStreamer && currentCoins < cost) {
            broadcastResponse(`@${username}, AI se baat karne ke liye 🪙 ${cost} ${cName} chahiye! Tere paas sirf ${currentCoins} hain.`, true);
            return;
        }

        if (cost > 0 && !isVipOrStreamer) {
            streamData.userCoins[userKey] -= cost;
            saveDataToDisk();
            broadcastState();
        }

        const aiAnswer = await askAI(question, username, userRole);
        broadcastResponse(aiAnswer, true);
        return;
    }

    if (isVipOrStreamer) {
        if (message === '!death+' || message === '!died') { streamData.deathCount++; broadcastState(); }
        if (message === '!death-') { if (streamData.deathCount > 0) streamData.deathCount--; broadcastState(); }
        if (message === '!deathreset') { streamData.deathCount = 0; broadcastState(); }
    }
});

const broadcastState = () => {
    io.emit('update-counter', { count: streamData.deathCount });
    io.emit('update-styles', streamData);
    io.emit('load-triggers', streamData.triggers);
    io.emit('bet-update', getCalculatedBetData());
    io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
    io.emit('all-commands-catalog', getDynamicCommandCatalog());
    saveDataToDisk();
};

io.on('connection', (socket) => {
    socket.emit('update-counter', { count: streamData.deathCount });
    socket.emit('stream-status', { status: currentStatus });
    socket.emit('load-triggers', streamData.triggers);
    socket.emit('update-styles', streamData);
    socket.emit('bet-update', getCalculatedBetData());
    socket.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
    socket.emit('all-commands-catalog', getDynamicCommandCatalog());

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

    socket.on('admin-force-sync-chat-id', async () => {
        const id = await resolveLiveChatId();
        if (id) {
            socket.emit('alert-message', '✅ Live Chat ID linked successfully: ' + id);
        } else {
            socket.emit('alert-message', '❌ Live Stream detect nahi hua! Make sure stream Public/Unlisted LIVE hai.');
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

        const testMsg = `Boss! System active hai aur stream control ready hai!`;
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

    socket.on('admin-disconnect-google', () => {
        streamData.ytAccessToken = '';
        streamData.ytRefreshToken = '';
        streamData.ytAccountName = '';
        streamData.enableYTChatSend = false;
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
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
