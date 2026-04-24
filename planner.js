const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// ── State ──────────────────────────────────────────────────────────────────
let offsetX = 0;      // pan offset in screen pixels
let offsetY = 0;
let scale = 1;        // current zoom level

const GRID_SPACING = 30;   // dots every 30 "world" pixels
const DOT_RADIUS   = 1.5;  // dot radius in screen pixels (constant)
const DOT_COLOR    = '#b0b0b0';

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

// ── Resize ─────────────────────────────────────────────────────────────────
function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  draw();
}

// ── Week day blocks ────────────────────────────────────────────────────────
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Layout: 12 units wide × 20 units tall, 1-unit gap between blocks, 1-unit left margin
// Row 1: Mon–Thu (indices 0–3), Row 2: Fri–Sun (indices 4–6)
// Each unit = GRID_SPACING world pixels
const BLOCK_W = 12 * GRID_SPACING;   // 360 world px
const BLOCK_H = 20 * GRID_SPACING;   // 600 world px
const BLOCK_GAP = 1 * GRID_SPACING;  // 30 world px between blocks
const BLOCK_MARGIN_X = 1 * GRID_SPACING;
const BLOCK_ROW1_Y = 2 * GRID_SPACING;  // leave 2 units above for label
const BLOCK_ROW2_Y = BLOCK_ROW1_Y + BLOCK_H + 2 * GRID_SPACING;

const DAY_BLOCKS = DAYS.map((name, i) => {
  const row = i < 4 ? 0 : 1;
  const col = i < 4 ? i : i - 4;
  return {
    name,
    wx: BLOCK_MARGIN_X + col * (BLOCK_W + BLOCK_GAP),
    wy: row === 0 ? BLOCK_ROW1_Y : BLOCK_ROW2_Y,
  };
});

function drawDayBlock(name, wx, wy) {
  const sx = wx * scale + offsetX;
  const sy = wy * scale + offsetY;
  const sw = BLOCK_W * scale;
  const sh = BLOCK_H * scale;

  const fontSize = Math.max(8, Math.round(14 * scale));
  ctx.font = `bold ${fontSize}px sans-serif`;

  const textWidth = ctx.measureText(name).width;
  const textPad   = 6 * scale;
  const gapW      = textWidth + textPad * 2;
  const gapStart  = (sw - gapW) / 2;

  ctx.strokeStyle = '#000000';
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';

  // Top-left segment
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + gapStart, sy);
  ctx.stroke();

  // Top-right segment
  ctx.beginPath();
  ctx.moveTo(sx + gapStart + gapW, sy);
  ctx.lineTo(sx + sw, sy);
  ctx.stroke();

  // Right, bottom, left sides
  ctx.beginPath();
  ctx.moveTo(sx + sw, sy);
  ctx.lineTo(sx + sw, sy + sh);
  ctx.lineTo(sx,       sy + sh);
  ctx.lineTo(sx,       sy);
  ctx.stroke();

  // Label text centered in the gap, vertically centred on the top border
  ctx.fillStyle    = '#000000';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, sx + sw / 2, sy);
}

// ── Draw ───────────────────────────────────────────────────────────────────
function draw() {
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Fill background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // The grid spacing in screen pixels at current zoom
  const step = GRID_SPACING * scale;

  // Find the first dot position (in screen space) that is visible
  // offsetX/offsetY represent where world-origin sits in screen space
  const startX = ((offsetX % step) + step) % step;
  const startY = ((offsetY % step) + step) % step;

  ctx.fillStyle = DOT_COLOR;

  for (let x = startX; x < w; x += step) {
    for (let y = startY; y < h; y += step) {
      ctx.beginPath();
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draw day blocks on top of the grid
  DAY_BLOCKS.forEach(({ name, wx, wy }) => drawDayBlock(name, wx, wy));
}

// ── Zoom (mouse wheel) ─────────────────────────────────────────────────────
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();

  const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newScale   = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * zoomFactor));

  // Zoom toward the cursor position
  const mouseX = e.clientX;
  const mouseY = e.clientY;

  offsetX = mouseX - (mouseX - offsetX) * (newScale / scale);
  offsetY = mouseY - (mouseY - offsetY) * (newScale / scale);
  scale   = newScale;

  draw();
}, { passive: false });

// ── Pan (mouse drag) ───────────────────────────────────────────────────────
let isPanning = false;
let lastMouseX = 0;
let lastMouseY = 0;

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return; // left button only
  isPanning  = true;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  canvas.classList.add('panning');
});

window.addEventListener('mousemove', (e) => {
  if (!isPanning) return;
  offsetX += e.clientX - lastMouseX;
  offsetY += e.clientY - lastMouseY;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  draw();
});

window.addEventListener('mouseup', () => {
  isPanning = false;
  canvas.classList.remove('panning');
});

// ── Pan + Zoom (touch) ─────────────────────────────────────────────────────
let lastTouchDist  = null;
let lastTouchMidX  = 0;
let lastTouchMidY  = 0;

function getTouchMid(touches) {
  const t0 = touches[0], t1 = touches[1];
  return {
    x: (t0.clientX + t1.clientX) / 2,
    y: (t0.clientY + t1.clientY) / 2,
  };
}

function getTouchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (e.touches.length === 1) {
    isPanning  = true;
    lastMouseX = e.touches[0].clientX;
    lastMouseY = e.touches[0].clientY;
    lastTouchDist = null;
  } else if (e.touches.length === 2) {
    isPanning     = false;
    lastTouchDist = getTouchDist(e.touches);
    const mid     = getTouchMid(e.touches);
    lastTouchMidX = mid.x;
    lastTouchMidY = mid.y;
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length === 1 && isPanning) {
    offsetX += e.touches[0].clientX - lastMouseX;
    offsetY += e.touches[0].clientY - lastMouseY;
    lastMouseX = e.touches[0].clientX;
    lastMouseY = e.touches[0].clientY;
    draw();
  } else if (e.touches.length === 2) {
    const dist      = getTouchDist(e.touches);
    const mid       = getTouchMid(e.touches);
    const zoomFactor = dist / (lastTouchDist || dist);
    const newScale   = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * zoomFactor));

    // Zoom toward lastTouchMid and apply midpoint translation as pan in one step
    offsetX = mid.x - (lastTouchMidX - offsetX) * (newScale / scale);
    offsetY = mid.y - (lastTouchMidY - offsetY) * (newScale / scale);

    scale         = newScale;
    lastTouchDist = dist;
    lastTouchMidX = mid.x;
    lastTouchMidY = mid.y;
    draw();
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (e.touches.length < 2) lastTouchDist = null;
  if (e.touches.length === 0) isPanning = false;
}, { passive: false });

// ── Init ───────────────────────────────────────────────────────────────────
window.addEventListener('resize', resize);
resize();
