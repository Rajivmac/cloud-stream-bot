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

// --- GAME DATA STATE ---
let deathCount = 0;

// --- AUTO-RECONNECT LOGIC ---
const startChat = async () => {
    try {
        console.log(`⏳ Checking YouTube Connection...`);
        const ok = await liveChat.start();
        if (ok) {
            console.log(`✅ Automatically Connected to YouTube Live Chat!`);
        }
    } catch (error) {
        console.log(`⚠️ Stream not ready yet (${error.message}). Retrying in 10 seconds...`);
        setTimeout(startChat, 10000); 
    }
};

liveChat.on("error", (err) => {
    console.log(`❌ Chat disconnected (${err.message}). Trying to reconnect...`);
    liveChat.stop();
    setTimeout(startChat, 10000);
});

startChat();

// --- CHAT COMMANDS ---
liveChat.on("chat", (chatItem) => {
    const message = chatItem.message.map(m => m.text ? m.text : '').join('').trim().toLowerCase();
    const username = chatItem.author.name;

    // 1. Meme Trigger (!combo)
    if (message === '!combo') {
        console.log(`🔥 ${username} triggered !combo!`);
        io.emit('play-meme', { 
            mediaUrl: 'https://res.cloudinary.com/udkv88c7/video/upload/v1790790781/Wavedash.mp4' 
        });
    }

    // 2. Death Counter Increment (!death+ ya !died)
    if (message === '!death+' || message === '!died') {
        deathCount++;
        console.log(`💀 ${username} added death! Total: ${deathCount}`);
        io.emit('update-counter', { count: deathCount });
    }

    // 3. Death Counter Decrement (!death-)
    if (message === '!death-') {
        if (deathCount > 0) deathCount--;
        console.log(`✨ ${username} reduced death! Total: ${deathCount}`);
        io.emit('update-counter', { count: deathCount });
    }

    // 4. Death Counter Reset (!deathreset)
    if (message === '!deathreset') {
        deathCount = 0;
        console.log(`🔄 Counter reset by ${username}`);
        io.emit('update-counter', { count: deathCount });
    }
});

// --- OBS WEBSOCKET CONNECTIONS ---
io.on('connection', (socket) => {
    console.log(`📺 OBS Overlay Connected: ${socket.id}`);
    
    // Naya widget ya OBS open hone par current score bhejo
    socket.emit('update-counter', { count: deathCount });
});

// Render dynamic port assign karta hai
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Cloud Stream Server running on port ${PORT}`);
});
