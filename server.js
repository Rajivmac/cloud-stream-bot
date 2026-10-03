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
  coinSettings: { currencyName: 'Mac-Coins', coinsPerMsg: 5, cooldownSeconds: 30, aiCost: 50, dailyAmount: 50, subReward: 100, memberReward: 500, superchatPerRupee: 2 },
  automod: { blockLinks: true, capsFilter: true, bannedWords: '' },
  userCoins: {}, userDailyClaim: {}, userHistories: {}, userMemory: {},
  triggers: [], customCommands: [],
  bet: { isOpen: false, locked: false, title: '', options: [], bets: {} }
};

let streamData = JSON.parse(JSON.stringify(defaults));
function applyLoaded(l) {
  streamData = { ...streamData, ...l,
    gameCommands: { ...defaults.gameCommands, ...(l.gameCommands || {}) },
    coinSettings: { ...defaults.coinSettings, ...(l.coinSettings || {}) },
    automod: { ...defaults.automod, ...(l.automod || {}) } };
}
try {
  if (fs.existsSync(DATA_FILE)) applyLoaded(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
} catch (e) { console.error('File load fail', e.message); }

// ---------- PERSISTENCE: Upstash Redis (Render disk ephemeral hai) + local file fallback ----------
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const REDIS_KEY = 'stream_data';
let remoteReady = !REDIS_URL; // redis load hone se pehle kabhi write nahi (warna khali data se overwrite ho jayega)
let dirty = false;

async function redisCmd(cmd) {
  const r = await fetch(REDIS_URL, { method: 'POST',
    headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error('redis ' + r.status);
  return r.json();
}
async function loadRemote() {
  if (!REDIS_URL) return;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await redisCmd(['GET', REDIS_KEY]);
      if (r.result) applyLoaded(JSON.parse(r.result));
      remoteReady = true; console.log('Redis data loaded');
      return;
    } catch (e) { console.error('Redis load fail', e.message); await new Promise(res => setTimeout(res, 1000 * (i + 1))); }
  }
  console.error('Redis unavailable: running in file mode, remote writes disabled');
}
async function flush() {
  if (!dirty) return;
  dirty = false;
  const json = JSON.stringify(streamData);
  try { fs.writeFileSync(DATA_FILE, json); } catch (e) {}
  if (REDIS_URL && remoteReady) { try { await redisCmd(['SET', REDIS_KEY, json]); } catch (e) { dirty = true; console.error('Redis save fail', e.message); } }
}
const save = () => { dirty = true; };
setInterval(flush, 10000);
const shutdown = async () => { await flush(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const S = () => streamData;
const bal = u => streamData.userCoins[u] || 0;
const addCoins = (u, n) => { streamData.userCoins[u] = Math.max(0, bal(u) + n); save(); };
const publicState = () => { const { userHistories, userDailyClaim, userMemory, bet, ...rest } = streamData; return rest; };

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
async function askAIBasic(q, username, role) {
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

// ---------- AI v2: Groq/Pollinations + Tavily web search + per-viewer long-term memory ----------
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const TAVILY_KEY = process.env.TAVILY_API_KEY || '';
const SEARCH_DAILY_CAP = parseInt(process.env.SEARCH_DAILY_CAP) || 100;
const NEEDS_SEARCH = /\b(kaun|kab|kitn[aeiy]|latest|news|aaj|abhi|today|current|price|score|who|when|release|patch|tier list|meta|weather|rank|update|winner|champion)\b|\?/i;
const searchCap = { day: '', n: 0 };
const memCount = {};

async function llm(messages, { max = 150, timeout = 9000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const url = GROQ_KEY ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://text.pollinations.ai/openai';
    const headers = { 'Content-Type': 'application/json', ...(GROQ_KEY ? { Authorization: 'Bearer ' + GROQ_KEY } : {}) };
    const body = { model: GROQ_KEY ? GROQ_MODEL : 'openai', messages, max_tokens: max, temperature: 0.8 };
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) return '';
    const j = await r.json();
    return (j.choices?.[0]?.message?.content || '').trim();
  } catch (e) { return ''; } finally { clearTimeout(t); }
}

async function webSearch(q) {
  if (!TAVILY_KEY) return '';
  const d = new Date().toISOString().slice(0, 10);
  if (searchCap.day !== d) { searchCap.day = d; searchCap.n = 0; }
  if (searchCap.n >= SEARCH_DAILY_CAP) return '';
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TAVILY_KEY },
      body: JSON.stringify({ query: q, max_results: 3, include_answer: true }), signal: ctl.signal });
    if (!r.ok) return '';
    const j = await r.json();
    searchCap.n++;
    return ((j.answer ? 'Summary: ' + j.answer + '\n' : '') +
      (j.results || []).map(x => `- ${x.title}: ${(x.content || '').slice(0, 250)}`).join('\n')).slice(0, 1200);
  } catch (e) { return ''; } finally { clearTimeout(t); }
}

