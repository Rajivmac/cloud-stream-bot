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
        prompt: "You are Son Goku from Dragon Ball. Cheerful, super energetic, love food and intense Tekken battles. Reply in 1-2 punchy sentences in the viewer's language."
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
        prompt: "You are Kazuya Mishima from TEKKEN 8. Cold, ruthless, power-hungry, and arrogant. Dorya! Reply in 1-2 sharp sentences in the viewer's language."
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

    // MAC-COINS ECONOMY
    coinSettings: {
        currencyName: "Mac-Coins",
        coinsPerMsg: 5,        // Har normal chat par
        cooldownSeconds: 30,   // Rate limit cooldown
        aiCost: 50,            // Cost for AI chat
        freeForMods: true      // Mod/Streamer ke liye free
    },

    userCoins: {},             // { "username": 150 }
    userHistories: {},

    customCommands: [
        { cmd: "!specs", reply: "PC Specs: Ryzen 7 7800X3D | RTX 4070 | 32GB RAM", tts: false },
        { cmd: "!rank", reply: "Tekken 8 Main: Kazuya Mishima (Tekken King Rank)!", tts: true },
        { cmd: "!discord", reply: "Discord community join karein: https://discord.gg/yourlink", tts: false }
    ]
};

// ACTIVE PREDICTION / BET STATE
let activeBet = {
    isOpen: false,
    locked: false,
    title: "",
    option1: "Win",
    option2: "Lose",
    pool1: 0,
    pool2: 0,
    bets: {} // { "username": { option: 1, amount: 50 } }
};

if (fs.existsSync(DATA_FILE)) {
    try {
        const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        streamData = { ...streamData, ...loaded };
        if (!streamData.userCoins) streamData.userCoins = {};
        if (!streamData.userHistories) streamData.userHistories = {};
        if (!streamData.coinSettings) {
            streamData.coinSettings = { currencyName: "Mac-Coins", coinsPerMsg: 5, cooldownSeconds: 30, aiCost: 50, freeForMods: true };
        }
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

// Auto-Timer Loop
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
        const reminderText = discordCmd ? discordCmd.reply : `Stream pasand aa rahi ho toh chat karke ${streamData.coinSettings.currencyName} kamao aur maze karo!`;
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: reminderText,
            enableBubble: streamData.enableBubble,
            enableTTS: false
        });
    }
}, Math.max(streamData.reminderMinutes, 5) * 60 * 1000);

