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

// --- PRESET CHARACTERS ---
const PRESETS = {
    goku: {
        name: "Son Goku",
        cmd: "!goku",
        image: "https://images2.alphacoders.com/131/1312384.png",
        prompt: "You are Son Goku from Dragon Ball. Cheerful, super energetic, love food and intense Tekken battles. Always stay in character. Reply in 1-2 punchy sentences in the viewer's language."
    },
    gojo: {
        name: "Gojo Satoru",
        cmd: "!gojo",
        image: "https://images8.alphacoders.com/134/1344405.jpeg",
        prompt: "You are Gojo Satoru from Jujutsu Kaisen. Supremely confident, witty, playful, and unbeatable. Always stay in character. Reply in 1-2 punchy sentences in the viewer's language."
    },
    kazuya: {
        name: "Kazuya Mishima",
        cmd: "!kazuya",
        image: "https://images3.alphacoders.com/134/1347311.jpeg",
        prompt: "You are Kazuya Mishima from TEKKEN 8. Cold, ruthless, power-hungry, and arrogant. Dorya! Always stay in character. Reply in 1-2 sharp sentences in the viewer's language."
    },
    sukuna: {
        name: "Ryomen Sukuna",
        cmd: "!sukuna",
        image: "https://images3.alphacoders.com/134/1344406.jpeg",
        prompt: "You are the King of Curses, Ryomen Sukuna. Proud, condescending, and majestic. Treat ordinary viewers like mere brats. Always stay in character. Reply in 1-2 royal sentences."
    }
};

// --- DEFAULT STATE & SETTINGS ---
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
    aiCommand: '!goku',
    characterName: 'Son Goku',
    characterImage: 'https://images2.alphacoders.com/131/1312384.png',
    characterPersona: PRESETS.goku.prompt,
    welcomeNewChatters: true,
    reminderMinutes: 15,

    // MEMORY PER VIEWER: { "username": [ {role: "user", text: "..."}, {role: "model", text: "..."} ] }
    userHistories: {},

    // CUSTOM CHAT COMMANDS LIST
    customCommands: [
        { cmd: "!specs", reply: "PC Specs: Ryzen 7 7800X3D | RTX 4070 | 32GB RAM", tts: false },
        { cmd: "!rank", reply: "Tekken 8 Main: Kazuya Mishima (Tekken King Rank)!", tts: true },
        { cmd: "!discord", reply: "Discord community join karein: https://discord.gg/yourlink", tts: false }
    ]
};

// Load saved data & chat memories from disk
if (fs.existsSync(DATA_FILE)) {
    try {
        const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        streamData = { ...streamData, ...loaded };
        if (!streamData.userHistories) streamData.userHistories = {};
        console.log(`💾 Data & Chat Memories loaded for ${Object.keys(streamData.userHistories).length} viewers.`);
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
let seenChatters = new Set();

setInterval(() => {
    if (isTimerRunning) {
        streamData.gameTimeSeconds++;
        io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
        if (streamData.gameTimeSeconds % 10 === 0) saveDataToDisk();
    }
}, 1000);

// Auto Reminders
setInterval(() => {
    if (currentStatus === 'online') {
        const discordCmd = streamData.customCommands.find(c => c.cmd === '!discord');
        const reminderText = discordCmd ? discordCmd.reply : "Stream pasand aa rahi ho toh like aur subscribe zaroor karein!";
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: reminderText,
            enableTTS: false
        });
    }
}, Math.max(streamData.reminderMinutes, 5) * 60 * 1000);

