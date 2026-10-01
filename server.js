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

const PRESETS = {
    goku: {
        name: "Son Goku",
        cmd: "!goku",
        image: "https://images2.alphacoders.com/131/1312384.png",
        gender: "male",
        pitch: 1.3,
        rate: 1.1,
        prompt: "You are Son Goku from Dragon Ball. Cheerful, energetic, loves food and fighting. Reply in 1-2 punchy sentences in the viewer's language."
    },
    gojo: {
        name: "Gojo Satoru",
        cmd: "!gojo",
        image: "https://images8.alphacoders.com/134/1344405.jpeg",
        gender: "male",
        pitch: 1.0,
        rate: 1.0,
        prompt: "You are Gojo Satoru from Jujutsu Kaisen. Supremely confident, witty, playful, and unbeatable. Reply in 1-2 punchy sentences in the viewer's language."
    },
    kazuya: {
        name: "Kazuya Mishima",
        cmd: "!kazuya",
        image: "https://images3.alphacoders.com/134/1347311.jpeg",
        gender: "male",
        pitch: 0.7,
        rate: 0.95,
        prompt: "You are Kazuya Mishima from TEKKEN 8. Cold, ruthless, arrogant, obsessed with power. Dorya! Reply in 1-2 sharp sentences in the viewer's language."
    },
    sukuna: {
        name: "Ryomen Sukuna",
        cmd: "!sukuna",
        image: "https://images3.alphacoders.com/134/1344406.jpeg",
        gender: "male",
        pitch: 0.8,
        rate: 0.9,
        prompt: "You are the King of Curses, Ryomen Sukuna. Proud, condescending, and majestic. Treat ordinary viewers like mere brats. Reply in 1-2 royal sentences."
    }
};

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
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',

    aiEnabled: true,
    enableBubble: true,
    enableTTS: true,
    ttsGender: 'male',
    ttsPitch: 1.1,
    ttsRate: 1.0,
    aiCommand: '!goku',
    characterName: 'Son Goku',
    characterImage: 'https://images2.alphacoders.com/131/1312384.png',
    characterPersona: PRESETS.goku.prompt,
    welcomeNewChatters: true,
    reminderMinutes: 15,

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

function getCalculatedBetData() {
    let totalPool = 0;
    let totalVotes = 0;

    activeBet.options.forEach(opt => {
        totalPool += (opt.pool || 0);
        totalVotes += (opt.votes || 0);
    });

    const calculatedOptions = activeBet.options.map(opt => {
        let pct = 0;
        if (totalPool > 0) {
            pct = Math.round(((opt.pool || 0) / totalPool) * 100);
        } else if (totalVotes > 0) {
            pct = Math.round(((opt.votes || 0) / totalVotes) * 100);
        } else {
            pct = activeBet.options.length > 0 ? Math.round(100 / activeBet.options.length) : 0;
        }
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
    } catch (e) {
        console.error('Data load error:', e);
    }
}

if (process.env.GEMINI_API_KEY && !streamData.geminiApiKey) streamData.geminiApiKey = process.env.GEMINI_API_KEY;
if (process.env.GROQ_API_KEY && !streamData.groqApiKey) streamData.groqApiKey = process.env.GROQ_API_KEY;
if (process.env.OPENROUTER_API_KEY && !streamData.openrouterApiKey) streamData.openrouterApiKey = process.env.OPENROUTER_API_KEY;

const saveDataToDisk = () => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(streamData, null, 2));
    } catch (e) {
        console.error('Data save error:', e);
    }
};

let currentStatus = 'offline';
let isTimerRunning = false;
let seenChatters = new Set();
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
        const reminderText = discordCmd ? discordCmd.reply : `Chat karke ${streamData.coinSettings.currencyName} kamao aur live betting me participate karo!`;
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: reminderText,
            enableBubble: streamData.enableBubble,
            enableTTS: false
        });
    }
}, Math.max(streamData.reminderMinutes, 5) * 60 * 1000);

