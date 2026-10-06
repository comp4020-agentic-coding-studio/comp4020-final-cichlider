import { WALL, boundsOf, drawStroke, hits, hueOf } from "./render.js";

const $ = (s) => document.querySelector(s);
const canvas = $("#wall");
const ctx = canvas.getContext("2d");
const base = document.createElement("canvas"); // committed strokes, redrawn only when they or the view change
const bctx = base.getContext("2d");

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: fine */ } },
};

// ---------------------------------------------------------------- state

const cam = { x: 0, y: 0, z: 1 }; // wall point at screen centre; screen px per wall unit
let W = 0, H = 0, dpr = 1;
const strokes = new Map(); // id -> stroke (with .bounds)
let order = []; // strokes sorted by id, rebuilt when dirty
let orderDirty = true;
const names = new Map(); // painter id -> tag
const live = new Map(); // painter id -> { name, cursor, partial, at }
const hidden = new Set(store.get("wall.hidden", []));
let solo = store.get("wall.solo", false);
let me = null;
let loaded = null; // wall rect we've fetched
const pendingBySeed = new Map(); // optimistic strokes awaiting their id
const mine = []; // ids I've made this visit, for undo
let online = 0;

const tool = {
  name: "pen",
  color: store.get("wall.color", "#e63946"),
  size: store.get("wall.size", 12),
  opacity: store.get("wall.opacity", 100),
  fill: false,
};

let baseDirty = true, dirty = true;
const redraw = (all = true) => { dirty = true; if (all) baseDirty = true; };
const visible = (author) => (solo ? me && author === me.id : !hidden.has(author));

// ---------------------------------------------------------------- coordinates

const toWall = (sx, sy) => [cam.x + (sx - W / 2) / cam.z, cam.y + (sy - H / 2) / cam.z];
const viewRect = () => {
  const [x0, y0] = toWall(0, 0), [x1, y1] = toWall(W, H);
  return { x0, y0, x1, y1 };
};

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  for (const c of [canvas, base]) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
  }
  redraw();
}

// ---------------------------------------------------------------- drawing the wall

function bricks(c, v) {
  const bw = 140, bh = 56;
  if (bh * cam.z < 7) return;
  c.save();
  c.strokeStyle = "rgba(120, 105, 85, 0.13)";
  c.lineWidth = 1.5 / cam.z;
  c.beginPath();
  const r0 = Math.floor(v.y0 / bh), r1 = Math.ceil(v.y1 / bh);
  for (let r = r0; r <= r1; r++) {
    const y = r * bh;
    c.moveTo(v.x0, y);
    c.lineTo(v.x1, y);
    const off = r % 2 === 0 ? 0 : bw / 2;
    for (let x = Math.floor((v.x0 - off) / bw) * bw + off; x <= v.x1; x += bw) {
      c.moveTo(x, y);
      c.lineTo(x, y + bh);
    }
  }
  c.stroke();
  c.restore();
}

function setView(c) {
  c.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * (W / 2 - cam.x * cam.z), dpr * (H / 2 - cam.y * cam.z));
}

function drawBase() {
  const v = viewRect();
  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.fillStyle = WALL;
  bctx.fillRect(0, 0, base.width, base.height);
  setView(bctx);
  bricks(bctx, v);
  if (orderDirty) {
    order = [...strokes.values()].sort((a, b) => a.id - b.id);
    orderDirty = false;
  }
  for (const s of order) {
    const b = s.bounds;
    if (b.maxx < v.x0 || b.minx > v.x1 || b.maxy < v.y0 || b.miny > v.y1) continue;
    if (!visible(s.author)) continue;
    drawStroke(bctx, s);
  }
}

function render() {
  if (baseDirty) {
    drawBase();
    baseDirty = false;
    updatePainters();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(base, 0, 0);
  setView(ctx);
  const now = Date.now();
  for (const [id, l] of live) {
    if (now - l.at > 6000) { live.delete(id); continue; }
    if (l.partial && visible(id)) drawStroke(ctx, l.partial);
  }
  if (drawing) drawStroke(ctx, drawing);

  // cursors and tags, in screen space so they stay readable at any zoom
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  for (const [id, l] of live) {
    if (!l.cursor || !visible(id) || (me && id === me.id)) continue;
    const sx = (l.cursor[0] - cam.x) * cam.z + W / 2, sy = (l.cursor[1] - cam.y) * cam.z + H / 2;
    if (sx < -50 || sy < -50 || sx > W + 50 || sy > H + 50) continue;
    ctx.globalAlpha = Math.max(0.15, 1 - (now - l.at) / 6000);
    ctx.fillStyle = hueOf(id);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + 11, sy + 4);
    ctx.lineTo(sx + 4, sy + 11);
    ctx.closePath();
    ctx.fill();
    const label = l.name || "?";
    const w = ctx.measureText(label).width + 10;
    ctx.fillRect(sx + 10, sy + 10, w, 18);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, sx + 15, sy + 23);
  }
  ctx.globalAlpha = 1;
}

