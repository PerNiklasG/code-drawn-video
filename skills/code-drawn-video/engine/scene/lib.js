// Deterministic drawing helpers shared by every scene. No Math.random anywhere: every "random" value is a hash.
// The look comes from style.json (STYLE, a preset from styles/ plus overrides), colours from palette.json (PAL)
// and the two font families from fonts.json; init() in scenes.js loads them before the first frame.
// look.js adds backgrounds, captions, camera and transitions; fx.js adds the effects kit.
'use strict';

const W = 1920, H = 1080;
let STYLE = null;
let DISPLAY = 'sans-serif', UI = 'sans-serif';
let DISPLAY_SPACING = 0.03, DISPLAY_CAPS = true;
const BASE_AMP = 1.6;

// A style value is a palette key or a literal colour.
const col = v => (v && v[0] === '#' ? v : PAL[v] || v);

function h32(a, b = 0, c = 0) {
  let x = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 1440662683)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  x = Math.imul(x, 2246822519);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}
const hs = (a, b = 0, c = 0) => h32(a, b, c) * 2 - 1;

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, p) => a + (b - a) * p;
const prog = (t, t0, t1) => clamp((t - t0) / (t1 - t0));
const ease = {
  inOut: p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  out: p => 1 - Math.pow(1 - p, 3),
  in: p => p * p * p,
  sine: p => 0.5 - 0.5 * Math.cos(Math.PI * p),
  back: p => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
  backBig: p => { const c1 = 3, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
  expo: p => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  elastic: p => (p === 0 || p === 1 ? p : Math.pow(2, -9 * p) * Math.sin((p * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
};
const boil = t => (STYLE.line.boilFps > 0 ? Math.floor(t * STYLE.line.boilFps) : 0);

function mixHex(a, b, p) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = s => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
  const A = ch(pa), B = ch(pb);
  const c = A.map((v, i) => Math.round(lerp(v, B[i], p)));
  return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
}

// ---------- point samplers ----------
function sampleLine(x1, y1, x2, y2, step = 22) {
  const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step) + 1);
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([lerp(x1, x2, i / (n - 1)), lerp(y1, y2, i / (n - 1))]);
  return pts;
}
function samplePoly(points, closed = true, step = 22) {
  const out = [];
  const n = points.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const s = sampleLine(a[0], a[1], b[0], b[1], step);
    if (i > 0) s.shift();
    out.push(...s);
  }
  if (closed) out.pop();
  return out;
}
function sampleRoundRect(x, y, w, h, r, step = 22) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  const arc = (cx, cy, a0) => {
    const n = Math.max(3, Math.ceil((Math.PI / 2) * r / step));
    for (let i = 0; i <= n; i++) {
      const a = a0 + (Math.PI / 2) * (i / n);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  const edge = (x1, y1, x2, y2) => { const s = sampleLine(x1, y1, x2, y2, step); s.shift(); s.pop(); pts.push(...s); };
  arc(x + w - r, y + r, -Math.PI / 2); edge(x + w, y + r, x + w, y + h - r);
  arc(x + w - r, y + h - r, 0); edge(x + w - r, y + h, x + r, y + h);
  arc(x + r, y + h - r, Math.PI / 2); edge(x, y + h - r, x, y + r);
  arc(x + r, y + r, Math.PI); edge(x + r, y, x + w - r, y);
  return pts;
}
function sampleEllipse(cx, cy, rx, ry, step = 22, a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2) {
  const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) * Math.max(rx, ry) / step));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = lerp(a0, a1, i / n);
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}
function sampleQuad(x1, y1, cx, cy, x2, y2, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, v = 1 - u;
    pts.push([v * v * x1 + 2 * v * u * cx + u * u * x2, v * v * y1 + 2 * v * u * cy + u * u * y2]);
  }
  return pts;
}