// --- AI DRIVER 1: GROQ CLOUD (Ultra-Fast 0.2s with Active Models) ---
async function callGroqDriver(key, systemText, userText, history) {
    if (!key || !key.startsWith('gsk_')) return { success: false, error: "Invalid Groq key format (must start with gsk_)" };

    const messages = [{ role: "system", content: systemText }];
    if (history && history.length) {
        history.slice(-6).forEach(h => {
            messages.push({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text });
        });
    }
    messages.push({ role: "user", content: userText });

    // Active working models on Groq
    const models = ["llama-3.3-70b-versatile", "llama3-70b-8192", "llama3-8b-8192", "mixtral-8x7b-32768"];
    let lastErr = "";

    for (const m of models) {
        try {
            const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${key}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: m,
                    messages: messages,
                    max_tokens: 150
                })
            });
            const data = await res.json();
            if (data.choices && data.choices[0] && data.choices[0].message) {
                return { success: true, text: data.choices[0].message.content.trim(), model: `Groq (${m})` };
            } else if (data.error) {
                lastErr = data.error.message;
            }
        } catch (e) {
            lastErr = e.message;
        }
    }
    return { success: false, error: lastErr || "Groq models busy" };
}

// --- AI DRIVER 2: GOOGLE GEMINI (Dynamic Model Discovery) ---
async function callGeminiDriver(key, systemText, userText, history) {
    if (!key) return { success: false, error: "Missing Gemini key" };

    const contents = [];
    if (history && history.length) {
        history.slice(-6).forEach(entry => {
            contents.push({ role: entry.role === 'model' ? 'model' : 'user', parts: [{ text: entry.text }] });
        });
    }
    contents.push({ role: "user", parts: [{ text: userText }] });

    // Auto-discover models directly from user's key
    let candidateModels = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-1.5-pro"];
    try {
        const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
        if (listRes.ok) {
            const listData = await listRes.json();
            if (listData.models && listData.models.length > 0) {
                const found = listData.models
                    .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
                    .map(m => m.name.replace('models/', ''));
                if (found.length > 0) candidateModels = found;
            }
        }
    } catch(e) {}

    let lastErr = "";
    for (const m of candidateModels.slice(0, 4)) {
        try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: systemText }] },
                    contents: contents
                })
            });
            const data = await res.json();
            if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
                return { success: true, text: data.candidates[0].content.parts[0].text.trim(), model: `Gemini (${m})` };
            } else if (data.error) {
                lastErr = data.error.message;
            }
        } catch (e) {
            lastErr = e.message;
        }
    }
    return { success: false, error: lastErr || "Gemini models busy" };
}

// --- AI DRIVER 3: OPENROUTER (Free Tier) ---
async function callOpenRouterDriver(key, systemText, userText, history) {
    if (!key || !key.startsWith('sk-or-')) return { success: false, error: "Invalid OpenRouter key format" };

    const messages = [{ role: "system", content: systemText }];
    if (history && history.length) {
        history.slice(-6).forEach(h => {
            messages.push({ role: h.role === 'model' ? 'assistant' : 'user', content: h.text });
        });
    }
    messages.push({ role: "user", content: userText });

    const models = ["meta-llama/llama-3.2-3b-instruct:free", "google/gemini-2.0-flash-exp:free", "mistralai/mistral-7b-instruct:free"];
    let lastErr = "";

    for (const m of models) {
        try {
            const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${key}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://stream-bot-hqlh.onrender.com",
                    "X-Title": "Stream Deck Bot"
                },
                body: JSON.stringify({
                    model: m,
                    messages: messages,
                    max_tokens: 150
                })
            });
            const data = await res.json();
            if (data.choices && data.choices[0] && data.choices[0].message) {
                return { success: true, text: data.choices[0].message.content.trim(), model: `OpenRouter (${m})` };
            } else if (data.error) {
                lastErr = data.error.message;
            }
        } catch (e) {
            lastErr = e.message;
        }
    }
    return { success: false, error: lastErr || "OpenRouter busy" };
}

