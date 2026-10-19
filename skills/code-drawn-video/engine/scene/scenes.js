// Scenes for the bundled example: a 37-second ad for "Pebblesprout", a fictional habit app, in the
// action-comic preset. renderFrame(t) is a pure function of t (seconds) and timeline.json. Rewrite the draw*
// functions, buildShots() and buildCues() for each video; keep the infrastructure (timing helpers at the top,
// everything from renderShot() down).
'use strict';

let PAL = null;      // palette.json
let TL = null;       // timeline.json
let CELLS = null;    // cells/cells.json .cells
let LN = {};         // line id -> line
let SEC = {};        // section id -> section
let SHOTS = [];
let MAIN = null, MCTX = null, OFF_A = null, OFF_B = null;

// Estimated start of a word inside a line, proportional by character (the "words" array wins when present).
function wordTime(id, word) {
  const l = line(id);
  if (l.words) { const w = l.words.find(x => x.w.toLowerCase() === word.toLowerCase()); if (w) return w.t; }
  const i = l.text.toLowerCase().indexOf(word.toLowerCase());
  if (i < 0) throw new Error(`word "${word}" not in ${id}`);
  return l.start + (i / l.text.length) * (l.end - l.start);
}
function line(id) { if (!LN[id]) throw new Error(`line ${id} is not in timeline.json`); return LN[id]; }
const S = id => line(id).start;
const E = id => line(id).end;
const gapMid = (a, b) => (E(a) + S(b)) / 2;
// A caption ends this long before the next one starts, so its exit never overlaps the next entrance.
const until = id => S(id) - 0.3;

// Offset of one cell relative to another, in source-image pixels, from their bbox in cells.json.
function rel(part, base) {
  const p = CELLS[part].bbox, b = CELLS[base].bbox;
  return [p.x - b.x, p.y - b.y];
}

// Per-section backgrounds (palette keys), on top of the preset's halftone.
const BG = {
  yellow: { color: 'background', dotColor: 'background2' },
  red: { color: 'red', dotColor: 'redDots' },
  blue: { color: 'blue', dotColor: 'blueDots' },
};

// ======================= props drawn in code =======================
function pebble(ctx, x, y, r, t, seed, o = {}) {
  if (r < 8) return;
  wobbly(ctx, sampleEllipse(x, y, r * 1.25, r * 0.82, 16), { seed, t, fill: col(o.fill || 'stone') });
  wobbly(ctx, sampleEllipse(x - r * 0.4, y - r * 0.3, r * 0.42, r * 0.17, 10, -Math.PI * 0.95, -Math.PI * 0.35),
    { seed: seed + 1, t, closed: false, width: Math.max(4, r * 0.08), color: PAL.white });
}

function leaf(ctx, x, y, len, ang, t, seed, fill) {
  if (len < 6) return;
  const pts = [];
  for (let i = 0; i <= 8; i++) { const u = i / 8; pts.push([u * len, -Math.sin(Math.PI * u) * len * 0.36]); }
  for (let i = 7; i > 0; i--) { const u = i / 8; pts.push([u * len, Math.sin(Math.PI * u) * len * 0.2]); }
  const c = Math.cos(ang), s = Math.sin(ang);
  wobbly(ctx, pts.map(([px, py]) => [x + px * c - py * s, y + px * s + py * c]), { seed, t, fill: fill || PAL.green, width: Math.max(5, len * 0.07) });
}

// A sprout of full height h that shoots up with g (0..1). Returns the tip.
function sprout(ctx, x, y, h, g, t, seed, o = {}) {
  const hh = h * ease.out(clamp(g * 1.3));
  if (hh < 8) return [x, y];
  const sway = Math.sin(t * 2.4 + seed) * h * 0.04;
  const tip = [x + sway, y - hh];
  const stem = sampleQuad(x, y, x - h * 0.06, y - hh * 0.5, tip[0], tip[1], 12);
  wobbly(ctx, stem, { seed, t, closed: false, width: Math.max(8, h * 0.06), color: PAL.ink });
  wobbly(ctx, stem, { seed, t, closed: false, width: Math.max(4, h * 0.035), color: PAL.greenDark, force: true });
  const lg = ease.backBig(prog(g, 0.4, 0.9));
  leaf(ctx, tip[0], tip[1] + hh * 0.1, h * 0.45 * lg, -0.45, t, seed + 11, PAL.green);
  leaf(ctx, tip[0], tip[1] + hh * 0.25, h * 0.38 * lg, Math.PI + 0.5, t, seed + 12, PAL.green);
  if (o.bud) {
    const b = ease.backBig(prog(g, 0.8, 1)) * h * 0.09;
    if (b > 4) {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + t;
        wobbly(ctx, sampleEllipse(tip[0] + Math.cos(a) * b, tip[1] - b + Math.sin(a) * b, b * 0.75, b * 0.75, 8), { seed: seed + 20 + k, t, fill: PAL.red, width: 4 });
      }
      wobbly(ctx, sampleEllipse(tip[0], tip[1] - b, b * 0.6, b * 0.6, 8), { seed: seed + 30, t, fill: PAL.highlight, width: 4 });
    }
  }
  return tip;
}

