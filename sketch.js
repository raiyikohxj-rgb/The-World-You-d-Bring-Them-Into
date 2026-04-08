// ─────────────────────────────────────────────────────────────────────────────
// 世界 — "The World You'd Bring Them Into"
// An interactive spring-mass globe of Chinese characters.
// The world slowly compresses. You can resist. But not forever.
//
// Paste into p5.js web editor: https://editor.p5js.org
// ─────────────────────────────────────────────────────────────────────────────

// ── CONFIG ────────────────────────────────────────────────────────────────────
const GRID      = 12;
const K_SPRING  = 0.16;
const DAMPING   = 0.91;
const PUSH_R    = 52;         // cursor shield radius
const PUSH_F    = 3.8;        // shield force strength
const COMPRESS_F= 0.0008;     // inward world pressure (slow, relentless)
const BEAT_SPD  = 0.035;

// Characters: hope → fear
const HOPE_CHARS = ['子','家','爱','暖','续','根','望','生','光','梦'];
const FEAR_CHARS = ['钱','债','苦','累','忧','孤','难','热','乱','失'];

// The single child at the centre
const CHILD_CHAR = '子';

// Radical falloff for fear characters when they collapse
const FEAR_RADICALS = {
  '钱': ['金','戋'], '债': ['亻','责'], '苦': ['艹','古'],
  '累': ['田','糸'], '忧': ['忄','尤'], '孤': ['子','瓜'],
  '难': ['又','隹'], '热': ['火','执'], '乱': ['舌','乙'],
  '失': ['失'],
};

// ── GLOBALS ───────────────────────────────────────────────────────────────────
let nodes     = [];
let springs   = [];
let particles = [];
let beatPhase = 0;
let vitality  = 1;   // 1 = all hope, 0 = all fear
let childNode = null;
let started   = false;
let timeAlive = 0;   // frames since start, drives entropy
let cx, cy, R;       // world centre & radius

// ── SETUP ─────────────────────────────────────────────────────────────────────
function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont('serif');
  buildWorld();
}

function buildWorld() {
  nodes     = [];
  springs   = [];
  particles = [];
  vitality  = 1;
  beatPhase = 0;
  timeAlive = 0;
  started   = false;

  cx = width  / 2;
  cy = height / 2;
  R  = min(width, height) * 0.36;

  // ── place nodes on grid inside circle ─────────────────────────────────────
  const nodeMap = new Map();

  for (let wx = cx - R; wx <= cx + R; wx += GRID) {
    for (let wy = cy - R; wy <= cy + R; wy += GRID) {
      const d = dist(wx, wy, cx, cy);
      if (d <= R - 2) {
        const col = Math.round((wx - (cx - R)) / GRID);
        const row = Math.round((wy - (cy - R)) / GRID);
        const idx = nodes.length;
        const isChild = (d < GRID * 1.2); // centre node = child

        nodes.push({
          x: wx, y: wy,
          px: wx, py: wy,
          hx: wx, hy: wy,
          char: isChild ? CHILD_CHAR : random(HOPE_CHARS),
          isChild,
          feared: false,
          collapsed: false,
          alpha: 255,
          springCount: 0,
          distFromCentre: d,
          fearTimer: 0,     // counts down before transformation
        });

        if (isChild && !childNode) childNode = nodes[idx];
        nodeMap.set(`${col},${row}`, idx);
      }
    }
  }

  // ── connect springs ────────────────────────────────────────────────────────
  const dirs = [[1,0],[0,1],[1,1],[1,-1]];
  for (const [key, i] of nodeMap) {
    const [c, r] = key.split(',').map(Number);
    for (const [dc, dr] of dirs) {
      const nb = nodeMap.get(`${c+dc},${r+dr}`);
      if (nb !== undefined) {
        const diag = (dc !== 0 && dr !== 0);
        const restLen = diag ? GRID * Math.SQRT2 : GRID;
        springs.push({ a: i, b: nb, rest: restLen, diag });
        nodes[i].springCount++;
        nodes[nb].springCount++;
      }
    }
  }
}

// ── DRAW ──────────────────────────────────────────────────────────────────────
function draw() {
  background(8, 7, 14);

  if (!started) {
    drawOpening();
    return;
  }

  timeAlive++;
  beatPhase += BEAT_SPD;

  // entropy accelerates gently over time
  const entropy = min(timeAlive / 4000, 1);
  const compressionThisFrame = COMPRESS_F * (1 + entropy * 2.5);

  applyCompression(compressionThisFrame);
  applyShield();
  updatePhysics();
  transformNodes(entropy);

  // recalc vitality
  let feared = 0;
  for (const n of nodes) if (n.feared || n.collapsed) feared++;
  vitality = max(0, 1 - feared / nodes.length);

  drawSprings();
  drawNodes();
  drawParticles();
  drawChildGlow();
  drawUI(entropy);
}

