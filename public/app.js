import { PALETTES } from "./palettes.js";
import { FLOOR, drawRoller, drawSlab, drawTag, drawTiles, makeView, paintFloor } from "./render.js";

const $ = (s) => document.querySelector(s);
const canvas = $("#wall");
const ctx = canvas.getContext("2d");
const floorCanvas = document.createElement("canvas"); // one pixel per cell
const fctx = floorCanvas.getContext("2d");
let floorImg = null;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: fine */ } },
};

// ---------------------------------------------------------------- state

let W = 0, H = 0, dpr = 1;
const cam = { x: 0, y: 0, z: 0.5 }; // arena point at screen centre, and zoom
let zoomFactor = store.get("turf.zoom", 1);
let me = null;
let game = null; // the fixed facts from /api/state: arena, cell size, roller width, fade time
let cells = null; // owner per cell: 0 bare, 1 team 0, 2 team 1
let painted = null; // game-clock ms each cell was last painted
let gameNow = 0;
let score = [0, 0];
let floorDirty = true;
const rollers = new Map(); // id -> { team, npc, name, move, x, y, h (shown), tx, ty, th (latest from server) }
let palette = PALETTES.find((p) => p.id === store.get("turf.palette", "default")) ?? PALETTES[0];

const colorOf = (team) => palette.teams[team].color;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------- drawing

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
}

// Close enough to see the roller and what's around it; phones get a bit
// further out so there's room to plan a route.
const baseZoom = () => Math.max(0.4, Math.min(1, Math.max(W, H) / 1250));

function render(dt) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--void").trim() || "#120e24";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!game) return;

  // ease every roller toward where the server last put it
  const ease = Math.min(1, dt * 12);
  for (const r of rollers.values()) {
    r.x += (r.tx - r.x) * ease;
    r.y += (r.ty - r.y) * ease;
    r.h = wrap(r.h + wrap(r.th - r.h) * ease);
  }

  // the camera follows you
  const mine = me && rollers.get(me.id);
  const fx = mine ? mine.x : 0, fy = mine ? mine.y : 0;
  cam.x += (fx - cam.x) * Math.min(1, dt * 5);
  cam.y += (fy - cam.y) * Math.min(1, dt * 5);
  cam.z = baseZoom() * zoomFactor;
  const v = makeView(cam, W, H);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const a = game.arena;
  drawSlab(ctx, v, a, palette.teams[1].color);

  if (floorDirty) {
    paintFloor(floorImg, cells, painted, gameNow, game.fadeMs, palette.teams.map((t) => t.color));
    fctx.putImageData(floorImg, 0, 0);
    floorDirty = false;
  }
  ctx.setTransform(...v.plane(dpr));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(floorCanvas, a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
  drawTiles(ctx, a, game.cell * 5, v.k);

  // rollers, back to front
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const list = [...rollers.entries()].sort(([, p], [, q]) => p.x + p.y - (q.x + q.y));
  for (const [id, r] of list) drawRoller(ctx, v, r, colorOf(r.team), game.roller, me && id === me.id);
  for (const [id, r] of list) {
    const isMe = me && id === me.id;
    drawTag(ctx, v, r, isMe ? `${r.name} (you)` : r.npc ? `🤖 ${r.name}` : r.name, isMe ? "#ffffff" : colorOf(r.team), isMe);
  }
}

let last = performance.now();
function frame(t) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  render(dt);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- the HUD

function hud() {
  if (!game) return;
  for (const t of [0, 1]) {
    const pct = (100 * score[t]) / game.total;
    $(`#pct${t}`).textContent = `${pct.toFixed(1)}%`;
    $(`#bar${t}`).style.width = `${pct}%`;
    $(`#name${t}`).textContent = palette.teams[t].name;
  }
  let humans = 0, npcs = 0;
  for (const r of rollers.values()) r.npc ? npcs++ : humans++;
  $("#online").textContent = `${humans} ${humans === 1 ? "player" : "players"}${npcs ? ` · ${npcs} bots` : ""}`;
}

function applyPalette() {
  const root = document.documentElement.style;
  root.setProperty("--team-0", palette.teams[0].color);
  root.setProperty("--team-1", palette.teams[1].color);
  root.setProperty("--light", palette.teams[0].color);
  root.setProperty("--dark", palette.teams[1].color);
  if (me) {
    root.setProperty("--mine", colorOf(me.team));
    $("#teamTag").textContent = `Team ${palette.teams[me.team].name}`;
    const b = document.createElement("b");
    b.textContent = `Team ${palette.teams[me.team].name}`;
    b.style.color = colorOf(me.team);
    $("#welcomeTeam").replaceChildren("You're on ", b, ".");
  }
  for (const sw of document.querySelectorAll(".pal")) sw.classList.toggle("on", sw.dataset.id === palette.id);
  floorDirty = true;
  hud();
}

for (const p of PALETTES) {
  const b = document.createElement("button");
  b.className = "pal";
  b.dataset.id = p.id;
  b.title = `${p.teams[0].name} / ${p.teams[1].name}`;
  b.setAttribute("aria-label", `${p.teams[0].name} and ${p.teams[1].name} colours`);
  b.style.background = `linear-gradient(135deg, ${p.teams[0].color} 50%, ${p.teams[1].color} 50%)`;
  b.onclick = () => {
    palette = p;
    store.set("turf.palette", p.id);
    applyPalette();
  };
  $("#palettes").append(b);
}

