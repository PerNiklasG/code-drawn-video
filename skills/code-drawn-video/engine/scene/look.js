// The style system: backgrounds, motion energy, camera, captions/type and transitions, all read from STYLE
// (style.json resolved against its preset in styles/). Pure functions of t, like everything in the scene.
'use strict';

const MOTION = {
  calm: { pop: 0.42, ease: p => ease.back(p), out: 0.35 },
  smooth: { pop: 0.55, ease: p => ease.out(p), out: 0.4 },
  punchy: { pop: 0.2, ease: p => ease.backBig(p), out: 0.15 },
};
const motion = () => MOTION[STYLE.motion?.energy] || MOTION.calm;

// Pop-in scale 0→1 from t0 in the style's energy (overshoots for calm/punchy, none for smooth).
function pop(t, t0, d) {
  const m = motion();
  return m.ease(prog(t, t0, t0 + (d == null ? m.pop : d)));
}

function configureLook(style, fonts) {
  STYLE = style;
  DISPLAY = fonts.display.family;
  UI = fonts.ui.family;
  DISPLAY_SPACING = fonts.display.spacing == null ? 0.03 : fonts.display.spacing;
  DISPLAY_CAPS = fonts.display.caps !== false;
}

// ---------- backgrounds ----------
// bg: { type: flat | gradient | paper | halftone | dark, color, color2, dotColor, dotSize, dotSpacing, grain }.
// Shots may pass their own bg (e.g. a red problem section); canvases are cached per spec.
const BG_CACHE = new Map();
function makeBackground(bg) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const c1 = col(bg.color || 'background'), c2 = col(bg.color2 || bg.color || 'background');
  if (bg.type === 'gradient') {
    const gr = bg.radial ? g.createRadialGradient(W / 2, H * 0.45, 50, W / 2, H / 2, W * 0.7) : g.createLinearGradient(0, 0, W * 0.3, H);
    gr.addColorStop(0, c1);
    gr.addColorStop(1, c2);
    g.fillStyle = gr;
  } else g.fillStyle = c1;
  g.fillRect(0, 0, W, H);
  if (bg.type === 'halftone') {
    const sp = bg.dotSpacing || 22, r0 = bg.dotSize || 6;
    g.fillStyle = col(bg.dotColor || c2);
    for (let y = 0, row = 0; y < H + sp; y += sp * 0.866, row++) {
      for (let x = (row % 2) * sp / 2; x < W + sp; x += sp) {
        const k = clamp(1 - Math.hypot(x - W * 0.85, y - H * 0.1) / (W * 1.05));
        const r = r0 * (0.25 + 0.75 * k);
        if (r < 0.6) continue;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    }
  }
  if (bg.type === 'dark' || bg.vignette) {
    const v = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${bg.vignette ?? 0.55})`);
    g.fillStyle = v;
    g.fillRect(0, 0, W, H);
  }
  const grain = bg.type === 'paper' ? (bg.grain ?? 1) : (bg.grain || 0);
  if (grain) {
    const id = g.getImageData(0, 0, W, H), d = id.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const v = (hs(x, y, 3) * 2.2 + (hs(x >> 5, y >> 5, 9) + hs((x + 16) >> 5, (y + 16) >> 5, 9)) * 1.1) * grain;
      d[i] += v; d[i + 1] += v; d[i + 2] += v * 1.15;
    }
    g.putImageData(id, 0, 0);
    if (bg.type === 'paper') {
      g.strokeStyle = `rgba(120,110,90,${(0.035 * grain).toFixed(4)})`;
      g.lineWidth = 1;
      for (let k = 0; k < 260; k++) {
        const x = h32(k, 1) * W, y = h32(k, 2) * H, a = h32(k, 3) * Math.PI, l = 8 + h32(k, 4) * 26;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 3, y + Math.sin(a) * l * 0.5 - 2, x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
    }
  }
  return c;
}
function drawBackground(ctx, bg) {
  const spec = { ...STYLE.background, ...(bg || {}) };
  const key = JSON.stringify(spec);
  if (!BG_CACHE.has(key)) BG_CACHE.set(key, makeBackground(spec));
  ctx.drawImage(BG_CACHE.get(key), 0, 0);
}

// ---------- camera ----------
// STYLE.camera: { type: still | kenburns | push | shake, amount }. Scenes add impulses with shake().
function camera(ctx, t, t0, t1, seed) {
  const cam = STYLE.camera || {};
  const amt = cam.amount ?? 1;
  if (cam.type === 'still' || !amt) return;
  const p = ease.sine(prog(t, t0, t1));
  if (cam.type === 'push') {
    const s = 1 + 0.07 * amt * ease.inOut(prog(t, t0, t1));
    ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
    return;
  }
  const s = 1.005 + 0.03 * amt * p;
  const dx = hs(seed, 1) * 22 * p * amt, dy = hs(seed, 2) * 14 * p * amt;
  const fx = W / 2 + hs(seed, 3) * 200, fy = H / 2 + hs(seed, 4) * 80;
  ctx.translate(fx + dx, fy + dy);
  ctx.scale(s, s);
  ctx.translate(-fx, -fy);
  if (cam.type === 'shake') {
    const k = Math.floor(t * 24);
    ctx.translate(hs(seed, k, 5) * 1.5 * amt, hs(seed, k, 6) * 1.5 * amt);
  }
}
// A decaying screen shake from t0 (call inside a draw function, before drawing what should shake).
function shake(ctx, t, t0, amp = 22, dur = 0.45, seed = 7) {
  const p = prog(t, t0, t0 + dur);
  if (p <= 0 || p >= 1) return;
  const k = Math.floor(t * 40), a = amp * (1 - p) * (1 - p);
  ctx.translate(hs(seed, k, 1) * a, hs(seed, k, 2) * a);
  ctx.rotate(hs(seed, k, 3) * a * 0.0012);
}

// ---------- type ----------
const capColor = o => col(o.color || STYLE.captions?.color || 'ink');

// Bold title that slams in: oversized, then snaps to size with a hard shadow and outline.
function titleText(ctx, str, cx, cy, t, o = {}) {
  const t0 = o.t0 ?? -1e9, t1 = o.t1 ?? 1e9;
  const m = motion();
  if (t < t0 || t > t1 + m.out) return;
  const size = o.size || STYLE.captions?.size || 110;
  const caps = o.caps ?? STYLE.captions?.caps ?? true;
  const s = caps ? str.toUpperCase() : str;
  const p = prog(t, t0, t0 + (o.dur ?? m.pop));
  const out = prog(t, t1, t1 + m.out);
  const sc = lerp(o.from ?? 2.1, 1, ease.out(p)) * (1 - 0.15 * out);
  const rot = (o.rot ?? -0.035) * (1 - ease.out(p) * 0.4);
  ctx.save();
  ctx.globalAlpha *= clamp(p * 3) * (1 - out) * (o.alpha ?? 1);
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.scale(sc, sc);
  setFont(ctx, o.family || DISPLAY, size, o.weight || 400, o.spacing ?? DISPLAY_SPACING);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const lines = wrap(ctx, s, o.maxW || 1700);
  const lh = size * 1.02;
  lines.forEach((ln, i) => {
    const y = (i - (lines.length - 1) / 2) * lh;
    const sh = o.shadow ?? STYLE.captions?.shadow;
    if (sh) { ctx.fillStyle = col(sh); ctx.fillText(ln, size * 0.06, y + size * 0.07); }
    const ol = o.outline ?? STYLE.captions?.outline;
    if (ol) { ctx.strokeStyle = col(ol); ctx.lineWidth = size * 0.11; ctx.strokeText(ln, 0, y); }
    ctx.fillStyle = capColor(o);
    ctx.fillText(ln, 0, y);
  });
  ctx.restore();
}

// Kinetic typography: words land one by one, each with its own pop, spread over `dur` from t0 (or at the
// times in o.times, e.g. from wordTime). o.accent colours every word in o.hot (lowercase words).
function kineticText(ctx, str, cx, cy, t, o = {}) {
  const t0 = o.t0 ?? -1e9, t1 = o.t1 ?? 1e9;
  const m = motion();
  if (t < t0 || t > t1 + m.out) return;
  const size = o.size || STYLE.captions?.size || 110;
  const caps = o.caps ?? STYLE.captions?.caps ?? true;
  const words = (caps ? str.toUpperCase() : str).split(/\s+/).filter(Boolean);
  const dur = o.dur ?? Math.min(1.2, 0.16 * words.length);
  const hot = new Set((o.hot || []).map(w => w.toUpperCase()));
  setFont(ctx, o.family || DISPLAY, size, o.weight || 400, o.spacing ?? DISPLAY_SPACING);
  const space = Math.max(ctx.measureText(' ').width, size * 0.36);
  const widths = words.map(w => ctx.measureText(w).width);
  const maxW = o.maxW || 1700;
  const rows = [[]];
  let rw = 0;
  words.forEach((w, i) => {
    if (rw + widths[i] > maxW && rows.at(-1).length) { rows.push([]); rw = 0; }
    rows.at(-1).push(i);
    rw += widths[i] + space;
  });
  const lh = size * 1.05;
  const out = prog(t, t1, t1 + m.out);
  ctx.save();
  ctx.globalAlpha *= 1 - out;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  rows.forEach((row, ri) => {
    const total = row.reduce((a, i) => a + widths[i], 0) + space * (row.length - 1);
    let x = cx - total / 2;
    const y = cy + (ri - (rows.length - 1) / 2) * lh - out * 30;
    for (const i of row) {
      const ti = o.times ? o.times[i] : t0 + (dur * i) / Math.max(1, words.length - 1);
      const p = m.ease(prog(t, ti, ti + m.pop));
      if (p > 0.02) {
        const clean = words[i].replace(/[^\p{L}\p{N}]/gu, '');
        const isHot = hot.has(clean);
        ctx.save();
        ctx.translate(x + widths[i] / 2, y + (1 - clamp(p)) * size * 0.35);
        ctx.scale(p * (isHot ? 1.12 : 1), p * (isHot ? 1.12 : 1));
        ctx.rotate(isHot ? -0.04 : 0);
        ctx.textAlign = 'center';
        const ol = o.outline ?? STYLE.captions?.outline;
        if (ol) { ctx.strokeStyle = col(ol); ctx.lineWidth = size * 0.1; ctx.strokeText(words[i], 0, 0); }
        ctx.fillStyle = isHot ? col(o.accent || 'accent') : capColor(o);
        ctx.fillText(words[i], 0, 0);
        ctx.restore();
      }
      x += widths[i] + space;
    }
  });
  ctx.restore();
}

// Lower third: a bar slides in from the left with the text on it.
function lowerThird(ctx, str, t, t0, t1, o = {}) {
  const m = motion();
  if (t < t0 || t > t1 + m.out) return;
  const size = o.size || STYLE.captions?.size || 54;
  const pin = ease.out(prog(t, t0, t0 + 0.45)), pout = ease.in(prog(t, t1, t1 + m.out));
  setFont(ctx, o.family || UI, size, o.weight || 800, 0.01);
  const tw = ctx.measureText(str).width;
  const x = 120, y = o.y || STYLE.captions?.y || 900, h = size * 1.7;
  const bw = (tw + 90) * pin;
  ctx.save();
  ctx.globalAlpha *= 1 - pout;
  ctx.translate(-80 * pout, 0);
  ctx.fillStyle = col(o.box || STYLE.captions?.box || 'accent');
  ctx.fillRect(x, y - h / 2, bw, h);
  ctx.fillStyle = col(STYLE.captions?.bar || 'highlight');
  ctx.fillRect(x, y - h / 2, 12, h);
  ctx.beginPath(); ctx.rect(x, y - h / 2, bw, h); ctx.clip();
  ctx.fillStyle = capColor(o);
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x + 45 - (1 - pin) * 40, y + 2);
  ctx.restore();
}

// The style's emphasis caption, at the standard caption position.
function caption(ctx, str, t, t0, t1, o = {}) {
  const c = STYLE.captions || {};
  const y = o.y || c.y || 905;
  switch (c.style) {
    case 'handwritten': return handText(ctx, str, W / 2, y, t, { size: o.size || c.size || 68, t0, t1, seed: o.seed || str.length, maxW: 1600, color: capColor(o) });
    case 'slam': return titleText(ctx, str, W / 2, y, t, { ...o, t0, t1 });
    case 'kinetic': return kineticText(ctx, str, W / 2, y, t, { ...o, t0, t1 });
    case 'lowerThird': return lowerThird(ctx, str, t, t0, t1, o);
    default: return undefined;
  }
}

// Transparent subtitle overlay for the captioned export, rendered here because many ffmpeg builds lack libass.
function renderSubtitle(str) {
  const ctx = MCTX;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const sub = STYLE.subtitles || {};
  setFont(ctx, UI, 40, 700, 0.01);
  const lines = wrap(ctx, str, 1700);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  lines.forEach((l, i) => {
    const y = 1056 - (lines.length - 1 - i) * 48;
    ctx.strokeStyle = col(sub.halo || 'background');
    ctx.lineWidth = 10;
    ctx.strokeText(l, W / 2, y);
    ctx.fillStyle = col(sub.color || 'ink');
    ctx.fillText(l, W / 2, y);
  });
}

// ---------- transitions ----------
// tr: cut | dissolve | zoom | slide | wipe (hand-drawn edge) | whip | flash | glitch | iris | punch
function composite(ctx, tr, p, A, B, t) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const e = ease.inOut(p);
  if (tr === 'cut') {
    ctx.drawImage(p < 0.5 ? A : B, 0, 0);
  } else if (tr === 'dissolve') {
    ctx.drawImage(A, 0, 0);
    ctx.globalAlpha = e;
    ctx.drawImage(B, 0, 0);
  } else if (tr === 'zoom') {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(lerp(1.06, 1, e), lerp(1.06, 1, e));
    ctx.drawImage(B, -W / 2, -H / 2);
    ctx.restore();
    ctx.globalAlpha = 1 - ease.inOut(prog(p, 0.1, 0.9));
    ctx.translate(W / 2, H / 2);
    ctx.scale(1 + 0.22 * e, 1 + 0.22 * e);
    ctx.drawImage(A, -W / 2, -H / 2);
  } else if (tr === 'slide') {
    ctx.drawImage(A, -160 * e, 0);
    ctx.fillStyle = `rgba(30,30,30,${0.12 * e})`;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(B, W * (1 - e), 0);
  } else if (tr === 'whip') {
    const x = -W * e, speed = Math.sin(Math.PI * p);
    for (let k = 4; k >= 0; k--) {
      ctx.globalAlpha = k === 0 ? 1 : 0.18 * speed;
      const dx = k * 55 * speed;
      ctx.drawImage(A, x + dx, 0);
      ctx.drawImage(B, x + W + dx, 0);
    }
    ctx.globalAlpha = 0.55 * speed;
    ctx.fillStyle = col(STYLE.whipColor || '#FFFFFF');
    for (let i = 0; i < 28; i++) {
      const y = h32(i, 77) * H, len = 300 + h32(i, 78) * 900, xx = ((h32(i, 79) * 2 - 0.5) * W - e * 1600) % (W * 1.5);
      ctx.fillRect(xx, y, len, 2 + h32(i, 80) * 6);
    }
  } else if (tr === 'flash') {
    ctx.drawImage(p < 0.5 ? A : B, 0, 0);
    ctx.globalAlpha = 1 - Math.abs(p - 0.5) * 2;
    ctx.fillStyle = col(STYLE.flashColor || '#FFFFFF');
    ctx.fillRect(0, 0, W, H);
  } else if (tr === 'glitch') {
    const src = p < 0.5 ? A : B, k = Math.floor(t * 30), amt = Math.sin(Math.PI * p);
    ctx.drawImage(src, 0, 0);
    for (let i = 0; i < 14; i++) {
      const y = Math.floor(h32(k, i, 1) * H), h = 8 + h32(k, i, 2) * 90, dx = hs(k, i, 3) * 160 * amt;
      ctx.drawImage(src, 0, y, W, h, dx, y, W, h);
    }
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.5 * amt;
    ctx.fillStyle = '#FF0050';
    ctx.fillRect(hs(k, 9) * 30, 0, W, H * 0.02 + h32(k, 10) * 40);
    ctx.fillStyle = '#00E5FF';
    ctx.fillRect(0, h32(k, 11) * H, W, 6 + h32(k, 12) * 30);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.35 * amt;
    ctx.drawImage(src, 14 * amt, 0);
  } else if (tr === 'iris') {
    ctx.drawImage(A, 0, 0);
    const r = ease.in(p) * Math.hypot(W, H) * 0.55;
    ctx.save();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.max(1, r), 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(B, 0, 0);
    ctx.restore();
    if (r > 2 && p < 0.98) {
      ctx.strokeStyle = col('ink');
      ctx.lineWidth = 14;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2); ctx.stroke();
    }
  } else if (tr === 'punch') {
    const first = p < 0.5;
    const q = first ? p * 2 : (p - 0.5) * 2;
    const s = first ? lerp(1, 1.3, ease.in(q)) : lerp(1.3, 1, ease.out(q));
    ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(first ? A : B, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.7 * (1 - Math.abs(p - 0.5) * 2) ** 2;
    ctx.fillStyle = col(STYLE.flashColor || '#FFFFFF');
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.drawImage(A, 0, 0);
    const edge = lerp(-160, W + 160, e);
    const pts = [[edge + 80, -20]];
    for (let y = -20; y <= H + 20; y += 60) pts.push([edge + Math.sin(y * 0.011 + 1.3) * 60 + hs(y, 1200) * 14, y]);
    pts.push([-40, H + 20], [-40, -20]);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    pts.forEach(q => ctx.lineTo(q[0], q[1]));
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(B, 0, 0);
    ctx.restore();
    wobbly(ctx, pts.slice(1, -2), { seed: 1201, t, width: 7, closed: false, color: PAL.ink, amp: 1.5, force: true });
  }
  ctx.restore();
}