function frame() {
  if (dirty) {
    dirty = false;
    render();
  }
  if (live.size) dirty = true; // keep fading cursors moving
  requestAnimationFrame(frame);
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

function addStroke(s) {
  if (strokes.has(s.id)) return;
  s.bounds = boundsOf(s);
  strokes.set(s.id, s);
  orderDirty = true;
}

let loading = false;
async function ensureLoaded() {
  const v = viewRect();
  if (loaded && v.x0 >= loaded.x0 && v.x1 <= loaded.x1 && v.y0 >= loaded.y0 && v.y1 <= loaded.y1) return;
  if (loading) return;
  loading = true;
  const w = v.x1 - v.x0, h = v.y1 - v.y0;
  const want = { x0: v.x0 - w, x1: v.x1 + w, y0: v.y0 - h, y1: v.y1 + h };
  try {
    const qs = new URLSearchParams(Object.entries(want).map(([k, n]) => [k, String(Math.round(n))]));
    const data = await api("GET", `/api/strokes?${qs}`);
    for (const [id, n] of Object.entries(data.names)) names.set(id, n);
    for (const s of data.strokes) addStroke(s);
    loaded = want;
    redraw();
  } catch (e) {
    toast(`couldn't load the wall: ${e.message}`);
  } finally {
    loading = false;
  }
  ensureLoaded(); // the view may have moved while we waited
}

function connect() {
  let first = true;
  const es = new EventSource("/api/events");
  es.onopen = () => {
    if (!first) { loaded = null; ensureLoaded(); } // catch up on whatever we missed
    first = false;
  };
  es.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "stroke") {
      names.set(m.stroke.author, m.name);
      settle(m.stroke);
      live.get(m.stroke.author) && (live.get(m.stroke.author).partial = null);
      redraw();
    } else if (m.type === "delete") {
      if (strokes.delete(m.id)) { orderDirty = true; redraw(); }
    } else if (m.type === "name") {
      names.set(m.id, m.name);
      if (live.has(m.id)) live.get(m.id).name = m.name;
      redraw();
    } else if (m.type === "live") {
      if (me && m.id === me.id) return;
      const l = live.get(m.id) ?? {};
      live.set(m.id, {
        name: m.name,
        cursor: m.cursor ?? l.cursor,
        partial: m.done ? null : m.partial ?? l.partial,
        at: Date.now(),
      });
      names.set(m.id, m.name);
      redraw(false);
    } else if (m.type === "presence") {
      online = m.count;
      $("#online").textContent = `· ${online} online`;
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

// ---------------------------------------------------------------- painting

let drawing = null;
let tempId = -1;
let lastLive = 0;
const PATH_TOOLS = ["pen", "marker", "brush", "spray", "buff"];

function startStroke(sx, sy) {
  const [x, y] = toWall(sx, sy);
  drawing = {
    id: tempId--,
    author: me?.id,
    tool: tool.name,
    color: tool.name === "buff" ? WALL : tool.color,
    size: Math.max(1, Math.min(240, tool.size / cam.z)),
    opacity: tool.name === "buff" ? 1 : tool.opacity / 100,
    fill: tool.fill,
    seed: (Math.random() * 0xffffffff) >>> 0,
    points: PATH_TOOLS.includes(tool.name) ? [x, y] : [x, y, x, y],
  };
  redraw(false);
}

function extendStroke(sx, sy) {
  const [x, y] = toWall(sx, sy);
  const p = drawing.points;
  if (PATH_TOOLS.includes(drawing.tool)) {
    const step = drawing.tool === "spray" ? Math.max(2, drawing.size * 0.25) : 2 / cam.z;
    if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < step) return;
    if (p.length / 2 >= 4000) return endStroke();
    p.push(x, y);
  } else {
    p[2] = x;
    p[3] = y;
  }
  redraw(false);
  const now = Date.now();
  if (now - lastLive > 80) {
    lastLive = now;
    sendLive({ cursor: [x, y], partial: liveCopy(drawing) });
  }
}

// What others see of a stroke in progress: its tail, if it's grown long.
function liveCopy(s) {
  const { tool: t, color, size, opacity, fill, seed } = s;
  const points = s.points.length > 1600 ? s.points.slice(-1600) : s.points;
  return { tool: t, color, size: Math.round(size * 10) / 10, opacity, fill, seed, points: points.map((n) => Math.round(n * 10) / 10) };
}

async function endStroke() {
  if (!drawing) return;
  const s = drawing;
  drawing = null;
  if (!PATH_TOOLS.includes(s.tool) && Math.hypot(s.points[2] - s.points[0], s.points[3] - s.points[1]) < 1) {
    redraw(false);
    return;
  }
  addStroke(s);
  pendingBySeed.set(s.seed, s.id);
  redraw();
  sendLive({ done: true });
  try {
    const saved = await api("POST", "/api/strokes", liveCopy({ ...s, points: s.points }));
    settle(saved);
    mine.push(saved.id);
    redraw();
  } catch (e) {
    strokes.delete(s.id);
    pendingBySeed.delete(s.seed);
    orderDirty = true;
    redraw();
    toast(e.status === 429 ? "whoa — slow down a second" : `that mark didn't stick: ${e.message}`);
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

async function undo() {
  const id = mine.pop();
  if (id === undefined) return toast("nothing of yours to take back on this visit");
  try {
    await api("DELETE", `/api/strokes/${id}`);
    strokes.delete(id);
    orderDirty = true;
    redraw();
  } catch (e) {
    toast(`couldn't undo: ${e.message}`);
  }
}

// ---------------------------------------------------------------- moving around

function moveTo(x, y, z = cam.z, animate = true) {
  if (!animate) {
    Object.assign(cam, { x, y, z });
    afterMove();
    return;
  }
  const from = { ...cam }, t0 = performance.now(), dur = 650;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    cam.x = from.x + (x - from.x) * e;
    cam.y = from.y + (y - from.y) * e;
    cam.z = from.z + (z - from.z) * e;
    afterMove();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function zoomAt(sx, sy, factor) {
  const [wx, wy] = toWall(sx, sy);
  cam.z = Math.max(0.04, Math.min(8, cam.z * factor));
  cam.x = wx - (sx - W / 2) / cam.z;
  cam.y = wy - (sy - H / 2) / cam.z;
  afterMove();
}

let hashTimer = 0;
function afterMove() {
  redraw();
  $("#zoom").textContent = `${Math.round(cam.z * 100)}%`;
  $("#where").textContent = `${Math.round(cam.x)}, ${Math.round(cam.y)}`;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    history.replaceState(null, "", `#${Math.round(cam.x)},${Math.round(cam.y)},${Math.round(cam.z * 100) / 100}`);
    ensureLoaded();
  }, 150);
}

// ---------------------------------------------------------------- pointer input

const pointers = new Map();
let mode = null; // "paint" | "pan" | "pinch"
let panFrom = null, pinchFrom = null, spaceDown = false;

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  hideWho();
  if (pointers.size === 2) {
    if (drawing) { drawing = null; redraw(false); } // second finger: it was a gesture, not a mark
    const [a, b] = [...pointers.values()];
    mode = "pinch";
    pinchFrom = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    return;
  }
  if (pointers.size > 2) return;
  if (e.button === 1 || e.button === 2 || spaceDown || tool.name === "hand") {
    mode = "pan";
    panFrom = { x: e.clientX, y: e.clientY };
    canvas.classList.add("panning");
  } else if (tool.name === "who") {
    whoAt(e.clientX, e.clientY);
  } else if (e.button === 0) {
    if (!me) return toast("still finding your tag — one moment");
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
    afterMove();
  } else if (mode === "paint" && drawing) {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const c of evs.length ? evs : [e]) extendStroke(c.clientX, c.clientY);
  } else if (!mode) {
    const now = Date.now();
    if (now - lastLive > 120) {
      lastLive = now;
      sendLive({ cursor: toWall(e.clientX, e.clientY) });
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
    afterMove();
  }
}, { passive: false });

