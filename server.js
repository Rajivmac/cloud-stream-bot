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
        pitch: 1.3,
        rate: 1.1,
        prompt: "You are Son Goku from Dragon Ball. Cheerful, energetic, loves food and fighting. Reply in 1-2 punchy sentences in the viewer's language."
    },
    gojo: {
        name: "Gojo Satoru",
        cmd: "!gojo",
        image: "https://images8.alphacoders.com/134/1344405.jpeg",
        pitch: 1.0,
        rate: 1.0,
        prompt: "You are Gojo Satoru from Jujutsu Kaisen. Supremely confident, witty, playful, and unbeatable. Reply in 1-2 punchy sentences in the viewer's language."
    },
    kazuya: {
        name: "Kazuya Mishima",
        cmd: "!kazuya",
        image: "https://images3.alphacoders.com/134/1347311.jpeg",
        pitch: 0.7,
        rate: 0.95,
        prompt: "You are Kazuya Mishima from TEKKEN 8. Cold, ruthless, arrogant, obsessed with power. Dorya! Reply in 1-2 sharp sentences in the viewer's language."
    },
    sukuna: {
        name: "Ryomen Sukuna",
        cmd: "!sukuna",
        image: "https://images3.alphacoders.com/134/1344406.jpeg",
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
    
    geminiApiKey: '',
    aiEnabled: true,
    enableBubble: true,
    enableTTS: true,
    postToYTChat: false,
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
        aiCost: 50,
        freeForMods: true
    },

    userCoins: {},
    userHistories: {},

    customCommands: [
        { cmd: "!specs", reply: "PC Specs: Ryzen 7 7800X3D | RTX 4070 | 32GB RAM", tts: false },
        { cmd: "!rank", reply: "Tekken 8 Main: Kazuya Mishima (Tekken King Rank)!", tts: true },
        { cmd: "!discord", reply: "Discord community: https://discord.gg/yourlink", tts: false }
    ]
};

let activeBet = {
    isOpen: false,
    locked: false,
    title: "",
    option1: "Win",
    option2: "Lose",
    pool1: 0,
    pool2: 0,
    bets: {}
};

function getCalculatedBetData() {
    let votes1 = 0, votes2 = 0;
    for (const b of Object.values(activeBet.bets)) {
        if (b.option === 1) votes1++;
        if (b.option === 2) votes2++;
    }
    const totalPool = activeBet.pool1 + activeBet.pool2;
    const totalVotes = votes1 + votes2;
    let pct1 = 50, pct2 = 50;
    if (totalPool > 0) {
        pct1 = Math.round((activeBet.pool1 / totalPool) * 100);
        pct2 = 100 - pct1;
    } else if (totalVotes > 0) {
        pct1 = Math.round((votes1 / totalVotes) * 100);
        pct2 = 100 - pct1;
    }
    return {
        ...activeBet,
        votes1, votes2, totalVotes, totalPool, pct1, pct2
    };
}