async function updateMemory(u, name, q, a) {
  memCount[u] = (memCount[u] || 0) + 1;
  if (memCount[u] % 3 !== 0) return; // har 3rd !ai pe notes update (quota bachane ke liye)
  const old = streamData.userMemory[u] || '';
  const out = await llm([
    { role: 'system', content: 'Tum ek viewer ke baare me chhote notes maintain karte ho (naam, pasand, games, rank, jo bhi yaad rakhne layak ho). Max 300 characters, ek paragraph. Sirf updated notes likho, aur kuch nahi.' },
    { role: 'user', content: `Purane notes: ${old || '(none)'}\nViewer ${name} ne kaha: ${q}\nBot ne jawab diya: ${a}` }], { max: 120 });
  if (out) { streamData.userMemory[u] = out.slice(0, 300); save(); }
}

async function askAI(q, username, role) {
  const u = username.toLowerCase();
  const hist = streamData.userHistories[u] || [];
  const mem = streamData.userMemory[u] || '';
  const web = (q.length > 15 && NEEDS_SEARCH.test(q)) ? await webSearch(q) : '';
  const sys = S().characterPersona + ' Maximum 2 short sentences, Hinglish.' +
    (mem ? `\nIs viewer ke baare me tumhe ye pata hai: ${mem}` : '') +
    (web ? `\nWeb search results (agar relevant ho to inka use karke sahi jawab do):\n${web}` : '') +
    '\nAgar jawab pata nahi ho to seedha bolo pata nahi, banao mat.';
  const tag = role === 'owner' ? 'Boss Rajiv Pal' : `Viewer @${username}`;
  const txt = (await llm([{ role: 'system', content: sys }, ...hist, { role: 'user', content: `${tag}: ${q}` }])).slice(0, 300);
  if (!txt) return { ok: false, text: role === 'owner' ? 'Boss, AI abhi busy hai, thodi der baad try karo!' : `@${username}, AI abhi busy hai, coins wapas kar diye!` };
  streamData.userHistories[u] = [...hist, { role: 'user', content: q }, { role: 'assistant', content: txt }].slice(-4);
  save();
  updateMemory(u, username, q, txt); // fire-and-forget, reply ko slow nahi karega
  return { ok: true, text: txt };
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
    return r.text.slice(0, 195); // YouTube chat limit ~200 chars
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

const keyOk = (q) => !ADMIN_KEY || q.key === ADMIN_KEY;
app.all('/api/streamerbot/chat', async (req, res) => {
  try {
    lastSbPing = Date.now();
    io.emit('streamerbot-status', { online: true });
    const q = { ...req.query, ...(req.body || {}) };
    if (!keyOk(q)) return res.status(403).send('');
    const out = await handleChat({ raw: q.message, username: q.user || 'Viewer', ownerFlag: q.isOwner === 'true' || q.isOwner === true });
    res.send(out || '');
  } catch (e) { console.error(e); res.send(''); }
});
app.get('/health', (_, r) => r.send('ok'));

// ---------- YOUTUBE ALERTS (Streamer.bot trigger -> yahan -> overlay) ----------
app.all('/api/alert', (req, res) => {
  const q = { ...req.query, ...(req.body || {}) };
  if (!keyOk(q)) return res.status(403).send('bad key');
  const type = ({ superchat: 'superchat', supersticker: 'superchat', member: 'member', sponsor: 'member', sub: 'subscriber', subscriber: 'subscriber' })[String(q.type || '').toLowerCase()];
  if (!type) return res.status(400).send('bad type');
  const user = String(q.user || 'Viewer').slice(0, 40);
  const amount = String(q.amount || '').slice(0, 20);
  const msg = String(q.message || '').slice(0, 200);
  const n = parseFloat(amount.replace(/[^0-9.]/g, '')) || 0;
  const cs = S().coinSettings;
  const reward = type === 'subscriber' ? cs.subReward : type === 'member' ? cs.memberReward : Math.floor(n * cs.superchatPerRupee);
  if (reward > 0) { addCoins(cleanU(user), reward); }
  const ttsText = type === 'superchat' ? `${user} ne ${amount} ka super chat bheja. ${msg}`
    : type === 'member' ? `${user} ab channel ke member hain! Welcome!` : `${user} ne subscribe kiya! Shukriya!`;
  io.emit('stream-alert', { type, user, amount, msg, avatar: String(q.avatar || ''), ttsText,
    voice: S().ttsVoice, pitch: S().ttsPitch, rate: S().ttsRate });
  io.emit('update-styles', publicState());
  res.send(reward > 0 ? '+' + reward : 'ok');
});


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

loadRemote().finally(() => server.listen(process.env.PORT || 3000, () => console.log('🚀 Master Server Ready')));