// --- GEMINI AI WITH LONG-TERM VIEWER MEMORY & RESPECT PROTOCOL ---
async function askGemini(userPrompt, username, userRole) {
    if (!streamData.geminiApiKey) {
        return `Pehle Dashboard ke AI tab mein Gemini API Key daal do!`;
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${streamData.geminiApiKey}`;

    // Persona + Special Role Recognition
    let roleInstructions = "";
    if (userRole === 'owner') {
        roleInstructions = `CRITICAL: The person talking to you is the STREAM OWNER / BOSS / CREATOR. Treat them with highest honor, obedience, and call them 'Streamer Sahab' or 'Boss'.`;
    } else if (userRole === 'mod') {
        roleInstructions = `CRITICAL: The person talking to you is a trusted MODERATOR of this stream. Address them respectfully as 'Moderator ji' or 'Mod Sahab'.`;
    } else {
        roleInstructions = `The viewer talking is named @${username}. Be friendly or act in character towards them.`;
    }

    const systemInstructionText = `${streamData.characterPersona}\n${roleInstructions}\nKeep your answer short (1-2 sentences) so it fits in a stream speech bubble.`;

    // Fetch previous conversation history for this specific user
    const history = streamData.userHistories[username] || [];

    // Build multi-turn payload
    const contents = [];
    history.slice(-6).forEach(entry => {
        contents.push({
            role: entry.role === 'model' ? 'model' : 'user',
            parts: [{ text: entry.text }]
        });
    });

    // Add current question
    contents.push({
        role: "user",
        parts: [{ text: userPrompt }]
    });

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: systemInstructionText }] },
                contents: contents
            })
        });

        const data = await res.json();
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            const aiReply = data.candidates[0].content.parts[0].text.trim();

            // Save conversation into user's memory history
            if (!streamData.userHistories[username]) streamData.userHistories[username] = [];
            streamData.userHistories[username].push({ role: 'user', text: userPrompt });
            streamData.userHistories[username].push({ role: 'model', text: aiReply });

            // Keep only latest 8 messages per viewer to keep file lightweight
            if (streamData.userHistories[username].length > 8) {
                streamData.userHistories[username] = streamData.userHistories[username].slice(-8);
            }
            saveDataToDisk();

            return aiReply;
        }
        return "Lagta hai power level bohot high ho gaya, samajh nahi aaya!";
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
    const isOwner = chatItem.author.isChatOwner;
    const isMod = chatItem.author.isChatModerator;
    const isModOrOwner = isOwner || isMod;

    const userRole = isOwner ? 'owner' : (isMod ? 'mod' : 'viewer');

    // 1. CHARACTER CHANGE COMMAND (!setchar <name>) - ONLY MOD / OWNER ALLOWED!
    if (message.startsWith('!setchar ') || message.startsWith('!switchchar ')) {
        const charKey = message.split(' ')[1];

        if (!isModOrOwner) {
            // Normal viewer rejected
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `Sorry @${username}, character badalne ki power sirf Moderator ji aur Streamer Boss ke paas hai! 😎`,
                enableTTS: streamData.enableTTS
            });
            return;
        }

        if (PRESETS[charKey]) {
            streamData.characterName = PRESETS[charKey].name;
            streamData.aiCommand = PRESETS[charKey].cmd;
            streamData.characterImage = PRESETS[charKey].image;
            streamData.characterPersona = PRESETS[charKey].prompt;
            broadcastState();

            const title = isOwner ? "Streamer Boss" : "Moderator ji";
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `${title} @${username} ke kehne par main aa gaya hoon! Command ab ${streamData.aiCommand} hai.`,
                enableTTS: streamData.enableTTS
            });
            return;
        } else {
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `Available characters: goku, gojo, kazuya, sukuna. (Use: !setchar goku)`,
                enableTTS: false
            });
            return;
        }
    }

    // 2. AUTO WELCOME (Recognizes Mod/Owner vs Regular Viewers)
    if (streamData.welcomeNewChatters && !seenChatters.has(username)) {
        seenChatters.add(username);
        let welcomeMsg = `Yo @${username}, stream par swagat hai!`;
        if (isOwner) welcomeMsg = `Aadab Streamer Boss! Stream live aur ready hai.`;
        else if (isMod) welcomeMsg = `Namaste Moderator ji @${username}! Duty par swagat hai.`;

        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: welcomeMsg,
            enableTTS: streamData.enableTTS
        });
    }

    // 3. CUSTOM CHAT COMMANDS (!specs, !rank, etc.)
    const matchedCustom = streamData.customCommands.find(c => c.cmd.toLowerCase() === message);
    if (matchedCustom) {
        const prefix = isMod ? "Moderator ji" : (isOwner ? "Boss" : `@${username}`);
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: `${prefix}, ${matchedCustom.reply}`,
            enableTTS: matchedCustom.tts && streamData.enableTTS
        });
        return;
    }

    // 4. TTS MANUAL COMMAND (!tts <text>)
    if (message.startsWith('!tts ')) {
        const ttsText = rawText.replace(/^!tts\s+/i, '');
        io.emit('ai-speak', {
            characterName: username,
            characterImage: 'https://cdn-icons-png.flaticon.com/512/3233/3233514.png',
            text: ttsText,
            enableTTS: true
        });
        return;
    }

    // 5. AI PERSONA QUESTIONS WITH VIEWER MEMORY (!goku, !gojo, !ai <question>)
    const activeCommand = (streamData.aiCommand || '!goku').toLowerCase();
    if (streamData.aiEnabled && (message.startsWith(activeCommand + ' ') || message === activeCommand)) {
        const question = rawText.slice(activeCommand.length).trim() || 'Kuch interesting batao!';
        const aiAnswer = await askGemini(question, username, userRole);
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: aiAnswer,
            enableTTS: streamData.enableTTS
        });
        return;
    }

    // 6. Dynamic Meme/SFX Triggers
    const matchedTrigger = triggers.find(t => t.cmd === message);
    if (matchedTrigger) {
        if (matchedTrigger.type === 'video') io.emit('play-meme', { mediaUrl: matchedTrigger.url });
        if (matchedTrigger.type === 'sfx') io.emit('play-sfx', { sfxUrl: matchedTrigger.url });
    }

    // 7. Death Counter (Moderator / Streamer Only)
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

// Admin Sockets
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
            text: `Yo! Test bubble bilkul mast kaam kar raha hai!`,
            enableTTS: streamData.enableTTS
        });
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
