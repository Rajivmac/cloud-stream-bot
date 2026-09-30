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
    themeColor: '#ff4757'
};

// Load saved data from disk
if (fs.existsSync(DATA_FILE)) {
    try {
        const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        streamData = { ...streamData, ...loaded };
        console.log(`💾 Saved stream data loaded successfully! (Deaths: ${streamData.deathCount}, Playtime: ${streamData.gameTimeSeconds}s)`);
    } catch (e) {
        console.error('Error reading saved data:', e);
    }
}

const saveDataToDisk = () => {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(streamData, null, 2));
    } catch (e) {
        console.error('Failed to save data:', e);
    }
};

let currentStatus = 'retrying';
let isTimerRunning = false;

// Auto-Timer Loop (Every 1 second)
setInterval(() => {
    if (isTimerRunning) {
        streamData.gameTimeSeconds++;
        io.emit('timer-tick', { 
            seconds: streamData.gameTimeSeconds, 
            running: isTimerRunning 
        });
        if (streamData.gameTimeSeconds % 10 === 0) saveDataToDisk();
    }
}, 1000);

const broadcastStatus = (status) => {
    currentStatus = status;
    io.emit('stream-status', { status });
};

const broadcastState = () => {
    io.emit('update-counter', { count: streamData.deathCount });
    io.emit('update-styles', streamData);
    io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
    saveDataToDisk();
};

// --- YOUTUBE CHAT & AUTO STREAM DETECTION ---
const CHANNEL_ID = 'UCjckDwkpw4xQAPlF5NEm2tQ';
const TEST_STREAM_ID = ''; 

const chatConfig = TEST_STREAM_ID ? { liveId: TEST_STREAM_ID } : { channelId: CHANNEL_ID };
const liveChat = new LiveChat(chatConfig); 

const startChat = async () => {
    try {
        console.log(`⏳ Checking YouTube Connection...`);
        broadcastStatus('retrying');

        const ok = await liveChat.start();
        if (ok) {
            console.log(`✅ Automatically Connected to YouTube Live Chat!`);
            broadcastStatus('online');
            
            // STREAM ON: Timer Auto-Starts
            isTimerRunning = true;
            io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
        }
    } catch (error) {
        broadcastStatus('retrying');
        // STREAM NOT ACTIVE: Timer Pauses
        if (isTimerRunning) {
            isTimerRunning = false;
            io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
        }
        setTimeout(startChat, 10000); 
    }
};

liveChat.on("error", (err) => {
    broadcastStatus('offline');
    isTimerRunning = false; // STREAM OFF: Timer Pauses
    io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });
    saveDataToDisk();
    liveChat.stop();
    setTimeout(startChat, 10000);
});

startChat();

// Dynamic Triggers
let triggers = [
    { name: "Gameplay", type: "scene", sceneName: "Gameplay" },
    { name: "BRB Screen", type: "scene", sceneName: "BRB" },
    { name: "Wavedash", cmd: "!combo", type: "video", url: "https://res.cloudinary.com/udkv88c7/video/upload/v1790790781/Wavedash.mp4" },
    { name: "Vine Boom", cmd: "!boom", type: "sfx", url: "https://www.myinstants.com/media/sounds/vine-boom.mp3" },
    { name: "Bonk", cmd: "!bonk", type: "sfx", url: "https://www.myinstants.com/media/sounds/bonk.mp3" }
];

liveChat.on("chat", (chatItem) => {
    const message = chatItem.message.map(m => m.text ? m.text : '').join('').trim().toLowerCase();
    const username = chatItem.author.name;
    const isModOrOwner = chatItem.author.isChatOwner || chatItem.author.isChatModerator;

    const matchedTrigger = triggers.find(t => t.cmd === message);
    if (matchedTrigger) {
        if (matchedTrigger.type === 'video') io.emit('play-meme', { mediaUrl: matchedTrigger.url });
        if (matchedTrigger.type === 'sfx') io.emit('play-sfx', { sfxUrl: matchedTrigger.url });
    }

    if (isModOrOwner) {
        if (message === '!death+' || message === '!died') { streamData.deathCount++; broadcastState(); }
        if (message === '!death-') { if (streamData.deathCount > 0) streamData.deathCount--; broadcastState(); }
        if (message === '!deathreset') { streamData.deathCount = 0; broadcastState(); }
    }
});

// --- ADMIN / OVERLAY WEBSOCKETS ---
io.on('connection', (socket) => {
    socket.emit('update-counter', { count: streamData.deathCount });
    socket.emit('stream-status', { status: currentStatus });
    socket.emit('load-triggers', triggers);
    socket.emit('update-styles', streamData);
    socket.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: isTimerRunning });

    // Counter Actions
    socket.on('admin-death-add', () => { streamData.deathCount++; broadcastState(); });
    socket.on('admin-death-sub', () => { if (streamData.deathCount > 0) streamData.deathCount--; broadcastState(); });
    socket.on('admin-death-reset', () => { streamData.deathCount = 0; broadcastState(); });

    // Timer Controls
    socket.on('admin-timer-start', () => { isTimerRunning = true; broadcastState(); });
    socket.on('admin-timer-pause', () => { isTimerRunning = false; broadcastState(); });
    socket.on('admin-timer-reset', () => { streamData.gameTimeSeconds = 0; broadcastState(); });

    // Style Controls
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
server.listen(PORT, () => console.log(`🚀 Stream Server running on port ${PORT}`));
