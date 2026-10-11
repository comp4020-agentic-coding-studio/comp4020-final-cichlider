import { VOID, drawFloor, drawRim, drawStroke } from "./render.js";

const $ = (s) => document.querySelector(s);
const canvas = $("#wall");
const ctx = canvas.getContext("2d");
const base = document.createElement("canvas"); // committed paint, redrawn only when it or the view changes
const bctx = base.getContext("2d");

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: fine */ } },
};

// ---------------------------------------------------------------- state

const cam = { x: 0, y: 0, z: 1 }; // arena point at screen centre; screen px per arena unit
let fitted = true; // follow the window size until someone zooms or pans
let W = 0, H = 0, dpr = 1;
const strokes = new Map(); // id -> stroke, this round only
let order = [];
let orderDirty = true;
const names = new Map(); // painter id -> tag
const live = new Map(); // painter id -> { name, team, cursor, partial, at }
let me = null;
let game = null; // what /api/round says: arena, teams, ink, the round's clock
let skew = 0; // server clock minus ours
let cells = [0, 0];
const pendingBySeed = new Map(); // optimistic strokes awaiting their id
const tank = { ink: 0, at: 0 };

let baseDirty = true, dirty = true;
const redraw = (all = true) => { dirty = true; if (all) baseDirty = true; };
const serverNow = () => Date.now() + skew;
const colorOf = (team) => game?.teams[team]?.color ?? "#888";

// ---------------------------------------------------------------- coordinates

const toArena = (sx, sy) => [cam.x + (sx - W / 2) / cam.z, cam.y + (sy - H / 2) / cam.z];
const clampToArena = ([x, y]) => {
  const a = game.arena;
  return [Math.max(a.x0, Math.min(a.x1, x)), Math.max(a.y0, Math.min(a.y1, y))];
};

function fit() {
  if (!game) return;
  const a = game.arena;
  // room for the score across the top and your tank along the bottom
  const z = Math.min(W / (a.x1 - a.x0 + 120), (H - 150) / (a.y1 - a.y0 + 60));
  Object.assign(cam, { x: (a.x0 + a.x1) / 2, y: (a.y0 + a.y1) / 2 + 10 / z, z });
  fitted = true;
  redraw();
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  for (const c of [canvas, base]) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
  }
  if (fitted) fit();
  redraw();
}

// ---------------------------------------------------------------- drawing the arena

function setView(c) {
  c.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * (W / 2 - cam.x * cam.z), dpr * (H / 2 - cam.y * cam.z));
}

function clipArena(c) {
  const a = game.arena;
  c.beginPath();
  c.rect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
  c.clip();
}

function drawBase() {
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.fillStyle = VOID;
  bctx.fillRect(0, 0, base.width, base.height);
  if (!game) return;
  setView(bctx);
  drawFloor(bctx, game.arena, game.cell, cam.z);
  if (orderDirty) {
    order = [...strokes.values()].sort((a, b) => a.id - b.id);
    orderDirty = false;
  }
  bctx.save();
  clipArena(bctx);
  for (const s of order) drawStroke(bctx, s, colorOf(s.team), game.roller);
  bctx.restore();
  drawRim(bctx, game.arena, cam.z);
}

