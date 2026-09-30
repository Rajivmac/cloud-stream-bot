const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { LiveChat } = require('youtube-chat');

const app = express();
app.use(cors());
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const CHANNEL_ID = 'UCjckDwkpw4xQAPlF5NEm2tQ';
const TEST_STREAM_ID = ''; 

const chatConfig = TEST_STREAM_ID ? { liveId: TEST_STREAM_ID } : { channelId: CHANNEL_ID };
const liveChat = new LiveChat(chatConfig); 

let deathCount = 0;
let currentStatus = 'retrying';

let counterSettings = {
    icon: '💀',
    font: 'Teko',
    color: '#ff4757'
};

// Triggers with Scenes, Memes, and SFX
let triggers = [
    { name: "Gameplay", type: "scene", sceneName: "Gameplay" },
    { name: "BRB Screen", type: "scene", sceneName: "BRB" },
    { name: "Wavedash", cmd: "!combo", type: "video", url: "https://res.cloudinary.com/udkv88c7/video/upload/v1790790781/Wavedash.mp4" },
    { name: "Vine Boom", cmd: "!boom", type: "sfx", url: "https://www.myinstants.com/media/sounds/vine-boom.mp3" },
    { name: "Bonk", cmd: "!bonk", type: "sfx", url: "https://www.myinstants.com/media/sounds/bonk.mp3" }
];

const broadcastStatus = (status) => {
    currentStatus = status;
    io.emit('stream-status', { status });
};

const broadcastDeathCount = () => {
    io.emit('update-counter', { count: deathCount });
};

const broadcastSettings = () => {
    io.emit('update-counter-style', counterSettings);
};

// --- CHAT ENGINE ---
const startChat = async () => {
    try {
        console.log(`⏳ Checking YouTube Connection...`);
        broadcastStatus('retrying');
        const ok = await liveChat.start();
        if (ok) {
            console.log(`✅ Automatically Connected to YouTube Live Chat!`);
            broadcastStatus('online');
        }
    } catch (error) {
        broadcastStatus('retrying');
        setTimeout(startChat, 10000); 
    }
};

liveChat.on("error", (err) => {
    broadcastStatus('offline');
    liveChat.stop();
    setTimeout(startChat, 10000);
});

startChat();

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
        if (message === '!death+' || message === '!died') { deathCount++; broadcastDeathCount(); }
        if (message === '!death-') { if (deathCount > 0) deathCount--; broadcastDeathCount(); }
        if (message === '!deathreset') { deathCount = 0; broadcastDeathCount(); }
    }
});

// --- ADMIN & OVERLAY SOCKETS ---
io.on('connection', (socket) => {
    socket.emit('update-counter', { count: deathCount });
    socket.emit('stream-status', { status: currentStatus });
    socket.emit('load-triggers', triggers);
    socket.emit('update-counter-style', counterSettings);

    socket.on('admin-death-add', () => { deathCount++; broadcastDeathCount(); });
    socket.on('admin-death-sub', () => { if (deathCount > 0) deathCount--; broadcastDeathCount(); });
    socket.on('admin-death-reset', () => { deathCount = 0; broadcastDeathCount(); });

    socket.on('admin-change-style', (newSettings) => {
        counterSettings = { ...counterSettings, ...newSettings };
        broadcastSettings();
    });

    socket.on('admin-add-trigger', (newTrigger) => {
        triggers.push(newTrigger);
        console.log(`✨ Added new ${newTrigger.type}: ${newTrigger.name}`);
        io.emit('load-triggers', triggers);
    });

    socket.on('admin-play-meme', (data) => io.emit('play-meme', data));
    socket.on('admin-play-sfx', (data) => io.emit('play-sfx', data));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));