// A card with a hard comic drop shadow.
function card(ctx, x, y, w, h, t, seed, fill, r = 28) {
  wobbly(ctx, sampleRoundRect(x + 14, y + 16, w, h, r, 24), { seed: seed + 1, t, color: null, fill: PAL.ink });
  wobbly(ctx, sampleRoundRect(x, y, w, h, r, 24), { seed, t, fill: fill || PAL.white });
}

function phone(ctx, cx, cy, w, h, t, seed) {
  card(ctx, cx - w / 2, cy - h / 2, w, h, t, seed, PAL.ink, 60);
  wobbly(ctx, sampleRoundRect(cx - w / 2 + 20, cy - h / 2 + 20, w - 40, h - 40, 42, 24), { seed: seed + 2, t, fill: PAL.white, color: null });
}

// A comic sticker: an action burst with a word on it, popping in at t0.
function sticker(ctx, word, x, y, r, t, t0, seed, fill = 'highlight', size = 72, t1 = Infinity) {
  const p = pop(t, t0) * (Number.isFinite(t1) ? 1 - ease.in(prog(t, t1, t1 + 0.2)) : 1);
  if (p < 0.03) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.12 + Math.sin(t * 6 + seed) * 0.03);
  ctx.scale(p, p);
  burst(ctx, 0, 0, r, t, seed, { fill: col(fill), points: 12, width: 8 });
  titleText(ctx, word, 0, 6, t, { size, t0: -1e9, rot: 0, from: 1, color: '#FFFFFF', outline: 'ink', shadow: null });
  ctx.restore();
}

// ======================= HOOK: day one … day nine =======================
function drawDays(ctx, t, shot) {
  const days = [['1', Math.max(shot.start + 0.1, S('H01') - 0.35)], ['5', S('H02')], ['9', S('H03')]];
  const tGone = wordTime('H03', 'gone');
  days.forEach(([n, t0], i) => {
    const next = days[i + 1]?.[1];
    if (t < t0 - 0.05) return;
    const leave = next == null ? 0 : prog(t, next - 0.05, next + 0.25);
    const blow = i === 2 ? prog(t, tGone, tGone + 0.7) : 0;
    if (leave >= 1 || blow >= 1) return;
    const p = pop(t, t0, 0.25);
    const s = lerp(1.8, 1, clamp(p)) * (1 - 0.4 * blow);
    ctx.save();
    ctx.translate(760 - 1500 * ease.in(leave) + 700 * ease.in(blow), 430 - 500 * ease.in(blow));
    ctx.rotate(-0.06 + i * 0.05 - 0.6 * leave + 2.2 * blow);
    ctx.scale(s, s);
    ctx.globalAlpha *= clamp(p * 4);
    card(ctx, -250, -270, 500, 520, t, 10 + i * 5, PAL.white);
    wobbly(ctx, sampleRoundRect(-250, -270, 500, 120, 28, 24), { seed: 30 + i, t, fill: PAL.red });
    text(ctx, 'DAY', 0, -210, { family: UI, size: 64, weight: 900, spacing: 0.12, align: 'center', color: PAL.white });
    text(ctx, n, 0, 70, { family: UI, size: 330, weight: 900, spacing: 0, align: 'center', color: PAL.ink });
    ctx.restore();
  });
  const tUn = wordTime('H01', 'unstoppable');
  speedLines(ctx, t, { cx: 760, cy: 430, inner: 420, alpha: 0.55 * (1 - prog(t, tUn + 0.8, tUn + 1.2)) * prog(t, tUn - 0.1, tUn) });
  sparks(ctx, 760, 430, t, tUn, { n: 30, seed: 3 });
  debris(ctx, 900, 330, t, tGone, { seed: 5, colors: [PAL.white, PAL.red, PAL.ink], size: 30 });
  smoke(ctx, 900, 380, t, tGone, { seed: 6, color: 'rgba(255,255,255,1)' });
  sticker(ctx, 'WOW!', 1420, 300, 150, t, tUn, 40, 'red', 70, S('H02') - 0.1);
  sticker(ctx, 'STILL!', 1440, 420, 140, t, wordTime('H02', 'still'), 41, 'blue', 64, S('H03') - 0.1);
  sticker(ctx, 'NOPE!', 1420, 380, 150, t, tGone + 0.1, 42, 'red', 70);
  caption(ctx, "YOU'RE UNSTOPPABLE", t, tUn - 0.15, until('H02'));
  caption(ctx, 'STILL GOING', t, wordTime('H02', 'still') - 0.1, until('H03'));
  caption(ctx, 'GONE.', t, tGone - 0.05, shot.end + 0.3, { size: 160 });
}

