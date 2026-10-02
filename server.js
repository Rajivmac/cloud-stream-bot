<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>OBS AI Speech & Unified Alerts Overlay</title>
    <style>
        body {
            margin: 0;
            padding: 24px;
            background: transparent;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        /* 🎬 FULLSCREEN / CENTER MEME VIDEO POPUP */
        #meme-container {
            display: none;
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            z-index: 9999;
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 0 50px rgba(0, 0, 0, 0.9);
            border: 3px solid #00d2d3;
        }

        #meme-video {
            max-width: 80vw;
            max-height: 80vh;
            display: block;
        }

        /* 🌟 ALERT CARD */
        #alert-box {
            display: none;
            align-items: center;
            gap: 16px;
            border-radius: 18px;
            padding: 16px 22px;
            max-width: 540px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.7);
            animation: alertPop 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            margin-bottom: 12px;
            box-sizing: border-box;
        }

        .tier-blue {
            background: linear-gradient(135deg, #0984e3, #00cec9) !important;
            border: 3px solid #74b9ff !important;
            color: #ffffff !important;
        }

        .tier-gold {
            background: linear-gradient(135deg, #f1c40f, #e67e22) !important;
            border: 3px solid #ffffff !important;
            color: #000000 !important;
        }

        .tier-red {
            background: linear-gradient(135deg, #ff4757, #8e44ad) !important;
            border: 3px solid #ffd32a !important;
            color: #ffffff !important;
            animation: redPulsingAlert 1s infinite alternate, alertPop 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
        }

        @keyframes redPulsingAlert {
            0% { border-color: #ffd32a; }
            100% { border-color: #ffffff; box-shadow: 0 0 45px rgba(255, 71, 87, 1); }
        }

        .alert-member {
            background: linear-gradient(135deg, #00d2d3, #2ecc71);
            border: 3px solid #ffffff;
            color: #000;
        }

        .alert-sub {
            background: linear-gradient(135deg, #ff4757, #c0392b);
            border: 3px solid #ffffff;
            color: #fff;
        }

        @keyframes alertPop {
            0% { transform: scale(0.65) translateY(-25px); opacity: 0; }
            100% { transform: scale(1) translateY(0); opacity: 1; }
        }

        .alert-avatar-img {
            width: 64px;
            height: 64px;
            border-radius: 50%;
            object-fit: cover;
            border: 3px solid #ffffff;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            flex-shrink: 0;
            background: #111;
        }

        .alert-content-col {
            display: flex;
            flex-direction: column;
            gap: 4px;
            flex: 1;
        }

        .alert-header-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            font-size: 15px;
            font-weight: 900;
            text-transform: uppercase;
        }

        .alert-badge-tag {
            background: rgba(0, 0, 0, 0.85);
            color: #fff;
            padding: 3px 9px;
            border-radius: 7px;
            font-size: 13px;
            font-weight: 800;
        }

        .alert-body-text {
            font-size: 15px;
            font-weight: 700;
            line-height: 1.35;
        }

        /* 💬 AI SPEECH BUBBLE */
        #ai-container {
            display: none;
            align-items: flex-start;
            gap: 16px;
            background: rgba(14, 18, 28, 0.96);
            border: 2px solid #00d2d3;
            border-radius: 16px;
            padding: 16px 20px;
            max-width: 550px;
            box-shadow: 0 8px 30px rgba(0, 210, 211, 0.4);
            animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        }

        @keyframes popIn {
            0% { transform: scale(0.7) translateY(20px); opacity: 0; }
            100% { transform: scale(1) translateY(0); opacity: 1; }
        }

        #avatar {
            width: 72px;
            height: 72px;
            border-radius: 50%;
            object-fit: cover;
            border: 3px solid #00d2d3;
            box-shadow: 0 0 15px rgba(0, 210, 211, 0.6);
            flex-shrink: 0;
            background: #0b0e14;
        }

        .talking-pulse {
            animation: pulseGlow 0.85s infinite alternate !important;
        }

        @keyframes pulseGlow {
            0% {
                box-shadow: 0 0 10px #00d2d3, 0 0 20px rgba(0, 210, 211, 0.4);
                border-color: #00d2d3;
                transform: scale(1);
            }
            100% {
                box-shadow: 0 0 25px #00d2d3, 0 0 45px rgba(0, 210, 211, 0.8);
                border-color: #ffffff;
                transform: scale(1.06);
            }
        }

        .content {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        #bot-name {
            font-size: 15px;
            font-weight: 800;
            color: #00d2d3;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        #bot-text {
            font-size: 16px;
            font-weight: 600;
            color: #ffffff;
            line-height: 1.4;
            text-shadow: 0 2px 4px rgba(0,0,0,0.8);
        }
    </style>
</head>
<body>

    <audio id="tts-audio" style="display:none;"></audio>
    <audio id="sfx-audio" style="display:none;"></audio>

    <!-- 🎬 MEME VIDEO REDEEM -->
    <div id="meme-container">
        <video id="meme-video" playsinline></video>
    </div>

    <!-- 🌟 UNIFIED ALERT CARD -->
    <div id="alert-box">
        <img id="alert-user-img" class="alert-avatar-img" src="https://cdn-icons-png.flaticon.com/512/847/847969.png" alt="User">
        <div class="alert-content-col">
            <div class="alert-header-row">
                <span id="alert-title">SUPER CHAT: @Rahul</span>
                <span id="alert-badge" class="alert-badge-tag">₹500</span>
            </div>
            <div class="alert-body-text" id="alert-msg">Keep grinding boss!</div>
        </div>
    </div>

    <!-- 💬 AI SPEECH BUBBLE -->
    <div id="ai-container">
        <img id="avatar" src="https://images3.alphacoders.com/134/1344406.jpeg" alt="Avatar">
        <div class="content">
            <span id="bot-name">Ryomen Sukuna</span>
            <div id="bot-text">Hello Stream!</div>
        </div>
    </div>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        const container = document.getElementById('ai-container');
        const avatar = document.getElementById('avatar');
        const botName = document.getElementById('bot-name');
        const botText = document.getElementById('bot-text');
        const audioPlayer = document.getElementById('tts-audio');
        const sfxPlayer = document.getElementById('sfx-audio');

        const memeContainer = document.getElementById('meme-container');
        const memeVideo = document.getElementById('meme-video');

        const alertBox = document.getElementById('alert-box');
        const alertUserImg = document.getElementById('alert-user-img');
        const alertTitle = document.getElementById('alert-title');
        const alertBadge = document.getElementById('alert-badge');
        const alertMsg = document.getElementById('alert-msg');

        const eventQueue = [];
        let isProcessing = false;
        let safetyTimeout = null;

        let audioCtx = null;
        let bassFilter = null;
        let trebleFilter = null;
        let sourceNode = null;
        let currentRate = 1.0;

        function initToneEqualizer() {
            try {
                if (!audioCtx) {
                    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    bassFilter = audioCtx.createBiquadFilter();
                    bassFilter.type = "lowshelf";
                    bassFilter.frequency.value = 220;

                    trebleFilter = audioCtx.createBiquadFilter();
                    trebleFilter.type = "highshelf";
                    trebleFilter.frequency.value = 2600;

                    sourceNode = audioCtx.createMediaElementSource(audioPlayer);
                    sourceNode.connect(bassFilter);
                    bassFilter.connect(trebleFilter);
                    trebleFilter.connect(audioCtx.destination);
                }
                if (audioCtx.state === 'suspended') {
                    audioCtx.resume();
                }
            } catch(e) {}
        }

        function playSoftChime() {
            try {
                initToneEqualizer();
                if (!audioCtx) return;
                const now = audioCtx.currentTime;
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(587.33, now);
                osc.frequency.exponentialRampToValueAtTime(880, now + 0.08);
                gain.gain.setValueAtTime(0.12, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start(now);
                osc.stop(now + 0.32);
            } catch(e) {}
        }

        function enqueueEvent(item) {
            if (eventQueue.length >= 8) return;
            eventQueue.push(item);
            if (!isProcessing) processNextQueueItem();
        }

        function processNextQueueItem() {
            if (eventQueue.length === 0) {
                isProcessing = false;
                return;
            }

            isProcessing = true;
            const current = eventQueue.shift();

            if (current.type === 'alert') {
                handleUnifiedAlert(current);
            } else if (current.type === 'speak') {
                handleCharacterSpeak(current);
            } else if (current.type === 'meme') {
                handleMemeVideo(current);
            } else if (current.type === 'sfx') {
                handleSFX(current);
            }
        }

        function finishCurrentItem() {
            if (safetyTimeout) clearTimeout(safetyTimeout);
            avatar.classList.remove('talking-pulse');
            alertUserImg.classList.remove('talking-pulse');
            container.style.display = 'none';
            alertBox.style.display = 'none';
            memeContainer.style.display = 'none';
            memeVideo.pause();

            setTimeout(processNextQueueItem, 400);
        }

        // 🎬 HANDLE MEME VIDEO
        function handleMemeVideo(data) {
            memeVideo.src = data.mediaUrl;
            memeContainer.style.display = 'block';
            memeVideo.currentTime = 0;
            memeVideo.volume = 1.0;

            memeVideo.onended = finishCurrentItem;
            memeVideo.onerror = finishCurrentItem;
            safetyTimeout = setTimeout(finishCurrentItem, 15000);

            memeVideo.play().catch(() => finishCurrentItem());
        }

        // 🔊 HANDLE SFX
        function handleSFX(data) {
            sfxPlayer.src = data.sfxUrl;
            sfxPlayer.volume = 1.0;
            sfxPlayer.onended = finishCurrentItem;
            sfxPlayer.onerror = finishCurrentItem;
            safetyTimeout = setTimeout(finishCurrentItem, 10000);

            sfxPlayer.play().catch(() => finishCurrentItem());
        }

        function parseAmountNumeric(amtStr) {
            if (!amtStr) return 0;
            const num = amtStr.toString().replace(/[^0-9.]/g, '');
            return parseFloat(num) || 0;
        }

        function handleUnifiedAlert(data) {
            playSoftChime();
            alertBox.className = '';
            alertUserImg.src = data.avatar || 'https://cdn-icons-png.flaticon.com/512/847/847969.png';

            if (data.alertType === 'superchat') {
                const numericAmount = parseAmountNumeric(data.amount);
                if (numericAmount >= 500) alertBox.classList.add('tier-red');
                else if (numericAmount >= 100) alertBox.classList.add('tier-gold');
                else alertBox.classList.add('tier-blue');

                alertTitle.innerText = `💰 SUPER CHAT: @${data.user}`;
                alertBadge.innerText = data.amount;
                alertMsg.innerText = data.msg || 'Thank you for supporting the stream!';
            } else if (data.alertType === 'member') {
                alertBox.classList.add('alert-member');
                alertTitle.innerText = `👑 NEW MEMBER: @${data.user}`;
                alertBadge.innerText = 'MEMBER';
                alertMsg.innerText = data.msg || 'Welcome to the channel family!';
            } else if (data.alertType === 'subscriber') {
                alertBox.classList.add('alert-sub');
                alertTitle.innerText = `🔴 NEW SUBSCRIBER: @${data.user}`;
                alertBadge.innerText = 'NEW SUB';
                alertMsg.innerText = 'Subscribed to the channel! Welcome!';
            }

            alertBox.style.display = 'flex';

            const speechText = data.ttsText || data.msg || `${data.user} thank you!`;
            playVoiceWithCallback(speechText, data.voice, data.pitch, data.rate, alertUserImg, () => {
                setTimeout(finishCurrentItem, 1000);
            });
        }

        function handleCharacterSpeak(data) {
            playSoftChime();
            if (data.enableBubble) {
                avatar.src = data.characterImage || 'https://images3.alphacoders.com/134/1344406.jpeg';
                botName.innerText = data.characterName || 'Bot';
                botText.innerText = data.text;
                container.style.display = 'flex';
            }

            if (data.enableTTS) {
                playVoiceWithCallback(data.text, data.voice, data.pitch, data.rate, avatar, () => {
                    finishCurrentItem();
                });
            } else {
                safetyTimeout = setTimeout(finishCurrentItem, 5500);
            }
        }

        function playVoiceWithCallback(text, voice, pitch, rate, targetImgElement, onComplete) {
            const cleanText = text.replace(/[*_#~`]/g, '').trim();
            if (!cleanText) return onComplete();

            initToneEqualizer();

            const isFemale = (voice || 'female').toLowerCase().includes('female');
            const selectedVoice = isFemale ? 'female' : 'male';
            const p = parseFloat(pitch) || 1.0;
            currentRate = Math.max(0.6, Math.min(1.8, parseFloat(rate) || 1.0));

            if (bassFilter && trebleFilter) {
                if (p < 1.0) {
                    bassFilter.gain.value = (1.0 - p) * 28;
                    trebleFilter.gain.value = -(1.0 - p) * 14;
                } else if (p > 1.0) {
                    bassFilter.gain.value = -(p - 1.0) * 14;
                    trebleFilter.gain.value = (p - 1.0) * 20;
                } else {
                    bassFilter.gain.value = 0;
                    trebleFilter.gain.value = 0;
                }
            }

            audioPlayer.preservesPitch = true;
            audioPlayer.pause();
            audioPlayer.crossOrigin = "anonymous";

            const applySpeed = () => {
                try { audioPlayer.playbackRate = currentRate; } catch(e) {}
            };

            audioPlayer.onloadedmetadata = applySpeed;
            audioPlayer.onplay = applySpeed;
            audioPlayer.onplaying = applySpeed;

            let completed = false;
            const done = () => {
                if (!completed) {
                    completed = true;
                    if (targetImgElement) targetImgElement.classList.remove('talking-pulse');
                    onComplete();
                }
            };

            audioPlayer.onended = done;
            audioPlayer.onerror = done;
            safetyTimeout = setTimeout(done, 8500);

            audioPlayer.src = `/api/tts?voice=${selectedVoice}&text=${encodeURIComponent(cleanText)}&t=${Date.now()}`;
            audioPlayer.volume = 1.0;

            const playPromise = audioPlayer.play();
            if (playPromise !== undefined) {
                playPromise.then(() => {
                    applySpeed();
                    if (targetImgElement) targetImgElement.classList.add('talking-pulse');
                }).catch(err => {
                    done();
                });
            }
        }

        // ==========================================
        // 📡 SOCKET LISTENERS (ALL WORKING!)
        // ==========================================
        socket.on('ai-speak', (data) => {
            enqueueEvent({ type: 'speak', ...data });
        });

        socket.on('stream-alert', (data) => {
            enqueueEvent({
                type: 'alert',
                alertType: data.type,
                user: data.user,
                amount: data.amount,
                avatar: data.avatar,
                msg: data.msg,
                ttsText: data.ttsText,
                voice: data.voice,
                pitch: data.pitch,
                rate: data.rate
            });
        });

        socket.on('play-meme', (data) => {
            enqueueEvent({ type: 'meme', mediaUrl: data.mediaUrl, name: data.name });
        });

        socket.on('play-sfx', (data) => {
            enqueueEvent({ type: 'sfx', sfxUrl: data.sfxUrl, name: data.name });
        });
    </script>
</body>
</html>
