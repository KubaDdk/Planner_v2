const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// ── Constants ─────────────────────────────────────────────────────────────────
// PR 1: 1 grid unit = 1 hour
const HOUR_UNIT    = 30;           // world pixels per hour
const GRID_SPACING = HOUR_UNIT;    // dot grid spacing (same as hour unit)
const DOT_RADIUS   = 1.5;
const DOT_COLOR    = '#b0b0b0';

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

const HOURS_IN_DAY     = 24;
const HOUR_LABEL_W     = 2 * HOUR_UNIT;  // 60 world px reserved for hour labels
const RESIZE_HANDLE_PX = 8;              // screen-pixel height of resize-handle hit zone

// ── State ─────────────────────────────────────────────────────────────────────
let offsetX = 0;
let offsetY = 0;
let scale   = 1;

// ── Week day blocks ────────────────────────────────────────────────────────────
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Layout: 12 units wide × 24 units tall (PR 1: full 24-hour day)
const BLOCK_W        = 12 * HOUR_UNIT;
const BLOCK_H        = HOURS_IN_DAY * HOUR_UNIT;  // 720 world px
const BLOCK_GAP      = 1 * HOUR_UNIT;
const BLOCK_MARGIN_X = 1 * HOUR_UNIT;
const BLOCK_ROW1_Y   = 2 * HOUR_UNIT;
const BLOCK_ROW2_Y   = BLOCK_ROW1_Y + BLOCK_H + 2 * HOUR_UNIT;

const DAY_BLOCKS = DAYS.map((name, i) => {
  const row = i < 4 ? 0 : 1;
  const col = i < 4 ? i : i - 4;
  return {
    name,
    index: i,
    wx: BLOCK_MARGIN_X + col * (BLOCK_W + BLOCK_GAP),
    wy: row === 0 ? BLOCK_ROW1_Y : BLOCK_ROW2_Y,
  };
});

// ── PR 2: Event data model + localStorage ─────────────────────────────────────
function loadEvents() {
  try { return JSON.parse(localStorage.getItem('planner_events') || '[]'); }
  catch { return []; }
}

function saveEvents() {
  localStorage.setItem('planner_events', JSON.stringify(events));
}

let events = loadEvents();
let nextId  = events.reduce((m, e) => Math.max(m, e.id + 1), 0);

function createEvent(dayIndex, startHour, title = '') {
  const ev = { id: nextId++, dayIndex, startHour, durationHours: 1, title };
  events.push(ev);
  saveEvents();
  return ev;
}

function deleteEvent(id) {
  events = events.filter(e => e.id !== id);
  saveEvents();
}

// ── Coordinate helpers (PR 3) ──────────────────────────────────────────────────
function screenToWorld(sx, sy) {
  return { x: (sx - offsetX) / scale, y: (sy - offsetY) / scale };
}

// ── Event geometry ─────────────────────────────────────────────────────────────
function getEventScreenRect(ev) {
  const block = DAY_BLOCKS[ev.dayIndex];
  const wx    = block.wx + HOUR_LABEL_W;
  const wy    = block.wy + ev.startHour * HOUR_UNIT;
  const ww    = BLOCK_W  - HOUR_LABEL_W;
  const wh    = ev.durationHours * HOUR_UNIT;
  return {
    x: wx * scale + offsetX,
    y: wy * scale + offsetY,
    w: ww * scale,
    h: wh * scale,
  };
}

// ── Hit-testing (PR 3) ────────────────────────────────────────────────────────
function hitTestEvents(sx, sy) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const r  = getEventScreenRect(ev);
    if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) {
      return { event: ev, isResizeHandle: sy >= r.y + r.h - RESIZE_HANDLE_PX };
    }
  }
  return null;
}

function hitTestDeleteButton(sx, sy) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev !== hoveredEvent && ev !== selectedEvent) continue;
    const r    = getEventScreenRect(ev);
    const btnX = r.x + r.w - 18;
    const btnY = r.y + 2;
    if (sx >= btnX && sx <= btnX + 14 && sy >= btnY && sy <= btnY + 14) return ev;
  }
  return null;
}