// ======================= PROBLEM: the streak that explodes =======================
function drawStreak(ctx, t, shot) {
  const tMiss = wordTime('P02', 'miss'), tBoom = wordTime('P02', 'boom');
  const PX = 700, PY = 430, PW = 420, PH = 690;
  ctx.save();
  shake(ctx, t, tBoom, 40, 0.6);
  const drop = ease.in(prog(t, until('P03'), until('P03') + 0.45));
  ctx.translate(0, 900 * drop);
  ctx.rotate(0.15 * drop);
  phone(ctx, PX, PY, PW, PH, t, 100);
  const boomed = t >= tBoom;
  const count = boomed ? 0 : Math.max(1, Math.round(47 * ease.out(prog(t, S('P01'), E('P01') + 0.2))));
  if (!boomed) fire(ctx, PX, PY - 140, 170, 170 * (0.9 + 0.1 * Math.sin(t * 9)), t, 101);
  text(ctx, String(count), PX, PY + 40, { family: UI, size: 190, weight: 900, spacing: 0, align: 'center', color: boomed ? PAL.red : PAL.ink });
  text(ctx, 'DAY STREAK', PX, PY + 160, { family: UI, size: 36, weight: 800, spacing: 0.1, align: 'center', color: PAL.stoneDark });
  if (t >= tMiss && !boomed) {
    const p = pop(t, tMiss);
    ctx.save();
    ctx.translate(PX + 120, PY + 250);
    ctx.scale(p, p);
    burst(ctx, 0, 0, 70, t, 110, { fill: PAL.red, points: 10 });
    text(ctx, '✕', 0, 4, { family: UI, size: 70, weight: 900, align: 'center', color: PAL.white });
    ctx.restore();
  }
  ctx.restore();
  explosion(ctx, PX, PY - 20, t, tBoom, { scale: 1.2, seed: 120 });
  sticker(ctx, 'BOOM!', 1380, 380, 230, t, tBoom + 0.05, 130, 'highlight', 120, until('P03'));
  caption(ctx, 'STREAKS', t, S('P01') + 0.1, tMiss - 0.25, { y: 880 });
  caption(ctx, 'MISS ONE DAY…', t, tMiss - 0.1, tBoom - 0.1, { y: 880 });
  caption(ctx, 'BACK TO ZERO', t, wordTime('P02', 'back') - 0.1, until('P03'), { y: 880 });
  titleText(ctx, 'SO YOU QUIT.', W / 2, 470, t, { t0: S('P03'), t1: shot.end + 0.3, size: 190 });
}

// ======================= MECHANISM =======================
function drawMeet(ctx, t, shot) {
  const tLand = S('M01') + 0.05;
  const fall = ease.in(prog(t, tLand - 0.35, tLand));
  ctx.save();
  shake(ctx, t, tLand, 26, 0.4);
  burst(ctx, W / 2, 400, 360 * pop(t, tLand + 0.05), t, 200, { fill: PAL.highlight, points: 16, width: 10 });
  pebble(ctx, W / 2, lerp(-250, 450, fall), 170, t, 201);
  sprout(ctx, W / 2 + 10, 330, 250, prog(t, tLand + 0.15, tLand + 0.8), t, 202);
  ctx.restore();
  shockwave(ctx, W / 2, 520, t, tLand, { r: 700, color: PAL.white });
  smoke(ctx, W / 2, 560, t, tLand, { seed: 203, color: 'rgba(255,255,255,1)', size: 70 });
  caption(ctx, 'PEBBLESPROUT', t, wordTime('M01', 'pebblesprout') - 0.1, shot.end + 0.3, { y: 820, size: 170, color: PAL.highlight });
}