// ---------------------------------------------------------------- talking to the server

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...(me ? { authorization: `Bearer ${me.secret}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

function applyRollers(list, snap) {
  const seen = new Set();
  for (const [id, team, x, y, h, move, npc, name] of list) {
    seen.add(id);
    const r = rollers.get(id);
    if (!r || snap) rollers.set(id, { team, npc: npc === 1, name, move, x, y, h, tx: x, ty: y, th: h });
    else Object.assign(r, { team, npc: npc === 1, name, move, tx: x, ty: y, th: h });
  }
  for (const id of rollers.keys()) if (!seen.has(id)) rollers.delete(id);
}

async function loadState() {
  const s = await api("GET", "/api/state");
  game = s;
  cells = new Uint8Array(s.cols * s.rows);
  painted = new Float64Array(s.cols * s.rows);
  for (let i = 0; i < s.cells.length; i += 3) {
    cells[s.cells[i]] = s.cells[i + 1];
    painted[s.cells[i]] = s.t - s.cells[i + 2];
  }
  floorCanvas.width = s.cols;
  floorCanvas.height = s.rows;
  floorImg = fctx.createImageData(s.cols, s.rows);
  gameNow = s.t;
  score = s.s;
  applyRollers(s.rollers, true);
  const mine = me && rollers.get(me.id);
  if (mine) { cam.x = mine.x; cam.y = mine.y; }
  floorDirty = true;
  hud();
}

let lastFloorPaint = 0;
function connect() {
  let first = true;
  const es = new EventSource("/api/events");
  es.onopen = () => {
    if (!first) loadState().catch(() => {}); // catch up on whatever we missed
    first = false;
  };
  es.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type !== "tick" || !game) return;
    gameNow = m.t;
    for (let i = 0; i < m.c.length; i += 2) {
      cells[m.c[i]] = m.c[i + 1];
      painted[m.c[i]] = m.t;
    }
    // new paint shows at once; ageing paint only needs a refresh now and then
    if (m.c.length || m.t - lastFloorPaint > 500) {
      floorDirty = true;
      lastFloorPaint = m.t;
    }
    score = m.s;
    applyRollers(m.r, false);
    hud();
  };
}

// ---------------------------------------------------------------- the five actions

// Whatever's held right now, from keys and on-screen buttons together.
const held = { fwd: new Set(), back: new Set(), left: new Set(), right: new Set() };
let sent = { move: null, turn: null };
let lastSentAt = 0;

function currentInput() {
  return {
    move: (held.fwd.size ? 1 : 0) - (held.back.size ? 1 : 0),
    turn: (held.right.size ? 1 : 0) - (held.left.size ? 1 : 0),
  };
}

function sync(force = false) {
  if (!me) return;
  const now = currentInput();
  if (!force && now.move === sent.move && now.turn === sent.turn) return;
  sent = now;
  lastSentAt = Date.now();
  for (const b of document.querySelectorAll("#pad button")) {
    b.classList.toggle("on", held[b.dataset.act].size > 0);
  }
  api("POST", "/api/input", now).catch((e) => {
    if (e.status !== 429) toast(`lost touch with the floor: ${e.message}`);
  });
}

// Staying on the floor while standing still: tell the server we're here.
setInterval(() => {
  if (me && !document.hidden && Date.now() - lastSentAt > 4000) sync(true);
}, 1000);

const KEYS = {
  KeyW: "fwd", ArrowUp: "fwd",
  KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
};
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "+" || e.key === "=") return setZoom(zoomFactor * 1.2);
  if (e.key === "-") return setZoom(zoomFactor / 1.2);
  const act = KEYS[e.code];
  if (!act) return;
  e.preventDefault();
  held[act].add(e.code);
  sync();
});
window.addEventListener("keyup", (e) => {
  const act = KEYS[e.code];
  if (!act) return;
  held[act].delete(e.code);
  sync();
});
// letting go of everything when the tab loses focus, so nobody rolls off forever
window.addEventListener("blur", () => {
  for (const s of Object.values(held)) s.clear();
  sync();
});

for (const b of document.querySelectorAll("#pad button")) {
  const act = b.dataset.act;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    held[act].add(`p${e.pointerId}`);
    sync();
  });
  const up = (e) => { held[act].delete(`p${e.pointerId}`); sync(); };
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
}

function setZoom(f) {
  zoomFactor = Math.max(0.5, Math.min(2.2, f));
  store.set("turf.zoom", zoomFactor);
}
$("#zoomIn").onclick = () => setZoom(zoomFactor * 1.2);
$("#zoomOut").onclick = () => setZoom(zoomFactor / 1.2);
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  setZoom(zoomFactor * Math.exp(-e.deltaY * 0.002));
}, { passive: false });

$("#name").addEventListener("change", async (e) => {
  try {
    const r = await api("PATCH", "/api/me", { name: e.target.value });
    me.name = r.name;
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
  document.documentElement.style.setProperty("--floor", FLOOR);
  applyPalette();
  requestAnimationFrame(frame);
  connect();
  try {
    me = await api("POST", "/api/session", { secret: store.get("wall.secret", null) });
    store.set("wall.secret", me.secret);
    $("#name").value = me.name;
    applyPalette();
    sync(true); // standing still is an action too: it puts you on the floor
  } catch (e) {
    toast(`couldn't get you a team: ${e.message}`);
  }
  try {
    await loadState();
  } catch (e) {
    toast(`couldn't load the floor: ${e.message}`);
  }
  if (!store.get("turf.welcomed2", false)) {
    $("#welcome").hidden = false;
    $("#start").onclick = () => { $("#welcome").hidden = true; store.set("turf.welcomed2", true); };
  }
}

start();
