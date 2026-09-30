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

// --- DEFAULT SETTINGS & STATE ---
let streamData = {
    deathCount: 0,
    gameTimeSeconds: 0,
    counterIcon: '💀',
    counterFont: 'Teko',
    clockFont: 'Share Tech Mono',
    timerFont: 'Orbitron',
    themeColor: '#ff4757',
    
    // AI SETTINGS
    geminiApiKey: '',
    aiEnabled: true,
    enableTTS: true,
    aiCommand: '!ai',
    characterName: 'Gojo Satoru',
    characterAvatar: '🕶️',
    characterPersona: 'You are Gojo Satoru from Jujutsu Kaisen. You are supremely confident, playful, humorous, and a TEKKEN god. Reply in 1-2 punchy sentences. Always reply in the language the user speaks (Hinglish/Hindi/English).',
    welcomeNewChatters: true,
    discordLink: 'https://discord.gg/yourlink',
    reminderMinutes: 15
};

// Load saved data
if (fs.existsSync(DATA_FILE)) {
    try {
        const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        streamData = { ...streamData, ...loaded };
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

let currentStatus = 'retrying';
let isTimerRunning = false;
let seenChatters = new Set(); // Auto-Welcome Tracker

// Auto-Timer Loop
setInterval(() => {
    if (isTimerRunning) {
        streamData.gameTimeSeconds++;
        io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
        if (streamData.gameTimeSeconds % 10 === 0) saveDataToDisk();
    }
}, 1000);

// Auto-Reminder Loop (Subscribers / Discord reminders)
setInterval(() => {
    if (currentStatus === 'online' && streamData.discordLink) {
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            avatar: streamData.characterAvatar,
            text: `Bhaiyo stream ko like-share kardo aur community ke liye Discord join karlo: ${streamData.discordLink}`,
            enableTTS: false // Reminder sirf screen par text dikhega, TTS noise nahi karega
        });
    }
}, Math.max(streamData.reminderMinutes, 5) * 60 * 1000);