function hitTestDayBlock(sx, sy) {
  const w = screenToWorld(sx, sy);
  return DAY_BLOCKS.find(b =>
    w.x >= b.wx && w.x <= b.wx + BLOCK_W &&
    w.y >= b.wy && w.y <= b.wy + BLOCK_H
  ) || null;
}

// ── Interaction state (PR 3) ──────────────────────────────────────────────────
// mode: 'idle' | 'pan' | 'drag' | 'resize'
let interactionMode = 'idle';
let activeEvent     = null;
let dragOffsetHour  = 0;
let resizeOrigY     = 0;
let resizeOrigHours = 0;

let hoveredEvent  = null;
let selectedEvent = null;

let isPanning  = false;
let lastMouseX = 0;
let lastMouseY = 0;

// ── Resize canvas ──────────────────────────────────────────────────────────────
function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  draw();
}

// ── Draw ───────────────────────────────────────────────────────────────────────
function draw() {
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Dot grid
  const step   = GRID_SPACING * scale;
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

  // Day blocks with time grid, then events on top
  DAY_BLOCKS.forEach(({ name, wx, wy }) => {
    drawDayBlock(name, wx, wy);
    drawTimeGrid(wx, wy);
  });
  events.forEach(ev => drawEvent(ev));
}

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

  // Label text centred in the gap on the top border
  ctx.fillStyle    = '#000000';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, sx + sw / 2, sy);
}

// PR 1: Draw horizontal hour lines and labels inside a day block
function drawTimeGrid(wx, wy) {
  const sx         = wx * scale + offsetX;
  const sy         = wy * scale + offsetY;
  const labelAreaW = HOUR_LABEL_W * scale;
  const lineStartX = sx + labelAreaW;
  const lineEndX   = sx + BLOCK_W * scale;
  const fontSize   = Math.max(7, Math.round(10 * scale));

  ctx.strokeStyle  = '#dddddd';
  ctx.lineWidth    = 1;
  ctx.font         = `${fontSize}px sans-serif`;
  ctx.fillStyle    = '#777777';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';

  for (let h = 0; h < HOURS_IN_DAY; h++) {
    const lineY  = sy + h * HOUR_UNIT * scale;
    const labelY = lineY + (HOUR_UNIT * scale) / 2;
    const label  = `${String(h).padStart(2, '0')}:00`;

    // Hour separator line (skip h=0, which coincides with the top border)
    if (h > 0) {
      ctx.beginPath();
      ctx.moveTo(lineStartX, lineY);
      ctx.lineTo(lineEndX,   lineY);
      ctx.stroke();
    }

    // Hour label centred vertically within the hour slot
    ctx.fillText(label, sx + labelAreaW - 4 * scale, labelY);
  }
}

// PR 2: Render a single event rectangle with resize handle and delete button
function drawEvent(ev) {
  const r          = getEventScreenRect(ev);
  const isHovered  = ev === hoveredEvent;
  const isSelected = ev === selectedEvent;
  const isActive   = isHovered || isSelected;

  if (r.w < 1 || r.h < 1) return;

  // Body
  ctx.fillStyle   = isSelected ? 'rgba(59,130,246,0.85)'
                  : isHovered  ? 'rgba(59,130,246,0.70)'
                  :               'rgba(59,130,246,0.55)';
  ctx.strokeStyle = '#1d4ed8';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, Math.max(r.h, 2), 3);
  ctx.fill();
  ctx.stroke();

  // Title (clipped to body)
  const fontSize = Math.max(8, Math.round(11 * scale));
  ctx.font        = `${fontSize}px sans-serif`;
  ctx.fillStyle   = '#ffffff';
  ctx.textAlign   = 'left';
  ctx.textBaseline = 'top';
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x + 3, r.y + 2, r.w - 22, r.h - 4);
  ctx.clip();
  ctx.fillText(ev.title || '(no title)', r.x + 4, r.y + 3);
  ctx.restore();

  // Resize handle — visual affordance at the bottom
  if (r.h >= 12) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(r.x + r.w * 0.3, r.y + r.h - RESIZE_HANDLE_PX + 2, r.w * 0.4, 3);
  }

  // Delete button (✕) — visible on hover or selection
  if (isActive && r.h >= 12 && r.w >= 18) {
    const btnX = r.x + r.w - 18;
    const btnY = r.y + 2;
    ctx.fillStyle = 'rgba(220,50,50,0.9)';
    ctx.beginPath();
    ctx.roundRect(btnX, btnY, 14, 14, 3);
    ctx.fill();
    const btnFontSize = Math.max(9, Math.round(10 * scale));
    ctx.font         = `bold ${btnFontSize}px sans-serif`;
    ctx.fillStyle    = '#ffffff';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', btnX + 7, btnY + 7);
  }
}

