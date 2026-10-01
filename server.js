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

let streamData = {
    deathCount: 0,
    gameTimeSeconds: 0,
    counterIcon: '💀',
    counterFont: 'Teko',
    clockFont: 'Share Tech Mono',
    timerFont: 'Orbitron',
    themeColor: '#ff4757',
    
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    groqApiKey: process.env.GROQ_API_KEY || '',

    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    ytAccessToken: '',
    ytRefreshToken: '',
    ytTokenExpiresAt: 0,
    ytAccountName: '',
    ytLiveChatId: '',
    enableYTChatSend: false,
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
    characterPersona: "You are the King of Curses, Ryomen Sukuna. Proud, condescending, and majestic. Treat ordinary viewers like mere brats. Reply in 1-2 royal sentences.",
    welcomeNewChatters: true,
    reminderMinutes: 15,

    // Auto-Moderation Settings
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

// Pending Duels Memory
let activeDuels = {};

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
        if (!streamData.userHistories) streamData.userHistories = {};
        if (!streamData.triggers) streamData.triggers = [];
        if (!streamData.customCommands) streamData.customCommands = [];
        if (!streamData.modSettings) {
            streamData.modSettings = {
                blockLinks: true,
                capsFilter: true,
                maxCapsPercent: 70,
                bannedWords: "mc,bc,bhenchod,madarchod,gandu,chutiya,randi,bsdk"
            };
        }
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

setInterval(() => {
    if (currentStatus === 'online') {
        const discordCmd = streamData.customCommands.find(c => c.cmd === '!discord');
        const reminderText = discordCmd ? discordCmd.reply : `Chat karke ${streamData.coinSettings.currencyName} kamao aur !gamble, !slots karke multiply karo!`;
        broadcastResponse(reminderText, false);
    }
}, Math.max(streamData.reminderMinutes, 5) * 60 * 1000);

// ========================================================
// 🎙️ BULLETPROOF DUAL AUDIO PROXY
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
                const seUrl = `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodeURIComponent(text)}`;                 const seRes = await fetch(seUrl, {                     headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }                 });                 if (seRes.ok) {                     const buf = Buffer.from(await seRes.arrayBuffer());                     if (buf.length > 300) {                         res.setHeader('Content-Type', 'audio/mpeg');                         res.setHeader('Access-Control-Allow-Origin', '*');                         return res.send(buf);                     }                 }             } catch(e) {}         }          res.status(500).send("TTS Error");     } catch(err) {         res.status(500).send("TTS Error: " + err.message);     } });  // OAuth Routes const REDIRECT_URI = "https://stream-bot-hqlh.onrender.com/oauth2callback";  app.get('/auth/google', (req, res) => {     const clientId = streamData.googleClientId \vert{}\vert{} process.env.GOOGLE_CLIENT_ID;     if (!clientId) {         return res.send("<script>alert('Pehle Dashboard mein Google Client ID daal kar Save karein!'); window.location.href='/admin.html';</script>");     }      const scope = encodeURIComponent("https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/userinfo.profile");     const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
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
                    headers: { Authorization: `Bearer ${tokenData.access_token}` }                 });                 const userData = await userRes.json();                 streamData.ytAccountName = userData.name \vert{}\vert{} "YouTube Account Connected";             } catch (e) {                 streamData.ytAccountName = "Connected Account";             }              await fetchActiveLiveChatId();             saveDataToDisk();             broadcastState();              const params = new URLSearchParams({                 auth: 'success',                 account: streamData.ytAccountName,                 refresh: streamData.ytRefreshToken \vert{}\vert{} '',                 access: streamData.ytAccessToken \vert{}\vert{} '',                 clientId: streamData.googleClientId \vert{}\vert{} '',                 clientSecret: streamData.googleClientSecret \vert{}\vert{} ''             });              res.redirect(`/admin.html?${params.toString()}`);
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

