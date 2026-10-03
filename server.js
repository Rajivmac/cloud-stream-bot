const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
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
const MAIN_CHANNEL_ID = 'UCjckDwkpw4xQAPlF5NEm2tQ';

let streamData = {
    deathCount: 0,
    wins: 0,
    losses: 0,
    gameTimeSeconds: 0,

    aiEnabled: true,
    enableBubble: true,
    enableTTS: true, 
    ttsVoice: 'female',
    ttsPitch: 1.0,
    ttsRate: 1.0,
    aiCommand: '!ai',
    characterName: 'AIBot',
    characterImage: 'https://images3.alphacoders.com/134/1344406.jpeg',
    characterPersona: "You are a witty, supportive, and energetic live stream AI gaming co-host. Reply in 1-2 punchy sentences in Hindi/Hinglish.",

    gameCommands: {
        daily: '!daily', coins: '!coins', gamble: '!gamble', slots: '!slots', duel: '!duel', pay: '!pay'
    },
    coinSettings: { currencyName: "Mac-Coins", coinsPerMsg: 5, cooldownSeconds: 30, aiCost: 50 },

    userCoins: {},
    userDailyClaim: {},
    userHistories: {}, // Yahan AI ki chat memory save hoti hai
    triggers: [],
    customCommands: []
};

let activeBet = { isOpen: false, locked: false, title: "", options: [], bets: {} };
let userLastAiTime = {};
let isTimerRunning = false;
let lastEarnedTime = {};
let lastStreamerBotPing = 0;

if (fs.existsSync(DATA_FILE)) {
    try {
        const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        streamData = { ...streamData, ...loaded };
        if (!streamData.userHistories) streamData.userHistories = {};
        if (!streamData.wins) streamData.wins = 0;
        if (!streamData.losses) streamData.losses = 0;
    } catch (e) {}
}

const saveDataToDisk = () => { fs.writeFileSync(DATA_FILE, JSON.stringify(streamData, null, 2)); };

setInterval(() => {
    if (isTimerRunning) {
        streamData.gameTimeSeconds++;
        io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
        if (streamData.gameTimeSeconds % 10 === 0) saveDataToDisk();
    }
}, 1000);

