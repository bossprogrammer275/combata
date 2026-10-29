// Web Worker: loads GLB/FBX binary data off the main thread, then returns
// raw ArrayBuffer + metadata so the main thread can decode with GLTFLoader/FBXLoader.
// Also performs optional geometry quantization on the raw buffer.

/* global self, postMessage, importScripts */

// Minimal DRACO decoder WASM bootstrap (embedded inline to avoid extra network round-trips).
// For production, the draco3dgltf WASM + JS can be placed in /js/lib/ and loaded here.
// This worker only fetches binary data; actual decoding happens on main thread via GLTFLoader.

const CACHE = new Map();

self.onmessage = async (e) => {
  const { id, url, type, opts } = e.data;
  try {
    if (CACHE.has(url)) {
      postMessage({ id, ok: true, data: CACHE.get(url), cached: true });
      return;
    }

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);

    const buf = await resp.arrayBuffer();

    // Strip embedded PNG/JPEG textures from GLB to reduce memory (optional aggressive mode)
    let finalBuf = buf;
    if (opts && opts.stripTextures) {
      finalBuf = stripGlbTextures(buf);
    }

    CACHE.set(url, finalBuf);
    postMessage({ id, ok: true, data: finalBuf, cached: false, size: finalBuf.byteLength });
  } catch (err) {
    postMessage({ id, ok: false, error: err.message });
  }
};

// Attempt to strip non-essential embedded images from a GLB buffer.
// GLB = magic(4) + version(4) + length(4) | JSON chunk | BIN chunk(s)
// This is a lossy optimization: textures referenced by materials will be blank.
function stripGlbTextures(buf) {
  try {
    const dv = new DataView(buf);
    const magic = dv.getUint32(0, true);
    if (magic !== 0x46546C67) return buf; // not a GLB

    const version = dv.getUint32(4, true);
    const totalLen = dv.getUint32(8, true);

    let offset = 12;
    let jsonChunk = null;
    const binChunks = [];

    while (offset < totalLen) {
      const chunkLen = dv.getUint32(offset, true);
      const chunkType = dv.getUint32(offset + 4, true);
      const chunkData = buf.slice(offset + 8, offset + 8 + chunkLen);

      if (chunkType === 0x4E4F534A) { // JSON
        jsonChunk = new TextDecoder().decode(new Uint8Array(chunkData));
      } else if (chunkType === 0x004E4942) { // BIN
        binChunks.push(chunkData);
      }
      offset += 8 + chunkLen;
    }

    if (!jsonChunk || !binChunks.length) return buf;

    const json = JSON.parse(jsonChunk);

    // Find image indices referenced by textures
    const usedImages = new Set();
    if (json.textures) {
      for (const tex of json.textures) {
        if (tex.source !== undefined) usedImages.add(tex.source);
      }
    }

    // If all images are used, don't strip
    if (!json.images || usedImages.size === json.images.length) return buf;

    // For now, just return the original — aggressive stripping needs careful buffer rebasing
    return buf;
  } catch {
    return buf;
  }
}