// ── PR 4: Title editing overlay ───────────────────────────────────────────────
let titleInput   = null;
let editingEvent = null;

function showTitleInput(ev) {
  hideTitleInput();
  editingEvent  = ev;
  selectedEvent = ev;

  const r     = getEventScreenRect(ev);
  const input = document.createElement('input');
  input.type        = 'text';
  input.value       = ev.title;
  input.placeholder = 'Event title…';
  Object.assign(input.style, {
    position:     'fixed',
    left:         `${r.x + 4}px`,
    top:          `${Math.max(r.y + 2, 0)}px`,
    width:        `${Math.max(60, r.w - 22)}px`,
    height:       `${Math.min(22, Math.max(16, r.h - 6))}px`,
    fontSize:     `${Math.max(10, Math.round(11 * scale))}px`,
    padding:      '1px 3px',
    border:       '1px solid #1d4ed8',
    borderRadius: '3px',
    background:   'rgba(255,255,255,0.95)',
    color:        '#000',
    outline:      'none',
    zIndex:       '10',
  });
  document.body.appendChild(input);
  input.focus();
  input.select();
  titleInput = input;

  let committed = false;

  function commit() {
    if (committed) return;
    committed = true;
    // Guard against the event having been deleted while the input was open
    const live = events.find(e => e.id === ev.id);
    if (live) {
      live.title = input.value;
      saveEvents();
    }
    hideTitleInput();
    draw();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  commit();
    if (e.key === 'Escape') { hideTitleInput(); draw(); }
    e.stopPropagation();
  });
  input.addEventListener('blur', commit);
}

function hideTitleInput() {
  if (!titleInput) return;
  const inp  = titleInput;
  titleInput   = null;   // nullify before remove to prevent re-entrant blur
  editingEvent = null;
  inp.remove();
}

// ── Mouse events ──────────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  hideTitleInput();

  const sx = e.clientX;
  const sy = e.clientY;

  // Check delete button first
  const delEv = hitTestDeleteButton(sx, sy);
  if (delEv) {
    if (selectedEvent === delEv) selectedEvent = null;
    if (hoveredEvent  === delEv) hoveredEvent  = null;
    deleteEvent(delEv.id);
    draw();
    return;
  }

  // Hit-test events → drag or resize
  const hit = hitTestEvents(sx, sy);
  if (hit) {
    selectedEvent = hit.event;
    activeEvent   = hit.event;
    if (hit.isResizeHandle) {
      interactionMode     = 'resize';
      resizeOrigY         = sy;
      resizeOrigHours     = hit.event.durationHours;
      canvas.style.cursor = 'ns-resize';
    } else {
      interactionMode = 'drag';
      const w = screenToWorld(sx, sy);
      const block = DAY_BLOCKS[hit.event.dayIndex];
      dragOffsetHour      = (w.y - block.wy) / HOUR_UNIT - hit.event.startHour;
      canvas.style.cursor = 'move';
    }
    draw();
    return;
  }

  // Pan
  selectedEvent       = null;
  interactionMode     = 'pan';
  isPanning           = true;
  lastMouseX          = sx;
  lastMouseY          = sy;
  canvas.style.cursor = '';
  canvas.classList.add('panning');
  draw();
});