// --- AI DRIVER 4 (ULTIMATE JUGAAD): ZERO-KEY PUBLIC AI PROXY ---
async function callPublicZeroKeyDriver(systemText, userText) {
    try {
        const fullPrompt = `${systemText}\nViewer says: ${userText}\nKeep reply punchy in 1-2 sentences.`;
        const res = await fetch(`https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}?model=openai`);
        if (res.ok) {
            const text = await res.text();
            if (text && text.trim().length > 0) {
                return { success: true, text: text.trim(), model: "Public Zero-Key AI (Pollinations)" };
            }
        }
    } catch(e) {}
    return { success: false, error: "Public AI unavailable" };
}

// MASTER CASCADE AI ROUTER
async function askAI(userPrompt, username, userRole) {
    let roleInstructions = "";
    if (userRole === 'owner') roleInstructions = `CRITICAL: The person talking is the STREAM OWNER / BOSS. Treat them with highest honor. Call them 'Boss' or 'Streamer Sahab'.`;
    else if (userRole === 'mod') roleInstructions = `CRITICAL: The person talking is a MODERATOR. Call them 'Moderator ji' or 'Mod Sahab'.`;
    else roleInstructions = `The viewer talking is named @${username}.`;

    const systemInstructionText = `${streamData.characterPersona}\n${roleInstructions}\nKeep answers short (1-2 sentences) for stream speech bubble.`;
    const history = streamData.userHistories[username] || [];

    // Priority 1: Groq Cloud (Super fast, no high demand)
    const groqKey = streamData.groqApiKey || process.env.GROQ_API_KEY;
    if (groqKey) {
        const res = await callGroqDriver(groqKey, systemInstructionText, userPrompt, history);
        if (res.success) {
            recordHistory(username, userPrompt, res.text);
            return res.text;
        }
    }

    // Priority 2: Google Gemini (Discovery mode)
    const geminiKey = streamData.geminiApiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) {
        const res = await callGeminiDriver(geminiKey, systemInstructionText, userPrompt, history);
        if (res.success) {
            recordHistory(username, userPrompt, res.text);
            return res.text;
        }
    }

    // Priority 3: OpenRouter
    const routerKey = streamData.openrouterApiKey || process.env.OPENROUTER_API_KEY;
    if (routerKey) {
        const res = await callOpenRouterDriver(routerKey, systemInstructionText, userPrompt, history);
        if (res.success) {
            recordHistory(username, userPrompt, res.text);
            return res.text;
        }
    }

    // Priority 4 (Bulletproof Jugaad): Public Zero-Key AI
    const publicRes = await callPublicZeroKeyDriver(systemInstructionText, userPrompt);
    if (publicRes.success) {
        recordHistory(username, userPrompt, publicRes.text);
        return publicRes.text;
    }

    return "Power level bohot high ho gaya, thodi der baad try karo!";
}

function recordHistory(username, userPrompt, aiReply) {
    if (!streamData.userHistories[username]) streamData.userHistories[username] = [];
    streamData.userHistories[username].push({ role: 'user', text: userPrompt });
    streamData.userHistories[username].push({ role: 'model', text: aiReply });
    if (streamData.userHistories[username].length > 8) {
        streamData.userHistories[username] = streamData.userHistories[username].slice(-8);
    }
    saveDataToDisk();
}

// YouTube Chat Engine
const CHANNEL_ID = 'UCjckDwkpw4xQAPlF5NEm2tQ';
const TEST_STREAM_ID = ''; 