// --- GEMINI AI FUNCTION ---
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
    history.slice(-6).forEach(entry => {
        contents.push({ role: entry.role === 'model' ? 'model' : 'user', parts: [{ text: entry.text }] });
    });
    contents.push({ role: "user", parts: [{ text: userPrompt }] });

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

            if (!streamData.userHistories[username]) streamData.userHistories[username] = [];
            streamData.userHistories[username].push({ role: 'user', text: userPrompt });
            streamData.userHistories[username].push({ role: 'model', text: aiReply });
            if (streamData.userHistories[username].length > 8) {
                streamData.userHistories[username] = streamData.userHistories[username].slice(-8);
            }
            saveDataToDisk();
            return aiReply;
        }
        return "Lagta hai power level bohot high ho gaya, samajh nahi aaya!";
    } catch (err) {
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
    const userKey = username.toLowerCase();
    const cName = streamData.coinSettings.currencyName;

    // 1. PASSIVE MAC-COINS EARNING
    const now = Date.now();
    if (!lastEarnedTime[userKey] || (now - lastEarnedTime[userKey]) >= (streamData.coinSettings.cooldownSeconds * 1000)) {
        if (!streamData.userCoins[userKey]) streamData.userCoins[userKey] = 0;
        streamData.userCoins[userKey] += streamData.coinSettings.coinsPerMsg;
        lastEarnedTime[userKey] = now;
        saveDataToDisk();
    }

    // 2. CHECK BALANCE (!coins, !balance, !maccoins)
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

    // 3. OWNER ONLY: GIVE COINS VIA CHAT (!givecoins @user <amount>)
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

    // 4. USER-TO-USER TRANSFER (!pay @user <amount> or !transfer @user <amount>)
    if (message.startsWith('!pay ') || message.startsWith('!transfer ') || message.startsWith('!gift ')) {
        const parts = rawText.split(' ');
        if (parts.length >= 3) {
            const recipient = parts[1].replace('@', '').toLowerCase();
            const amount = parseInt(parts[2]);

            if (recipient === userKey) {
                io.emit('ai-speak', {
                    characterName: streamData.characterName,
                    characterImage: streamData.characterImage,
                    text: `@${username}, khud ko hi ${cName} transfer nahi kar sakte! 😂`,
                    enableBubble: streamData.enableBubble,
                    enableTTS: false
                });
                return;
            }

            if (isNaN(amount) || amount <= 0) {
                return;
            }

            const senderBalance = streamData.userCoins[userKey] || 0;
            if (senderBalance < amount) {
                io.emit('ai-speak', {
                    characterName: streamData.characterName,
                    characterImage: streamData.characterImage,
                    text: `@${username}, aapke paas transfer karne ke liye paryapt ${cName} nahi hain! Balance: ${senderBalance}`,
                    enableBubble: streamData.enableBubble,
                    enableTTS: false
                });
                return;
            }

            // Execute Transfer
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
            return;
        }
    }

    // 5. BETTING / PREDICTION COMMAND (!bet 1 <amount> or !bet 2 <amount>)
    if (message.startsWith('!bet ')) {
        if (!activeBet.isOpen) {
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `@${username}, abhi koi bet ya prediction active nahi hai!`,
                enableBubble: streamData.enableBubble,
                enableTTS: false
            });
            return;
        }

        if (activeBet.locked) {
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `@${username}, betting lock ho chuki hai! Agli round ka intezar karein.`,
                enableBubble: streamData.enableBubble,
                enableTTS: false
            });
            return;
        }

        const parts = rawText.split(' ');
        if (parts.length >= 3) {
            const optionChoice = parseInt(parts[1]);
            const betAmount = parseInt(parts[2]);

            if (optionChoice !== 1 && optionChoice !== 2) {
                io.emit('ai-speak', {
                    characterName: streamData.characterName,
                    characterImage: streamData.characterImage,
                    text: `@${username}, valid option chunein: 1 (${activeBet.option1}) ya 2 (${activeBet.option2})! Example: !bet 1 50`,
                    enableBubble: streamData.enableBubble,
                    enableTTS: false
                });
                return;
            }

            if (isNaN(betAmount) || betAmount <= 0) return;

            const userBalance = streamData.userCoins[userKey] || 0;
            if (userBalance < betAmount) {
                io.emit('ai-speak', {
                    characterName: streamData.characterName,
                    characterImage: streamData.characterImage,
                    text: `@${username}, aapke paas bet lagane ke liye sirf 🪙 ${userBalance} ${cName} hain!`,
                    enableBubble: streamData.enableBubble,
                    enableTTS: false
                });
                return;
            }

            // Deduct Coins & Place Bet
            streamData.userCoins[userKey] -= betAmount;
            if (!activeBet.bets[userKey]) {
                activeBet.bets[userKey] = { option: optionChoice, amount: betAmount };
            } else {
                // Add to existing bet on same option
                activeBet.bets[userKey].amount += betAmount;
            }

            if (optionChoice === 1) activeBet.pool1 += betAmount;
            else activeBet.pool2 += betAmount;

            saveDataToDisk();
            broadcastState();
            io.emit('bet-update', activeBet);

            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `🎲 @${username} ne 🪙 ${betAmount} ${cName} Option ${optionChoice} par lagaye!`,
                enableBubble: streamData.enableBubble,
                enableTTS: false
            });
            return;
        }
    }

    // 6. CHARACTER CHANGE (!setchar <name>) - ONLY OWNER & MODS
    if (message.startsWith('!setchar ') || message.startsWith('!switchchar ')) {
        const charKey = message.split(' ')[1];
        if (!isModOrOwner) {
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `Sorry @${username}, character badalne ki power sirf Moderator ji aur Streamer Boss ke paas hai! 😎`,
                enableBubble: streamData.enableBubble,
                enableTTS: streamData.enableTTS
            });
            return;
        }

        if (PRESETS[charKey]) {
            streamData.characterName = PRESETS[charKey].name;
            streamData.aiCommand = PRESETS[charKey].cmd;
            streamData.characterImage = PRESETS[charKey].image;
            streamData.characterPersona = PRESETS[charKey].prompt;
            streamData.ttsPitch = PRESETS[charKey].pitch;
            streamData.ttsRate = PRESETS[charKey].rate;
            broadcastState();

            const title = isOwner ? "Streamer Boss" : "Moderator ji";
            io.emit('ai-speak', {
                characterName: streamData.characterName,
                characterImage: streamData.characterImage,
                text: `${title} @${username} ke kehne par main aa gaya hoon! Command ab ${streamData.aiCommand} hai.`,
                enableBubble: streamData.enableBubble,
                enableTTS: streamData.enableTTS
            });
            return;
        }
    }

    // 7. AUTO WELCOME
    if (streamData.welcomeNewChatters && !seenChatters.has(username)) {
        seenChatters.add(username);
        let welcomeMsg = `Yo @${username}, stream par swagat hai! Normal chat karke ${cName} kamao aur maze karo!`;
        if (isOwner) welcomeMsg = `Aadab Streamer Boss! Stream live aur ready hai.`;
        else if (isMod) welcomeMsg = `Namaste Moderator ji @${username}! Duty par swagat hai.`;

        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: welcomeMsg,
            enableBubble: streamData.enableBubble,
            enableTTS: streamData.enableTTS
        });
    }

    // 8. CUSTOM COMMANDS
    const matchedCustom = streamData.customCommands.find(c => c.cmd.toLowerCase() === message);
    if (matchedCustom) {
        const prefix = isMod ? "Moderator ji" : (isOwner ? "Boss" : `@${username}`);
        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: `${prefix}, ${matchedCustom.reply}`,
            enableBubble: streamData.enableBubble,
            enableTTS: matchedCustom.tts && streamData.enableTTS
        });
        return;
    }

    // 9. MANUAL TTS
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

    // 10. AI QUESTIONS WITH COIN DEDUCTION
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
                text: `@${username}, AI se baat karne ke liye 🪙 ${cost} ${cName} chahiye! Tere paas sirf ${currentCoins} hain. Chat karke earn karo!`,
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

    // 12. Death Counter
    if (isModOrOwner) {
        if (message === '!death+' || message === '!died') { streamData.deathCount++; broadcastState(); }
        if (message === '!death-') { if (streamData.deathCount > 0) streamData.deathCount--; broadcastState(); }
        if (message === '!deathreset') { streamData.deathCount = 0; broadcastState(); }
    }
});

