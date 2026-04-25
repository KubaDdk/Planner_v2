const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Hidden input to capture keyboard on mobile (software keyboard trigger)
const hiddenInput = document.createElement('input');
hiddenInput.setAttribute('type', 'text');
hiddenInput.setAttribute('autocomplete', 'off');
hiddenInput.setAttribute('autocorrect', 'off');
hiddenInput.setAttribute('autocapitalize', 'off');
hiddenInput.setAttribute('spellcheck', 'false');
Object.assign(hiddenInput.style, {
  position: 'fixed', opacity: '0', pointerEvents: 'none',
  top: '0', left: '0', width: '1px', height: '1px', fontSize: '16px',
});
document.body.appendChild(hiddenInput);

// Sync hidden input value → active edit buffer on every input event (handles
// mobile IME, paste, autocorrect, etc.)
hiddenInput.addEventListener('input', () => {
  const val = hiddenInput.value;
  if (todoEditId !== null) {
    todoEditText   = val;
    todoEditCursor = val.length;
    todoEditBlinkOn = true;
    draw();
  } else if (editingEvent) {
    editText   = val;
    editCursor = val.length;
    editBlinkOn = true;
    draw();
  }
});

hiddenInput.addEventListener('keydown', (ev) => {
  // Stop propagation so character keys don't also fire the window keydown handler
  ev.stopPropagation();
  // Forward only structural keys to the window handler
  const structural = ['Enter','Escape','Backspace','Delete','ArrowLeft','ArrowRight','Home','End'];
  if (structural.includes(ev.key)) {
    // Backspace/Delete: apply manually and update hiddenInput so input event stays in sync
    if (ev.key === 'Backspace' || ev.key === 'Delete') {
      // Let the input element handle it natively → input event will fire and sync
      return;
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ev.key, bubbles: true }));
    ev.preventDefault();
  }
});

let hiddenInputBlurring = false;

hiddenInput.addEventListener('blur', () => {
  if (hiddenInputBlurring) return;
  // User dismissed keyboard (e.g. tapped outside on mobile) — commit
  commitEdit();
  commitTodoEdit();
});

// ── Constants ─────────────────────────────────────────────────────────────────
// PR 1: 1 grid unit = 1 hour
const HOUR_UNIT    = 30;           // world pixels per hour
const GRID_SPACING = HOUR_UNIT;    // dot grid spacing (same as hour unit)
const DOT_RADIUS   = 1.5;
const DOT_COLOR    = '#b0b0b0';

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

const HOURS_IN_DAY     = 18;               // 06:00 – 24:00
const DAY_START_HOUR   = 6;                // hour shown at the top of each day block
const HOUR_LABEL_W     = 1.5 * HOUR_UNIT;  // 45 world px reserved for hour labels
const BLOCK_INNER_PAD  = 0.4 * HOUR_UNIT;  // 12 world px horizontal padding inside block
const BLOCK_INNER_PAD_Y = 0.4 * HOUR_UNIT; // 12 world px vertical padding inside block (top & bottom)
const RESIZE_HANDLE_PX = 8;                // screen-pixel height of resize-handle hit zone

// ── State ─────────────────────────────────────────────────────────────────────
let offsetX = 0;
let offsetY = 0;
let scale   = 1;

// ── Week day blocks ────────────────────────────────────────────────────────────
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Layout: 12 units wide × 24 units tall (PR 1: full 24-hour day)
const BLOCK_W        = 12 * HOUR_UNIT;
const BLOCK_H        = (HOURS_IN_DAY + 1) * HOUR_UNIT;  // 1 extra unit of bottom padding
const BLOCK_GAP      = 1 * HOUR_UNIT;
const BLOCK_MARGIN_X = 1 * HOUR_UNIT;
const BLOCK_ROW1_Y   = 2 * HOUR_UNIT;
const BLOCK_ROW2_Y   = BLOCK_ROW1_Y + BLOCK_H + 2 * HOUR_UNIT;