const chatConfig = TEST_STREAM_ID ? { liveId: TEST_STREAM_ID } : { channelId: CHANNEL_ID };
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

    // Passive Coin Earning
    const now = Date.now();
    if (!lastEarnedTime[userKey] || (now - lastEarnedTime[userKey]) >= (streamData.coinSettings.cooldownSeconds * 1000)) {
        if (!streamData.userCoins[userKey]) streamData.userCoins[userKey] = 0;
        streamData.userCoins[userKey] += streamData.coinSettings.coinsPerMsg;
        lastEarnedTime[userKey] = now;
        saveDataToDisk();
    }

    if (message === '!coins' || message === '!balance' || message === '!maccoins') {
        const balance = streamData.userCoins[userKey] || 0;
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: `@${username}, aapke paas 🪙 ${balance} ${cName} hain!`,
            enableBubble: streamData.enableBubble,
            enableTTS: false
        });
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
                io.emit('ai-speak', {
                    characterName: streamData.characterName,
                    characterImage: streamData.characterImage,
                    text: `Streamer Boss ne @${targetUser} ko 🪙 ${amount} ${cName} diye!`,
                    enableBubble: streamData.enableBubble,
                    enableTTS: streamData.enableTTS,
                    pitch: streamData.ttsPitch,
                    rate: streamData.ttsRate,
                    gender: streamData.ttsGender
                });
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
                    io.emit('ai-speak', {
                        characterName: streamData.characterName,
                        characterImage: streamData.characterImage,
                        text: `💸 @${username} ne @${recipient} ko 🪙 ${amount} ${cName} transfer kiye!`,
                        enableBubble: streamData.enableBubble,
                        enableTTS: streamData.enableTTS,
                        pitch: streamData.ttsPitch,
                        rate: streamData.ttsRate,
                        gender: streamData.ttsGender
                    });
                }
            }
            return;
        }
    }

    // Meme Redeem
    const matchedTrigger = streamData.triggers.find(t => t.cmd && t.cmd.toLowerCase() === message);
    if (matchedTrigger) {
        const cost = parseInt(matchedTrigger.cost) || 0;
        const currentBalance = streamData.userCoins[userKey] || 0;

        if (cost > 0 && !isOwner && currentBalance < cost) {
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `@${username}, '${matchedTrigger.name}' ke liye 🪙 ${cost} ${cName} chahiye! Tere paas sirf ${currentBalance} coins hain.`,
                enableBubble: streamData.enableBubble,
                enableTTS: streamData.enableTTS,
                pitch: streamData.ttsPitch,
                rate: streamData.ttsRate,
                gender: streamData.ttsGender
            });
            return;
        }

        if (cost > 0 && !isOwner) {
            streamData.userCoins[userKey] -= cost;
            saveDataToDisk();
            broadcastState();
        }

        if (matchedTrigger.type === 'video') {
            io.emit('play-meme', { mediaUrl: matchedTrigger.url, name: matchedTrigger.name, redeemedBy: username });
        }
        if (matchedTrigger.type === 'sfx') {
            io.emit('play-sfx', { sfxUrl: matchedTrigger.url, name: matchedTrigger.name, redeemedBy: username });
        }
        return;
    }

    // Custom Commands
    const matchedCustom = streamData.customCommands.find(c => c.cmd.toLowerCase() === message);
    if (matchedCustom) {
        const cost = parseInt(matchedCustom.cost) || 0;
        const currentBalance = streamData.userCoins[userKey] || 0;

        if (cost > 0 && !isOwner && currentBalance < cost) {
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `@${username}, '${matchedCustom.cmd}' ke liye 🪙 ${cost} ${cName} chahiye!`,
                enableBubble: streamData.enableBubble,
                enableTTS: streamData.enableTTS,
                pitch: streamData.ttsPitch,
                rate: streamData.ttsRate,
                gender: streamData.ttsGender
            });
            return;
        }

        if (cost > 0 && !isOwner) {
            streamData.userCoins[userKey] -= cost;
            saveDataToDisk();
            broadcastState();
        }

        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: `${isMod ? "Moderator ji" : (isOwner ? "Boss" : `@${username}`)}, ${matchedCustom.reply}`,
            enableBubble: matchedCustom.bubble !== false,
            enableTTS: matchedCustom.tts === true,
            pitch: streamData.ttsPitch,
            rate: streamData.ttsRate,
            gender: streamData.ttsGender
        });
        return;
    }

    // Betting
    if (message.startsWith('!bet ') || message.startsWith('!vote ')) {
        if (!activeBet.isOpen || activeBet.locked) return;
        const parts = rawText.split(' ');
        if (parts.length >= 2) {
            const optionChoice = parseInt(parts[1]);
            const betAmount = parts[2] ? parseInt(parts[2]) : 0;

            const targetOption = activeBet.options.find(o => o.id === optionChoice);
            if (!targetOption) return;

            if (betAmount > 0) {
                const userBalance = streamData.userCoins[userKey] || 0;
                if (userBalance < betAmount) {
                    io.emit('ai-speak', {
                        characterName: streamData.characterName,
                        characterImage: streamData.characterImage,
                        text: `@${username}, aapke paas bet ke liye sirf 🪙 ${userBalance} ${cName} hain!`,
                        enableBubble: streamData.enableBubble,
                        enableTTS: false
                    });
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

            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `🎲 @${username} ne '${targetOption.name}' par vote kiya! ${betAmount > 0 ? `(🪙 ${betAmount} ${cName})` : ''}`,
                enableBubble: streamData.enableBubble,
                enableTTS: false
            });
            return;
        }
    }

    if (message.startsWith('!tts ')) {
        const ttsText = rawText.replace(/^!tts\s+/i, '');
        io.emit('ai-speak', {
            characterName: username,
            characterImage: 'https://cdn-icons-png.flaticon.com/512/3233/3233514.png',
            text: ttsText,
            enableBubble: streamData.enableBubble,
            enableTTS: true,
            pitch: 1.0,
            rate: 1.0,
            gender: streamData.ttsGender
        });
        return;
    }

    // AI Question (Auto-Failover)
    const activeCommand = (streamData.aiCommand || '!goku').toLowerCase();
    if (streamData.aiEnabled && (message.startsWith(activeCommand + ' ') || message === activeCommand)) {
        const question = rawText.slice(activeCommand.length).trim() || 'Kuch interesting batao!';
        const currentCoins = streamData.userCoins[userKey] || 0;
        const cost = streamData.coinSettings.aiCost;

        if (cost > 0 && !isOwner && currentCoins < cost) {
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `@${username}, AI se baat karne ke liye 🪙 ${cost} ${cName} chahiye! Tere paas sirf ${currentCoins} hain.`,
                enableBubble: streamData.enableBubble,
                enableTTS: streamData.enableTTS,
                pitch: streamData.ttsPitch,
                rate: streamData.ttsRate,
                gender: streamData.ttsGender
            });
            return;
        }

        if (cost > 0 && !isOwner) {
            streamData.userCoins[userKey] -= cost;
            saveDataToDisk();
            broadcastState();
        }

        const aiAnswer = await askAI(question, username, userRole);
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: aiAnswer,
            enableBubble: streamData.enableBubble,
            enableTTS: streamData.enableTTS,
            pitch: streamData.ttsPitch,
            rate: streamData.ttsRate,
            gender: streamData.ttsGender
        });
        return;
    }

    // Death counter
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

    socket.on('admin-sync-local', (localData) => {
        let changed = false;
        if (!streamData.geminiApiKey && localData.geminiApiKey) { streamData.geminiApiKey = localData.geminiApiKey; changed = true; }
        if (!streamData.groqApiKey && localData.groqApiKey) { streamData.groqApiKey = localData.groqApiKey; changed = true; }
        if (!streamData.openrouterApiKey && localData.openrouterApiKey) { streamData.openrouterApiKey = localData.openrouterApiKey; changed = true; }
        if (!streamData.characterImage && localData.characterImage) { streamData.characterImage = localData.characterImage; changed = true; }
        if (changed) {
            saveDataToDisk();
            broadcastState();
        }
    });

    // SERVER-SIDE DETAILED VERIFIER
    socket.on('admin-verify-ai', async ({ geminiKey, groqKey, openrouterKey }) => {
        const results = [];
        let anySuccess = false;

        // Test Groq if present
        if (groqKey && groqKey.trim()) {
            const r = await callGroqDriver(groqKey.trim(), "Say hi.", "hi", []);
            if (r.success) {
                results.push(`🟢 Groq: Ready (${r.model})`);
                anySuccess = true;
            } else {
                results.push(`🔴 Groq: ${r.error}`);
            }
        }

        // Test Gemini if present
        if (geminiKey && geminiKey.trim()) {
            const r = await callGeminiDriver(geminiKey.trim(), "Say hi.", "hi", []);
            if (r.success) {
                results.push(`🟢 Google Gemini: Ready (${r.model})`);
                anySuccess = true;
            } else {
                results.push(`🔴 Google Gemini: ${r.error}`);
            }
        }

        // Test OpenRouter if present
        if (openrouterKey && openrouterKey.trim()) {
            const r = await callOpenRouterDriver(openrouterKey.trim(), "Say hi.", "hi", []);
            if (r.success) {
                results.push(`🟢 OpenRouter: Ready (${r.model})`);
                anySuccess = true;
            } else {
                results.push(`🔴 OpenRouter: ${r.error}`);
            }
        }

        // Test Zero-Key Jugaad
        const pub = await callPublicZeroKeyDriver("Say hi.", "hi");
        if (pub.success) {
            results.push(`🟢 Public Free AI: Ready (Always active fallback)`);
            anySuccess = true;
        }

        socket.emit('admin-ai-verify-result', {
            success: anySuccess,
            message: anySuccess ? `✅ Connection Successful!\n${results.join('\n')}` : `❌ Failed:\n${results.join('\n')}`
        });
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

        activeBet = {
            isOpen: true,
            locked: false,
            title: title || "Who will win?",
            options: parsedOptions,
            bets: {}
        };
        broadcastState();

        const optionsText = parsedOptions.map(o => `[${o.id}: ${o.name}]`).join(' vs ');
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: `🚨 POLL OPEN: "${activeBet.title}" 👉 ${optionsText}. Vote: !bet <num> <amount> or !vote <num>`,
            enableBubble: streamData.enableBubble,
            enableTTS: streamData.enableTTS,
            pitch: streamData.ttsPitch,
            rate: streamData.ttsRate,
            gender: streamData.ttsGender
        });
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

        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: `🏆 RESULT: "${winningOption.name}" JEET GAYA! Total 🪙 ${totalPool} Mac-Coins distribute ho gaye!`,
            enableBubble: streamData.enableBubble,
            enableTTS: streamData.enableTTS,
            pitch: streamData.ttsPitch,
            rate: streamData.ttsRate,
            gender: streamData.ttsGender
        });

        setTimeout(() => {
            activeBet = { isOpen: false, locked: false, title: "", options: [], bets: {} };
            saveDataToDisk();
            broadcastState();
        }, 12000);
    });

    socket.on('admin-end-bet', () => {
        for (const [user, bet] of Object.entries(activeBet.bets)) {
            if (bet.amount > 0) {
                streamData.userCoins[user] = (streamData.userCoins[user] || 0) + bet.amount;
            }
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

    socket.on('admin-test-ai', () => {
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: `Yo! Audio aur Speech bubble test successful!`,
            enableBubble: streamData.enableBubble,
            enableTTS: streamData.enableTTS,
            pitch: streamData.ttsPitch,
            rate: streamData.ttsRate,
            gender: streamData.ttsGender
        });
    });

    socket.on('admin-play-meme', (data) => {
        io.emit('play-meme', { mediaUrl: data.mediaUrl, name: "Stream Deck", redeemedBy: "Streamer Boss" });
    });

    socket.on('admin-play-sfx', (data) => {
        io.emit('play-sfx', { sfxUrl: data.sfxUrl, name: "Stream Deck", redeemedBy: "Streamer Boss" });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