// ---------------------------------------------------------------- who painted this

function whoAt(sx, sy) {
  const [x, y] = toWall(sx, sy);
  const slack = 6 / cam.z;
  let found = null;
  for (let i = order.length - 1; i >= 0; i--) {
    const s = order[i];
    if (visible(s.author) && s.tool !== "buff" && hits(s, x, y, slack)) { found = s; break; }
  }
  const pop = $("#whoPop");
  if (!found) return hideWho();
  const name = names.get(found.author) ?? "someone";
  const isMe = found.author === me?.id;
  const when = new Date(found.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  pop.innerHTML = "";
  const b = document.createElement("b");
  b.textContent = isMe ? `${name} (you)` : name;
  pop.append(b, document.createTextNode(` · ${found.tool} · ${when}`));
  if (!isMe) {
    const btn = document.createElement("button");
    btn.textContent = "hide their marks";
    btn.onclick = () => { setHidden(found.author, true); hideWho(); };
    pop.append(btn);
  }
  pop.style.left = `${Math.min(sx + 12, W - 320)}px`;
  pop.style.top = `${Math.min(sy + 12, H - 60)}px`;
  pop.hidden = false;
}
const hideWho = () => { $("#whoPop").hidden = true; };

// ---------------------------------------------------------------- painters panel

function setHidden(id, on) {
  if (on) hidden.add(id);
  else hidden.delete(id);
  store.set("wall.hidden", [...hidden]);
  redraw();
}

let paintersKey = "";
function updatePainters() {
  const v = viewRect();
  const counts = new Map();
  for (const s of order) {
    const b = s.bounds;
    if (b.maxx < v.x0 || b.minx > v.x1 || b.maxy < v.y0 || b.miny > v.y1) continue;
    counts.set(s.author, (counts.get(s.author) ?? 0) + 1);
  }
  for (const id of live.keys()) if (!counts.has(id)) counts.set(id, 0);
  const rows = [...counts].filter(([id]) => id && id !== me?.id).sort((a, b) => b[1] - a[1]).slice(0, 60);
  const key = JSON.stringify([rows, [...hidden], solo, [...live.keys()]]);
  if (key === paintersKey) return;
  paintersKey = key;

  const ul = $("#painters");
  ul.innerHTML = "";
  if (!rows.length) {
    const li = document.createElement("li");
    li.textContent = "nobody else has painted in view";
    li.style.color = "var(--muted)";
    ul.append(li);
  }
  for (const [id, n] of rows) {
    const li = document.createElement("li");
    const off = solo || hidden.has(id);
    li.className = (off ? "off " : "") + (live.has(id) ? "live" : "");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = hueOf(id);
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = names.get(id) ?? "someone";
    const count = document.createElement("span");
    count.className = "n";
    count.textContent = n ? String(n) : "";
    const btn = document.createElement("button");
    btn.textContent = hidden.has(id) ? "show" : "hide";
    btn.disabled = solo;
    btn.onclick = () => setHidden(id, !hidden.has(id));
    li.append(dot, nm, count, btn);
    ul.append(li);
  }
  $("#showAll").hidden = hidden.size === 0 && !solo;
}

$("#solo").checked = solo;
$("#solo").onchange = (e) => { solo = e.target.checked; store.set("wall.solo", solo); redraw(); };
$("#showAll").onclick = () => {
  hidden.clear();
  store.set("wall.hidden", []);
  solo = false;
  $("#solo").checked = false;
  store.set("wall.solo", false);
  redraw();
};
$("#peopleToggle").onclick = () => {
  const closed = $("#people").classList.toggle("closed");
  $("#peopleToggle").setAttribute("aria-expanded", String(!closed));
};
if (window.innerWidth < 720) $("#people").classList.add("closed");

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

// ---------------------------------------------------------------- tool + paint controls

const SWATCHES = ["#1d1b19", "#ffffff", "#e63946", "#ff7a00", "#ffd60a", "#2ec4b6", "#3a86ff", "#8338ec", "#ff5fa2", "#6a994e", "#8d5524"];

function selectTool(name) {
  tool.name = name;
  for (const b of document.querySelectorAll("#tools [data-tool]")) b.classList.toggle("on", b.dataset.tool === name);
  canvas.className = name === "hand" ? "pan" : name === "who" ? "who" : "paint";
  $("#fillWrap").style.opacity = name === "rect" || name === "ellipse" ? "1" : "0.4";
  hideWho();
}
for (const b of document.querySelectorAll("#tools [data-tool]")) b.onclick = () => selectTool(b.dataset.tool);

function selectColor(c) {
  tool.color = c;
  store.set("wall.color", c);
  $("#color").value = c;
  let matched = false;
  for (const sw of document.querySelectorAll(".sw")) {
    const on = sw.dataset.c === c;
    matched ||= on;
    sw.classList.toggle("on", on);
  }
  $(".custom").classList.toggle("on", !matched);
}
for (const c of SWATCHES) {
  const b = document.createElement("button");
  b.className = "sw";
  b.dataset.c = c;
  b.title = c;
  b.style.background = c;
  if (c === "#ffffff") b.style.borderColor = "#5a544c";
  b.onclick = () => selectColor(c);
  $("#swatches").append(b);
}
$("#color").oninput = (e) => selectColor(e.target.value);

function setSize(n) {
  tool.size = Math.max(1, Math.min(120, n));
  $("#size").value = tool.size;
  $("#sizeOut").textContent = tool.size;
  store.set("wall.size", tool.size);
}
$("#size").oninput = (e) => setSize(Number(e.target.value));
$("#opacity").oninput = (e) => {
  tool.opacity = Number(e.target.value);
  $("#opOut").textContent = tool.opacity;
  store.set("wall.opacity", tool.opacity);
};
$("#opacity").value = tool.opacity;
$("#opOut").textContent = tool.opacity;
$("#fill").onchange = (e) => { tool.fill = e.target.checked; };
$("#undo").onclick = undo;

const KEYS = { p: "pen", m: "marker", b: "brush", s: "spray", l: "line", r: "rect", o: "ellipse", e: "buff", h: "hand", i: "who" };
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); return undo(); }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === "Space") { e.preventDefault(); if (!spaceDown) { spaceDown = true; canvas.classList.add("pan"); } return; }
  if (e.key === "[") return setSize(tool.size - (tool.size > 20 ? 4 : 1));
  if (e.key === "]") return setSize(tool.size + (tool.size >= 20 ? 4 : 1));
  if (e.key === "+" || e.key === "=") return zoomAt(W / 2, H / 2, 1.25);
  if (e.key === "-") return zoomAt(W / 2, H / 2, 0.8);
  const t = KEYS[e.key.toLowerCase()];
  if (t) selectTool(t);
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") { spaceDown = false; selectTool(tool.name); }
});