// --- GEMINI AI REST API CALL ---
async function askGemini(userPrompt, username) {
    if (!streamData.geminiApiKey) {
        return `Bhai pehle Dashboard ke AI tab mein Gemini API Key daal do!`;
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${streamData.geminiApiKey}`;

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: {
                    parts: [{ text: `${streamData.characterPersona} The viewer asking is named @${username}.` }]
                },
                contents: [{ parts: [{ text: userPrompt }] }]
            })
        });

        const data = await res.json();
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            return data.candidates[0].content.parts[0].text.trim();
        }
        return "Lagta hai Infinity activate ho gaya, samajh nahi aaya!";
    } catch (err) {
        console.error('Gemini Error:', err);
        return "AI connect nahi ho paaya, try again!";
    }
}

// --- YOUTUBE CHAT INTEGRATION ---
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
            isTimerRunning = true;
        }
    } catch (error) {
        currentStatus = 'retrying';
        io.emit('stream-status', { status: currentStatus });
        isTimerRunning = false;
        setTimeout(startChat, 10000); 
    }
};

liveChat.on("error", () => {
    currentStatus = 'offline';
    io.emit('stream-status', { status: currentStatus });
    isTimerRunning = false;
    liveChat.stop();
    setTimeout(startChat, 10000);
});

startChat();

// Dynamic Triggers
let triggers = [
    { name: "Gameplay", type: "scene", sceneName: "Gameplay" },
    { name: "BRB Screen", type: "scene", sceneName: "BRB" },
    { name: "Wavedash", cmd: "!combo", type: "video", url: "https://res.cloudinary.com/udkv88c7/video/upload/v1790790781/Wavedash.mp4" },
    { name: "Vine Boom", cmd: "!boom", type: "sfx", url: "https://www.myinstants.com/media/sounds/vine-boom.mp3" }
];

liveChat.on("chat", async (chatItem) => {
    const rawText = chatItem.message.map(m => m.text ? m.text : '').join('').trim();
    const message = rawText.toLowerCase();
    const username = chatItem.author.name;
    const isModOrOwner = chatItem.author.isChatOwner || chatItem.author.isChatModerator;

    // 1. AUTO WELCOME FIRST TIME CHATTERS
    if (streamData.welcomeNewChatters && !seenChatters.has(username)) {
        seenChatters.add(username);
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            avatar: streamData.characterAvatar,
            text: `Yo @${username}, stream par swagat hai!`,
            enableTTS: streamData.enableTTS
        });
    }

    // 2. DISCORD COMMAND (!discord)
    if (message === '!discord') {
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            avatar: '💬',
            text: `@${username} Discord community link: ${streamData.discordLink}`,
            enableTTS: false
        });
        return;
    }

    // 3. MANUAL TTS COMMAND (!tts <text>)
    if (message.startsWith('!tts ')) {
        const ttsText = rawText.replace(/^!tts\s+/i, '');
        io.emit('ai-speak', {
            characterName: username,
            avatar: '🔊',
            text: ttsText,
            enableTTS: true
        });
        return;
    }

    // 4. AI PERSONA QUESTION (!ai <question>)
    const aiPrefix = streamData.aiCommand.toLowerCase() + ' ';
    if (streamData.aiEnabled && message.startsWith(aiPrefix)) {
        const question = rawText.slice(aiPrefix.length).trim();
        if (question.length > 0) {
            const aiAnswer = await askGemini(question, username);
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                avatar: streamData.characterAvatar,
                text: aiAnswer,
                enableTTS: streamData.enableTTS
            });
        }
        return;
    }

    // 5. Dynamic Meme/SFX Triggers
    const matchedTrigger = triggers.find(t => t.cmd === message);
    if (matchedTrigger) {
        if (matchedTrigger.type === 'video') io.emit('play-meme', { mediaUrl: matchedTrigger.url });
        if (matchedTrigger.type === 'sfx') io.emit('play-sfx', { sfxUrl: matchedTrigger.url });
    }

    // 6. Death Counter
    if (isModOrOwner) {
        if (message === '!death+' || message === '!died') { streamData.deathCount++; broadcastState(); }
        if (message === '!death-') { if (streamData.deathCount > 0) streamData.deathCount--; broadcastState(); }
        if (message === '!deathreset') { streamData.deathCount = 0; broadcastState(); }
    }
});

const broadcastState = () => {
    io.emit('update-counter', { count: streamData.deathCount });
    io.emit('update-styles', streamData);
    saveDataToDisk();
};

// --- ADMIN CONTROLS ---
io.on('connection', (socket) => {
    socket.emit('update-counter', { count: streamData.deathCount });
    socket.emit('stream-status', { status: currentStatus });
    socket.emit('load-triggers', triggers);
    socket.emit('update-styles', streamData);
    socket.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });

    socket.on('admin-death-add', () => { streamData.deathCount++; broadcastState(); });
    socket.on('admin-death-sub', () => { if (streamData.deathCount > 0) streamData.deathCount--; broadcastState(); });
    socket.on('admin-death-reset', () => { streamData.deathCount = 0; broadcastState(); });

    socket.on('admin-timer-start', () => { isTimerRunning = true; broadcastState(); });
    socket.on('admin-timer-pause', () => { isTimerRunning = false; broadcastState(); });
    socket.on('admin-timer-reset', () => { streamData.gameTimeSeconds = 0; broadcastState(); });

    socket.on('admin-change-styles', (newSettings) => {
        streamData = { ...streamData, ...newSettings };
        broadcastState();
    });

    socket.on('admin-add-trigger', (newTrigger) => {
        triggers.push(newTrigger);
        io.emit('load-triggers', triggers);
    });

    socket.on('admin-play-meme', (data) => io.emit('play-meme', data));
    socket.on('admin-play-sfx', (data) => io.emit('play-sfx', data));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