if (fs.existsSync(DATA_FILE)) {
    try {
        const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        streamData = { ...streamData, ...loaded };
        if (!streamData.userCoins) streamData.userCoins = {};
        if (!streamData.userHistories) streamData.userHistories = {};
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

async function askGemini(userPrompt, username, userRole) {
    if (!streamData.geminiApiKey) return `Pehle Dashboard ke AI tab mein Gemini API Key daal do!`;

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${streamData.geminiApiKey}`;

    let roleInstructions = "";
    if (userRole === 'owner') roleInstructions = `CRITICAL: The person talking is the STREAM OWNER / BOSS. Treat them with highest honor. Call them 'Boss' or 'Streamer Sahab'.`;
    else if (userRole === 'mod') roleInstructions = `CRITICAL: The person talking is a MODERATOR. Call them 'Moderator ji' or 'Mod Sahab'.`;
    else roleInstructions = `The viewer talking is named @${username}.`;

    const systemInstructionText = `${streamData.characterPersona}\n${roleInstructions}\nKeep answers short (1-2 sentences) for stream speech bubble.`;
    const history = streamData.userHistories[username] || [];

    const contents = [];
    history.slice(-6).forEach(entry => contents.push({ role: entry.role === 'model' ? 'model' : 'user', parts: [{ text: entry.text }] }));
    contents.push({ role: "user", parts: [{ text: userPrompt }] });

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ system_instruction: { parts: [{ text: systemInstructionText }] }, contents })
        });
        const data = await res.json();
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            const aiReply = data.candidates[0].content.parts[0].text.trim();
            if (!streamData.userHistories[username]) streamData.userHistories[username] = [];
            streamData.userHistories[username].push({ role: 'user', text: userPrompt });
            streamData.userHistories[username].push({ role: 'model', text: aiReply });
            if (streamData.userHistories[username].length > 8) streamData.userHistories[username] = streamData.userHistories[username].slice(-8);
            saveDataToDisk();
            return aiReply;
        }
        return "Lagta hai power level bohot high ho gaya, samajh nahi aaya!";
    } catch (err) {
        return "AI connect nahi ho paaya, try again!";
    }
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
    const userKey = username.toLowerCase();
    const cName = streamData.coinSettings.currencyName;

    // 1. Passive Earning
    const now = Date.now();
    if (!lastEarnedTime[userKey] || (now - lastEarnedTime[userKey]) >= (streamData.coinSettings.cooldownSeconds * 1000)) {
        if (!streamData.userCoins[userKey]) streamData.userCoins[userKey] = 0;
        streamData.userCoins[userKey] += streamData.coinSettings.coinsPerMsg;
        lastEarnedTime[userKey] = now;
        saveDataToDisk();
    }

    // 2. Check Balance
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

    // 3. Owner Add Coins
    if (message.startsWith('!givecoins ') || message.startsWith('!addcoins ')) {
        if (!isOwner) {
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `Maaf kijiye @${username}, ${cName} generate karne ka haq sirf Streamer Boss ke paas hai! ❌`,
                enableBubble: streamData.enableBubble,
                enableTTS: streamData.enableTTS
            });
            return;
        }
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
                    text: `Streamer Boss ne @${targetUser} ko 🪙 ${amount} ${cName} diye! Naya balance: ${streamData.userCoins[targetUser]}`,
                    enableBubble: streamData.enableBubble,
                    enableTTS: streamData.enableTTS
                });
                return;
            }
        }
    }

    // 4. P2P Transfer
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
                        enableTTS: streamData.enableTTS
                    });
                }
            }
            return;
        }
    }

    // 5. Betting / Voting (!bet 1 50 or !bet 2 100)
    if (message.startsWith('!bet ')) {
        if (!activeBet.isOpen || activeBet.locked) return;
        const parts = rawText.split(' ');
        if (parts.length >= 3) {
            const optionChoice = parseInt(parts[1]);
            const betAmount = parseInt(parts[2]);
            if ((optionChoice === 1 || optionChoice === 2) && !isNaN(betAmount) && betAmount > 0) {
                const userBalance = streamData.userCoins[userKey] || 0;
                if (userBalance >= betAmount) {
                    streamData.userCoins[userKey] -= betAmount;
                    if (!activeBet.bets[userKey]) {
                        activeBet.bets[userKey] = { option: optionChoice, amount: betAmount };
                    } else {
                        activeBet.bets[userKey].amount += betAmount;
                    }
                    if (optionChoice === 1) activeBet.pool1 += betAmount;
                    else activeBet.pool2 += betAmount;

                    saveDataToDisk();
                    broadcastState();
                }
            }
            return;
        }
    }

    // 6. Character Switch
    if (message.startsWith('!setchar ') || message.startsWith('!switchchar ')) {
        const charKey = message.split(' ')[1];
        if (!isModOrOwner) return;
        if (PRESETS[charKey]) {
            streamData.characterName = PRESETS[charKey].name;
            streamData.aiCommand = PRESETS[charKey].cmd;
            streamData.characterImage = PRESETS[charKey].image;
            streamData.characterPersona = PRESETS[charKey].prompt;
            streamData.ttsPitch = PRESETS[charKey].pitch;
            streamData.ttsRate = PRESETS[charKey].rate;
            broadcastState();
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `${isOwner ? "Streamer Boss" : "Moderator ji"} @${username} ke kehne par main aa gaya hoon! Command: ${streamData.aiCommand}`,
                enableBubble: streamData.enableBubble,
                enableTTS: streamData.enableTTS
            });
            return;
        }
    }

    // 7. Auto Welcome
    if (streamData.welcomeNewChatters && !seenChatters.has(username)) {
        seenChatters.add(username);
        let welcomeMsg = `Yo @${username}, stream par swagat hai! Chat karke ${cName} kamao!`;
        if (isOwner) welcomeMsg = `Aadab Streamer Boss! Stream live aur ready hai.`;
        else if (isMod) welcomeMsg = `Namaste Moderator ji @${username}!`;

        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: welcomeMsg,
            enableBubble: streamData.enableBubble,
            enableTTS: streamData.enableTTS
        });
    }

    // 8. Custom Commands
    const matchedCustom = streamData.customCommands.find(c => c.cmd.toLowerCase() === message);
    if (matchedCustom) {
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: `${isMod ? "Moderator ji" : (isOwner ? "Boss" : `@${username}`)}, ${matchedCustom.reply}`,
            enableBubble: streamData.enableBubble,
            enableTTS: matchedCustom.tts && streamData.enableTTS
        });
        return;
    }

    // 9. Manual TTS
    if (message.startsWith('!tts ')) {
        const ttsText = rawText.replace(/^!tts\s+/i, '');
        io.emit('ai-speak', {
            characterName: username,
            characterImage: 'https://cdn-icons-png.flaticon.com/512/3233/3233514.png',
            text: ttsText,
            enableBubble: streamData.enableBubble,
            enableTTS: true
        });
        return;
    }

    // 10. AI Questions
    const activeCommand = (streamData.aiCommand || '!goku').toLowerCase();
    if (streamData.aiEnabled && (message.startsWith(activeCommand + ' ') || message === activeCommand)) {
        const question = rawText.slice(activeCommand.length).trim() || 'Kuch interesting batao!';
        const isFree = isModOrOwner && streamData.coinSettings.freeForMods;
        const currentCoins = streamData.userCoins[userKey] || 0;
        const cost = streamData.coinSettings.aiCost;

        if (!isFree && currentCoins < cost) {
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `@${username}, AI se baat karne ke liye 🪙 ${cost} ${cName} chahiye! Tere paas sirf ${currentCoins} hain.`,
                enableBubble: streamData.enableBubble,
                enableTTS: streamData.enableTTS
            });
            return;
        }

        if (!isFree) {
            streamData.userCoins[userKey] -= cost;
            saveDataToDisk();
            broadcastState();
        }

        const aiAnswer = await askGemini(question, username, userRole);
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: aiAnswer,
            enableBubble: streamData.enableBubble,
            enableTTS: streamData.enableTTS
        });
        return;
    }

    // 11. Memes & SFX
    const matchedTrigger = triggers.find(t => t.cmd === message);
    if (matchedTrigger) {
        if (matchedTrigger.type === 'video') io.emit('play-meme', { mediaUrl: matchedTrigger.url });
        if (matchedTrigger.type === 'sfx') io.emit('play-sfx', { sfxUrl: matchedTrigger.url });
    }

    // 12. Deaths
    if (isModOrOwner) {
        if (message === '!death+' || message === '!died') { streamData.deathCount++; broadcastState(); }
        if (message === '!death-') { if (streamData.deathCount > 0) streamData.deathCount--; broadcastState(); }
        if (message === '!deathreset') { streamData.deathCount = 0; broadcastState(); }
    }
});

const broadcastState = () => {
    io.emit('update-counter', { count: streamData.deathCount });
    io.emit('update-styles', streamData);
    io.emit('bet-update', getCalculatedBetData());
    saveDataToDisk();
};

// Admin Sockets
io.on('connection', (socket) => {
    socket.emit('update-counter', { count: streamData.deathCount });
    socket.emit('stream-status', { status: currentStatus });
    socket.emit('load-triggers', triggers);
    socket.emit('update-styles', streamData);
    socket.emit('bet-update', getCalculatedBetData());
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
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `Dashboard update: @${u} ka balance 🪙 ${streamData.userCoins[u]} ${streamData.coinSettings.currencyName} ho gaya!`,
                enableBubble: streamData.enableBubble,
                enableTTS: streamData.enableTTS
            });
        }
    });

    socket.on('admin-start-bet', ({ title, option1, option2 }) => {
        activeBet = {
            isOpen: true,
            locked: false,
            title: title || "Will I win this match?",
            option1: option1 || "Win",
            option2: option2 || "Lose",
            pool1: 0,
            pool2: 0,
            bets: {}
        };
        broadcastState();
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: `🚨 PREDICTION OPEN: "${activeBet.title}" 👉 [1: ${activeBet.option1}] vs [2: ${activeBet.option2}]. Vote with !bet 1 <amount> or !bet 2 <amount>`,
            enableBubble: streamData.enableBubble,
            enableTTS: streamData.enableTTS
        });
    });

    socket.on('admin-lock-bet', () => {
        activeBet.locked = true;
        broadcastState();
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: `🔒 BETS LOCKED! Match shuru ho chuka hai. Live pool screen par lock ho gaya!`,
            enableBubble: streamData.enableBubble,
            enableTTS: streamData.enableTTS
        });
    });

    socket.on('admin-resolve-bet', ({ winningOption }) => {
        if (!activeBet.isOpen) return;
        const totalPool = activeBet.pool1 + activeBet.pool2;
        const winningPool = winningOption === 1 ? activeBet.pool1 : activeBet.pool2;
        const winningName = winningOption === 1 ? activeBet.option1 : activeBet.option2;

        if (winningPool > 0) {
            for (const [user, bet] of Object.entries(activeBet.bets)) {
                if (bet.option === winningOption) {
                    const payout = Math.floor((bet.amount / winningPool) * totalPool);
                    streamData.userCoins[user] = (streamData.userCoins[user] || 0) + payout;
                }
            }
        }
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: `🏆 RESULT: "${winningName}" JEET GAYA! Total 🪙 ${totalPool} pool winners ko banta gaya!`,
            enableBubble: streamData.enableBubble,
            enableTTS: streamData.enableTTS
        });

        activeBet = { isOpen: false, locked: false, title: "", option1: "Win", option2: "Lose", pool1: 0, pool2: 0, bets: {} };
        saveDataToDisk();
        broadcastState();
    });

    socket.on('admin-cancel-bet', () => {
        if (!activeBet.isOpen) return;
        for (const [user, bet] of Object.entries(activeBet.bets)) {
            streamData.userCoins[user] = (streamData.userCoins[user] || 0) + bet.amount;
        }
        activeBet = { isOpen: false, locked: false, title: "", option1: "Win", option2: "Lose", pool1: 0, pool2: 0, bets: {} };
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
            text: `Yo! Audio aur Speech bubble bilkul perfect set hai!`,
            enableBubble: streamData.enableBubble,
            enableTTS: streamData.enableTTS,
            pitch: streamData.ttsPitch,
            rate: streamData.ttsRate
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
