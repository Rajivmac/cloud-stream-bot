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

// --- SMART CONFIGURATION ---
const CHANNEL_ID = 'UCjckDwkpw4xQAPlF5NEm2tQ'; // Public TEKKEN stream
const TEST_STREAM_ID = ''; // Unlisted test ke liye ID daalein, Public ke liye khali chhod dein

const chatConfig = TEST_STREAM_ID ? { liveId: TEST_STREAM_ID } : { channelId: CHANNEL_ID };
const liveChat = new LiveChat(chatConfig); 

// --- GAME DATA & STATUS STATE ---
let deathCount = 0;
let currentStatus = 'retrying'; // Status options: 'online', 'retrying', 'offline'

// Status broadcast helper (Green / Orange / Red icon ke liye)
const broadcastStatus = (status) => {
    currentStatus = status;
    io.emit('stream-status', { status });
};

// Death counter broadcast helper
const broadcastDeathCount = () => {
    io.emit('update-counter', { count: deathCount });
};

// --- AUTO-RECONNECT LOGIC ---
const startChat = async () => {
    try {
        console.log(`⏳ Checking YouTube Connection...`);
        broadcastStatus('retrying'); // Orange Indicator

        const ok = await liveChat.start();
        if (ok) {
            console.log(`✅ Automatically Connected to YouTube Live Chat!`);
            broadcastStatus('online'); // Green Indicator
        }
    } catch (error) {
        console.log(`⚠️ Stream not ready yet (${error.message}). Retrying in 10 seconds...`);
        broadcastStatus('retrying'); // Orange Indicator
        setTimeout(startChat, 10000); 
    }
};

liveChat.on("error", (err) => {
    console.log(`❌ Chat disconnected (${err.message}). Retrying...`);
    broadcastStatus('offline'); // Red Indicator
    liveChat.stop();
    setTimeout(startChat, 10000);
});

startChat();

// --- CHAT COMMANDS ---
liveChat.on("chat", (chatItem) => {
    const message = chatItem.message.map(m => m.text ? m.text : '').join('').trim().toLowerCase();
    const username = chatItem.author.name;

    // Check if chatter is Mod or Streamer/Owner
    const isModOrOwner = chatItem.author.isChatOwner || chatItem.author.isChatModerator;

    // 1. Meme Trigger (!combo - Anyone can trigger)
    if (message === '!combo') {
        console.log(`🔥 ${username} triggered !combo!`);
        io.emit('play-meme', { 
            mediaUrl: 'https://res.cloudinary.com/udkv88c7/video/upload/v1790790781/Wavedash.mp4' 
        });
    }

    // 2. Mod / Owner Only Commands for Death Counter
    if (isModOrOwner) {
        if (message === '!death+' || message === '!died') {
            deathCount++;
            console.log(`💀 [MOD/OWNER] ${username} added death! Total: ${deathCount}`);
            broadcastDeathCount();
        }

        if (message === '!death-') {
            if (deathCount > 0) deathCount--;
            console.log(`✨ [MOD/OWNER] ${username} reduced death! Total: ${deathCount}`);
            broadcastDeathCount();
        }

        if (message === '!deathreset') {
            deathCount = 0;
            console.log(`🔄 [MOD/OWNER] Counter reset by ${username}`);
            broadcastDeathCount();
        }
    }
});

// --- OBS WEBSOCKET & ADMIN DECK CONTROLS ---
io.on('connection', (socket) => {
    console.log(`📺 Client Connected: ${socket.id}`);
    
    // Naya widget ya phone deck open hote hi current state sync karein
    socket.emit('update-counter', { count: deathCount });
    socket.emit('stream-status', { status: currentStatus });

    // Admin Deck Se Death Counter Controls
    socket.on('admin-death-add', () => {
        deathCount++;
        console.log(`📱 Admin Deck: +1 Death (Total: ${deathCount})`);
        broadcastDeathCount();
    });

    socket.on('admin-death-sub', () => {
        if (deathCount > 0) deathCount--;
        console.log(`📱 Admin Deck: -1 Death (Total: ${deathCount})`);
        broadcastDeathCount();
    });

    socket.on('admin-death-reset', () => {
        deathCount = 0;
        console.log(`📱 Admin Deck: Reset Death`);
        broadcastDeathCount();
    });

    // Admin Deck Se Meme Trigger
    socket.on('admin-play-meme', (data) => {
        console.log(`📱 Admin Deck triggered meme`);
        io.emit('play-meme', data);
    });

    // Admin Deck Se Sound Effect (SFX) Trigger
    socket.on('admin-play-sfx', (data) => {
        console.log(`📱 Admin Deck triggered SFX`);
        io.emit('play-sfx', data);
    });
});

// Cloud platforms (Render) ke liye dynamic port handling
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Cloud Stream Server running on port ${PORT}`);
});