window.addEventListener('mousemove', (e) => {
  const sx = e.clientX;
  const sy = e.clientY;

  if (interactionMode === 'pan' && isPanning) {
    offsetX   += sx - lastMouseX;
    offsetY   += sy - lastMouseY;
    lastMouseX = sx;
    lastMouseY = sy;
    draw();
    return;
  }

  if (interactionMode === 'drag' && activeEvent) {
    const w = screenToWorld(sx, sy);
    // Determine target day column from world X
    const targetBlock = DAY_BLOCKS.find(b => w.x >= b.wx && w.x <= b.wx + BLOCK_W) || null;
    if (targetBlock) {
      activeEvent.dayIndex = targetBlock.index;
      const raw      = (w.y - targetBlock.wy) / HOUR_UNIT - dragOffsetHour;
      const snapped  = Math.round(raw);
      const maxStart = HOURS_IN_DAY - activeEvent.durationHours;
      activeEvent.startHour = Math.max(0, Math.min(snapped, maxStart));
    }
    draw();
    return;
  }

  if (interactionMode === 'resize' && activeEvent) {
    const dy      = sy - resizeOrigY;
    const rawHrs  = resizeOrigHours + (dy / scale) / HOUR_UNIT;
    const snapped = Math.round(rawHrs);
    const maxHrs  = HOURS_IN_DAY - activeEvent.startHour;
    activeEvent.durationHours = Math.max(1, Math.min(snapped, maxHrs));
    draw();
    return;
  }

  // Idle: update hover state and cursor
  const hit      = hitTestEvents(sx, sy);
  const newHover = hit ? hit.event : null;
  if (newHover !== hoveredEvent) {
    hoveredEvent = newHover;
    draw();
  }
  if (hit) {
    canvas.style.cursor = hit.isResizeHandle ? 'ns-resize' : 'move';
  } else {
    canvas.style.cursor = '';  // fall back to CSS cursor: grab
  }
});

window.addEventListener('mouseup', () => {
  if (interactionMode === 'drag' || interactionMode === 'resize') {
    if (activeEvent) saveEvents();
    canvas.style.cursor = '';
  }
  interactionMode = 'idle';
  isPanning       = false;
  activeEvent     = null;
  canvas.classList.remove('panning');
});

// ── PR 4: Double-click to create or edit events ───────────────────────────────
canvas.addEventListener('dblclick', (e) => {
  const sx = e.clientX;
  const sy = e.clientY;

  // Double-click on existing event → edit title
  const hit = hitTestEvents(sx, sy);
  if (hit && !hit.isResizeHandle) {
    showTitleInput(hit.event);
    draw();
    return;
  }

  // Double-click inside a day block → create a new 1-hour event
  const block = hitTestDayBlock(sx, sy);
  if (block) {
    const w    = screenToWorld(sx, sy);
    const raw  = (w.y - block.wy) / HOUR_UNIT;
    const hour = Math.max(0, Math.min(Math.floor(raw), HOURS_IN_DAY - 1));
    const ev   = createEvent(block.index, hour);
    showTitleInput(ev);
    draw();
  }
});

// ── Zoom (mouse wheel) ─────────────────────────────────────────────────────────
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();

  const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const newScale   = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * zoomFactor));
  const mouseX     = e.clientX;
  const mouseY     = e.clientY;

  offsetX = mouseX - (mouseX - offsetX) * (newScale / scale);
  offsetY = mouseY - (mouseY - offsetY) * (newScale / scale);
  scale   = newScale;

  draw();
}, { passive: false });

// ── Touch: pan + pinch-zoom ────────────────────────────────────────────────────
let lastTouchDist = null;
let lastTouchMidX = 0;
let lastTouchMidY = 0;

function getTouchMid(touches) {
  return {
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
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
    isPanning     = true;
    lastMouseX    = e.touches[0].clientX;
    lastMouseY    = e.touches[0].clientY;
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
    offsetX   += e.touches[0].clientX - lastMouseX;
    offsetY   += e.touches[0].clientY - lastMouseY;
    lastMouseX = e.touches[0].clientX;
    lastMouseY = e.touches[0].clientY;
    draw();
  } else if (e.touches.length === 2) {
    const dist       = getTouchDist(e.touches);
    const mid        = getTouchMid(e.touches);
    const zoomFactor = dist / (lastTouchDist || dist);
    const newScale   = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * zoomFactor));

    // Zoom toward midpoint and apply midpoint translation as pan in one step
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

// ── Init ───────────────────────────────────────────────────────────────────────
window.addEventListener('resize', resize);
resize();