// ── Week date helpers ────────────────────────────────────────────────────────
function getMondayOfCurrentWeek() {
  const today = new Date();
  const day   = today.getDay(); // 0=Sun … 6=Sat
  const diff  = (day === 0 ? -6 : 1 - day); // offset to Monday
  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function getWeekDates() {
  const monday = getMondayOfCurrentWeek();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

const WEEKLY_PLANNER_BLOCK = {
  name: 'Weekly planner',
  wx: BLOCK_MARGIN_X,
  wy: BLOCK_ROW1_Y,
};

const DAY_BLOCKS = DAYS.map((name, i) => {
  // Top row: Mon(0), Tue(1), Wed(2) — offset by 1 col so Mon sits above Fri (col 1-3)
  // Bottom row: Thu(3), Fri(4), Sat(5), Sun(6) (col 0-3)
  const row = i < 3 ? 0 : 1;
  const col = i < 3 ? i + 1 : i - 3;
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

// ── Todos data model ───────────────────────────────────────────────────────────
function loadTodos() {
  try { return JSON.parse(localStorage.getItem('planner_todos') || '[]'); }
  catch { return []; }
}
function saveTodos() {
  localStorage.setItem('planner_todos', JSON.stringify(todos));
}

let todos   = loadTodos();
let todoNextId = todos.reduce((m, t) => Math.max(m, t.id + 1), 0);

function createTodo(text) {
  const t = { id: todoNextId++, text, checked: false };
  todos.push(t);
  saveTodos();
  return t;
}
function deleteTodo(id) {
  todos = todos.filter(t => t.id !== id);
  saveTodos();
}

// Hit-areas populated each draw() call, used by mouse handlers
let todoHitAreas = [];  // [{ type:'checkbox'|'text'|'delete'|'add', id, x, y, w, h }]

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
  const wy    = block.wy + BLOCK_INNER_PAD_Y + ev.startHour * HOUR_UNIT;
  const ww    = BLOCK_W  - HOUR_LABEL_W - BLOCK_INNER_PAD;
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
    const btnR  = 9;
    const btnCX = r.x + r.w - btnR - 4;
    const btnCY = r.y + btnR + 4;
    const dx = sx - btnCX;
    const dy = sy - btnCY;
    if (dx * dx + dy * dy <= btnR * btnR) return ev;
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
  drawDayBlock(WEEKLY_PLANNER_BLOCK.name, null, WEEKLY_PLANNER_BLOCK.wx, WEEKLY_PLANNER_BLOCK.wy);
  drawWeeklyPlannerContent(WEEKLY_PLANNER_BLOCK.wx, WEEKLY_PLANNER_BLOCK.wy);
  const weekDates = getWeekDates();
  DAY_BLOCKS.forEach(({ name, index, wx, wy }) => {
    const d = weekDates[index];
    const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    const today = new Date();
    const isToday = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    drawDayBlock(isToday ? 'Today' : name, dateStr, wx, wy);
    drawTimeGrid(wx, wy);
  });
  events.forEach(ev => drawEvent(ev));
}

function drawDayBlock(name, dateStr, wx, wy) {
  const sx = wx * scale + offsetX;
  const sy = wy * scale + offsetY;
  const sw = BLOCK_W * scale;
  const sh = BLOCK_H * scale;
  const r  = Math.min(8 * scale, sw / 2, sh / 2);  // corner radius, scaled

  const fontSize = Math.max(12, Math.round(20 * scale));
  ctx.font = `bold ${fontSize}px sans-serif`;
  const label     = dateStr ? `${name} ${dateStr}` : name;
  const textWidth = ctx.measureText(label).width;
  const textPad   = 6 * scale;
  const gapW      = textWidth + textPad * 2;
  const gapStart  = (sw - gapW) / 2;

  ctx.strokeStyle = '#000000';
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';

  // Fill block background to cover the dot grid
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(sx, sy, sw, sh, r);
  ctx.fill();

  // Draw border as two paths so the day-name gap is preserved on the top edge.
  // Top-left corner + left segment of top border
  ctx.beginPath();
  ctx.moveTo(sx + gapStart, sy);
  ctx.lineTo(sx + r, sy);
  ctx.arcTo(sx, sy, sx, sy + r, r);
  ctx.lineTo(sx, sy + sh - r);
  ctx.arcTo(sx, sy + sh, sx + r, sy + sh, r);
  ctx.lineTo(sx + sw - r, sy + sh);
  ctx.arcTo(sx + sw, sy + sh, sx + sw, sy + sh - r, r);
  ctx.lineTo(sx + sw, sy + r);
  ctx.arcTo(sx + sw, sy, sx + sw - r, sy, r);
  ctx.lineTo(sx + gapStart + gapW, sy);
  ctx.stroke();

  // Label text centred in the gap on the top border
  ctx.fillStyle    = '#000000';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillText(label, sx + sw / 2, sy);
}

function drawWeeklyPlannerContent(wx, wy) {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const today  = new Date();
  const dateLabel = `${String(today.getDate()).padStart(2, '0')} ${MONTHS[today.getMonth()]} ${today.getFullYear()}`;

  const sx  = wx * scale + offsetX;
  const sy  = wy * scale + offsetY;
  const sw  = BLOCK_W * scale;
  const sh  = BLOCK_H * scale;
  const pad = 14 * scale;

  const sepFontSz  = Math.max(10, Math.round(14 * scale));
  const itemFontSz = Math.max(10, Math.round(15 * scale));
  const boxSize    = Math.max(10, Math.round(14 * scale));
  const rowH       = boxSize * 2.0;

  // ── Today date ──────────────────────────────────────────────────────────────
  const dateFontSize = Math.max(14, Math.round(22 * scale));
  ctx.font         = `${dateFontSize}px sans-serif`;
  ctx.fillStyle    = '#333333';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  const dateY = sy + sh * 0.07;
  ctx.fillText(dateLabel, sx + sw / 2, dateY);

  // ── TO DO TODAY section ─────────────────────────────────────────────────────
  // dayIndex: 0=Mon … 6=Sun; JS getDay(): 0=Sun … 6=Sat → (jsDay+6)%7
  const todayDayIndex  = (today.getDay() + 6) % 7;
  const todayEvents    = events
    .filter(e => e.dayIndex === todayDayIndex)
    .sort((a, b) => a.startHour - b.startHour);

  let cursorY = dateY + rowH * 0.9;

  if (todayEvents.length > 0) {
    // Separator
    ctx.font      = `bold ${sepFontSz}px sans-serif`;
    ctx.fillStyle = '#555555';
    ctx.textAlign = 'center';
    ctx.fillText('─── TO DO TODAY ───', sx + sw / 2, cursorY);
    cursorY += rowH * 0.85;

    // Event list
    const evFontSz  = Math.max(9, Math.round(13 * scale));
    const bulletX   = sx + pad;
    const textX     = bulletX + 12 * scale;
    const maxEvTextW = sw - textX - pad + sx;

    ctx.font         = `${evFontSz}px sans-serif`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';

    todayEvents.forEach(ev => {
      const hour  = DAY_START_HOUR + ev.startHour;
      const hh    = String(hour).padStart(2, '0');
      const mm    = ev.startHour % 1 !== 0 ? '30' : '00';
      const timeStr = `${hh}:${mm}`;
      const rawText = ev.title && ev.title.trim() ? ev.title.trim() : '(no title)';
      let display   = `${timeStr}  ${rawText}`;

      ctx.font = `${evFontSz}px sans-serif`;
      const avail = sw - pad * 2;
      while (display.length > timeStr.length + 3 && ctx.measureText(display).width > avail) {
        display = display.slice(0, -1);
      }
      if (display.length < `${timeStr}  ${rawText}`.length) display = display.slice(0, -1) + '…';

      // Bullet dot
      ctx.fillStyle = '#4a90d9';
      ctx.beginPath();
      ctx.arc(bulletX + 3 * scale, cursorY, 3 * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#333333';
      ctx.fillText(display, textX, cursorY);
      cursorY += rowH * 0.75;
    });

    cursorY += rowH * 0.2;
  }

  // ── TODO separator ──────────────────────────────────────────────────────────
  const sepY = cursorY;
  ctx.font      = `bold ${sepFontSz}px sans-serif`;
  ctx.fillStyle = '#555555';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('─── TODO ───', sx + sw / 2, sepY);

  // ── Checkboxes ──────────────────────────────────────────────────────────────
  const textOffX = pad + boxSize + 8 * scale;
  const startY   = sepY + rowH * 0.9;
  const maxTextW = sw - textOffX - pad - boxSize;

  todoHitAreas = [];

  ctx.font         = `${itemFontSz}px sans-serif`;
  ctx.textBaseline = 'middle';

  todos.forEach((todo, i) => {
    const rowY  = startY + i * rowH;
    const midY  = rowY + rowH / 2;
    const bx    = sx + pad;
    const by    = midY - boxSize / 2;
    const isEditingThis = todoEditId === todo.id;

    // Checkbox border
    ctx.strokeStyle = todo.checked ? '#4a90d9' : '#888888';
    ctx.lineWidth   = 1.5;
    ctx.fillStyle   = todo.checked ? '#4a90d9' : '#ffffff';
    ctx.beginPath();
    ctx.roundRect(bx, by, boxSize, boxSize, 3);
    ctx.fill();
    ctx.stroke();

    // Checkmark
    if (todo.checked) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = Math.max(1.5, 2 * scale);
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      ctx.moveTo(bx + boxSize * 0.18, by + boxSize * 0.5);
      ctx.lineTo(bx + boxSize * 0.42, by + boxSize * 0.72);
      ctx.lineTo(bx + boxSize * 0.82, by + boxSize * 0.25);
      ctx.stroke();
    }

    const inputX = sx + textOffX;
    const inputW = maxTextW;
    const inputH = rowH * 0.78;
    const inputY = midY - inputH / 2;

    if (isEditingThis) {
      // Inline text input box
      ctx.fillStyle   = '#f0f6ff';
      ctx.strokeStyle = '#4a90d9';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.roundRect(inputX - 4, inputY, inputW + 8, inputH, 4);
      ctx.fill();
      ctx.stroke();

      ctx.font         = `${itemFontSz}px sans-serif`;
      ctx.fillStyle    = '#111111';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      // Draw text clipped to input box
      ctx.save();
      ctx.beginPath();
      ctx.rect(inputX - 2, inputY + 1, inputW + 4, inputH - 2);
      ctx.clip();
      ctx.fillText(todoEditText, inputX, midY);
      // Blinking cursor
      if (todoEditBlinkOn) {
        const cursorX = inputX + ctx.measureText(todoEditText.slice(0, todoEditCursor)).width;
        ctx.strokeStyle = '#333333';
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.moveTo(cursorX, inputY + 3);
        ctx.lineTo(cursorX, inputY + inputH - 3);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      // Label text (strikethrough if checked)
      ctx.fillStyle    = todo.checked ? '#aaaaaa' : '#222222';
      ctx.font         = `${itemFontSz}px sans-serif`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      let displayText  = todo.text || '(no text)';
      while (displayText.length > 1 && ctx.measureText(displayText).width > maxTextW) {
        displayText = displayText.slice(0, -1);
      }
      if (displayText !== todo.text) displayText = displayText.slice(0, -1) + '\u2026';
      ctx.fillText(displayText, inputX, midY);

      if (todo.checked) {
        const tw = ctx.measureText(displayText).width;
        ctx.strokeStyle = '#aaaaaa';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(inputX, midY);
        ctx.lineTo(inputX + tw, midY);
        ctx.stroke();
      }
    }

    // Delete button '×'
    const delFontSz = Math.max(10, Math.round(13 * scale));
    const delX      = sx + sw - pad - delFontSz;
    ctx.font        = `${delFontSz}px sans-serif`;
    ctx.fillStyle   = '#cccccc';
    ctx.textAlign   = 'center';
    ctx.fillText('\u2715', delX, midY);
    ctx.font        = `${itemFontSz}px sans-serif`; // restore

    // Register hit areas
    todoHitAreas.push({ type: 'checkbox', id: todo.id, x: bx, y: by, w: boxSize, h: boxSize });
    todoHitAreas.push({ type: 'text', id: todo.id, x: inputX, y: rowY, w: maxTextW, h: rowH });
    todoHitAreas.push({ type: 'delete', id: todo.id, x: delX - delFontSz, y: rowY, w: delFontSz * 2, h: rowH });
  });

  // ── Add button / new-todo inline input ─────────────────────────────────────
  const addY      = startY + todos.length * rowH + rowH * 0.2;
  const addFontSz = Math.max(10, Math.round(13 * scale));
  const addMidY   = addY + rowH / 2;

  if (todoEditId === 'new') {
    // Inline input for new todo
    const inputX = sx + pad;
    const inputW = sw - pad * 2;
    const inputH = rowH * 0.78;
    const inputY = addMidY - inputH / 2;
    ctx.fillStyle   = '#f0f6ff';
    ctx.strokeStyle = '#4a90d9';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.roundRect(inputX - 4, inputY, inputW + 8, inputH, 4);
    ctx.fill();
    ctx.stroke();
    ctx.font         = `${addFontSz}px sans-serif`;
    ctx.fillStyle    = todoEditText ? '#111111' : '#aaaaaa';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.beginPath();
    ctx.rect(inputX - 2, inputY + 1, inputW + 4, inputH - 2);
    ctx.clip();
    ctx.fillText(todoEditText || 'Type and press Enter…', inputX, addMidY);
    if (todoEditBlinkOn && todoEditText !== undefined) {
      const cursorX = inputX + ctx.measureText(todoEditText.slice(0, todoEditCursor)).width;
      ctx.strokeStyle = '#333333';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(cursorX, inputY + 3);
      ctx.lineTo(cursorX, inputY + inputH - 3);
      ctx.stroke();
    }
    ctx.restore();
    todoHitAreas.push({ type: 'add', id: null, x: inputX, y: addY, w: inputW, h: rowH });
  } else {
    ctx.font         = `${addFontSz}px sans-serif`;
    ctx.fillStyle    = '#4a90d9';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('+ Add item', sx + pad, addMidY);
    todoHitAreas.push({ type: 'add', id: null, x: sx + pad, y: addY, w: 120 * scale, h: rowH });
  }
}

// PR 1: Draw horizontal hour lines and labels inside a day block
function drawTimeGrid(wx, wy) {
  const sx         = wx * scale + offsetX;
  const sy         = wy * scale + offsetY;
  const gridOffY   = BLOCK_INNER_PAD_Y * scale;
  const labelAreaW = HOUR_LABEL_W * scale;
  const lineStartX = sx + labelAreaW;
  const lineEndX   = sx + (BLOCK_W - BLOCK_INNER_PAD) * scale;
  const fontSize   = Math.max(7, Math.round(10 * scale));

  ctx.strokeStyle  = '#dddddd';
  ctx.lineWidth    = 1;
  ctx.font         = `${fontSize}px sans-serif`;
  ctx.fillStyle    = '#777777';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';

  for (let h = 0; h < HOURS_IN_DAY; h++) {
    const lineY  = sy + gridOffY + h * HOUR_UNIT * scale;
    const labelY = lineY + (HOUR_UNIT * scale) / 2;
    const label  = `${String((h + DAY_START_HOUR) % 24).padStart(2, '0')}:00`;

    // Hour separator line (skip h=0, which coincides with the top border)
    if (h > 0) {
      ctx.beginPath();
      ctx.moveTo(lineStartX, lineY);
      ctx.lineTo(lineEndX,   lineY);
      ctx.stroke();
    }

    // Hour label centred vertically within the hour slot
    ctx.fillText(label, sx + BLOCK_INNER_PAD * scale, labelY);
  }
}

// Break `text` into lines that fit within `maxWidth` (canvas pixels).
function wrapText(text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function isOverEventText(ev, sx, sy) {
  const r        = getEventScreenRect(ev);
  const fontSize = Math.max(15, Math.round(15 * scale));
  ctx.font       = `${fontSize}px sans-serif`;
  const text     = ev === editingEvent ? editText : (ev.title || '(no title)');
  const maxW     = r.w - 8;
  const lines    = wrapText(text, maxW);
  const lineH    = fontSize * 1.3;
  const totalH   = lines.length * lineH;
  const textCX   = r.x + r.w / 2;
  const textCY   = r.y + r.h / 2;
  const blockW   = Math.max(...lines.map(l => ctx.measureText(l).width));
  return sx >= textCX - blockW / 2 && sx <= textCX + blockW / 2 &&
         sy >= textCY - totalH / 2 && sy <= textCY + totalH / 2;
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
  ctx.roundRect(r.x, r.y, r.w, Math.max(r.h, 2), 8);
  ctx.fill();
  ctx.stroke();

  // Title (clipped to body) — rendered inline with word-wrap; cursor shown while editing
  const fontSize = Math.max(15, Math.round(15 * scale));
  const lineH    = fontSize * 1.3;
  const maxTextW = r.w - 8;
  ctx.font        = `${fontSize}px sans-serif`;
  ctx.fillStyle   = '#ffffff';
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x + 4, r.y + 4, r.w - 8, r.h - 8);
  ctx.clip();
  const isEditing   = ev === editingEvent;
  const displayText = isEditing ? editText : (ev.title || '(no title)');
  const lines       = wrapText(displayText, maxTextW);
  const totalH      = lines.length * lineH;
  const textCX      = r.x + r.w / 2;
  const firstLineY  = r.y + r.h / 2 - totalH / 2 + lineH / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, textCX, firstLineY + i * lineH);
  });
  // Blinking cursor: find which line+offset the cursor falls on
  if (isEditing && editBlinkOn) {
    let charsLeft = editCursor;
    let cursorLine = 0;
    let cursorOffsetInLine = 0;
    for (let i = 0; i < lines.length; i++) {
      if (charsLeft <= lines[i].length || i === lines.length - 1) {
        cursorLine = i;
        cursorOffsetInLine = charsLeft;
        break;
      }
      // +1 for the space that was consumed during wrapping
      charsLeft -= lines[i].length + 1;
    }
    const lineText  = lines[cursorLine];
    const beforeW   = ctx.measureText(lineText.slice(0, cursorOffsetInLine)).width;
    const lineW     = ctx.measureText(lineText).width;
    const cursorX   = textCX - lineW / 2 + beforeW;
    const cursorY   = firstLineY + cursorLine * lineH;
    ctx.fillRect(cursorX, cursorY - fontSize * 0.6, 1.5, fontSize * 1.2);
  }
  ctx.restore();

  // Resize handle — visual affordance at the bottom
  if (r.h >= 12) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(r.x + r.w * 0.3, r.y + r.h - RESIZE_HANDLE_PX + 2, r.w * 0.4, 3);
  }

  // Duration label — bottom right
  if (r.h >= 20 && r.w >= 30) {
    const totalMins = Math.round(ev.durationHours * 60);
    const hrs       = Math.floor(totalMins / 60);
    const mins      = totalMins % 60;
    const durLabel  = hrs > 0
      ? (mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`)
      : `${mins}m`;
    const durFontSize = Math.max(8, Math.round(10 * scale));
    ctx.font          = `${durFontSize}px sans-serif`;
    ctx.fillStyle     = 'rgba(255,255,255,0.75)';
    ctx.textAlign     = 'right';
    ctx.textBaseline  = 'bottom';
    ctx.fillText(durLabel, r.x + r.w - 6, r.y + r.h - 6);
  }

  // Delete button (✕) — visible on hover or selection
  if (isActive && r.h >= 12 && r.w >= 22) {
    const btnR  = 9;
    const btnCX = r.x + r.w - btnR - 4;
    const btnCY = r.y + btnR + 4;
    // Same blue as the block but darker (higher opacity)
    ctx.fillStyle = isSelected ? 'rgba(29,78,216,0.95)'
                  :               'rgba(37,99,235,0.90)';
    ctx.beginPath();
    ctx.arc(btnCX, btnCY, btnR, 0, Math.PI * 2);
    ctx.fill();
    const btnFontSize = Math.max(9, Math.round(11 * scale));
    ctx.font         = `bold ${btnFontSize}px sans-serif`;
    ctx.fillStyle    = '#ffffff';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', btnCX, btnCY);
  }
}

// ── Canvas-native inline text editing (todos) ───────────────────────────────
let todoEditId     = null;   // null | todo.id | 'new'
let todoEditText   = '';
let todoEditCursor = 0;
let todoEditBlinkOn   = true;
let todoEditBlinkTimer = null;

function startTodoEdit(id, initialText) {
  commitTodoEdit();
  commitEdit();
  todoEditId     = id;
  todoEditText   = initialText;
  todoEditCursor = initialText.length;
  todoEditBlinkOn   = true;
  todoEditBlinkTimer = setInterval(() => { todoEditBlinkOn = !todoEditBlinkOn; draw(); }, 530);
  hiddenInput.value = initialText;
  hiddenInput.focus();
  draw();
}

function commitTodoEdit() {
  if (todoEditId === null) return;
  if (todoEditId === 'new') {
    if (todoEditText.trim()) createTodo(todoEditText.trim());
  } else {
    const t = todos.find(t => t.id === todoEditId);
    if (t) { t.text = todoEditText; saveTodos(); }
  }
  _stopTodoEditing();
}

function cancelTodoEdit() { _stopTodoEditing(); }

function _stopTodoEditing() {
  clearInterval(todoEditBlinkTimer);
  todoEditBlinkTimer = null;
  todoEditId     = null;
  todoEditText   = '';
  todoEditCursor = 0;
  hiddenInput.value = '';
  hiddenInputBlurring = true;
  hiddenInput.blur();
  hiddenInputBlurring = false;
  draw();
}

// ── Canvas-native inline text editing ────────────────────────────────────────
let editingEvent  = null;
let editText      = '';
let editCursor    = 0;
let editBlinkOn   = true;
let editBlinkTimer = null;

function startEditing(ev) {
  commitEdit();
  editingEvent  = ev;
  editText      = ev.title;
  editCursor    = editText.length;
  selectedEvent = ev;
  editBlinkOn   = true;
  editBlinkTimer = setInterval(() => { editBlinkOn = !editBlinkOn; draw(); }, 530);
  hiddenInput.value = ev.title;
  hiddenInput.focus();
  draw();
}

function commitEdit() {
  if (!editingEvent) return;
  const live = events.find(e => e.id === editingEvent.id);
  if (live) { live.title = editText; saveEvents(); }
  _stopEditing();
}

function cancelEdit() {
  _stopEditing();
}

function _stopEditing() {
  clearInterval(editBlinkTimer);
  editBlinkTimer = null;
  editingEvent   = null;
  editText       = '';
  editCursor     = 0;
  hiddenInput.value = '';
  hiddenInputBlurring = true;
  hiddenInput.blur();
  hiddenInputBlurring = false;
  draw();
}

window.addEventListener('keydown', (e) => {
  // ── Todo inline editing ──
  if (todoEditId !== null) {
    e.preventDefault();
    if (e.key === 'Enter' || e.key === 'Escape') { e.key === 'Enter' ? commitTodoEdit() : cancelTodoEdit(); return; }
    if (e.key === 'Backspace')       { if (todoEditCursor > 0) { todoEditText = todoEditText.slice(0, todoEditCursor - 1) + todoEditText.slice(todoEditCursor); todoEditCursor--; } }
    else if (e.key === 'Delete')     { todoEditText = todoEditText.slice(0, todoEditCursor) + todoEditText.slice(todoEditCursor + 1); }
    else if (e.key === 'ArrowLeft')  { todoEditCursor = Math.max(0, todoEditCursor - 1); }
    else if (e.key === 'ArrowRight') { todoEditCursor = Math.min(todoEditText.length, todoEditCursor + 1); }
    else if (e.key === 'Home')       { todoEditCursor = 0; }
    else if (e.key === 'End')        { todoEditCursor = todoEditText.length; }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      todoEditText = todoEditText.slice(0, todoEditCursor) + e.key + todoEditText.slice(todoEditCursor);
      todoEditCursor++;
    }
    todoEditBlinkOn = true;
    draw();
    return;
  }

  // ── Event inline editing ──
  if (!editingEvent) return;
  e.preventDefault();
  if (e.key === 'Enter')       { commitEdit(); return; }
  if (e.key === 'Escape')      { cancelEdit(); return; }
  if (e.key === 'Backspace')   { if (editCursor > 0) { editText = editText.slice(0, editCursor - 1) + editText.slice(editCursor); editCursor--; } }
  else if (e.key === 'Delete') { editText = editText.slice(0, editCursor) + editText.slice(editCursor + 1); }
  else if (e.key === 'ArrowLeft')  { editCursor = Math.max(0, editCursor - 1); }
  else if (e.key === 'ArrowRight') { editCursor = Math.min(editText.length, editCursor + 1); }
  else if (e.key === 'Home')   { editCursor = 0; }
  else if (e.key === 'End')    { editCursor = editText.length; }
  else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    editText = editText.slice(0, editCursor) + e.key + editText.slice(editCursor);
    editCursor++;
  }
  editBlinkOn = true;
  draw();
});

// ── Mouse events ──────────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  commitEdit();
  commitTodoEdit();

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

  // Hit-test events → edit text, drag, or resize
  const hit = hitTestEvents(sx, sy);
  if (hit) {
    // Single click on the text area → enter edit mode immediately
    if (!hit.isResizeHandle && isOverEventText(hit.event, sx, sy)) {
      startEditing(hit.event);
      return;
    }
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
      dragOffsetHour      = (w.y - block.wy - BLOCK_INNER_PAD_Y) / HOUR_UNIT - hit.event.startHour;
      canvas.style.cursor = 'move';
    }
    draw();
    return;
  }

  // Hit-test todo areas
  const todoHit = todoHitAreas.find(a => sx >= a.x && sx <= a.x + a.w && sy >= a.y && sy <= a.y + a.h);
  if (todoHit) {
    if (todoHit.type === 'checkbox') {
      const t = todos.find(t => t.id === todoHit.id);
      if (t) { t.checked = !t.checked; saveTodos(); draw(); }
      return;
    }
    if (todoHit.type === 'delete') {
      deleteTodo(todoHit.id);
      draw();
      return;
    }
    if (todoHit.type === 'add') {
      startTodoEdit('new', '');
      return;
    }
    if (todoHit.type === 'text') {
      startTodoEdit(todoHit.id, todos.find(t => t.id === todoHit.id)?.text ?? '');
      return;
    }
  }

  // Pan
  selectedEvent       = null;
  interactionMode     = 'pan';
  isPanning           = true;
  lastMouseX          = sx;
  lastMouseY          = sy;
  canvas.style.cursor = 'grab';
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
    // Determine target day block from world X and Y so that row 0 and row 1
    // blocks with overlapping X ranges resolve correctly.
    const targetBlock = DAY_BLOCKS.find(b =>
      w.x >= b.wx && w.x <= b.wx + BLOCK_W &&
      w.y >= b.wy && w.y <= b.wy + BLOCK_H
    ) || null;
    if (targetBlock) {
      activeEvent.dayIndex = targetBlock.index;
      const raw      = (w.y - targetBlock.wy - BLOCK_INNER_PAD_Y) / HOUR_UNIT - dragOffsetHour;
      const snapped  = Math.round(raw * 2) / 2;
      const maxStart = HOURS_IN_DAY - activeEvent.durationHours;
      activeEvent.startHour = Math.max(0, Math.min(snapped, maxStart));
    }
    draw();
    return;
  }

  if (interactionMode === 'resize' && activeEvent) {
    const dy      = sy - resizeOrigY;
    const rawHrs  = resizeOrigHours + (dy / scale) / HOUR_UNIT;
    const snapped = Math.round(rawHrs * 2) / 2;
    const maxHrs  = HOURS_IN_DAY - activeEvent.startHour;
    activeEvent.durationHours = Math.max(0.5, Math.min(snapped, maxHrs));
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
    if (hitTestDeleteButton(sx, sy)) {
      canvas.style.cursor = 'default';
    } else if (hit.isResizeHandle) {
      canvas.style.cursor = 'ns-resize';
    } else if (isOverEventText(hit.event, sx, sy)) {
      canvas.style.cursor = 'text';
    } else {
      canvas.style.cursor = 'move';
    }
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

  // Double-click on todo text → already handled by single-click; just ignore here
  const todoHitDbl = todoHitAreas.find(a => a.type === 'text' && sx >= a.x && sx <= a.x + a.w && sy >= a.y && sy <= a.y + a.h);
  if (todoHitDbl) return;

  // Double-click on existing event → edit title inline
  const hit = hitTestEvents(sx, sy);
  if (hit && !hit.isResizeHandle) {
    startEditing(hit.event);
    return;
  }

  // Double-click inside a day block → create a new 1-hour event and edit it
  const block = hitTestDayBlock(sx, sy);
  if (block) {
    const w    = screenToWorld(sx, sy);
    const raw  = (w.y - block.wy - BLOCK_INNER_PAD_Y) / HOUR_UNIT;
    const hour = Math.max(0, Math.min(Math.round(raw * 2) / 2, HOURS_IN_DAY - 0.5));
    const ev   = createEvent(block.index, hour);
    startEditing(ev);
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

// ── Touch: pan + pinch-zoom + tap + double-tap ────────────────────────────────
let lastTouchDist = null;
let lastTouchMidX = 0;
let lastTouchMidY = 0;

// Tap / double-tap tracking
let lastTapTime = 0;
let lastTapX    = 0;
let lastTapY    = 0;
let touchStartX = 0;
let touchStartY = 0;
let touchMoved  = false;
const TAP_MAX_MOVE   = 10;  // px
const DOUBLE_TAP_GAP = 300; // ms

function handleSingleTap(sx, sy) {
  // Mirrors mousedown logic for todo hit areas and delete/checkbox
  commitEdit();
  commitTodoEdit();

  const delEv = hitTestDeleteButton(sx, sy);
  if (delEv) {
    if (selectedEvent === delEv) selectedEvent = null;
    if (hoveredEvent  === delEv) hoveredEvent  = null;
    deleteEvent(delEv.id);
    draw();
    return;
  }

  const todoHit = todoHitAreas.find(a => sx >= a.x && sx <= a.x + a.w && sy >= a.y && sy <= a.y + a.h);
  if (todoHit) {
    if (todoHit.type === 'checkbox') {
      const t = todos.find(t => t.id === todoHit.id);
      if (t) { t.checked = !t.checked; saveTodos(); draw(); }
    } else if (todoHit.type === 'delete') {
      deleteTodo(todoHit.id);
      draw();
    } else if (todoHit.type === 'add') {
      startTodoEdit('new', '');
    } else if (todoHit.type === 'text') {
      startTodoEdit(todoHit.id, todos.find(t => t.id === todoHit.id)?.text ?? '');
    }
    return;
  }
}

function handleDoubleTap(sx, sy) {
  commitEdit();
  commitTodoEdit();

  const hit = hitTestEvents(sx, sy);
  if (hit && !hit.isResizeHandle) {
    startEditing(hit.event);
    return;
  }

  const block = hitTestDayBlock(sx, sy);
  if (block) {
    const w    = screenToWorld(sx, sy);
    const raw  = (w.y - block.wy - BLOCK_INNER_PAD_Y) / HOUR_UNIT;
    const hour = Math.max(0, Math.min(Math.round(raw * 2) / 2, HOURS_IN_DAY - 0.5));
    const ev   = createEvent(block.index, hour);
    startEditing(ev);
  }
}

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
    touchStartX   = e.touches[0].clientX;
    touchStartY   = e.touches[0].clientY;
    lastMouseX    = touchStartX;
    lastMouseY    = touchStartY;
    touchMoved    = false;
    lastTouchDist = null;
  } else if (e.touches.length === 2) {
    isPanning     = false;
    touchMoved    = true; // suppress tap if pinch started
    lastTouchDist = getTouchDist(e.touches);
    const mid     = getTouchMid(e.touches);
    lastTouchMidX = mid.x;
    lastTouchMidY = mid.y;
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length === 1 && isPanning) {
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.sqrt(dx * dx + dy * dy) > TAP_MAX_MOVE) touchMoved = true;
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

  if (e.touches.length === 0) {
    isPanning = false;

    if (!touchMoved) {
      const sx  = e.changedTouches[0].clientX;
      const sy  = e.changedTouches[0].clientY;
      const now = Date.now();
      const dt  = now - lastTapTime;
      const tapDist = Math.sqrt((sx - lastTapX) ** 2 + (sy - lastTapY) ** 2);

      if (dt < DOUBLE_TAP_GAP && tapDist < TAP_MAX_MOVE * 2) {
        // Double-tap
        lastTapTime = 0;
        handleDoubleTap(sx, sy);
      } else {
        // Single tap — fire immediately, also arm double-tap timer
        lastTapTime = now;
        lastTapX    = sx;
        lastTapY    = sy;
        handleSingleTap(sx, sy);
      }
    }
  }
}, { passive: false });

// ── Init ───────────────────────────────────────────────────────────────────────
window.addEventListener('resize', resize);
resize();