// Offsets every point by seeded noise that changes STYLE.line.boilFps times per second, so lines "boil" like hand
// animation. Only the "wobbly" line type jitters; STYLE.line.wobble scales it.
function jitter(pts, seed, t, amp = BASE_AMP) {
  amp *= STYLE.line.type === 'wobbly' ? STYLE.line.wobble : 0;
  if (!amp) return pts;
  const b = boil(t);
  return pts.map((p, i) => [p[0] + hs(seed, i, b) * amp, p[1] + hs(seed + 7919, i, b) * amp]);
}

function tracePath(ctx, pts, closed) {
  const n = pts.length;
  if (n < 2) return;
  ctx.beginPath();
  if (closed) {
    const m0 = mid(pts[n - 1], pts[0]);
    ctx.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
      const p = pts[i], m = mid(p, pts[(i + 1) % n]);
      ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
    }
    ctx.closePath();
  } else {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n - 1; i++) {
      const m = mid(pts[i], pts[i + 1]);
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
    }
    ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
  }
}
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// Draws a shape in the style's line treatment (STYLE.line.type): "wobbly" (hand-drawn, boiling), "clean",
// "outline" (thick, for comic/sticker looks) or "none" (fills only; pass force: true to stroke anyway).
// opts: seed, t, amp, width, color, fill, closed, progress (0..1 draw-on), alpha, force
function wobbly(ctx, pts, o) {
  const mode = STYLE.line.type;
  const closed = o.closed !== false;
  const j = jitter(pts, o.seed || 1, o.t || 0, o.amp == null ? BASE_AMP : o.amp);
  ctx.save();
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  if (o.fill) {
    const jf = jitter(pts, (o.seed || 1) + 31, o.t || 0, (o.amp == null ? BASE_AMP : o.amp) * 1.4);
    tracePath(ctx, jf, true);
    ctx.fillStyle = o.fill;
    ctx.fill();
  }
  if (o.color !== null && (mode !== 'none' || o.force)) {
    ctx.strokeStyle = o.color || PAL.ink;
    ctx.lineWidth = o.width || STYLE.line.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const p = o.progress == null ? 1 : clamp(o.progress);
    if (p > 0) {
      if (p >= 1) {
        tracePath(ctx, j, closed);
      } else {
        const k = Math.max(2, Math.round((closed ? j.length + 1 : j.length) * p));
        const sub = [];
        for (let i = 0; i < k; i++) sub.push(j[i % j.length]);
        tracePath(ctx, sub, false);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------- sprites ----------
const IMG = {};
function loadImages(names) {
  return Promise.all(names.map(n => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { IMG[n] = im; res(); };
    im.onerror = () => rej(new Error('image failed: ' + n));
    im.src = '../cells/' + n + '.png';
  })));
}
// Draws image n so that its pixel (ax, ay) (anchor, in image px; default centre) sits at (x, y).
function sprite(ctx, n, x, y, s = 1, rot = 0, alpha = 1, ax = null, ay = null) {
  const im = IMG[n];
  if (!im || alpha <= 0 || s <= 0) return;
  ctx.save();
  ctx.globalAlpha *= clamp(alpha);
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.scale(s, s);
  ctx.drawImage(im, -(ax == null ? im.width / 2 : ax), -(ay == null ? im.height / 2 : ay));
  ctx.restore();
}

// ---------- text ----------
function setFont(ctx, family, size, weight = 400, spacing = 0.04) {
  ctx.font = `${weight} ${size}px "${family}"`;
  ctx.letterSpacing = (size * spacing).toFixed(2) + 'px';
}
function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Handwritten-style text with a per-character write-on pop (the hand-drawn caption). Draws centred on (cx, cy).
// o: size, color, t0 (appear), t1 (disappear, optional), maxW, align ('center'|'left'), seed, dur (write-on seconds)
// Upper-cased when fonts.json display.caps is true.
function handText(ctx, text, cx, cy, t, o = {}) {
  if (DISPLAY_CAPS && !o.family) text = text.toUpperCase();
  const size = o.size || 68;
  const t0 = o.t0 == null ? -1e9 : o.t0;
  const t1 = o.t1 == null ? 1e9 : o.t1;
  if (t < t0 || t > t1 + 0.35) return;
  ctx.save();
  const spacing = o.spacing == null ? DISPLAY_SPACING : o.spacing;
  setFont(ctx, o.family || DISPLAY, size, o.weight || 400, spacing);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = o.color || PAL.ink;
  const lines = wrap(ctx, text, o.maxW || 1640);
  const lh = size * (o.lh || 1.12);
  const total = text.length;
  const dur = o.dur == null ? Math.min(0.7, 0.03 * total + 0.1) : o.dur;
  const out = prog(t, t1, t1 + 0.3);
  ctx.globalAlpha *= (o.alpha == null ? 1 : o.alpha) * (1 - ease.inOut(out));
  const b = boil(t);
  let k = 0;
  lines.forEach((line, li) => {
    const lw = ctx.measureText(line).width - size * spacing;
    let x0 = o.align === 'left' ? cx : cx - lw / 2;
    const y = cy + (li - (lines.length - 1) / 2) * lh - out * 10;
    for (let ci = 0; ci < line.length; ci++, k++) {
      const ch = line[ci];
      const x = x0 + ctx.measureText(line.slice(0, ci)).width;
      if (ch === ' ') continue;
      const ck = t0 + dur * (k / Math.max(1, total));
      const p = prog(t, ck, ck + 0.16);
      if (p <= 0) continue;
      const sc = lerp(1.5, 1, ease.back(p));
      const seed = (o.seed || 5) * 131 + k;
      const lj = STYLE.letterJitter ?? 0;
      const dy = (hs(seed, 1, b) * size * 0.012 + hs(seed, 9) * size * 0.03) * lj;
      const rot = (hs(seed, 2) * 0.035 + hs(seed, 3, b) * 0.01) * lj;
      const cw = ctx.measureText(ch).width;
      ctx.save();
      ctx.globalAlpha *= clamp(p * 2);
      ctx.translate(x + cw / 2, y + dy);
      ctx.rotate(rot);
      ctx.scale(sc, sc);
      if (o.halo) {
        ctx.strokeStyle = o.halo;
        ctx.lineWidth = o.haloW || 10;
        ctx.lineJoin = 'round';
        ctx.strokeText(ch, -cw / 2, 0);
      }
      ctx.fillText(ch, -cw / 2, 0);
      ctx.restore();
    }
    k++;
  });
  ctx.restore();
}

// Plain text (UI font or hand font) without write-on.
function text(ctx, str, x, y, o = {}) {
  ctx.save();
  setFont(ctx, o.family || UI, o.size || 32, o.weight || 600, o.spacing == null ? 0.02 : o.spacing);
  ctx.textAlign = o.align || 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = o.color || PAL.ink;
  if (o.alpha != null) ctx.globalAlpha *= o.alpha;
  ctx.fillText(str, x, y);
  ctx.restore();
}

// ---------- small doodles ----------
// Returns below r = 6: an ease.back pop-in is not exactly 0 at its start, and a tiny stroked star reads as a dot.
function sparkle(ctx, x, y, r, t, seed, color, alpha = 1) {
  if (r < 6) return;
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.32;
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  wobbly(ctx, pts, { seed, t, amp: 1, width: 4, color: color || PAL.ink, fill: PAL.highlight, alpha });
}
function magnifier(ctx, x, y, r, t, seed, alpha = 1) {
  if (r < 3) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const a = Math.PI / 4;
  wobbly(ctx, sampleLine(x + Math.cos(a) * r * 1.05, y + Math.sin(a) * r * 1.05, x + Math.cos(a) * r * 2.1, y + Math.sin(a) * r * 2.1, 14),
    { seed: seed + 1, t, width: r * 0.28, closed: false, amp: 1 });
  wobbly(ctx, sampleEllipse(x, y, r, r, 16), { seed, t, width: 7, fill: 'rgba(255,255,255,0.55)' });
  wobbly(ctx, sampleEllipse(x - r * 0.1, y - r * 0.1, r * 0.55, r * 0.55, 10, -Math.PI * 0.95, -Math.PI * 0.55),
    { seed: seed + 2, t, width: 5, closed: false, color: mixHex(PAL.ink, PAL.background, 0.6), amp: 0.8 });
  ctx.restore();
}
