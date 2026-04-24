# Planner v2

A static, zero-dependency week planner that runs directly in the browser — no build step, no backend.

## What it is

A canvas-based week view with a dotted background grid and day blocks (Monday–Sunday).
The current version provides:

- **Pan** — click and drag (or single-finger touch) to pan the canvas.
- **Zoom** — scroll wheel (or two-finger pinch) to zoom in/out.
- Seven day blocks arranged in two rows (Mon–Thu / Fri–Sun), each block representing one day.

The grid unit (`GRID_SPACING = 30 world px`) is designed to equal **1 hour**, ready for the time-grid and event features coming in follow-up PRs.

## File structure

```
index.html   ← shell: loads style.css and planner.js
style.css    ← all styles (reset, body, canvas cursor)
planner.js   ← all canvas logic (state, draw, pan, zoom, touch)
```

## Running locally

**Option A — open directly**

Just open `index.html` in any modern browser:

```bash
open index.html          # macOS
start index.html         # Windows
xdg-open index.html      # Linux
```

**Option B — simple HTTP server** (recommended to avoid any browser restrictions)

```bash
# Python 3
python3 -m http.server 8080
# then visit http://localhost:8080

# Node.js (npx, no install)
npx serve .
```

## Deploying on GitHub Pages

1. Go to **Settings → Pages** in the repository.
2. Under *Source*, select the branch (`main`) and root folder (`/`).
3. Save — GitHub Pages will publish the site at `https://<username>.github.io/<repo>/`.

No build step is required; all paths are relative.

## Next steps / planned PRs

### PR 1 — Time grid (1 unit = 1 hour)
- Rename / clarify `GRID_SPACING` as the hour unit.
- Expand each day block height to cover the desired time range (e.g. 24 h → `BLOCK_H = 24 * GRID_SPACING`).
- Draw horizontal hour lines inside each block and render hour labels (e.g. `08:00`) on the left edge.

### PR 2 — Event data model + rendering
- Define the event shape: `{ id, dayIndex, startHour, durationHours, title }`.
- Render events as filled rectangles on top of the day block, sized by `durationHours * GRID_SPACING`.
- Add a small resize handle at the bottom of each event rectangle.
- Persist events to `localStorage` (load on startup, save on every change).

### PR 3 — Interactions: hit-testing, drag, resize
- Implement `screenToWorld(px, py)` helper.
- Replace the "always pan on mousedown" logic with an interaction-mode state machine: `pan | drag | resize`.
- **Drag**: on pointer-down on an event body, track pointer offset; on move update `dayIndex` and `startHour` (snapped to `GRID_SPACING`); finalize on pointer-up.
- **Resize**: on pointer-down on the resize handle, track origin; on move update `durationHours` (snapped, min 1 h, clamped to end of day); finalize on pointer-up.
- Clamp events so they never exceed day boundaries.

### PR 4 — Event creation UX, title editing, delete
- **Double-click** inside a day block → create a 1-hour event at the clicked hour.
- Show a lightweight in-canvas or HTML overlay input to set / edit the event title.
- Add a delete affordance (e.g. small ✕ button visible on hover / selection).

### PR 5 — Persistence: localStorage, import / export
- Auto-save to `localStorage` on every mutation (already wired in PR 2, extended here).
- Add **Export JSON** button → `Blob` download.
- Add **Import JSON** button → file picker, validate schema, merge or replace.

### PR 6 — Polish: touch events, overlap handling, accessibility
- Unify mouse and touch handling via the Pointer Events API (`pointerdown/move/up`).
- Detect and visually indicate overlapping events within the same day (offset or colour shift).
- Add basic keyboard accessibility: tab to select events, arrow keys to move, Delete to remove.
- Add ARIA labels to the canvas fallback content for screen readers.

