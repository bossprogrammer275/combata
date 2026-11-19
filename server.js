// STATIC COMMAND — single-player open world.
// Plain static file server. Multiplayer/pad networking removed (single-player focus).
import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdir, readFile, writeFile, unlink } from 'fs/promises';
import { networkInterfaces } from 'os';
import { randomInt } from 'crypto';
import { Server } from 'socket.io';

function getLanIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));
const WORLDS_DIR = join(__dirname, 'data', 'worlds');
const ASSET_OVERRIDES_FILE = join(__dirname, 'data', 'asset-overrides.json');
const app = express();
const httpServer = createServer(app);

app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wasm')) {
      res.setHeader('Content-Type', 'application/wasm');
    }
  }
}));
app.get('/favicon.ico', (req, res) => res.status(204).end());

 // Asset Lab persistence. Edits are kept separate from city map layout JSON.
app.get('/api/asset-overrides', async (req, res) => {
  try { const parsed = JSON.parse(await readFile(ASSET_OVERRIDES_FILE, 'utf8')); res.json(parsed && parsed.assets ? parsed : { version: 1, assets: {} }); }
  catch (e) { if (e && e.code === 'ENOENT') return res.json({ version: 1, assets: {} }); res.status(500).json({ error: String(e) }); }
});
app.post('/api/asset-overrides', async (req, res) => {
  const data = req.body && req.body.data;
  if (typeof data !== 'string' || data.length > 5000000) return res.status(400).json({ error: 'bad asset override data' });
  try {
    const parsed = JSON.parse(data);
    if (!parsed || !parsed.assets || typeof parsed.assets !== 'object' || Array.isArray(parsed.assets)) return res.status(400).json({ error: 'expected an assets object' });
    for (const key of Object.keys(parsed.assets)) {
      if (!key.startsWith('/data/models/') && !key.startsWith('./data/models/')) return res.status(400).json({ error: 'asset path is outside data/models' });
      if (!parsed.assets[key] || typeof parsed.assets[key] !== 'object') return res.status(400).json({ error: 'invalid asset entry' });
    }
    await writeFile(ASSET_OVERRIDES_FILE, JSON.stringify({ version: 1, assets: parsed.assets }, null, 2), 'utf8');
    res.json({ ok: true, assets: Object.keys(parsed.assets).length });
  } catch (e) { res.status(400).json({ error: String(e) }); }
});