function drawPick(ctx, t, shot) {
  const habits = [['DRINK WATER', 'blue'], ['READ A PAGE', 'red'], ['STRETCH', 'green']];
  const tOne = wordTime('M02', 'one');
  habits.forEach(([label, fill], i) => {
    const p = pop(t, shot.start + 0.05 + i * 0.08);
    if (p < 0.02) return;
    const dim = i === 1 ? 1 : 1 - 0.6 * prog(t, tOne + 0.1, tOne + 0.3);
    ctx.save();
    ctx.translate(420 + i * 540, 430 + (i === 1 ? -30 * prog(t, tOne, tOne + 0.2) : 0));
    ctx.rotate((i - 1) * 0.05);
    ctx.scale(p, p);
    ctx.globalAlpha *= dim;
    card(ctx, -220, -110, 440, 220, t, 300 + i * 3, PAL[fill]);
    titleText(ctx, label, 0, 4, t, { size: 66, t0: -1e9, rot: 0, from: 1, color: '#FFFFFF', outline: 'ink', shadow: null });
    ctx.restore();
  });
  sticker(ctx, 'ONE!', 1180, 230, 110, t, tOne + 0.05, 310, 'highlight', 64);
  kineticText(ctx, 'PICK ONE SMALL HABIT', W / 2, 860, t, { t0: S('M02') - 0.05, t1: shot.end + 0.3, size: 110, hot: ['one'], dur: 0.5, outline: 'ink' });
}

function weekStrip(ctx, t, filled, waitAt) {
  const X = 1120, Y = 250;
  card(ctx, X, Y, 640, 190, t, 400, PAL.white, 40);
  text(ctx, 'THIS WEEK', X + 40, Y + 46, { family: UI, size: 30, weight: 900, spacing: 0.1, color: PAL.stoneDark });
  for (let k = 0; k < 7; k++) {
    const x = X + 70 + k * 83, y = Y + 125, f = filled[k] || 0;
    wobbly(ctx, sampleEllipse(x, y, 27, 27, 9), { seed: 410 + k, t, fill: f > 0.5 ? PAL.green : PAL.white, width: 6 });
    if (f > 0.5) text(ctx, '✓', x, y + 2, { family: UI, size: 34, weight: 900, align: 'center', color: PAL.white });
  }
  const p = waitAt == null ? 0 : pop(t, waitAt);
  if (p > 0.03) {
    ctx.save();
    ctx.translate(X + 70 + 83, Y + 125);
    ctx.scale(p, p);
    wobbly(ctx, sampleEllipse(0, 0, 27, 27, 9), { seed: 440, t, fill: PAL.highlight, width: 6 });
    text(ctx, 'Ⅱ', 0, 2, { family: UI, size: 30, weight: 900, align: 'center', color: PAL.ink });
    ctx.restore();
  }
}

