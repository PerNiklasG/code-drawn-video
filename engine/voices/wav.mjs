// Minimal WAV/PCM helpers shared by the voice adapters, so no adapter needs ffmpeg to hand back audio.
import fs from 'node:fs';

// Signed 16-bit little-endian PCM (what most TTS APIs return as "raw pcm") -> Float32Array.
export function pcm16ToFloat(buf) {
  const n = buf.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

// Parses a PCM (format 1) or float (format 3) WAV, mixed down to mono.
export function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    // Streamed WAVs (some TTS APIs) write 0 or 0xFFFFFFFF as the data size.
    if (id === 'data' && (size === 0 || size === 0xffffffff || off + 8 + size > buf.length)) size = buf.length - off - 8;
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(off + 8), channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') { data = buf.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV without fmt/data chunk');
  const bytes = fmt.bits / 8, frames = Math.floor(data.length / (bytes * fmt.channels));
  const read = fmt.format === 3 ? (o => data.readFloatLE(o))
    : fmt.bits === 16 ? (o => data.readInt16LE(o) / 32768)
    : fmt.bits === 24 ? (o => data.readIntLE(o, 3) / 8388608)
    : fmt.bits === 32 ? (o => data.readInt32LE(o) / 2147483648)
    : null;
  if (!read) throw new Error(`unsupported WAV: format ${fmt.format}, ${fmt.bits} bit`);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) s += read((f * fmt.channels + c) * bytes);
    out[f] = s / fmt.channels;
  }
  return { pcm: out, sampleRate: fmt.sampleRate };
}

// Writes mono float samples as a 16-bit PCM WAV.
export function writeWav16(file, pcm, sampleRate) {
  const data = Buffer.alloc(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

export function requireKey(name, where) {
  const key = process.env[name];
  if (!key) {
    throw new Error(`${name} is not set. Create a key at ${where} and set it in your shell before running:\n` +
      `  macOS / Linux:        export ${name}=...\n` +
      `  Windows (PowerShell): $env:${name}="..."\n` +
      'Never commit the key to the project.');
  }
  return key;
}

export async function postJson(url, headers, body, what) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
  return res;
}