// ---------------------------------------------------------------- getting around

$("#zoomIn").onclick = () => zoomAt(W / 2, H / 2, 1.25);
$("#zoomOut").onclick = () => zoomAt(W / 2, H / 2, 0.8);
$("#home").onclick = () => moveTo(0, 0, 1);

$("#hot").onclick = async () => {
  try {
    const { spots } = await api("GET", "/api/hotspots");
    const away = spots.filter((s) => Math.hypot(s.x - cam.x, s.y - cam.y) > 600 / cam.z);
    if (!away.length) return toast("this is the busy spot — nowhere busier right now");
    const s = away[Math.floor(Math.random() * Math.min(away.length, 8))];
    moveTo(s.x, s.y, 1);
  } catch (e) {
    toast(e.message);
  }
};

$("#blank").onclick = async () => {
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2, r = 2500 + Math.random() * 12000;
    const x = Math.round(cam.x + Math.cos(a) * r), y = Math.round(cam.y + Math.sin(a) * r);
    const qs = new URLSearchParams({ x0: String(x - 900), x1: String(x + 900), y0: String(y - 600), y1: String(y + 600) });
    try {
      const { strokes: found } = await api("GET", `/api/strokes?${qs}`);
      if (found.length === 0) return moveTo(x, y, 1);
    } catch { /* try another */ }
  }
  toast("couldn't find an empty patch — the wall's getting full!");
};