function drawGrow(ctx, t, shot) {
  const PX = 620, PY = 640;
  const tTap = wordTime('M03', 'tap'), tSprout = wordTime('M03', 'sprout');
  const press = 1 - 0.08 * Math.sin(Math.PI * prog(t, tTap, tTap + 0.18));
  ctx.save();
  ctx.translate(PX, PY); ctx.scale(1, press); ctx.translate(-PX, -PY);
  pebble(ctx, PX, PY, 175 * pop(t, shot.start + 0.05), t, 500);
  ctx.restore();
  for (let k = 0; k < 3; k++) shockwave(ctx, PX, PY - 30, t, tTap + k * 0.08, { r: 330, width: 16, color: 'highlight', life: 0.5 });
  sticker(ctx, 'TAP!', PX + 280, PY - 230, 105, t, tTap, 510, 'red', 64);
  const g1 = prog(t, tSprout - 0.15, tSprout + 0.45);
  const g2 = prog(t, S('M05'), S('M05') + 1.2);
  speedLines(ctx, t, { cx: PX, cy: PY - 330, inner: 260, alpha: 0.35 * (1 - prog(t, tSprout + 0.4, tSprout + 0.8)) * prog(t, tSprout - 0.15, tSprout), color: 'white' });
  sprout(ctx, PX + 10, PY - 125, lerp(260, 380, ease.out(g2)), g1, t, 520, { bud: g2 > 0.2 });
  sparks(ctx, PX + 10, PY - 330, t, tSprout + 0.2, { n: 26, seed: 530, colors: [PAL.green, PAL.highlight, '#FFFFFF'] });
  sparks(ctx, PX + 10, PY - 470, t, S('M05') + 0.9, { n: 26, seed: 531, colors: [PAL.red, PAL.highlight, '#FFFFFF'] });

  const tSkip = wordTime('M04', 'skip');
  const filled = [prog(t, tTap, tTap + 0.1), 0, prog(t, S('M05') + 0.2, S('M05') + 0.3), prog(t, S('M05') + 0.7, S('M05') + 0.8), prog(t, S('M05') + 1.2, S('M05') + 1.3)];
  ctx.save();
  ctx.globalAlpha *= prog(t, shot.start + 0.2, shot.start + 0.5);
  weekStrip(ctx, t, filled, tSkip);
  ctx.restore();
  sticker(ctx, 'WAITS', 1530, 560, 120, t, wordTime('M04', 'waits'), 540, 'highlight', 58);

  caption(ctx, 'TAP YOUR PEBBLE', t, tTap - 0.1, tSprout - 0.15);
  caption(ctx, 'A SPROUT GROWS!', t, tSprout - 0.05, until('M04'));
  caption(ctx, 'SKIP A DAY? IT WAITS.', t, S('M04'), until('M05'));
  kineticText(ctx, 'NOTHING RESETS. NOTHING DIES.', W / 2, 900, t, {
    t0: S('M05'), t1: shot.end + 0.3, size: 100, hot: ['resets', 'dies'], outline: 'ink',
    times: [S('M05'), wordTime('M05', 'resets'), wordTime('M05', 'nothing dies'), wordTime('M05', 'dies')],
  });
}

const GARDEN = [[330, 470, 70, 170], [620, 430, 80, 230], [930, 460, 74, 190], [1240, 420, 84, 250], [1560, 470, 70, 180],
  [470, 690, 92, 220], [820, 700, 96, 260], [1160, 690, 94, 210], [1480, 700, 90, 240]];
const gardenTime = i => lerp(S('M06') - 0.1, wordTime('M06', 'garden'), i / (GARDEN.length - 1));
function drawGarden(ctx, t, shot) {
  speedLines(ctx, t, { cx: W / 2, cy: 400, inner: 500, alpha: 0.3, color: 'white' });
  GARDEN.forEach(([x, y, r, h], i) => {
    const ti = gardenTime(i);
    pebble(ctx, x, y, r * pop(t, ti, 0.2), t, 600 + i * 7, { fill: i % 3 === 1 ? 'stoneDark' : 'stone' });
    sprout(ctx, x + 6, y - r * 0.7, h, prog(t, ti + 0.1, ti + 0.6), t, 650 + i * 5, { bud: i % 2 === 0 });
    sparks(ctx, x, y - r * 0.7 - h * 0.6, t, ti + 0.45, { n: 10, seed: 680 + i, speed: 500, colors: [PAL.green, '#FFFFFF'] });
  });
  caption(ctx, 'A WHOLE GARDEN', t, wordTime('M06', 'garden') - 0.1, shot.end + 0.3, { y: 930, size: 120 });
}