// ── OPENING SCREEN ────────────────────────────────────────────────────────────
function drawOpening() {
  // Draw the static world faintly
  noStroke();
  textAlign(CENTER, CENTER);
  for (const n of nodes) {
    fill(180, 120, 160, 60);
    textSize(GRID * 0.9);
    text(n.char, n.x, n.y);
  }

  // Title
  const pulse = sin(frameCount * 0.04) * 0.15 + 0.85;
  fill(230, 180, 200, 240 * pulse);
  textSize(18);
  textFont('serif');
  text('你会把他们带进怎样的世界？', cx, cy - 36);

  fill(180, 140, 160, 180 * pulse);
  textSize(11);
  text('What kind of world would you bring them into?', cx, cy - 12);

  fill(140, 110, 130, 140);
  textSize(10);
  text('click to begin · drag to shield · the world will not wait', cx, cy + 20);
}

// ── COMPRESSION (the world pressing inward) ────────────────────────────────────
function applyCompression(f) {
  for (const n of nodes) {
    if (n.isChild) continue; // child is protected
    const dx = n.x - cx;
    const dy = n.y - cy;
    const d  = sqrt(dx*dx + dy*dy) || 1;
    // push inward
    n.x -= (dx / d) * f * d * 0.5;
    n.y -= (dy / d) * f * d * 0.5;
  }
}

// ── SHIELD (cursor pushes back) ────────────────────────────────────────────────
function applyShield() {
  if (!mouseIsPressed) return;
  for (const n of nodes) {
    const d = dist(mouseX, mouseY, n.x, n.y);
    if (d < PUSH_R && d > 0) {
      const f = pow(1 - d / PUSH_R, 1.5) * PUSH_F;
      const dx = n.x - mouseX;
      const dy = n.y - mouseY;
      const len = sqrt(dx*dx + dy*dy) || 1;
      n.x += dx / len * f;
      n.y += dy / len * f;
    }
  }
}

// ── PHYSICS ───────────────────────────────────────────────────────────────────
function updatePhysics() {
  const beatAmp = 0.008 * pow(vitality, 2);
  const beat    = 1 + beatAmp * (sin(beatPhase*2)*0.6 + sin(beatPhase*5)*0.3);

  for (const n of nodes) {
    if (n.collapsed) continue;
    const vx = (n.x - n.px) * DAMPING;
    const vy = (n.y - n.py) * DAMPING;
    n.px = n.x;
    n.py = n.y;

    if (n.isChild) {
      // child pulses gently at centre
      n.x += (cx - n.x) * 0.08 + vx;
      n.y += (cy - n.y) * 0.08 + vy;
    } else {
      n.x += vx;
      n.y += vy;
    }
  }

  // solve springs
  for (let iter = 0; iter < 3; iter++) {
    for (const s of springs) {
      const a = nodes[s.a], b = nodes[s.b];
      if (a.collapsed || b.collapsed) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d  = sqrt(dx*dx + dy*dy) || 0.001;
      const f  = (d - s.rest) / d * K_SPRING * 0.5;
      if (!a.isChild) { a.x += dx*f; a.y += dy*f; }
      if (!b.isChild) { b.x -= dx*f; b.y -= dy*f; }
    }
  }
}

// ── NODE TRANSFORMATION ────────────────────────────────────────────────────────
function transformNodes(entropy) {
  for (const n of nodes) {
    if (n.isChild || n.collapsed) continue;
    const d = dist(n.x, n.y, cx, cy);

    // nodes squeezed far from home toward centre become feared
    const squeeze = n.distFromCentre > 0
      ? 1 - (d / n.distFromCentre)
      : 0;

    if (!n.feared && squeeze > 0.38 + (1 - entropy) * 0.2) {
      n.fearTimer++;
      if (n.fearTimer > 18) {
        n.feared = true;
        n.char   = random(FEAR_CHARS);
        n.fearTimer = 0;
        spawnParticles(n);
      }
    } else if (!n.feared) {
      n.fearTimer = max(0, n.fearTimer - 1);
    }

    // nodes crushed all the way to centre collapse
    if (d < GRID * 2.5 && !n.isChild) {
      n.collapsed = true;
      spawnCollapse(n);
    }
  }
}

// ── PARTICLES ─────────────────────────────────────────────────────────────────
function spawnParticles(n) {
  const rads = FEAR_RADICALS[n.char] || [n.char];
  for (const r of rads) {
    particles.push({
      x: n.x, y: n.y,
      vx: random(-1.8, 1.8),
      vy: random(-2.5, -0.3),
      char: r, alpha: 220,
      angle: random(TWO_PI),
      spin: random(-0.05, 0.05),
      isCollapse: false,
    });
  }
}

function spawnCollapse(n) {
  particles.push({
    x: n.x, y: n.y,
    vx: random(-0.8, 0.8),
    vy: random(-1.2, 0.2),
    char: n.char, alpha: 180,
    angle: random(TWO_PI),
    spin: random(-0.03, 0.03),
    isCollapse: true,
  });
}