$("#share").onclick = async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    toast("link to this spot copied");
  } catch {
    toast(location.href);
  }
};

let toastTimer = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------------------------------------------------------- start

function readHash() {
  const m = location.hash.slice(1).split(",").map(Number);
  if (m.length >= 2 && m.every(Number.isFinite)) {
    cam.x = m[0];
    cam.y = m[1];
    if (m[2] > 0) cam.z = Math.max(0.04, Math.min(8, m[2]));
  }
}

async function start() {
  readHash();
  resize();
  selectTool("pen");
  selectColor(tool.color);
  setSize(tool.size);
  afterMove();
  window.addEventListener("resize", resize);
  window.addEventListener("hashchange", () => { readHash(); afterMove(); });

  if (!store.get("wall.welcomed", false)) {
    $("#welcome").hidden = false;
    $("#start").onclick = () => { $("#welcome").hidden = true; store.set("wall.welcomed", true); };
  }

  requestAnimationFrame(frame);
  connect();
  ensureLoaded();
  try {
    me = await api("POST", "/api/session", { secret: store.get("wall.secret", null) });
    store.set("wall.secret", me.secret);
    names.set(me.id, me.name);
    $("#name").value = me.name;
    redraw();
  } catch (e) {
    toast(`couldn't get you a tag: ${e.message}`);
  }
}

start();