// TTS Proxy API
app.get('/api/tts', async (req, res) => {
    try {
        const text = (req.query.text || '').slice(0, 280).trim();
        const voice = (req.query.voice || streamData.ttsVoice || 'female').trim().toLowerCase();
        if (!text) return res.status(400).send("No text");

        if (voice.includes('female')) {
            const gUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=hi&q=${encodeURIComponent(text)}`;
            const gRes = await fetch(gUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }});
            if (gRes.ok) return res.setHeader('Content-Type', 'audio/mpeg').send(Buffer.from(await gRes.arrayBuffer()));
        } else {
            const ttRes = await fetch('https://tiktok-tts.weilnet.workers.dev/api/generation', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text.slice(0, 200), voice: 'en_male_narration' })
            });
            if (ttRes.ok) {
                const ttData = await ttRes.json();
                if (ttData?.data) return res.setHeader('Content-Type', 'audio/mpeg').send(Buffer.from(ttData.data, 'base64'));
            }
        }
        res.status(500).send("TTS Error");
    } catch(err) { res.status(500).send("TTS Error"); }
});

function broadcastResponse(text, isTTS = true, isBubble = true) {
    io.emit('ai-speak', {
        characterName: streamData.characterName,
        characterImage: streamData.characterImage,
        text: text,
        enableBubble: isBubble && streamData.enableBubble,
        enableTTS: isTTS,
        voice: streamData.ttsVoice
    });
}

// 🧠 AI Memory System Engine
async function askAI(userPrompt, username, userRole) {
    const lowerName = username.toLowerCase();
    if (!streamData.userHistories[lowerName]) streamData.userHistories[lowerName] = [];
    
    // Maintain context memory (last 4 messages)
    let historyContext = "";
    streamData.userHistories[lowerName].forEach(msg => {
        historyContext += `${msg.role === 'user' ? 'Viewer' : 'You'}: ${msg.content}\n`;
    });

    let roleTag = userRole === 'owner' ? "(This is Boss Rajiv Pal)" : `(Viewer: @${username})`;
    const fullPrompt = `System: ${streamData.characterPersona}\n${historyContext}Viewer ${roleTag}: ${userPrompt}\nYou:`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000); // 4 second wait max
        const res = await fetch(`https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}?model=openai`, { signal: controller.signal });
        clearTimeout(timeout);
        
        if (res.ok) {
            let aiText = await res.text();
            aiText = aiText.replace(/You:/gi, '').trim();
            
            // Save to memory
            streamData.userHistories[lowerName].push({ role: 'user', content: userPrompt });
            streamData.userHistories[lowerName].push({ role: 'model', content: aiText });
            if (streamData.userHistories[lowerName].length > 4) streamData.userHistories[lowerName] = streamData.userHistories[lowerName].slice(-4);
            
            return aiText;
        }
    } catch (e) {}

    // Fallback if API fails
    return userRole === 'owner' ? "Boss, game pe focus karo, backend load le raha hai!" : `@${username}, thoda time do, abhi busy hoon!`;
}

// 👑 Chat Processor (Streamer.bot forwards to here)
async function processCoreChatLogic({ rawText, username, isOwnerOverride, isModOverride }) {
    let cleanRaw = (rawText || '').trim();
    const lowerName = (username || '').toLowerCase();
    if (lowerName.includes('rajivmacai') || lowerName.includes('aibot')) return null;

    const isOwner = isOwnerOverride || lowerName.includes('rajiv') || lowerName.includes('mac_s');
    const isMod = isModOverride || false;
    const userRole = isOwner ? 'owner' : (isMod ? 'mod' : 'viewer');
    const cName = streamData.coinSettings.currencyName;
    const gc = streamData.gameCommands;

    // Background Coins
    const now = Date.now();
    if (!lastEarnedTime[lowerName] || (now - lastEarnedTime[lowerName]) >= (streamData.coinSettings.cooldownSeconds * 1000)) {
        streamData.userCoins[lowerName] = (streamData.userCoins[lowerName] || 0) + streamData.coinSettings.coinsPerMsg;
        lastEarnedTime[lowerName] = now;
        saveDataToDisk();
    }

    const message = cleanRaw.toLowerCase();

    // 🎲 POLL / BETTING ENGINE (Fix applied here)
    if (message.startsWith('!bet ') && activeBet.isOpen && !activeBet.locked) {
        const parts = message.split(' ');
        const optionId = parseInt(parts[1]);
        const amount = parseInt(parts[2]) || 0;
        
        const option = activeBet.options.find(o => o.id === optionId);
        if (option && amount > 0) {
            if ((streamData.userCoins[lowerName] || 0) >= amount) {
                streamData.userCoins[lowerName] -= amount;
                if (!activeBet.bets[lowerName]) activeBet.bets[lowerName] = { amount: 0, optionId: optionId };
                
                activeBet.bets[lowerName].amount += amount;
                activeBet.bets[lowerName].optionId = optionId;
                option.pool += amount;
                option.votes += 1;
                
                saveDataToDisk();
                io.emit('bet-update', activeBet);
                return { reply: `🎲 @${username} ne 🪙${amount} lagaye [${option.name}] par!` };
            } else {
                return { reply: `@${username} coins kam hain!` };
            }
        }
    }

    // 🤖 AI TRIGGER
    const aiCmd = streamData.aiCommand.toLowerCase();
    if (message.startsWith(aiCmd)) {
        if (!isOwner && !isMod && (Date.now() - (userLastAiTime[lowerName] || 0) < 15000)) return { reply: `⏳ Cooldown!` };
        
        const cost = streamData.coinSettings.aiCost;
        if (!isOwner && (streamData.userCoins[lowerName] || 0) < cost) return { reply: `@${username}, 🪙${cost} ${cName} chahiye!` };
        if (!isOwner) streamData.userCoins[lowerName] -= cost;
        userLastAiTime[lowerName] = Date.now();
        
        let question = cleanRaw.slice(aiCmd.length).trim() || 'Kya haal hai?';
        const aiAnswer = await askAI(question, username, userRole);
        broadcastResponse(aiAnswer, streamData.enableTTS, streamData.enableBubble);
        return { reply: aiAnswer };
    }

    // 🪙 ECONOMY TRIGGERS
    if (message === gc.coins) return { reply: `@${username}, Balance: 🪙 ${streamData.userCoins[lowerName] || 0} ${cName}` };
    
    // CUSTOM COMMANDS
    const custom = streamData.customCommands.find(c => c.cmd.toLowerCase() === message);
    if (custom) {
        broadcastResponse(custom.reply, custom.tts, custom.bubble);
        return { reply: custom.reply };
    }

    return null;
}

app.all('/api/streamerbot/chat', async (req, res) => {
    try {
        lastStreamerBotPing = Date.now();
        io.emit('streamerbot-status', { online: true });
        const user = req.body?.user || req.query?.user || 'Viewer';
        const message = req.body?.message || req.query?.message || '';
        
        if (!message) return res.send("");
        const result = await processCoreChatLogic({ rawText: message, username: user, isOwnerOverride: Boolean(req.body?.isOwner || req.query?.isOwner) });
        
        if (result && result.reply) return res.send(result.reply);
        return res.send("");
    } catch (err) { return res.send(""); }
});

const broadcastState = () => {
    io.emit('update-counter', { count: streamData.deathCount, wins: streamData.wins, losses: streamData.losses });
    io.emit('update-styles', streamData);
    io.emit('load-triggers', streamData.triggers);
    io.emit('bet-update', activeBet);
    io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
    saveDataToDisk();
};

io.on('connection', (socket) => {
    broadcastState();
    
    socket.on('admin-win-add', () => { streamData.wins++; broadcastState(); });
    socket.on('admin-loss-add', () => { streamData.losses++; broadcastState(); });
    socket.on('admin-death-add', () => { streamData.deathCount++; broadcastState(); });
    socket.on('admin-death-sub', () => { if(streamData.deathCount>0) streamData.deathCount--; broadcastState(); });
    socket.on('admin-death-reset', () => { streamData.deathCount=0; streamData.wins=0; streamData.losses=0; broadcastState(); });

    socket.on('admin-timer-start', () => { isTimerRunning = true; broadcastState(); });
    socket.on('admin-timer-pause', () => { isTimerRunning = false; broadcastState(); });
    socket.on('admin-timer-reset', () => { streamData.gameTimeSeconds = 0; broadcastState(); });

    socket.on('admin-start-bet', ({ title, options }) => {
        let opts = options.map((opt, i) => ({ id: i+1, name: opt, pool: 0, votes: 0 }));
        activeBet = { isOpen: true, locked: false, title: title, options: opts, bets: {} };
        broadcastState();
    });
    
    // Add missing handlers from previous setup (coins, custom commands, etc)
    // ...
});

server.listen(process.env.PORT || 3000, () => console.log(`🚀 Master Server Ready`));