// ======================= CTA =======================
function drawCta(ctx, t, shot) {
  const tName = S('C02');
  const out = ease.in(prog(t, tName - 0.2, tName + 0.1));
  confetti(ctx, t, wordTime('C01', 'green') - 0.1, { colors: [PAL.green, PAL.highlight, PAL.white, PAL.red], n: 70, size: 30 });
  kineticText(ctx, 'NO GUILT. JUST MORE GREEN.', W / 2, 470 - 300 * out, t, {
    t0: S('C01'), t1: tName - 0.2, size: 150, hot: ['green'], accent: 'green', outline: 'ink',
    times: [S('C01'), wordTime('C01', 'guilt'), wordTime('C01', 'just'), wordTime('C01', 'more'), wordTime('C01', 'green')],
  });
  const pp = pop(t, tName);
  if (pp > 0.02) {
    ctx.save();
    ctx.translate(560, 470);
    ctx.scale(pp, pp);
    ctx.rotate(-0.06);
    phone(ctx, 0, 0, 360, 640, t, 900);
    text(ctx, 'My garden', 0, -240, { family: UI, size: 40, weight: 900, spacing: 0, align: 'center', color: PAL.ink });
    [[-80, 20, 40, 110], [80, 0, 38, 120], [-60, 220, 44, 100], [85, 210, 42, 120]].forEach(([x, y, r, h], i) => {
      pebble(ctx, x, y, r, t, 910 + i * 5);
      sprout(ctx, x + 4, y - r * 0.7, h, prog(t, tName + 0.1 + i * 0.1, tName + 0.6 + i * 0.1), t, 930 + i * 3, { bud: i % 2 === 1 });
    });
    ctx.restore();
  }
  burst(ctx, 1290, 430, 380 * pop(t, tName + 0.05), t, 950, { fill: PAL.highlight, points: 18, width: 10 });
  pebble(ctx, 1290, 370, 95 * pop(t, tName + 0.1), t, 951);
  sprout(ctx, 1296, 310, 150, prog(t, tName + 0.2, tName + 0.7), t, 952);
  titleText(ctx, 'PEBBLESPROUT', 1290, 610, t, { t0: wordTime('C02', 'pebblesprout') - 0.05, size: 130, color: PAL.white, outline: 'ink', shadow: 'ink' });
  const tFree = wordTime('C02', 'free');
  const fp = ease.out(prog(t, tFree - 0.1, tFree + 0.25));
  if (fp > 0) {
    ctx.save();
    ctx.translate(1290 + 600 * (1 - fp), 740);
    ctx.rotate(-0.03);
    wobbly(ctx, sampleRoundRect(-300, -48, 600, 96, 20, 24), { seed: 960, t, fill: PAL.red });
    text(ctx, 'FREE ON YOUR PHONE', 0, 3, { family: UI, size: 46, weight: 900, spacing: 0.06, align: 'center', color: PAL.white });
    ctx.restore();
  }
  sparks(ctx, 1290, 430, t, tName + 0.1, { n: 50, seed: 970, speed: 1200 });
}

// ======================= shots, transitions, sound cues =======================
function buildShots() {
  const cut = (a, b) => gapMid(a, b);
  const list = [
    { id: 'days', draw: drawDays, bg: BG.yellow, next: cut('H03', 'P01'), tr: 'whip' },
    { id: 'streak', draw: drawStreak, bg: BG.red, next: cut('P03', 'M01'), tr: 'glitch' },
    { id: 'meet', draw: drawMeet, bg: BG.blue, next: cut('M01', 'M02'), tr: 'punch' },
    { id: 'pick', draw: drawPick, bg: BG.yellow, next: cut('M02', 'M03'), tr: 'whip' },
    { id: 'grow', draw: drawGrow, bg: BG.blue, next: cut('M05', 'M06'), tr: 'iris' },
    { id: 'garden', draw: drawGarden, bg: BG.yellow, next: cut('M06', 'C01'), tr: 'flash' },
    { id: 'cta', draw: drawCta, bg: BG.blue, next: TL.total + 10, tr: null },
  ];
  let prev = 0;
  list.forEach((s, i) => {
    if (s.tr === 'auto') s.tr = STYLE.transitions[i % STYLE.transitions.length];
    s.d = s.d ?? STYLE.transitionDuration ?? 0.4;
    s.start = prev;
    s.end = s.next;
    s.seed = 1000 + i * 17;
    prev = s.next;
  });
  return list;
}

