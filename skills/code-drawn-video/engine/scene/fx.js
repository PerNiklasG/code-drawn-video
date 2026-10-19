// Effects kit drawn in code. Every effect is a pure function of t and a seed (positions come from h32/hs, never
// Math.random), so any frame renders identically in any worker. Times are absolute seconds: pass t0 from the
// timeline (S, E, wordTime), never a literal.
'use strict';

const TAU = Math.PI * 2;

// Additive glow: draws fn() with 'lighter' compositing and a soft shadow, so bright colours bloom.
function glow(ctx, fn, { blur = 30, color = null, alpha = 1 } = {}) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha *= alpha;
  ctx.shadowBlur = blur;
  ctx.shadowColor = color || 'rgba(255,240,200,0.9)';
  fn();
  ctx.restore();
}

// A comic "action burst": a jagged star. points = number of spikes, jag = inner radius ratio.
function burst(ctx, x, y, r, t, seed, { points = 14, jag = 0.62, fill = null, stroke = null, width = 8, rot = 0, alpha = 1 } = {}) {
  if (r < 4) return;
  const k = STYLE.line.boilFps > 0 ? boil(t) : Math.floor(t * 10);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * TAU;
    const rr = r * (i % 2 ? jag + hs(seed, i, k) * 0.05 : 1 + hs(seed, i) * 0.12);
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill || col('highlight');
  ctx.fill();
  if (stroke !== false) { ctx.lineJoin = 'round'; ctx.lineWidth = width; ctx.strokeStyle = stroke || col('ink'); ctx.stroke(); }
  ctx.restore();
}

// Sparks: n streaks flying out from (x, y) at t0, with gravity and a short trail, fading over `life`.
function sparks(ctx, x, y, t, t0, { n = 24, speed = 900, life = 0.7, gravity = 900, size = 5, colors = null, seed = 1, spread = TAU, dir = 0 } = {}) {
  const p = t - t0;
  if (p <= 0 || p > life) return;
  const cs = colors || [col('highlight'), '#FFFFFF', col('accent')];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = dir + (h32(seed, i, 1) - 0.5) * spread;
    const v = speed * (0.35 + 0.65 * h32(seed, i, 2));
    const li = life * (0.5 + 0.5 * h32(seed, i, 3));
    if (p > li) continue;
    const q = p, qb = Math.max(0, p - 0.05);
    const px = x + Math.cos(a) * v * q, py = y + Math.sin(a) * v * q + 0.5 * gravity * q * q;
    const bx = x + Math.cos(a) * v * qb, by = y + Math.sin(a) * v * qb + 0.5 * gravity * qb * qb;
    ctx.globalAlpha = 1 - p / li;
    ctx.strokeStyle = cs[i % cs.length];
    ctx.lineWidth = size * (1 - 0.6 * p / li);
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(px, py); ctx.stroke();
  }
  ctx.restore();
}