function render() {
  if (baseDirty) {
    drawBase();
    baseDirty = false;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(base, 0, 0);
  if (!game) return;
  setView(ctx);
  ctx.save();
  clipArena(ctx);
  const now = Date.now();
  for (const [id, l] of live) {
    if (now - l.at > 6000) { live.delete(id); continue; }
    if (l.partial) drawStroke(ctx, l.partial, colorOf(l.team), game.roller);
  }
  if (drawing) drawStroke(ctx, drawing, colorOf(me.team), game.roller);
  ctx.restore();

  // cursors and tags, in screen space so they stay readable at any zoom
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = "700 12px ui-sans-serif, system-ui, sans-serif";
  for (const [id, l] of live) {
    if (!l.cursor || (me && id === me.id)) continue;
    const sx = (l.cursor[0] - cam.x) * cam.z + W / 2, sy = (l.cursor[1] - cam.y) * cam.z + H / 2;
    if (sx < -50 || sy < -50 || sx > W + 50 || sy > H + 50) continue;
    ctx.globalAlpha = Math.max(0.2, 1 - (now - l.at) / 6000);
    const r = Math.max(5, (game.roller / 2) * cam.z);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#0e0a1c";
    ctx.fillStyle = colorOf(l.team);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    const label = l.name || "?";
    const w = ctx.measureText(label).width + 12;
    ctx.fillRect(sx + r + 4, sy - 10, w, 20);
    ctx.strokeRect(sx + r + 4, sy - 10, w, 20);
    ctx.fillStyle = "#0e0a1c";
    ctx.fillText(label, sx + r + 10, sy + 4);
  }
  ctx.globalAlpha = 1;
}

function frame() {
  if (dirty) {
    dirty = false;
    render();
  }
  if (live.size) dirty = true; // keep fading cursors moving
  hud();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- the HUD

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const pct = (n) => (game ? (100 * n) / game.total : 0);

let hudKey = "";
function hud() {
  if (!game) return;
  const now = serverNow();
  const ink = inkNow();
  const clock = game.round ? fmt(game.round.endsAt - now) : "—";
  const late = game.round && game.round.endsAt - now < 10_000;
  const key = `${cells}|${clock}|${Math.round(ink)}|${game.nextAt ? fmt(game.nextAt - now) : ""}`;
  if (key === hudKey) return;
  hudKey = key;

  for (const t of [0, 1]) {
    $(`#pct${t}`).textContent = `${pct(cells[t]).toFixed(1)}%`;
    $(`#bar${t}`).style.width = `${pct(cells[t])}%`;
  }
  $("#clock").textContent = clock;
  $("#clock").classList.toggle("late", Boolean(late));
  if (me) {
    $("#ink").style.height = `${(100 * ink) / game.ink.max}%`;
    $("#inkWrap").classList.toggle("low", ink < game.ink.max * 0.15);
  }
  if (game.nextAt && !game.round) $("#resultNext").textContent = `next round in ${fmt(game.nextAt - now)}`;
}

function applyTeams() {
  const root = document.documentElement.style;
  for (const t of [0, 1]) {
    root.setProperty(`--team-${t}`, game.teams[t].color);
    $(`#name${t}`).textContent = game.teams[t].name;
  }
  if (me) {
    root.setProperty("--mine", colorOf(me.team));
    $("#teamTag").textContent = `Team ${game.teams[me.team].name}`;
    $("#welcomeTeam").innerHTML = "";
    const b = document.createElement("b");
    b.textContent = `Team ${game.teams[me.team].name}`;
    b.style.color = colorOf(me.team);
    $("#welcomeTeam").append("You're on ", b, ".");
  }
}

function showResult(r) {
  if (!r) return;
  const [a, b] = r.cells.map((n) => (100 * n) / r.total);
  const title = $("#resultTitle");
  if (r.winner === null) {
    title.textContent = "Dead heat!";
    title.style.color = "";
  } else {
    title.textContent = `${game.teams[r.winner].name} wins!`;
    title.style.color = colorOf(r.winner);
  }
  $("#resultScore").textContent = `${a.toFixed(1)}% – ${b.toFixed(1)}%`;
  $("#result").hidden = false;
}

// ---------------------------------------------------------------- ink

function inkNow() {
  if (!game) return 0;
  const now = Date.now();
  if (!drawing) tank.ink = Math.min(game.ink.max, tank.ink + ((now - tank.at) / 1000) * game.ink.rate);
  tank.at = now;
  return tank.ink;
}

// ---------------------------------------------------------------- talking to the server

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...(me ? { authorization: `Bearer ${me.secret}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
  return data;
}

function addStroke(s) {
  if (strokes.has(s.id)) return;
  strokes.set(s.id, s);
  orderDirty = true;
}

async function loadRound() {
  const t0 = Date.now();
  const g = await api("GET", "/api/round");
  skew = g.now - Math.round((t0 + Date.now()) / 2);
  const first = !game;
  game = g;
  cells = g.cells;
  if (first) { tank.ink = g.ink.max; tank.at = Date.now(); }
  applyTeams();
  if (first || fitted) fit();
  if (g.round) $("#result").hidden = true;
  else showResult(g.lastResult);
  const data = await api("GET", "/api/strokes");
  strokes.clear();
  for (const [id, n] of Object.entries(data.names)) names.set(id, n);
  for (const s of data.strokes) addStroke(s);
  orderDirty = true;
  redraw();
}

function connect() {
  let first = true;
  const es = new EventSource("/api/events");
  es.onopen = () => {
    if (!first) loadRound().catch(() => {}); // catch up on whatever we missed
    first = false;
  };
  es.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "stroke") {
      if (game?.round && m.stroke) {
        names.set(m.stroke.author, m.name);
        settle(m.stroke);
        cells = m.cells;
        const l = live.get(m.stroke.author);
        if (l) l.partial = null;
        redraw();
      }
    } else if (m.type === "round-start") {
      game.round = m.round;
      game.nextAt = null;
      strokes.clear();
      pendingBySeed.clear();
      orderDirty = true;
      cells = [0, 0];
      $("#result").hidden = true;
      toast("go! roll your colour everywhere");
      redraw();
    } else if (m.type === "round-end") {
      game.round = null;
      game.nextAt = m.nextAt;
      cells = m.result.cells;
      if (drawing) { drawing = null; sendLive({ done: true }); }
      showResult(m.result);
      redraw();
    } else if (m.type === "name") {
      names.set(m.id, m.name);
      if (live.has(m.id)) live.get(m.id).name = m.name;
      redraw(false);
    } else if (m.type === "live") {
      if (me && m.id === me.id) return;
      const l = live.get(m.id) ?? {};
      live.set(m.id, {
        name: m.name,
        team: m.team,
        cursor: m.cursor ?? l.cursor,
        partial: m.done ? null : m.partial ?? l.partial,
        at: Date.now(),
      });
      names.set(m.id, m.name);
      redraw(false);
    } else if (m.type === "presence") {
      $("#online").textContent = `${m.count} here`;
    }
  };
}

// A stroke of mine shows up twice, from the POST and from the stream; whichever
// is first replaces the optimistic copy.
function settle(s) {
  const temp = pendingBySeed.get(s.seed);
  if (temp !== undefined && s.author === me?.id) {
    strokes.delete(temp);
    pendingBySeed.delete(s.seed);
    orderDirty = true;
  }
  addStroke(s);
}

// ---------------------------------------------------------------- rolling

let drawing = null;
let tempId = -1;
let lastLive = 0;

function startStroke(sx, sy) {
  if (!game.round) return toast("round's over — the next one starts soon");
  if (inkNow() < game.roller) return toast("out of ink — lift off and let it refill");
  const [x, y] = clampToArena(toArena(sx, sy));
  drawing = { id: tempId--, author: me.id, team: me.team, tool: "roller", seed: (Math.random() * 0xffffffff) >>> 0, points: [x, y] };
  redraw(false);
}

function extendStroke(sx, sy) {
  const [x, y] = clampToArena(toArena(sx, sy));
  const p = drawing.points;
  const d = Math.hypot(x - p[p.length - 2], y - p[p.length - 1]);
  if (d < 4) return;
  if (p.length / 2 >= 4000) return endStroke();
  inkNow();
  if (tank.ink < d) {
    endStroke();
    return toast("out of ink — lift off and let it refill");
  }
  tank.ink -= d;
  p.push(x, y);
  redraw(false);
  const now = Date.now();
  if (now - lastLive > 80) {
    lastLive = now;
    sendLive({ cursor: [x, y], partial: liveCopy(drawing) });
  }
}

// What others see of a stroke in progress: its tail, if it's grown long.
function liveCopy(s) {
  const points = s.points.length > 1600 ? s.points.slice(-1600) : s.points;
  return { tool: "roller", seed: s.seed, points: points.map((n) => Math.round(n * 10) / 10) };
}

async function endStroke() {
  if (!drawing) return;
  const s = drawing;
  drawing = null;
  tank.at = Date.now();
  addStroke(s);
  pendingBySeed.set(s.seed, s.id);
  redraw();
  sendLive({ done: true });
  try {
    const saved = await api("POST", "/api/strokes", { tool: "roller", seed: s.seed, points: s.points.map((n) => Math.round(n * 10) / 10) });
    if (saved.roundId === game.round?.id) {
      settle(saved);
      cells = saved.cells;
    }
    tank.ink = Math.min(tank.ink, saved.ink); // the server's tank is the real one
    redraw();
  } catch (e) {
    strokes.delete(s.id);
    pendingBySeed.delete(s.seed);
    orderDirty = true;
    redraw();
    if (e.data && typeof e.data.ink === "number") tank.ink = e.data.ink;
    toast(e.status === 429 ? "whoa — slow down a second" : e.message);
  }
}

let liveQueued = null, liveInFlight = false;
function sendLive(body) {
  if (!me) return;
  liveQueued = body;
  if (liveInFlight) return;
  liveInFlight = true;
  const next = liveQueued;
  liveQueued = null;
  api("POST", "/api/live", next).catch(() => {}).finally(() => {
    liveInFlight = false;
    if (liveQueued) sendLive(liveQueued);
  });
}

// ---------------------------------------------------------------- moving around

function zoomAt(sx, sy, factor) {
  const [wx, wy] = toArena(sx, sy);
  cam.z = Math.max(0.05, Math.min(4, cam.z * factor));
  cam.x = wx - (sx - W / 2) / cam.z;
  cam.y = wy - (sy - H / 2) / cam.z;
  fitted = false;
  redraw();
}

// ---------------------------------------------------------------- pointer input

const pointers = new Map();
let mode = null; // "paint" | "pan" | "pinch"
let panFrom = null, pinchFrom = null, spaceDown = false;

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    if (drawing) { drawing = null; sendLive({ done: true }); redraw(false); } // second finger: a gesture, not paint
    const [a, b] = [...pointers.values()];
    mode = "pinch";
    pinchFrom = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    return;
  }
  if (pointers.size > 2) return;
  if (e.button === 1 || e.button === 2 || spaceDown) {
    mode = "pan";
    panFrom = { x: e.clientX, y: e.clientY };
    canvas.classList.add("panning");
  } else if (e.button === 0) {
    if (!me || !game) return toast("still finding you a team — one moment");
    mode = "paint";
    startStroke(e.clientX, e.clientY);
  }
});

canvas.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (p) { p.x = e.clientX; p.y = e.clientY; }
  if (mode === "pinch" && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    cam.x -= (mx - pinchFrom.mx) / cam.z;
    cam.y -= (my - pinchFrom.my) / cam.z;
    zoomAt(mx, my, d / pinchFrom.d);
    pinchFrom = { d, mx, my };
  } else if (mode === "pan") {
    cam.x -= (e.clientX - panFrom.x) / cam.z;
    cam.y -= (e.clientY - panFrom.y) / cam.z;
    panFrom = { x: e.clientX, y: e.clientY };
    fitted = false;
    redraw();
  } else if (mode === "paint" && drawing) {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const c of evs.length ? evs : [e]) {
      if (!drawing) break;
      extendStroke(c.clientX, c.clientY);
    }
  } else if (!mode && game) {
    const now = Date.now();
    if (now - lastLive > 120) {
      lastLive = now;
      sendLive({ cursor: toArena(e.clientX, e.clientY) });
    }
  }
});

function pointerEnd(e) {
  pointers.delete(e.pointerId);
  if (mode === "paint") endStroke();
  if (pointers.size === 0) {
    mode = null;
    canvas.classList.remove("panning");
  } else if (mode === "pinch" && pointers.size === 1) {
    mode = "pan";
    const [p] = [...pointers.values()];
    panFrom = { x: p.x, y: p.y };
  }
}
canvas.addEventListener("pointerup", pointerEnd);
canvas.addEventListener("pointercancel", pointerEnd);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
  } else {
    const k = e.deltaMode === 1 ? 20 : 1;
    cam.x += (e.deltaX * k) / cam.z;
    cam.y += (e.deltaY * k) / cam.z;
    fitted = false;
    redraw();
  }
}, { passive: false });

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === "Space") { e.preventDefault(); if (!spaceDown) { spaceDown = true; canvas.classList.add("pan"); } return; }
  if (e.key === "+" || e.key === "=") return zoomAt(W / 2, H / 2, 1.25);
  if (e.key === "-") return zoomAt(W / 2, H / 2, 0.8);
  if (e.key === "0" || e.key === "f") return fit();
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") { spaceDown = false; canvas.classList.remove("pan"); }
});

$("#zoomIn").onclick = () => zoomAt(W / 2, H / 2, 1.25);
$("#zoomOut").onclick = () => zoomAt(W / 2, H / 2, 0.8);
$("#fit").onclick = fit;

$("#name").addEventListener("change", async (e) => {
  try {
    const r = await api("PATCH", "/api/me", { name: e.target.value });
    me.name = r.name;
    names.set(me.id, r.name);
    toast(`you're now “${r.name}”`);
  } catch (err) {
    e.target.value = me.name;
    toast(err.message);
  }
});

let toastTimer = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------------------------------------------------------- start

async function start() {
  resize();
  window.addEventListener("resize", resize);
  requestAnimationFrame(frame);
  connect();
  try {
    me = await api("POST", "/api/session", { secret: store.get("wall.secret", null) });
    store.set("wall.secret", me.secret);
    names.set(me.id, me.name);
    $("#name").value = me.name;
  } catch (e) {
    toast(`couldn't get you a team: ${e.message}`);
  }
  try {
    await loadRound();
  } catch (e) {
    toast(`couldn't load the arena: ${e.message}`);
  }
  if (!store.get("turf.welcomed", false)) {
    $("#welcome").hidden = false;
    $("#start").onclick = () => { $("#welcome").hidden = true; store.set("turf.welcomed", true); };
  }
}

start();
