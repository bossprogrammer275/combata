// STATIC COMMAND — single-player open world.
// Plain static file server. Multiplayer/pad networking removed (single-player focus).
import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdir, readFile, writeFile, unlink } from 'fs/promises';
import { networkInterfaces } from 'os';

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

httpServer.listen(PORT, () => {
  const lan = getLanIp();
  console.log('STATIC COMMAND SERVER');
  console.log('  Local  -> http://localhost:' + PORT + '/');
  console.log('  LAN    -> http://' + lan + ':' + PORT + '/');
});
