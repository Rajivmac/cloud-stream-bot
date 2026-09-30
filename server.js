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

// DYNAMIC TRIGGERS LIST (Default pre-loaded triggers)
let triggers = [
    { 
        name: "Wavedash", 
        cmd: "!combo", 
        type: "video", 
        url: "https://res.cloudinary.com/udkv88c7/video/upload/v1790790781/Wavedash.mp4" 
    },
    { 
        name: "Vine Boom", 
        cmd: "!boom", 
        type: "sfx", 
        url: "https://www.myinstants.com/media/sounds/vine-boom.mp3" 
    },
    { 
        name: "Bonk", 
        cmd: "!bonk", 
        type: "sfx", 
        url: "https://www.myinstants.com/media/sounds/bonk.mp3" 
    },
    { 
        name: "Bruh", 
        cmd: "!bruh", 
        type: "sfx", 
        url: "https://www.myinstants.com/media/sounds/bruh.mp3" 
    }
];

const broadcastStatus = (status) => {
    currentStatus = status;
    io.emit('stream-status', { status });
};

const broadcastDeathCount = () => {
    io.emit('update-counter', { count: deathCount });
};

// --- AUTO-RECONNECT LOGIC ---
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
        console.log(`⚠️ Stream not ready yet (${error.message}). Retrying in 10 seconds...`);
        broadcastStatus('retrying');
        setTimeout(startChat, 10000); 
    }
};

liveChat.on("error", (err) => {
    console.log(`❌ Chat disconnected (${err.message}). Retrying...`);
    broadcastStatus('offline');
    liveChat.stop();
    setTimeout(startChat, 10000);
});

startChat();

// --- CHAT COMMANDS ---
liveChat.on("chat", (chatItem) => {
    const message = chatItem.message.map(m => m.text ? m.text : '').join('').trim().toLowerCase();
    const username = chatItem.author.name;
    const isModOrOwner = chatItem.author.isChatOwner || chatItem.author.isChatModerator;

    // 1. Check Dynamic Triggers
    const matchedTrigger = triggers.find(t => t.cmd === message);
    if (matchedTrigger) {
        console.log(`⚡ ${username} triggered ${matchedTrigger.name} via ${matchedTrigger.cmd}`);
        if (matchedTrigger.type === 'video') {
            io.emit('play-meme', { mediaUrl: matchedTrigger.url });
        } else if (matchedTrigger.type === 'sfx') {
            io.emit('play-sfx', { sfxUrl: matchedTrigger.url });
        }
    }

    // 2. Mod / Owner Only Commands for Death Counter
    if (isModOrOwner) {
        if (message === '!death+' || message === '!died') {
            deathCount++;
            broadcastDeathCount();
        }
        if (message === '!death-') {
            if (deathCount > 0) deathCount--;
            broadcastDeathCount();
        }
        if (message === '!deathreset') {
            deathCount = 0;
            broadcastDeathCount();
        }
    }
});

// --- ADMIN DECK CONTROLS ---
io.on('connection', (socket) => {
    socket.emit('update-counter', { count: deathCount });
    socket.emit('stream-status', { status: currentStatus });
    socket.emit('load-triggers', triggers); // Send dynamic buttons to dashboard

    // Death Counter
    socket.on('admin-death-add', () => { deathCount++; broadcastDeathCount(); });
    socket.on('admin-death-sub', () => { if (deathCount > 0) deathCount--; broadcastDeathCount(); });
    socket.on('admin-death-reset', () => { deathCount = 0; broadcastDeathCount(); });

    // Triggers from Dashboard clicks
    socket.on('admin-play-meme', (data) => io.emit('play-meme', data));
    socket.on('admin-play-sfx', (data) => io.emit('play-sfx', data));

    // Add New Trigger from Form (NO CODE NEEDED!)
    socket.on('admin-add-trigger', (newTrigger) => {
        triggers.push(newTrigger);
        console.log(`✨ New trigger added: ${newTrigger.name} (${newTrigger.cmd})`);
        io.emit('load-triggers', triggers); // Update dashboard buttons instantly
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Cloud Stream Server running on port ${PORT}`);
});