// Debris: small tumbling polygons thrown out from (x, y) at t0.
function debris(ctx, x, y, t, t0, { n = 14, speed = 700, life = 1.1, gravity = 1400, size = 22, colors = null, seed = 2 } = {}) {
  const p = t - t0;
  if (p <= 0 || p > life) return;
  const cs = colors || [col('ink'), col('accent')];
  for (let i = 0; i < n; i++) {
    const a = h32(seed, i, 1) * TAU, v = speed * (0.4 + 0.6 * h32(seed, i, 2));
    const px = x + Math.cos(a) * v * p, py = y + Math.sin(a) * v * p * 0.8 + 0.5 * gravity * p * p;
    const s = size * (0.5 + h32(seed, i, 3)) * (1 - 0.4 * p / life);
    ctx.save();
    ctx.globalAlpha *= clamp(1.5 * (1 - p / life));
    ctx.translate(px, py);
    ctx.rotate(p * 12 * hs(seed, i, 4));
    ctx.fillStyle = cs[i % cs.length];
    ctx.beginPath();
    ctx.moveTo(-s / 2, -s / 3); ctx.lineTo(s / 2, -s / 2); ctx.lineTo(s / 3, s / 2); ctx.lineTo(-s / 2, s / 3);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

// Smoke: soft puffs that grow, drift up and fade.
function smoke(ctx, x, y, t, t0, { n = 9, life = 1.6, size = 90, color = null, seed = 3 } = {}) {
  const p = t - t0;
  if (p <= 0 || p > life) return;
  ctx.save();
  ctx.fillStyle = color || 'rgba(60,60,60,1)';
  for (let i = 0; i < n; i++) {
    const a = h32(seed, i, 1) * TAU, d = 60 + 140 * h32(seed, i, 2);
    const q = ease.out(p / life);
    const px = x + Math.cos(a) * d * q, py = y + Math.sin(a) * d * q * 0.6 - 120 * q;
    const r = size * (0.4 + 0.6 * h32(seed, i, 3)) * (0.5 + q);
    ctx.globalAlpha = 0.35 * (1 - p / life);
    ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// Shockwave: a ring that expands and thins.
function shockwave(ctx, x, y, t, t0, { r = 520, life = 0.55, width = 26, color = '#FFFFFF' } = {}) {
  const p = prog(t, t0, t0 + life);
  if (p <= 0 || p >= 1) return;
  ctx.save();
  ctx.strokeStyle = col(color);
  ctx.globalAlpha *= 1 - p;
  ctx.lineWidth = width * (1 - p) + 1;
  ctx.beginPath(); ctx.arc(x, y, r * ease.out(p), 0, TAU); ctx.stroke();
  ctx.restore();
}

// Full explosion at t0: screen flash, fireball burst, shockwave, sparks, debris and smoke.
function explosion(ctx, x, y, t, t0, { scale = 1, seed = 11, colors = null } = {}) {
  const p = t - t0;
  if (p < 0 || p > 1.8) return;
  const cs = colors || ['#FFF4C2', '#FFC93C', '#FF7A1A', '#E8261B'];
  smoke(ctx, x, y, t, t0 + 0.12, { size: 110 * scale, seed: seed + 1, color: 'rgba(255,244,230,1)' });
  const fb = prog(t, t0, t0 + 0.5);
  if (fb > 0 && fb < 1) {
    const r = 260 * scale * ease.out(clamp(fb * 2.2)) * (1 - 0.35 * fb);
    burst(ctx, x, y, r * 1.25, t, seed + 2, { fill: cs[3], stroke: false, alpha: 1 - fb, points: 12, jag: 0.55 });
    burst(ctx, x, y, r, t, seed + 3, { fill: cs[2], stroke: false, alpha: 1 - fb * 0.8, points: 11, jag: 0.6, rot: 0.3 });
    burst(ctx, x, y, r * 0.66, t, seed + 4, { fill: cs[1], stroke: false, alpha: 1 - fb * 0.6, points: 9, jag: 0.6, rot: 0.6 });
    glow(ctx, () => { ctx.fillStyle = cs[0]; ctx.beginPath(); ctx.arc(x, y, r * 0.38, 0, TAU); ctx.fill(); }, { blur: 60, alpha: 1 - fb });
  }
  shockwave(ctx, x, y, t, t0 + 0.02, { r: 620 * scale, width: 30 * scale });
  debris(ctx, x, y, t, t0, { seed: seed + 5, size: 26 * scale, speed: 900 * scale });
  sparks(ctx, x, y, t, t0, { n: 40, seed: seed + 6, speed: 1300 * scale, colors: cs.slice(0, 3) });
  const fl = prog(t, t0, t0 + 0.16);
  if (fl > 0 && fl < 1) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.85 * (1 - fl);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

// Stylised fire: layered flame tongues (red, orange, yellow) that flicker at 12 fps. (x, y) is the base centre.
function fire(ctx, x, y, w, h, t, seed = 21, { colors = null, alpha = 1 } = {}) {
  if (h < 6) return;
  const cs = colors || ['#E8261B', '#FF7A1A', '#FFC93C'];
  const k = Math.floor(t * 12);
  ctx.save();
  ctx.globalAlpha *= alpha;
  cs.forEach((c, layer) => {
    const lw = w * (1 - layer * 0.25), lh = h * (1 - layer * 0.22);
    const n = 5 - layer;
    ctx.fillStyle = c;
    for (let i = 0; i < n; i++) {
      const cx = x + (i / Math.max(1, n - 1) - 0.5) * lw * 0.75;
      const th = lh * (0.55 + 0.45 * h32(seed + layer, i, k)) * (1 - Math.abs(i / Math.max(1, n - 1) - 0.5) * 0.7);
      const tw = lw / n * 1.25;
      const sway = hs(seed + layer, i, k + 99) * tw * 0.35;
      ctx.beginPath();
      ctx.moveTo(cx - tw / 2, y);
      ctx.quadraticCurveTo(cx - tw * 0.55, y - th * 0.55, cx + sway, y - th);
      ctx.quadraticCurveTo(cx + tw * 0.55, y - th * 0.55, cx + tw / 2, y);
      ctx.closePath();
      ctx.fill();
    }
  });
  ctx.restore();
}

// Speed lines: radial (towards a focus) or horizontal streaks, re-drawn 12 times a second.
function speedLines(ctx, t, { cx = W / 2, cy = H / 2, inner = 360, n = 46, color = null, alpha = 0.8, seed = 31, mode = 'radial', width = 10 } = {}) {
  const k = Math.floor(t * 12);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = col(color || 'ink');
  for (let i = 0; i < n; i++) {
    if (mode === 'horizontal') {
      const y = h32(seed, i, k) * H, len = 200 + h32(seed, i, k + 1) * 700, x = h32(seed, i, k + 2) * W;
      ctx.fillRect(x, y, len, 2 + h32(seed, i, 3) * width * 0.5);
      continue;
    }
    const a = (i / n) * TAU + hs(seed, i, k) * 0.05;
    const r0 = inner * (0.9 + 0.35 * h32(seed, i, k + 5)), r1 = Math.hypot(W, H);
    const wd = (0.006 + 0.012 * h32(seed, i, 7)) * (width / 10);
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a - wd) * r1, cy + Math.sin(a - wd) * r1);
    ctx.lineTo(cx + Math.cos(a + wd) * r1, cy + Math.sin(a + wd) * r1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Confetti: rectangles that fall, tumble and flutter from t0, spread over the width.
function confetti(ctx, t, t0, { n = 90, colors = null, seed = 41, life = 3, x0 = 0, x1 = W, y0 = -40, size = 20 } = {}) {
  const p = t - t0;
  if (p <= 0 || p > life) return;
  const cs = colors || [col('accent'), col('highlight'), '#FFFFFF'];
  for (let i = 0; i < n; i++) {
    const start = h32(seed, i, 1) * 0.5;
    const q = p - start;
    if (q <= 0) continue;
    const x = lerp(x0, x1, h32(seed, i, 2)) + Math.sin(q * 3 + i) * 40;
    const y = y0 + q * (380 + 260 * h32(seed, i, 3));
    if (y > H + 40) continue;
    const flip = Math.cos(q * (6 + 6 * h32(seed, i, 4)));
    ctx.save();
    ctx.globalAlpha *= clamp((life - p) / 0.5);
    ctx.translate(x, y);
    ctx.rotate(q * 3 * hs(seed, i, 5));
    ctx.scale(1, flip);
    ctx.fillStyle = cs[i % cs.length];
    ctx.fillRect(-size / 2, -size / 4, size, size / 2);
    ctx.restore();
  }
}
