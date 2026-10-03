const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'stream_data.json');
const ADMIN_KEY = process.env.ADMIN_KEY || ''; // Render env var. Khali = no protection

// ---------- DATABASE (flat JSON) ----------
const defaults = {
  deathCount: 0, wins: 0, losses: 0, gameTimeSeconds: 0,
  enableBubble: true, enableTTS: true,
  ttsVoice: 'female', ttsPitch: 1.0, ttsRate: 1.0,
  aiCommand: '!ai', characterName: 'AIBot',
  characterImage: 'https://images3.alphacoders.com/134/1344406.jpeg',
  characterPersona: 'You are a witty, supportive, energetic live stream AI gaming co-host (Ryzen Sukuna). Reply in 1-2 punchy sentences in Hindi/Hinglish.',
  gameCommands: { daily: '!daily', coins: '!coins', gamble: '!gamble', slots: '!slots', duel: '!duel', pay: '!pay' },
  coinSettings: { currencyName: 'Mac-Coins', coinsPerMsg: 5, cooldownSeconds: 30, aiCost: 50, dailyAmount: 50 },
  automod: { blockLinks: true, capsFilter: true, bannedWords: '' },
  userCoins: {}, userDailyClaim: {}, userHistories: {},
  triggers: [], customCommands: [],
  bet: { isOpen: false, locked: false, title: '', options: [], bets: {} }
};

let streamData = JSON.parse(JSON.stringify(defaults));
try {
  if (fs.existsSync(DATA_FILE)) {
    const l = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    streamData = { ...streamData, ...l,
      gameCommands: { ...defaults.gameCommands, ...(l.gameCommands || {}) },
      coinSettings: { ...defaults.coinSettings, ...(l.coinSettings || {}) },
      automod: { ...defaults.automod, ...(l.automod || {}) } };
  }
} catch (e) { console.error('Data load fail', e.message); }

let saveT = null;
const save = () => {
  if (saveT) return;
  saveT = setTimeout(() => { saveT = null; fs.writeFile(DATA_FILE, JSON.stringify(streamData), () => {}); }, 1500);
};

const S = () => streamData;
const bal = u => streamData.userCoins[u] || 0;
const addCoins = (u, n) => { streamData.userCoins[u] = Math.max(0, bal(u) + n); save(); };
const publicState = () => { const { userHistories, userDailyClaim, bet, ...rest } = streamData; return rest; };

// ---------- TIMER ----------
let timerRunning = false;
setInterval(() => {
  if (!timerRunning) return;
  streamData.gameTimeSeconds++;
  io.emit('timer-tick', { seconds: streamData.gameTimeSeconds, running: true });
  if (streamData.gameTimeSeconds % 10 === 0) save();
}, 1000);

// ---------- TTS PROXY ----------
app.get('/api/tts', async (req, res) => {
  try {
    const text = (req.query.text || '').slice(0, 200).trim();
    const voice = (req.query.voice || 'female').toLowerCase();
    if (!text) return res.status(400).send('No text');
    if (voice.includes('female')) {
      const r = await fetch(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=hi&q=${encodeURIComponent(text)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (r.ok) return res.set('Content-Type', 'audio/mpeg').send(Buffer.from(await r.arrayBuffer()));
    } else {
      const r = await fetch('https://tiktok-tts.weilnet.workers.dev/api/generation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'en_male_narration' }) });
      if (r.ok) { const j = await r.json(); if (j?.data) return res.set('Content-Type', 'audio/mpeg').send(Buffer.from(j.data, 'base64')); }
    }
    res.status(502).send('TTS Error');
  } catch (e) { res.status(502).send('TTS Error'); }
});

function speak(text, tts = true, bubble = true) {
  io.emit('ai-speak', {
    characterName: S().characterName, characterImage: S().characterImage, text,
    enableBubble: bubble && S().enableBubble, enableTTS: tts && S().enableTTS,
    voice: S().ttsVoice, pitch: S().ttsPitch, rate: S().ttsRate });
}

// ---------- AI (context = last 4 msgs per user, 9s timeout, refund on fail) ----------
async function askAI(q, username, role) {
  const u = username.toLowerCase();
  const hist = streamData.userHistories[u] || [];
  const tag = role === 'owner' ? 'Boss Rajiv Pal' : `Viewer @${username}`;
  const messages = [
    { role: 'system', content: S().characterPersona + ' Maximum 2 short sentences.' },
    ...hist, { role: 'user', content: `${tag}: ${q}` }];
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch('https://text.pollinations.ai/openai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai', messages }), signal: ctl.signal });
    if (r.ok) {
      const j = await r.json();
      const txt = (j.choices?.[0]?.message?.content || '').trim().slice(0, 300);
      if (txt) {
        streamData.userHistories[u] = [...hist, { role: 'user', content: q }, { role: 'assistant', content: txt }].slice(-4);
        save();
        return { ok: true, text: txt };
      }
    }
  } catch (e) { /* timeout / network */ } finally { clearTimeout(t); }
  return { ok: false, text: role === 'owner' ? 'Boss, AI abhi busy hai, thodi der baad try karo!' : `@${username}, AI abhi busy hai, coins wapas kar diye!` };
}