async function fetchActiveLiveChatId() {
    if (!streamData.ytAccessToken) return;
    try {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/liveBroadcasts?broadcastStatus=active&broadcastType=all&part=snippet`, {
            headers: { Authorization: `Bearer ${streamData.ytAccessToken}` }         });         const data = await res.json();         if (data.items && data.items.length > 0 && data.items[0].snippet.liveChatId) {             streamData.ytLiveChatId = data.items[0].snippet.liveChatId;             saveDataToDisk();         }     } catch (e) {} }  setInterval(() => {     if (streamData.enableYTChatSend && streamData.ytAccessToken) fetchActiveLiveChatId(); }, 120000);  async function postToYouTubeChat(messageText) {     if (!streamData.enableYTChatSend \vert{}\vert{} streamData.ytQuotaExhausted) return;     const hasToken = await ensureValidAccessToken();     if (!hasToken \vert{}\vert{} !streamData.ytAccessToken \vert{}\vert{} !streamData.ytLiveChatId) return;      if (streamData.ytMessagesSentToday >= 180) {         handleQuotaExceeded();         return;     }      try {         const res = await fetch(`https://www.googleapis.com/youtube/v3/liveChatMessages?part=snippet`, {             method: 'POST',             headers: {                 'Authorization': `Bearer ${streamData.ytAccessToken}`,
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

    const alertMsg = "Dhyan dein! YouTube chat quota khatam ho gaya hai. Ab se saare replies screen speech bubble aur TTS voice mein aayenge!";
    io.emit('ai-speak', {
        characterName: streamData.characterName,
        characterImage: streamData.characterImage,
        text: alertMsg,
        enableBubble: true,
        enableTTS: true,
        voice: streamData.ttsVoice,
        pitch: streamData.ttsPitch,
        rate: streamData.ttsRate
    });
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

// AI Drivers
async function callPublicZeroKeyDriver(systemText, userText) {
    try {
        const fullPrompt = `${systemText}\nUser:${userText}\nKeep reply punchy in 1-2 short sentences.`;
        const res = await fetch(`https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}?model=openai`);         if (res.ok) {             const text = await res.text();             if (text && text.trim().length > 0) return { success: true, text: text.trim() };         }     } catch(e) {}     return { success: false }; }  async function callGroqDriver(key, systemText, userText, history) {     if (!key \vert{}\vert{} !key.startsWith('gsk_')) return { success: false };     const messages = [{ role: "system", content: systemText }];     if (history && history.length) {         history.slice(-6).forEach(h => messages.push({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text }));     }     messages.push({ role: "user", content: userText });      const models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];     for (const m of models) {         try {             const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {                 method: "POST",                 headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
                body: JSON.stringify({ model: m, messages: messages, max_tokens: 150 })
            });
            const data = await res.json();
            if (data.choices && data.choices[0] && data.choices[0].message) {
                return { success: true, text: data.choices[0].message.content.trim() };
            }
        } catch (e) {}
    }
    return { success: false };
}

async function callGeminiDriver(key, systemText, userText, history) {
    if (!key) return { success: false };
    const contents = [];
    if (history && history.length) {
        history.slice(-6).forEach(entry => contents.push({ role: entry.role === 'model' ? 'model' : 'user', parts: [{ text: entry.text }] }));
    }
    contents.push({ role: "user", parts: [{ text: userText }] });

    const models = ["gemini-2.5-flash", "gemini-1.5-flash"];
    for (const m of models) {
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ system_instruction: { parts: [{ text: systemText }] }, contents })
            });
            const data = await res.json();
            if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
                return { success: true, text: data.candidates[0].content.parts[0].text.trim() };
            }
        } catch (e) {}
    }
    return { success: false };
}

async function askAI(userPrompt, username, userRole) {
    let roleInstructions = "";
    if (userRole === 'owner') roleInstructions = `CRITICAL: The person talking is the STREAM OWNER / BOSS. Treat them with highest honor. Call them 'Boss' or 'Streamer Sahab'.`;
    else if (userRole === 'mod') roleInstructions = `CRITICAL: The person talking is a MODERATOR. Call them 'Moderator ji' or 'Mod Sahab'.`;
    else roleInstructions = `The viewer talking is named @${username}.`;

    const systemInstructionText = `${streamData.characterPersona}\n${roleInstructions}\nKeep answers short (1-2 sentences) for stream speech bubble.`;
    const history = streamData.userHistories[username] || [];

    const groqKey = streamData.groqApiKey || process.env.GROQ_API_KEY;
    if (groqKey) {
        const res = await callGroqDriver(groqKey, systemInstructionText, userPrompt, history);
        if (res.success) { recordHistory(username, userPrompt, res.text); return res.text; }
    }

    const geminiKey = streamData.geminiApiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) {
        const res = await callGeminiDriver(geminiKey, systemInstructionText, userPrompt, history);
        if (res.success) { recordHistory(username, userPrompt, res.text); return res.text; }
    }

    const publicRes = await callPublicZeroKeyDriver(systemInstructionText, userPrompt);
    if (publicRes.success) { recordHistory(username, userPrompt, publicRes.text); return publicRes.text; }

    return "Power level bohot high ho gaya! Thodi der baad poocho.";
}