const broadcastState = () => {
    io.emit('update-counter', { count: streamData.deathCount });
    io.emit('update-styles', streamData);
    io.emit('bet-update', activeBet);
    saveDataToDisk();
};

// --- ADMIN / DASHBOARD SOCKET CONTROLS ---
io.on('connection', (socket) => {
    socket.emit('update-counter', { count: streamData.deathCount });
    socket.emit('stream-status', { status: currentStatus });
    socket.emit('load-triggers', triggers);
    socket.emit('update-styles', streamData);
    socket.emit('bet-update', activeBet);
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

    // Save Coin Economy Rules
    socket.on('admin-save-coins', (newCoinSettings) => {
        streamData.coinSettings = { ...streamData.coinSettings, ...newCoinSettings };
        saveDataToDisk();
        broadcastState();
    });

    // Direct Gift / Deduct Coins from Dashboard
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
                text: `Dashboard se @${u} ka balance update hua! Naya balance: 🪙 ${streamData.userCoins[u]} ${streamData.coinSettings.currencyName}`,
                enableBubble: streamData.enableBubble,
                enableTTS: streamData.enableTTS
            });
        }
    });

    // --- BETTING ARENA CONTROLS ---
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
            text: `🚨 BETTING SHURU! "${activeBet.title}" 👉 [1: ${activeBet.option1}] vs [2: ${activeBet.option2}]. Command: !bet 1 <amount> ya !bet 2 <amount>`,
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
            text: `🔒 BETTING CLOSED! Saare bets lock ho gaye hain. Match shuru! Pool: 1=[${activeBet.pool1}] vs 2=[${activeBet.pool2}]`,
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
            // Distribute pool to winners
            for (const [user, bet] of Object.entries(activeBet.bets)) {
                if (bet.option === winningOption) {
                    const share = (bet.amount / winningPool) * totalPool;
                    const payout = Math.floor(share);
                    streamData.userCoins[user] = (streamData.userCoins[user] || 0) + payout;
                }
            }
        } else {
            // Refund if no winners on that option
            for (const [user, bet] of Object.entries(activeBet.bets)) {
                streamData.userCoins[user] = (streamData.userCoins[user] || 0) + bet.amount;
            }
        }

        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: `🏆 BET RESULTS: "${winningName}" JEET GAYA! Total 🪙 ${totalPool} ${streamData.coinSettings.currencyName} ka pool jeetne walo mein bant diya gaya hai!`,
            enableBubble: streamData.enableBubble,
            enableTTS: streamData.enableTTS
        });

        activeBet = { isOpen: false, locked: false, title: "", option1: "Win", option2: "Lose", pool1: 0, pool2: 0, bets: {} };
        saveDataToDisk();
        broadcastState();
    });

    socket.on('admin-cancel-bet', () => {
        if (!activeBet.isOpen) return;
        // Refund everyone
        for (const [user, bet] of Object.entries(activeBet.bets)) {
            streamData.userCoins[user] = (streamData.userCoins[user] || 0) + bet.amount;
        }
        activeBet = { isOpen: false, locked: false, title: "", option1: "Win", option2: "Lose", pool1: 0, pool2: 0, bets: {} };
        saveDataToDisk();
        broadcastState();

        io.emit('ai-speak', {
            characterName: streamData.characterName,
            characterImage: streamData.characterImage,
            text: `Bet cancel ho gayi hai aur sabke ${streamData.coinSettings.currencyName} wapas refund kar diye gaye hain!`,
            enableBubble: streamData.enableBubble,
            enableTTS: false
        });
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
