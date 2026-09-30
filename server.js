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
const CHANNEL_ID = 'UCjckDwkpw4xQAPlF5NEm2tQ'; // Public TEKKEN stream ke liye (hamesha yahi rahega)
const TEST_STREAM_ID = ''; // Aaj ki test stream ke liye (Public stream me isko '' kar dena)

// Logic: Agar Test ID hai toh usey use karo, warna Channel ID
const chatConfig = TEST_STREAM_ID ? { liveId: TEST_STREAM_ID } : { channelId: CHANNEL_ID };
const liveChat = new LiveChat(chatConfig); 

// --- AUTO-RECONNECT LOGIC (Better Version) ---
const startChat = async () => {
    try {
        console.log(`⏳ Checking YouTube Connection...`);
        const ok = await liveChat.start();
        if(ok) {
            console.log(`✅ Automatically Connected to YouTube Live Chat!`);
        }
    } catch (error) {
        console.log(`⚠️ Stream not ready yet (${error.message}). Retrying in 10 seconds...`);
        // 10 second baad wapas try karega bina server crash kiye
        setTimeout(startChat, 10000); 
    }
};

// Agar stream ke beech me connection toot jaye ya stream end ho
liveChat.on("error", (err) => {
    console.log(`❌ Chat disconnected (${err.message}). Trying to reconnect...`);
    liveChat.stop();
    setTimeout(startChat, 10000);
});

// Bot start karo
startChat();

// --- CHAT COMMANDS (Media Triggers) ---
liveChat.on("chat", (chatItem) => {
    const message = chatItem.message.map(m => m.text ? m.text : '').join('').trim().toLowerCase();
    const username = chatItem.author.name;

    // Command 1: !combo (Wavedash Meme)
    if (message === '!combo') {
        console.log(`🔥 ${username} triggered !combo command!`);
        io.emit('stream-event', { 
            type: 'video', 
            mediaUrl: 'https://res.cloudinary.com/udkv88c7/video/upload/v1790790781/Wavedash.mp4' 
        });
    }
    
    // Aap aise aur bhi commands add kar sakte ho (Example ke liye niche wala code uncomment kar sakte hain)
    /*
    if (message === '!ko') {
        console.log(`💥 ${username} triggered !ko command!`);
        io.emit('stream-event', { type: 'video', mediaUrl: 'AAPKA_DUSRA_CLOUDINARY_LINK_YAHAN' });
    }
    */
});

io.on('connection', (socket) => {
    console.log(`📺 OBS Connected: ${socket.id}`);
});

server.listen(3000, () => {
    console.log(`🚀 Cloud Stream Server running on port 3000`);
});