// ---------- BET ENGINE ----------
function betView() {
  const b = streamData.bet;
  if (!b.isOpen) return { isOpen: false };
  const opts = b.options.map(o => ({ id: o.id, name: o.name, pool: 0, votes: 0, pct: 0 }));
  let total = 0;
  for (const x of Object.values(b.bets)) {
    const o = opts.find(v => v.id === x.optionId);
    if (o) { o.pool += x.amount; o.votes++; total += x.amount; }
  }
  opts.forEach(o => { o.pct = total ? Math.round((o.pool / total) * 100) : 0; });
  return { isOpen: true, locked: b.locked, title: b.title, options: opts, totalPool: total, totalVotes: Object.keys(b.bets).length };
}
const pushBet = () => { io.emit('bet-update', betView()); save(); };
const closeBet = () => { streamData.bet = { isOpen: false, locked: false, title: '', options: [], bets: {} }; pushBet(); };

function resolveBet(winId) {
  const b = streamData.bet;
  if (!b.isOpen) return;
  const opt = b.options.find(o => o.id === winId);
  if (!opt) return;
  const entries = Object.entries(b.bets);
  const total = entries.reduce((s, [, x]) => s + x.amount, 0);
  const winners = entries.filter(([, x]) => x.optionId === winId);
  const winPool = winners.reduce((s, [, x]) => s + x.amount, 0);
  if (winPool === 0) entries.forEach(([u, x]) => addCoins(u, x.amount)); // koi jeeta nahi -> refund
  else winners.forEach(([u, x]) => addCoins(u, Math.floor((x.amount / winPool) * total)));
  b.locked = true;
  io.emit('bet-winner', { winnerName: opt.name, totalPool: total });
  speak(`Prediction khatam! Jeetne wala option: ${opt.name}`, false, true);
  pushBet();
  setTimeout(closeBet, 12000);
}

// ---------- CHAT LOGIC ----------
const lastEarn = {}, lastAi = {}, duels = {};
const today = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10); // IST
const cleanU = s => (s || '').replace(/^@/, '').trim().toLowerCase();
const parseAmt = (s, u) => (String(s).toLowerCase() === 'all' ? bal(u) : parseInt(s));
const SYM = ['🍒', '🍋', '🔔', '💎', '7️⃣'];

