// STATIC COMMAND — single-player open world.
// Plain static file server. Multiplayer/pad networking removed (single-player focus).
import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, relative, isAbsolute, parse, sep } from 'path';
import { readdir, readFile, writeFile, unlink } from 'fs/promises';
import { networkInterfaces } from 'os';
import { randomInt, createHash } from 'crypto';
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


// Asset calibration review persistence. Sidecars are written beside a known source
// model only; the model itself is read-only and its SHA-256 must still match.
const CALIBRATION_ROOTS = [
  resolve(__dirname, 'data', 'models', 'assets'),
  resolve(__dirname, 'data', 'models', 'cars'),
];

function resolveCalibrationSource(input) {
  const raw = String(input || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!raw || raw.includes('..') || !/\.(glb|gltf)$/i.test(raw)) return null;
  const absolute = resolve(__dirname, raw);
  const allowed = CALIBRATION_ROOTS.some(root => {
    const rel = relative(root, absolute);
    return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
  });
  if (!allowed) return null;
  return {
    absolute,
    assetPath: relative(__dirname, absolute).split(sep).join('/'),
    sidecar: join(parse(absolute).dir, parse(absolute).name + '_calibration.json'),
  };
}

function validCalibrationAnchor(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.trim().length > 0 && Number.isFinite(Number(value));
  if (Array.isArray(value)) return value.length > 0 && value.every(item => Number.isFinite(Number(item)));
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value.position)) return value.position.length >= 3 && value.position.slice(0, 3).every(item => Number.isFinite(Number(item)));
  if (value.position && ['x', 'y', 'z'].every(key => Number.isFinite(Number(value.position[key])))) return true;
  return ['x', 'y', 'z'].every(key => Number.isFinite(Number(value[key])))
    || Object.keys(value).length > 0;
}

function validateCalibrationWrite(data, assetPath, sourceHash) {
  if (!data || data.schemaVersion !== 1 || data.kind !== 'open-world-asset-calibration') {
    return 'unsupported calibration schema';
  }
  if (data.source?.assetUrl !== assetPath || data.source?.sha256 !== sourceHash
    || data.collision?.sourceSha256 !== sourceHash) {
    return 'source path or SHA-256 no longer matches this calibration';
  }
  if (!Array.isArray(data.components) || !Array.isArray(data.collision?.boxes)) {
    return 'calibration is missing components or collision boxes';
  }
  const components = new Map();
  for (const component of data.components) {
    if (!component?.nodeKey || components.has(component.nodeKey)) return 'component node keys must be present and unique';
    if (!component.role || !component.kind) return 'component role/kind is missing';
    if (!Number.isFinite(Number(component.confidence)) || component.confidence < 0 || component.confidence > 1) {
      return 'component confidence is invalid';
    }
    components.set(component.nodeKey, component);
    if (component.interaction?.accepted === true) {
      const anchors = component.interaction.anchors || {};
      for (const key of component.interaction.requiredAnchors || []) {
        if (!validCalibrationAnchor(anchors[key])) return 'accepted interaction is missing anchor: ' + key;
      }
    }
  }
  for (const section of data.bridge?.sections || []) {
    if (section.requiresReview === false && /curved|sloped|ramp/i.test(section.kind)
      && (!Array.isArray(section.connection?.points)
        || section.connection.points.length < 3
        || section.connection.points.some(point => !Array.isArray(point)
          || point.length < 3 || !point.slice(0, 3).every(value => Number.isFinite(Number(value)))))) {
      return 'approved curved/sloped bridge section requires a reviewed multi-point centreline';
    }
  }
  const excluded = new Set(data.collision?.excludedDriveableMeshKeys || []);
  for (const key of excluded) {
    const component = components.get(key);
    const surface = (data.road?.surfaces || []).find(item => item.nodeKey === key);
    if (!component || component.runtimeEnabled !== true || !surface || surface.runtimeEnabled !== true) {
      return 'collision exclusion does not resolve to an enabled calibrated road surface';
    }
  }
  for (const surface of data.road?.surfaces || []) {
    const component = components.get(surface.nodeKey);
    if (!component) return 'road surface references an unknown component';
    if (surface.connection?.accepted === true) {
      if (surface.connection.status !== 'estimated' || surface.connection.requiresReview !== false
        || surface.runtimeEnabled !== true || component.runtimeEnabled !== true) {
        return 'accepted road connection is not runtime-enabled or still requires review';
      }
      const start = surface.connection.start?.position;
      const end = surface.connection.end?.position;
      if (!validCalibrationAnchor(start) || !validCalibrationAnchor(end)
        || !(Number(surface.connection.width) > 0.5)) {
        return 'accepted road connection has invalid endpoints or width';
      }
      const needsPolyline = /curve|sloped|ramp/i.test(surface.sectionKind || '')
        || surface.role === 'road-corner-module';
      if (needsPolyline && (!Array.isArray(surface.connection.points)
        || surface.connection.points.length < 3
        || surface.connection.points.some(point => !Array.isArray(point)
          || point.length < 3 || !point.slice(0, 3).every(value => Number.isFinite(Number(value)))))) {
        return 'curved/sloped road connection requires at least three finite centreline points';
      }
    }
  }
  return null;
}

app.get('/api/asset-calibration', async (req, res) => {
  const source = resolveCalibrationSource(req.query.path);
  if (!source) return res.status(400).json({ error: 'asset path must be a GLB/glTF inside data/models/assets or data/models/cars' });
  try {
    const sourceBytes = await readFile(source.absolute);
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    let data = null;
    try { data = JSON.parse(await readFile(source.sidecar, 'utf8')); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      return res.json({ exists: false, stale: false, assetPath: source.assetPath });
    }
    const stale = data?.source?.sha256 !== sourceHash || data?.source?.assetUrl !== source.assetPath;
    res.json({ exists: true, stale, assetPath: source.assetPath, data });
  } catch (error) {
    if (error?.code === 'ENOENT') return res.status(404).json({ error: 'source asset not found' });
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/asset-calibration', async (req, res) => {
  const source = resolveCalibrationSource(req.body?.path);
  const raw = req.body?.data;
  if (!source) return res.status(400).json({ error: 'asset path must be a GLB/glTF inside data/models/assets or data/models/cars' });
  if (typeof raw !== 'string' || raw.length > 5000000) return res.status(400).json({ error: 'invalid calibration JSON payload' });
  try {
    const data = JSON.parse(raw);
    const sourceBytes = await readFile(source.absolute);
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    const validationError = validateCalibrationWrite(data, source.assetPath, sourceHash);
    if (validationError) return res.status(400).json({ error: validationError });
    await writeFile(source.sidecar, JSON.stringify(data, null, 2) + '\\n', 'utf8');
    res.json({ ok: true, path: relative(__dirname, source.sidecar).split('\\\\').join('/'), sha256: sourceHash });
  } catch (error) {
    if (error?.code === 'ENOENT') return res.status(404).json({ error: 'source asset not found' });
    res.status(400).json({ error: String(error) });
  }
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