function recordHistory(username, userPrompt, aiReply) {
    if (!streamData.userHistories[username]) streamData.userHistories[username] = [];
    streamData.userHistories[username].push({ role: 'user', text: userPrompt });
    streamData.userHistories[username].push({ role: 'model', text: aiReply });
    if (streamData.userHistories[username].length > 8) streamData.userHistories[username] = streamData.userHistories[username].slice(-8);
    saveDataToDisk();
}

// Live Chat Listener
const CHANNEL_ID = 'UCjckDwkpw4xQAPlF5NEm2tQ';
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
    const isOwner = chatItem.author.isChatOwner;
    const isMod = chatItem.author.isChatModerator;
    const userRole = isOwner ? 'owner' : (isMod ? 'mod' : 'viewer');
    const userKey = username.toLowerCase();
    const cName = streamData.coinSettings.currencyName;

    // ========================================================
    // 🛡️ 1. AUTO-MODERATION & SPAM FILTER
    // ========================================================
    if (!isOwner && !isMod) {
        const ms = streamData.modSettings || {};

        // Link Blocker Check
        if (ms.blockLinks) {
            const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.(com|in|org|net|io|gg|tv)\b)/i;
            if (urlRegex.test(rawText)) {
                broadcastResponse(`⚠️ @${username}, live stream chat mein links post karna mana hai!`, false);
                return;
            }
        }

        // Banned Words Check
        if (ms.bannedWords) {
            const bannedList = ms.bannedWords.split(',').map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
            for (const bad of bannedList) {
                if (message.includes(bad)) {
                    broadcastResponse(`⚠️ @${username}, chat mein abusive language use karna mana hai! Warning di ja rahi hai.`, false);
                    return;
                }
            }
        }

        // CAPS Spam Check
        if (ms.capsFilter && rawText.length >= 10) {
            let uppercaseCount = 0;
            for (let i = 0; i < rawText.length; i++) {
                if (rawText[i] >= 'A' && rawText[i] <= 'Z') uppercaseCount++;
            }
            const pct = Math.round((uppercaseCount / rawText.length) * 100);
            if (pct >= (ms.maxCapsPercent || 70)) {
                broadcastResponse(`⚠️ @${username}, excessive CAPS lock use na karein!`, false);
                return;
            }
        }
    }

    // ========================================================
    // 🎉 2. SUPER CHAT & MEMBERSHIP DETECTOR
    // ========================================================
    if (chatItem.superchat || chatItem.purchaseAmount) {
        const amount = chatItem.purchaseAmount || (chatItem.superchat && chatItem.superchat.amount) || "Donation";
        io.emit('stream-alert', {
            type: 'superchat',
            user: username,
            amount: amount,
            msg: rawText
        });
        broadcastResponse(`Huge shoutout to @${username} for the${amount} Super Chat! "${rawText || 'Thank you!'}"`, true);
        return;
    }

    // Coin Accumulator
    const now = Date.now();
    if (!lastEarnedTime[userKey] || (now - lastEarnedTime[userKey]) >= (streamData.coinSettings.cooldownSeconds * 1000)) {
        if (!streamData.userCoins[userKey]) streamData.userCoins[userKey] = 0;
        streamData.userCoins[userKey] += streamData.coinSettings.coinsPerMsg;
        lastEarnedTime[userKey] = now;
        saveDataToDisk();
    }

    // ========================================================
    // 🎰 3. CHAT MINI-GAMES (!gamble, !slots, !duel)
    // ========================================================
    
    // GAME A: !gamble <amount> (50/50 Coin Flip)
    if (message.startsWith('!gamble ') || message.startsWith('!roulette ')) {
        const parts = rawText.split(' ');
        const amount = parseInt(parts[1]);
        const currentBalance = streamData.userCoins[userKey] || 0;

        if (isNaN(amount) || amount <= 0) {
            broadcastResponse(`@${username}, usage: !gamble <amount> (e.g. !gamble 50)`, false);             return;         }         if (currentBalance < amount) {             broadcastResponse(`@${username}, aapke paas gamble karne ke liye sirf 🪙 ${currentBalance}${cName} hain!`, false);
            return;
        }

        const isWin = Math.random() < 0.50;
        if (isWin) {
            streamData.userCoins[userKey] += amount;
            broadcastResponse(`🎲 [WIN!] @${username} ne 🪙 ${amount} gamble kiya aur JEET GAYA! New Balance: 🪙 ${streamData.userCoins[userKey]}${cName}`, false);
        } else {
            streamData.userCoins[userKey] -= amount;
            broadcastResponse(`💀 [LOSS!] @${username} ne 🪙 ${amount} gamble kiya aur HAAR GAYA! New Balance: 🪙 ${streamData.userCoins[userKey]}${cName}`, false);
        }
        saveDataToDisk();
        broadcastState();
        return;
    }

    // GAME B: !slots <amount> (3 Reel Slot Machine)
    if (message.startsWith('!slots ')) {
        const parts = rawText.split(' ');
        const amount = parseInt(parts[1]);
        const currentBalance = streamData.userCoins[userKey] || 0;

        if (isNaN(amount) || amount <= 0) {
            broadcastResponse(`@${username}, usage: !slots <amount> (e.g. !slots 50)`, false);             return;         }         if (currentBalance < amount) {             broadcastResponse(`@${username}, aapke paas slots ke liye sirf 🪙 ${currentBalance}${cName} hain!`, false);
            return;
        }

        const symbols = ['🍒', '🍋', '🍇', '💎', '7️⃣'];
        const s1 = symbols[Math.floor(Math.random() * symbols.length)];
        const s2 = symbols[Math.floor(Math.random() * symbols.length)];
        const s3 = symbols[Math.floor(Math.random() * symbols.length)];

        if (s1 === s2 && s2 === s3) {
            // Jackpot 5x
            const win = amount * 5;
            streamData.userCoins[userKey] += (win - amount);
            broadcastResponse(`🎰 [${s1} \vert{}${s2} | ${s3}] JACKPOT!! @${username} ne 5x jeeta (+🪙 ${win} ${cName})! Total: 🪙 ${streamData.userCoins[userKey]}`, false);
        } else if (s1 === s2 || s2 === s3 || s1 === s3) {
            // 2 Match 2x
            const win = amount * 2;
            streamData.userCoins[userKey] += (win - amount);
            broadcastResponse(`🎰 [${s1} \vert{}${s2} | ${s3}] 2 MATCH! @${username} ne 2x jeeta (+🪙 ${win}${cName})! Total: 🪙 ${streamData.userCoins[userKey]}`, false);         } else {             // Loss             streamData.userCoins[userKey] -= amount;             broadcastResponse(`🎰 [${s1} | ${s2} \vert{}${s3}] No match! @${username} lost 🪙 ${amount}${cName}. Total: 🪙 ${streamData.userCoins[userKey]}`, false);         }         saveDataToDisk();         broadcastState();         return;     }      // GAME C: !duel @target <amount> & !accept     if (message.startsWith('!duel ')) {         const parts = rawText.split(' ');         if (parts.length >= 3) {             const targetUser = parts[1].replace('@', '').toLowerCase();             const amount = parseInt(parts[2]);             const challengerBalance = streamData.userCoins[userKey] \vert{}\vert{} 0;             const targetBalance = streamData.userCoins[targetUser] \vert{}\vert{} 0;              if (targetUser === userKey) return;             if (isNaN(amount) \vert{}\vert{} amount <= 0) return;             if (challengerBalance < amount) {                 broadcastResponse(`@${username}, duel ke liye tere paas 🪙 ${amount} coins nahi hain!`, false);
                return;
            }
            if (targetBalance < amount) {
                broadcastResponse(`@${username}, @${targetUser} ke paas duel ke liye 🪙 ${amount} coins nahi hain!`, false);
                return;
            }

            activeDuels[targetUser] = {
                challenger: username,
                challengerKey: userKey,
                amount: amount,
                expires: Date.now() + 60000
            };

            broadcastResponse(`⚔️ DUEL! @${username} ne @${targetUser} ko 🪙 ${amount}${cName} ke duel ka challenge diya! Accept karne ke liye type karein: !accept`, false);
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
                    broadcastResponse(`⚔️ DUEL OVER: @${challengerName} ne @${username} ko hara kar 🪙 ${amount}${cName} jeet liye!`, true);
                } else {
                    streamData.userCoins[userKey] += amount;
                    streamData.userCoins[challengerKey] -= amount;
                    broadcastResponse(`⚔️ DUEL OVER: @${username} ne @${challengerName} ko hara kar 🪙 ${amount}${cName} jeet liye!`, true);
                }
                delete activeDuels[userKey];
                saveDataToDisk();
                broadcastState();
                return;
            }
        }
    }

    // Viewer Economy
    if (message === '!coins' || message === '!balance' || message === '!maccoins') {
        const balance = streamData.userCoins[userKey] || 0;
        broadcastResponse(`@${username}, aapke paas 🪙 ${balance}${cName} hain!`, false);
        return;
    }

    if (message.startsWith('!givecoins ') || message.startsWith('!addcoins ')) {
        if (!isOwner) return;
        const parts = rawText.split(' ');
        if (parts.length >= 3) {
            const targetUser = parts[1].replace('@', '').toLowerCase();
            const amount = parseInt(parts[2]);
            if (!isNaN(amount) && amount > 0) {
                if (!streamData.userCoins[targetUser]) streamData.userCoins[targetUser] = 0;
                streamData.userCoins[targetUser] += amount;
                saveDataToDisk();
                broadcastState();
                broadcastResponse(`Streamer Boss ne @${targetUser} ko 🪙 ${amount}${cName} diye!`, true);
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
                    broadcastResponse(`💸 @${username} ne @${recipient} ko 🪙 ${amount}${cName} transfer kiye!`, true);
                }
            }
            return;
        }
    }

    const matchedTrigger = streamData.triggers.find(t => t.cmd && t.cmd.toLowerCase() === message);
    if (matchedTrigger) {
        const cost = parseInt(matchedTrigger.cost) || 0;
        const currentBalance = streamData.userCoins[userKey] || 0;

        if (cost > 0 && !isOwner && currentBalance < cost) {
            broadcastResponse(`@${username}, '${matchedTrigger.name}' ke liye 🪙 ${cost}${cName} chahiye! Tere paas sirf ${currentBalance} coins hain.`, true);
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

    const matchedCustom = streamData.customCommands.find(c => c.cmd.toLowerCase() === message);
    if (matchedCustom) {
        const cost = parseInt(matchedCustom.cost) || 0;
        const currentBalance = streamData.userCoins[userKey] || 0;

        if (cost > 0 && !isOwner && currentBalance < cost) {
            broadcastResponse(`@${username}, '${matchedCustom.cmd}' ke liye 🪙 ${cost}${cName} chahiye!`, true);
            return;
        }

        if (cost > 0 && !isOwner) {
            streamData.userCoins[userKey] -= cost;
            saveDataToDisk();
            broadcastState();
        }

        const replyPrefix = isMod ? "Moderator ji" : (isOwner ? "Boss" : `@${username}`);         broadcastResponse(`${replyPrefix}, ${matchedCustom.reply}`, matchedCustom.tts === true);         return;     }      if (message.startsWith('!bet ') \vert{}\vert{} message.startsWith('!vote ')) {         if (!activeBet.isOpen \vert{}\vert{} activeBet.locked) return;         const parts = rawText.split(' ');         if (parts.length >= 2) {             const optionChoice = parseInt(parts[1]);             const betAmount = parts[2] ? parseInt(parts[2]) : 0;              const targetOption = activeBet.options.find(o => o.id === optionChoice);             if (!targetOption) return;              if (betAmount > 0) {                 const userBalance = streamData.userCoins[userKey] \vert{}\vert{} 0;                 if (userBalance < betAmount) {                     broadcastResponse(`@${username}, aapke paas bet ke liye sirf 🪙 ${userBalance}${cName} hain!`, false);
                    return;
                }
                streamData.userCoins[userKey] -= betAmount;
                targetOption.pool = (targetOption.pool || 0) + betAmount;
            }

            targetOption.votes = (targetOption.votes || 0) + 1;

            if (!activeBet.bets[userKey]) {
                activeBet.bets[userKey] = { optionId: optionChoice, amount: betAmount };
            } else {
                activeBet.bets[userKey].amount += betAmount;
                activeBet.bets[userKey].optionId = optionChoice;
            }

            saveDataToDisk();
            broadcastState();
            broadcastResponse(`🎲 @${username} ne '${targetOption.name}' par vote kiya! ${betAmount > 0 ? `(🪙 ${betAmount} ${cName})` : ''}`, false);             return;         }     }      if (message.startsWith('!tts ')) {         const ttsText = rawText.replace(/^!tts\s+/i, '');         io.emit('ai-speak', {             characterName: username,             characterImage: 'https://cdn-icons-png.flaticon.com/512/3233/3233514.png',             text: ttsText,             enableBubble: streamData.enableBubble,             enableTTS: true,             voice: streamData.ttsVoice,             pitch: 1.0,             rate: 1.0         });         return;     }      const activeCommand = (streamData.aiCommand \vert{}\vert{} '!ai').toLowerCase();     if (streamData.aiEnabled && (message.startsWith(activeCommand + ' ') \vert{}\vert{} message === activeCommand)) {         const question = rawText.slice(activeCommand.length).trim() \vert{}\vert{} 'Kuch interesting batao!';         const currentCoins = streamData.userCoins[userKey] \vert{}\vert{} 0;         const cost = streamData.coinSettings.aiCost;          if (cost > 0 && !isOwner && currentCoins < cost) {             broadcastResponse(`@${username}, AI se baat karne ke liye 🪙 ${cost}${cName} chahiye! Tere paas sirf ${currentCoins} hain.`, true);
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
});

const broadcastState = () => {
    io.emit('update-counter', { count: streamData.deathCount });
    io.emit('update-styles', streamData);
    io.emit('load-triggers', streamData.triggers);
    io.emit('bet-update', getCalculatedBetData());
    io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
    saveDataToDisk();
};

io.on('connection', (socket) => {
    socket.emit('update-counter', { count: streamData.deathCount });
    socket.emit('stream-status', { status: currentStatus });
    socket.emit('load-triggers', streamData.triggers);
    socket.emit('update-styles', streamData);
    socket.emit('bet-update', getCalculatedBetData());
    socket.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });

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
        if (local.geminiApiKey && !streamData.geminiApiKey) { streamData.geminiApiKey = local.geminiApiKey; changed = true; }
        if (local.groqApiKey && !streamData.groqApiKey) { streamData.groqApiKey = local.groqApiKey; changed = true; }
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
            ? `Namaste! Female voice aur audio settings ready hain. Main hoon ${streamData.characterName}!` 
            : `Yo! Male voice aur audio settings ready hain. Main hoon ${streamData.characterName}!`;

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

    // Test Alert Handlers
    socket.on('admin-test-superchat', () => {
        io.emit('stream-alert', {
            type: 'superchat',
            user: 'Rahul Gamer',
            amount: '₹500',
            msg: 'Bhai gaming level bohot mast hai! Keep grinding!'
        });
        broadcastResponse(`Huge shoutout to Rahul Gamer for the ₹500 Super Chat! "Bhai gaming level bohot mast hai!"`, true);
    });

    socket.on('admin-test-member', () => {
        io.emit('stream-alert', {
            type: 'member',
            user: 'Amit Sharma',
            amount: 'Level 1 Member',
            msg: 'New Member Joined!'
        });
        broadcastResponse(`Welcome Amit Sharma to the stream membership family! GG!`, true);
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

    socket.on('admin-reset-yt-quota', () => {
        streamData.ytQuotaExhausted = false;
        streamData.ytMessagesSentToday = 0;
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

        const optionsText = parsedOptions.map(o => `[${o.id}:${o.name}]`).join(' vs ');
        broadcastResponse(`🚨 POLL OPEN: "${activeBet.title}" 👉 ${optionsText}. Vote: !bet <num> <amount> or !vote <num>`, true);     });      socket.on('admin-lock-bet', () => {         activeBet.locked = true;         broadcastState();     });      socket.on('admin-resolve-bet', ({ winningOptionId }) => {         if (!activeBet.isOpen) return;         const totalPool = activeBet.options.reduce((sum, o) => sum + (o.pool \vert{}\vert{} 0), 0);         const winningOption = activeBet.options.find(o => o.id === parseInt(winningOptionId));         if (!winningOption) return;          const winningPool = winningOption.pool \vert{}\vert{} 0;         if (winningPool > 0) {             for (const [user, bet] of Object.entries(activeBet.bets)) {                 if (bet.optionId === winningOption.id && bet.amount > 0) {                     const payout = Math.floor((bet.amount / winningPool) * totalPool);                     streamData.userCoins[user] = (streamData.userCoins[user] \vert{}\vert{} 0) + payout;                 }             }         }          io.emit('bet-winner', { winnerName: winningOption.name, winnerId: winningOption.id, totalPool });         broadcastResponse(`🏆 RESULT: "${winningOption.name}" JEET GAYA! Total 🪙 ${totalPool} Mac-Coins distribute ho gaye!`, true);

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