// map editor: list / load / save scene JSONs (data/worlds/*.json only)
app.get('/api/scenes', async (req, res) => {
  try {
    const files = (await readdir(WORLDS_DIR)).filter((f) => f.endsWith('.json'));
    res.json(files);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/scene', async (req, res) => {
  const name = String(req.query.name || '');
  if (!/^[\w-]+\.json$/.test(name)) return res.status(400).json({ error: 'bad name' });
  try {
    res.type('application/json').send(await readFile(join(WORLDS_DIR, name), 'utf8'));
  } catch (e) {
    res.status(404).json({ error: String(e) });
  }
});

app.post('/api/scene', async (req, res) => {
  const name = String((req.body && req.body.name) || '');
  if (!/^[\w-]+\.json$/.test(name)) return res.status(400).json({ error: 'bad name' });
  const data = req.body && req.body.data;
  if (typeof data !== 'string') return res.status(400).json({ error: 'bad data' });
  try {
    JSON.parse(data); // reject invalid JSON before writing
    await writeFile(join(WORLDS_DIR, name), data, 'utf8');
    res.json({ ok: true, name });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.delete('/api/scene', async (req, res) => {
  const name = String(req.query.name || '');
  if (!/^[\w-]+\.json$/.test(name)) return res.status(400).json({ error: 'bad name' });
  try {
    await unlink(join(WORLDS_DIR, name));
    res.json({ ok: true });
  } catch (e) {
    res.status(404).json({ error: String(e) });
  }
});


// Low-latency phone-controller pairing. The desktop owns a short-lived room;
// the phone joins with the six-character code and streams compact input state.
const io = new Server(httpServer, {
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 12000,
});

const pairSessions = new Map();
const PAIR_CODE_TTL_MS = 10 * 60 * 1000;
const ALLOWED_REMOTE_BUTTONS = new Set([
  'CROSS', 'TRIANGLE', 'SQUARE', 'CIRCLE',
  'L1', 'L2', 'L3', 'R1', 'R2', 'R3',
  'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT',
  'TOUCHPAD', 'SHARE', 'OPTIONS', 'PS',
]);

function makePairCode() {
  let code = '';
  do {
    code = String(randomInt(0, 1000000)).padStart(6, '0');
  } while (pairSessions.has(code));
  return code;
}

function expirePair(code, session) {
  clearTimeout(session.expiryTimer);
  session.expiryTimer = setTimeout(() => {
    if (pairSessions.get(code) !== session || session.controllerId) return;
    pairSessions.delete(code);
    const host = io.sockets.sockets.get(session.hostId);
    if (host) {
      host.emit('pair:expired');
      host.data.pairCode = null;
    }
  }, PAIR_CODE_TTL_MS);
  session.expiryTimer.unref?.();
}

function closePair(code, reason = 'closed') {
  const session = pairSessions.get(code);
  if (!session) return;
  clearTimeout(session.expiryTimer);
  pairSessions.delete(code);
  if (session.controllerId) {
    io.to(session.controllerId).emit('pair:closed', { reason });
  }
  const host = io.sockets.sockets.get(session.hostId);
  if (host) {
    host.emit('pair:closed', { reason });
    host.data.pairCode = null;
  }
}

function clampAxis(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(-1, Math.min(1, number));
}

function sanitizeControllerState(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const sourceButtons = payload.buttons && typeof payload.buttons === 'object'
    ? payload.buttons : {};
  const buttons = {};
  for (const key of ALLOWED_REMOTE_BUTTONS) {
    buttons[key] = sourceButtons[key] === true;
  }
  return {
    left: {
      x: clampAxis(payload.left?.x),
      y: clampAxis(payload.left?.y),
    },
    right: {
      x: clampAxis(payload.right?.x),
      y: clampAxis(payload.right?.y),
    },
    buttons,
  };
}

io.on('connection', (socket) => {
  socket.data.role = null;
  socket.data.pairCode = null;
  socket.data.joinAttempts = [];

  socket.on('pair:create', () => {
    if (socket.data.role === 'controller') return;
    if (socket.data.pairCode) closePair(socket.data.pairCode, 'replaced');

    const code = makePairCode();
    const session = {
      hostId: socket.id,
      controllerId: null,
      createdAt: Date.now(),
      expiryTimer: null,
      lastInputAt: 0,
    };
    pairSessions.set(code, session);
    socket.data.role = 'host';
    socket.data.pairCode = code;
    socket.join('game:' + code);
    expirePair(code, session);
    socket.emit('pair:created', {
      code,
      expiresInMs: PAIR_CODE_TTL_MS,
    });
  });

  socket.on('pair:join', (payload) => {
    if (socket.data.role === 'host') {
      socket.emit('pair:error', { message: 'This device is hosting a game session.' });
      return;
    }

    const now = Date.now();
    socket.data.joinAttempts = socket.data.joinAttempts.filter((time) => now - time < 10000);
    if (socket.data.joinAttempts.length >= 8) {
      socket.emit('pair:error', { message: 'Too many attempts. Wait a few seconds and try again.' });
      return;
    }
    socket.data.joinAttempts.push(now);

    const code = String(payload?.code || '').replace(/\D/g, '').slice(0, 6);
    const session = pairSessions.get(code);
    if (!/^\d{6}$/.test(code) || !session) {
      socket.emit('pair:error', { message: 'Pair code not found. Check the six digits on your game screen.' });
      return;
    }
    if (session.controllerId && session.controllerId !== socket.id) {
      socket.emit('pair:error', { message: 'A phone is already connected to this game.' });
      return;
    }
    if (now - session.createdAt > PAIR_CODE_TTL_MS && !session.controllerId) {
      closePair(code, 'expired');
      socket.emit('pair:error', { message: 'That pair code expired. Generate a new one on the game screen.' });
      return;
    }

    clearTimeout(session.expiryTimer);
    session.controllerId = socket.id;
    socket.data.role = 'controller';
    socket.data.pairCode = code;
    socket.join('game:' + code);
    socket.emit('pair:joined', { code });
    io.to(session.hostId).emit('controller:connected');
  });

  socket.on('controller:input', (payload) => {
    const code = socket.data.pairCode;
    if (socket.data.role !== 'controller' || !code) return;
    const session = pairSessions.get(code);
    if (!session || session.controllerId !== socket.id) return;

    const now = Date.now();
    if (now - session.lastInputAt < 7) return; // cap at about 140 packets/second
    session.lastInputAt = now;
    const state = sanitizeControllerState(payload);
    if (!state) return;
    io.to(session.hostId).emit('controller:input', state);
  });

  socket.on('game:mode', (payload) => {
    const code = socket.data.pairCode;
    if (socket.data.role !== 'host' || !code) return;
    const session = pairSessions.get(code);
    if (!session || session.hostId !== socket.id || !session.controllerId) return;
    const mode = payload?.mode === 'vehicle' ? 'vehicle' : 'foot';
    const state = ['menu', 'playing', 'paused', 'dead', 'intro'].includes(payload?.state)
      ? payload.state : 'menu';
    const vehicleName = String(payload?.vehicleName || '').slice(0, 32);
    io.to(session.controllerId).emit('game:mode', { mode, state, vehicleName });
  });

  socket.on('pair:cancel', () => {
    if (socket.data.role === 'host' && socket.data.pairCode) {
      closePair(socket.data.pairCode, 'cancelled');
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.pairCode;
    if (!code) return;
    const session = pairSessions.get(code);
    if (!session) return;

    if (socket.data.role === 'host' && session.hostId === socket.id) {
      closePair(code, 'host-disconnected');
      return;
    }
    if (socket.data.role === 'controller' && session.controllerId === socket.id) {
      session.controllerId = null;
      const host = io.sockets.sockets.get(session.hostId);
      if (host) host.emit('controller:disconnected');
      expirePair(code, session);
    }
  });
});

httpServer.listen(PORT, () => {
  const lan = getLanIp();
  console.log('STATIC COMMAND SERVER');
  console.log('  Local  -> http://localhost:' + PORT + '/');
  console.log('  LAN    -> http://' + lan + ':' + PORT + '/');
});