function drawParticles() {
  textAlign(CENTER, CENTER);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += p.isCollapse ? 0.04 : 0.18;
    p.vx *= 0.97;
    p.x  += p.vx;
    p.y  += p.vy;
    p.alpha -= p.isCollapse ? 1.2 : 3;
    p.angle += p.spin;

    if (p.alpha <= 0) { particles.splice(i, 1); continue; }

    push();
    translate(p.x, p.y);
    rotate(p.angle);
    const t = p.alpha / 220;
    const col = lerpColor(color(130,130,150), color(200,100,130), t);
    fill(red(col), green(col), blue(col), p.alpha);
    noStroke();
    textSize(GRID * 0.82);
    text(p.char, 0, 0);
    pop();
  }
}

// ── DRAW SPRINGS ──────────────────────────────────────────────────────────────
function drawSprings() {
  strokeWeight(0.5);
  for (const s of springs) {
    const a = nodes[s.a], b = nodes[s.b];
    if (a.collapsed || b.collapsed) continue;
    const feared = a.feared || b.feared;
    stroke(feared ? color(140,70,90,25) : color(160,120,180,22));
    line(a.x, a.y, b.x, b.y);
  }
}

// ── DRAW NODES ────────────────────────────────────────────────────────────────
function drawNodes() {
  noStroke();
  textAlign(CENTER, CENTER);
  const sz = GRID * 0.92;

  for (const n of nodes) {
    if (n.collapsed || n.isChild) continue;
    let c;
    if (n.feared) {
      // fear: muted red-grey
      const t = min(1, (timeAlive - 60) / 600);
      c = lerpColor(color(200,90,110), color(110,90,100), t * 0.5);
    } else {
      // hope: warm rose-gold
      c = lerpColor(color(230,170,200), color(200,140,190), 0.4);
    }
    fill(red(c), green(c), blue(c), n.alpha);
    textSize(sz);
    text(n.char, n.x, n.y);
  }
}

// ── CHILD GLOW ────────────────────────────────────────────────────────────────
function drawChildGlow() {
  if (!childNode) return;

  // pulsing glow
  const pulse = sin(beatPhase * 2) * 0.3 + 0.7;
  const glowR = GRID * 2.5 * pulse;

  noStroke();
  for (let r = glowR; r > 0; r -= 2) {
    const a = map(r, 0, glowR, 80, 0) * vitality;
    fill(240, 200, 220, a);
    ellipse(childNode.x, childNode.y, r*2, r*2);
  }

  // the child character
  const childSize = GRID * 1.4 * (0.9 + pulse * 0.1);
  fill(255, 220, 235, 240);
  textAlign(CENTER, CENTER);
  textSize(childSize);
  text(CHILD_CHAR, childNode.x, childNode.y);
}

// ── UI ────────────────────────────────────────────────────────────────────────
function drawUI(entropy) {
  // world vitality arc
  noFill();
  strokeWeight(1.5);
  stroke(60, 40, 55);
  arc(cx, cy, R*2 + 22, R*2 + 22, -HALF_PI, -HALF_PI + TWO_PI);
  const vCol = lerpColor(color(160,60,80), color(200,160,210), vitality);
  stroke(red(vCol), green(vCol), blue(vCol), 180);
  arc(cx, cy, R*2 + 22, R*2 + 22, -HALF_PI, -HALF_PI + TWO_PI * vitality);

  // entropy indicator (top right)
  fill(120, 90, 110, 160);
  noStroke();
  textAlign(RIGHT, TOP);
  textSize(10);
  textFont('serif');
  text('世界压力 ' + nf(entropy * 100, 1, 0) + '%', width - 22, 22);

  // hold hint
  if (mouseIsPressed) {
    // shield radius visualisation
    noFill();
    stroke(180, 160, 220, 50);
    strokeWeight(1);
    ellipse(mouseX, mouseY, PUSH_R*2, PUSH_R*2);
  } else {
    fill(110, 85, 100, 120);
    noStroke();
    textAlign(CENTER, BOTTOM);
    textSize(10);
    text('按住鼠标保护这个世界  ·  hold to shield  ·  R to reset', cx, height - 18);
  }

  // vitality text
  textAlign(LEFT, TOP);
  fill(150, 110, 130, 150);
  textSize(10);
  const hopeLabel = vitality > 0.66 ? '希望尚存' : vitality > 0.33 ? '摇摇欲坠' : '岌岌可危';
  text(hopeLabel, 22, 22);
}

// ── INPUT ─────────────────────────────────────────────────────────────────────
function mousePressed() {
  if (!started) {
    started = true;
    return;
  }
}

function keyPressed() {
  if (key === 'r' || key === 'R') buildWorld();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  buildWorld();
}