// Sound-effect cues for sfx.mjs: { t, type, gain?, pan?, len?, f? }. Times come from the timeline only.
function buildCues() {
  const TR_SFX = { whip: 'whoosh', glitch: 'glitch', punch: 'impact', iris: 'whoosh', flash: 'impact', slide: 'whoosh', zoom: 'whoosh' };
  const cues = [];
  SHOTS.forEach(s => { if (s.tr && TR_SFX[s.tr]) cues.push({ t: s.end - (TR_SFX[s.tr] === 'whoosh' ? 0.2 : 0), type: TR_SFX[s.tr], gain: 0.8 }); });
  cues.push(
    { t: S('H01'), type: 'impact', gain: 0.6 }, { t: S('H02'), type: 'impact', gain: 0.6 }, { t: S('H03'), type: 'impact', gain: 0.6 },
    { t: wordTime('H01', 'unstoppable'), type: 'shimmer' },
    { t: wordTime('H03', 'gone'), type: 'whoosh', gain: 1.1, pan: 0.5 },
    { t: wordTime('P02', 'miss'), type: 'pop', f: 500 },
    { t: wordTime('P02', 'boom'), type: 'boom', gain: 1.2 },
    { t: S('M01') + 0.05, type: 'riser', len: 1.2 },
    { t: S('M01') + 0.05, type: 'impact', gain: 1 },
    { t: wordTime('M02', 'one') + 0.05, type: 'pop', f: 1100 },
    { t: wordTime('M03', 'tap'), type: 'click', gain: 1.2 }, { t: wordTime('M03', 'tap'), type: 'pop', f: 700 },
    { t: wordTime('M03', 'sprout') - 0.1, type: 'shimmer', gain: 1.2 },
    { t: wordTime('M04', 'waits'), type: 'pop', f: 600 },
    { t: S('M05') + 0.9, type: 'shimmer' },
    { t: wordTime('C01', 'green'), type: 'shimmer', gain: 1.3 },
    { t: S('C02'), type: 'impact', gain: 1 },
  );
  GARDEN.forEach((_, i) => cues.push({ t: gardenTime(i), type: 'pop', f: 600 + i * 90, gain: 0.6, pan: (i % 5) / 2 - 1 }));
  return cues.sort((a, b) => a.t - b.t).map(c => ({ ...c, t: +c.t.toFixed(3) }));
}

function renderShot(ctx, shot, t) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawBackground(ctx, shot.bg);
  camera(ctx, t, shot.start - 0.5, shot.end + 0.5, shot.seed);
  shot.draw(ctx, t, shot);
  ctx.restore();
}

function renderFrame(t) {
  const ctx = MCTX;
  let i = SHOTS.findIndex(s => t < s.end);
  if (i < 0) i = SHOTS.length - 1;
  const cur = SHOTS[i], nxt = SHOTS[i + 1], prv = SHOTS[i - 1];
  if (nxt && cur.tr && t > cur.end - cur.d / 2) renderPair(ctx, cur, nxt, cur.tr, (t - (cur.end - cur.d / 2)) / cur.d, t);
  else if (prv && prv.tr && t < prv.end + prv.d / 2) renderPair(ctx, prv, cur, prv.tr, (t - (prv.end - prv.d / 2)) / prv.d, t);
  else renderShot(ctx, cur, t);
}
function renderPair(ctx, A, B, tr, p, t) {
  renderShot(OFF_A.getContext('2d'), A, t);
  renderShot(OFF_B.getContext('2d'), B, t);
  composite(ctx, tr, clamp(p), OFF_A, OFF_B, t);
}

function mergeStyle(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b;
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) out[k] = mergeStyle(out[k], v);
  return out;
}

async function loadFont(family, file, weights) {
  const face = new FontFace(family, `url("../${file}")`, weights ? { weight: weights } : {});
  document.fonts.add(await face.load());
}

async function init() {
  const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); });
  let own, FONTS;
  [PAL, TL, CELLS, own, FONTS] = await Promise.all(
    ['../palette.json', '../timeline.json', '../cells/cells.json', '../style.json', '../fonts.json'].map(get));
  const todo = JSON.stringify([PAL, FONTS, own]).match(/[^"]*\bTODO\b[^"]*/);
  if (todo) throw new Error(`placeholder value in palette/fonts/style.json: "${todo[0]}"`);
  const style = own.preset === 'custom' ? own : mergeStyle(await get(`../styles/${own.preset}.json`), own);
  CELLS = CELLS.cells;
  TL.lines.forEach(l => { LN[l.id] = l; });
  TL.sections.forEach(s => { SEC[s.id] = s; });
  MAIN = document.getElementById('c');
  MCTX = MAIN.getContext('2d');
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  OFF_A = mk(); OFF_B = mk();
  await loadImages(Object.keys(CELLS));
  await loadFont(FONTS.display.family, FONTS.display.file, FONTS.display.weights);
  await loadFont(FONTS.ui.family, FONTS.ui.file, FONTS.ui.weights);
  await document.fonts.ready;
  configureLook(style, FONTS);
  SHOTS = buildShots();
  window.VIDEO = { total: TL.total, fps: 30, shots: SHOTS.map(s => ({ id: s.id, start: s.start, end: s.end })), cues: buildCues() };
  window.renderFrame = renderFrame;
  window.renderSubtitle = renderSubtitle;
  window.READY = true;
}
init().catch(e => { window.INIT_ERROR = String(e && e.stack || e); });