async function handleChat({ raw, username, ownerFlag }) {
  const text = (raw || '').trim();
  const u = cleanU(username);
  if (!text || !u || u.includes('aibot') || u.includes('rajivmacai')) return null;
  const isOwner = ownerFlag || u.includes('rajiv') || u.includes('mac_s');
  const role = isOwner ? 'owner' : 'viewer';
  const cs = S().coinSettings, gc = S().gameCommands, cn = cs.currencyName, am = S().automod;

  // automod (local fallback)
  if (!isOwner) {
    if (am.blockLinks && /(https?:\/\/|www\.|\.com\b|\.in\b)/i.test(text)) return null;
    const banned = (am.bannedWords || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
    if (banned.some(w => text.toLowerCase().split(/\W+/).includes(w))) return null;
  }

  // passive earn
  const now = Date.now();
  if (!lastEarn[u] || now - lastEarn[u] >= cs.cooldownSeconds * 1000) {
    addCoins(u, cs.coinsPerMsg); lastEarn[u] = now;
  }

  if (!text.startsWith('!')) return null;
  const [cmd, ...args] = text.split(/\s+/);
  const c = cmd.toLowerCase();

  // !bet <option> <amount>
  if (c === '!bet') {
    const b = streamData.bet;
    if (!b.isOpen) return '@' + username + ', abhi koi poll nahi chal raha.';
    if (b.locked) return '@' + username + ', voting lock ho chuki hai.';
    const optId = parseInt(args[0]); const amt = parseAmt(args[1], u);
    const opt = b.options.find(o => o.id === optId);
    if (!opt || !(amt > 0)) return `@${username} use: !bet <option number> <amount>`;
    const prev = b.bets[u];
    if (prev && prev.optionId !== optId) return `@${username}, tum pehle hi option ${prev.optionId} pe laga chuke ho.`;
    if (bal(u) < amt) return `@${username}, coins kam hain! Balance: 🪙${bal(u)}`;
    addCoins(u, -amt);
    b.bets[u] = { optionId: optId, amount: (prev ? prev.amount : 0) + amt };
    pushBet();
    return `🎲 @${username} ne 🪙${amt} lagaye [${opt.name}] par! Total: 🪙${b.bets[u].amount}`;
  }

  if (c === S().aiCommand.toLowerCase()) {
    if (!isOwner && now - (lastAi[u] || 0) < 15000) return `⏳ @${username} 15 sec ka cooldown hai.`;
    const cost = isOwner ? 0 : cs.aiCost;
    if (bal(u) < cost) return `@${username}, 🪙${cost} ${cn} chahiye!`;
    addCoins(u, -cost); lastAi[u] = now;
    const r = await askAI(args.join(' ') || 'Kya haal hai?', username, role);
    if (!r.ok) { addCoins(u, cost); return r.text; }
    speak(r.text, S().enableTTS, S().enableBubble);
    return r.text;
  }

  if (c === gc.coins) return `@${username}, Balance: 🪙 ${bal(u)} ${cn}`;

  if (c === gc.daily) {
    if (streamData.userDailyClaim[u] === today()) return `@${username}, aaj ka daily le chuke ho!`;
    streamData.userDailyClaim[u] = today(); addCoins(u, cs.dailyAmount);
    return `🎁 @${username} ko 🪙${cs.dailyAmount} daily mile! Balance: 🪙${bal(u)}`;
  }

  if (c === gc.pay) {
    const to = cleanU(args[0]); const amt = parseInt(args[1]);
    if (!to || to === u || !(amt > 0)) return `@${username} use: ${gc.pay} @user <amount>`;
    if (bal(u) < amt) return `@${username}, coins kam hain!`;
    addCoins(u, -amt); addCoins(to, amt);
    return `💸 @${username} ➜ @${to}: 🪙${amt}`;
  }

  if (c === gc.gamble) {
    const amt = parseAmt(args[0], u);
    if (!(amt > 0)) return `@${username} use: ${gc.gamble} <amount>`;
    if (bal(u) < amt) return `@${username}, coins kam hain!`;
    if (Math.random() < 0.5) { addCoins(u, amt); return `🎰 @${username} JEET gaye! +🪙${amt} (Balance 🪙${bal(u)})`; }
    addCoins(u, -amt); return `💀 @${username} haar gaye! -🪙${amt} (Balance 🪙${bal(u)})`;
  }

  if (c === gc.slots) {
    const amt = parseAmt(args[0], u);
    if (!(amt > 0)) return `@${username} use: ${gc.slots} <amount>`;
    if (bal(u) < amt) return `@${username}, coins kam hain!`;
    const r = [0, 0, 0].map(() => SYM[Math.floor(Math.random() * SYM.length)]);
    const uniq = new Set(r).size;
    const mult = uniq === 1 ? 5 : uniq === 2 ? 2 : 0;
    addCoins(u, -amt + amt * mult);
    const tag = mult === 5 ? `JACKPOT 5x! +🪙${amt * 4}` : mult === 2 ? `2x! +🪙${amt}` : `-🪙${amt}`;
    return `🎰 [ ${r.join(' | ')} ] @${username} ${tag} (Balance 🪙${bal(u)})`;
  }

  if (c === gc.duel) {
    const to = cleanU(args[0]); const amt = parseInt(args[1]);
    if (!to || to === u || !(amt > 0)) return `@${username} use: ${gc.duel} @user <amount>`;
    if (bal(u) < amt) return `@${username}, coins kam hain!`;
    duels[to] = { from: u, amount: amt, exp: now + 30000 };
    return `⚔️ @${to}, @${username} ne 🪙${amt} ka duel challenge kiya! 30 sec me !accept likho.`;
  }

  if (c === '!accept') {
    const d = duels[u];
    if (!d || d.exp < now) return null;
    delete duels[u];
    if (bal(d.from) < d.amount || bal(u) < d.amount) return '⚔️ Duel cancel: kisi ke paas coins nahi.';
    const win = Math.random() < 0.5 ? d.from : u; const lose = win === u ? d.from : u;
    addCoins(win, d.amount); addCoins(lose, -d.amount);
    return `⚔️ DUEL: @${win} ne @${lose} ko haraya! +🪙${d.amount}`;
  }

  // media redeem (!boom etc) -> dashboard OBS ko bhejega
  const trig = S().triggers.find(t => t.type !== 'scene' && t.cmd && t.cmd.toLowerCase() === c);
  if (trig) {
    const cost = isOwner ? 0 : (trig.cost || 0);
    if (bal(u) < cost) return `@${username}, 🪙${cost} chahiye!`;
    addCoins(u, -cost);
    io.emit('play-media', { url: trig.url, name: trig.name });
    return `🎬 @${username} ne "${trig.name}" chalaya!`;
  }

  // custom commands
  const cc = S().customCommands.find(x => x.cmd.toLowerCase() === c);
  if (cc) {
    const cost = isOwner ? 0 : (cc.cost || 0);
    if (bal(u) < cost) return `@${username}, 🪙${cost} chahiye!`;
    addCoins(u, -cost);
    if (cc.tts || cc.bubble) speak(cc.reply, !!cc.tts, cc.bubble !== false);
    return cc.reply;
  }
  return null;
}

app.all('/api/streamerbot/chat', async (req, res) => {
  try {
    lastSbPing = Date.now();
    io.emit('streamerbot-status', { online: true });
    const q = { ...req.query, ...(req.body || {}) };
    const out = await handleChat({ raw: q.message, username: q.user || 'Viewer', ownerFlag: q.isOwner === 'true' || q.isOwner === true });
    res.send(out || '');
  } catch (e) { console.error(e); res.send(''); }
});
app.get('/health', (_, r) => r.send('ok'));

let lastSbPing = 0;
setInterval(() => { if (lastSbPing && Date.now() - lastSbPing > 90000) { io.emit('streamerbot-status', { online: false }); lastSbPing = 0; } }, 15000);

// ---------- SOCKET / ADMIN ----------
const pushAll = () => {
  io.emit('update-counter', { count: S().deathCount, wins: S().wins, losses: S().losses });
  io.emit('update-styles', publicState());
  io.emit('load-triggers', S().triggers);
  io.emit('bet-update', betView());
  io.emit('timer-tick', { seconds: S().gameTimeSeconds, running: timerRunning });
  save();
};

io.on('connection', (socket) => {
  const isAdmin = !ADMIN_KEY || socket.handshake.auth?.key === ADMIN_KEY;
  socket.use(([ev], next) => (ev.startsWith('admin-') && !isAdmin ? next(new Error('unauthorized')) : next()));
  socket.on('error', () => {});
  socket.emit('update-counter', { count: S().deathCount, wins: S().wins, losses: S().losses });
  socket.emit('update-styles', publicState());
  socket.emit('load-triggers', S().triggers);
  socket.emit('bet-update', betView());
  socket.emit('timer-tick', { seconds: S().gameTimeSeconds, running: timerRunning });

  // stats
  socket.on('admin-win-add', () => { S().wins++; pushAll(); });
  socket.on('admin-loss-add', () => { S().losses++; pushAll(); });
  socket.on('admin-death-add', () => { S().deathCount++; pushAll(); });
  socket.on('admin-death-sub', () => { if (S().deathCount > 0) S().deathCount--; pushAll(); });
  socket.on('admin-death-reset', () => { S().deathCount = 0; S().wins = 0; S().losses = 0; pushAll(); });

  // timer
  socket.on('admin-timer-start', () => { timerRunning = true; pushAll(); });
  socket.on('admin-timer-pause', () => { timerRunning = false; pushAll(); });
  socket.on('admin-timer-reset', () => { S().gameTimeSeconds = 0; timerRunning = false; pushAll(); });
  socket.on('admin-timer-set', ({ hours, minutes, seconds }) => {
    S().gameTimeSeconds = (+hours || 0) * 3600 + (+minutes || 0) * 60 + (+seconds || 0); pushAll(); });

  // polls
  socket.on('admin-start-bet', ({ title, options }) => {
    if (streamData.bet.isOpen) { Object.entries(streamData.bet.bets).forEach(([u, x]) => addCoins(u, x.amount)); } // purana poll refund
    streamData.bet = { isOpen: true, locked: false, title, options: options.map((n, i) => ({ id: i + 1, name: n })), bets: {} };
    pushBet();
  });
  socket.on('admin-lock-bet', () => { if (streamData.bet.isOpen) { streamData.bet.locked = true; pushBet(); } });
  socket.on('admin-end-bet', () => { // cancel = sab ko refund
    Object.entries(streamData.bet.bets || {}).forEach(([u, x]) => addCoins(u, x.amount));
    closeBet(); pushAll(); });
  socket.on('admin-resolve-bet', ({ winningOptionId }) => { resolveBet(winningOptionId); pushAll(); });

  // coins
  socket.on('admin-grant-coins', ({ user, amount }) => { addCoins(cleanU(user), parseInt(amount) || 0); pushAll(); });
  socket.on('admin-save-coins', ({ coinsPerMsg, cooldownSeconds }) => {
    S().coinSettings.coinsPerMsg = coinsPerMsg; S().coinSettings.cooldownSeconds = cooldownSeconds; pushAll(); });

  // AI / voice / persona
  socket.on('admin-change-styles', (d) => {
    ['ttsVoice', 'ttsPitch', 'ttsRate', 'characterName', 'characterImage', 'characterPersona'].forEach(k => { if (d[k] !== undefined) S()[k] = d[k]; });
    pushAll(); });
  socket.on('admin-update-ai-cmd-config', ({ cmd, cost, tts, bubble }) => {
    S().aiCommand = cmd; S().coinSettings.aiCost = cost; S().enableTTS = tts; S().enableBubble = bubble; pushAll(); });
  socket.on('admin-test-speak', () => speak('Test voice! Sab theek chal raha hai boss.', true, true));

  // commands
  socket.on('admin-update-game-commands', (d) => { Object.assign(S().gameCommands, d); pushAll(); });
  socket.on('admin-add-custom-cmd', (c) => {
    S().customCommands = S().customCommands.filter(x => x.cmd.toLowerCase() !== c.cmd.toLowerCase()).concat(c); pushAll(); });
  socket.on('admin-del-custom-cmd', (cmd) => { S().customCommands = S().customCommands.filter(x => x.cmd !== cmd); pushAll(); });
  socket.on('admin-save-automod', (d) => { S().automod = d; pushAll(); });

  // triggers
  socket.on('admin-add-trigger', (t) => { S().triggers.push({ id: Date.now().toString(36), ...t }); pushAll(); });
  socket.on('admin-del-trigger', (id) => { S().triggers = S().triggers.filter(t => t.id !== id); pushAll(); });
});

server.listen(process.env.PORT || 3000, () => console.log('🚀 Master Server Ready'));
