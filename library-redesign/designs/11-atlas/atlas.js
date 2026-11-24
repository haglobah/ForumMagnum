import "../../shared/header.js";
import { loadLibrary } from "../../shared/library.js";
import { topicByKey, SOURCES, GROUPS, SORTS, AREAS, buildPool, select, group } from "./model.js";
import { squarify } from "./treemap.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const map = $("#map"), panel = $("#panel"), crumbs = $("#crumbs");

const [lib, art] = await Promise.all([loadLibrary(), fetch("../../data/art.json").then(r => r.json())]);
let posts = null, loadingPosts = null;
let pool = buildPool(lib, art, null);

// ---------- state, kept in the address ----------
const PRESETS = [
  { key: "sequences", name: "All sequences", s: ["curatedSeq", "communitySeq", "core"], g: "topic", o: "size", a: "time" },
  { key: "bolw", name: "Best of LessWrong", s: ["bolw"], g: "topic", o: "rank", a: "equal" },
  { key: "years", name: "Best of, by year", s: ["bolw"], g: "year", o: "rank", a: "equal" },
  { key: "curated", name: "Curated posts", s: ["curatedPosts"], g: "year", o: "date", a: "karma" },
  { key: "everything", name: "Everything", s: ["everything", "curatedSeq", "core"], g: "topic", o: "karma", a: "karma" },
];
const state = { sources: new Set(PRESETS[0].s), group: "topic", sort: "size", dir: "down", area: "time", look: "art",
  focus: null, hover: null, selected: null };
{
  const u = new URLSearchParams(location.search);
  if (u.get("s")) state.sources = new Set(u.get("s").split(",").filter(k => SOURCES.some(s => s.key === k)));
  if (GROUPS[u.get("g")]) state.group = u.get("g");
  if (SORTS[u.get("o")]) state.sort = u.get("o");
  if (u.get("o") === "newest" || u.get("o") === "oldest") state.sort = "date"; // the old addresses
  if (u.get("d") === "up" || u.get("o") === "oldest") state.dir = "up";
  if (AREAS[u.get("a")]) state.area = u.get("a");
  if (u.get("l") === "ink") state.look = "ink";
}
function saveState() {
  const u = new URLSearchParams();
  u.set("s", [...state.sources].join(",")); u.set("g", state.group); u.set("o", state.sort); u.set("a", state.area);
  if (state.dir === "up") u.set("d", "up");
  if (state.look !== "art") u.set("l", state.look);
  history.replaceState(null, "", "?" + u + location.hash);
}

// ---------- numbers ----------
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const hrs = min => min < 60 ? `${Math.round(min)} min` : min < 600 ? `${(min / 60).toFixed(1)} h` : `${Math.round(min / 60).toLocaleString("en")} h`;
const plural = (n, w) => `${n.toLocaleString("en")} ${w}${n === 1 ? "" : "s"}`;
const years = it => !it.year ? "" : it.lastYear && it.lastYear !== it.year ? `${it.year}–${String(it.lastYear).slice(2)}` : `${it.year}`;
const hueOf = n => topicByKey[n.topic]?.hue || n.hue || "#6b6257";

// ---------- the tree: root → groups → items (→ chapters → posts); "more" nodes are made by the layout ----------
let root, nodes, parents;
function rebuild() {
  const picked = select(pool, state);
  const groups = group(picked, state.group, state.sort, state.sources, state.area, state.dir);
  root = { id: "root", kind: "root", name: "The selection", children: groups.map(g => ({ ...g, id: "g:" + g.key, kind: "group", children: g.items })) };
  nodes = new Map(); parents = new Map();
  (function walk(n, parent) {
    nodes.set(n.id, n); if (parent) parents.set(n.id, parent);
    n.children?.forEach(c => walk(c, n));
  })(root, null);
}
const parentOf = n => n.kind === "more" ? n.parent : parents.get(n.id) || null;
// A node's size: an item's (or post's) own measure; a group's, chapter's or "more" the sum of its children.
const SUMMED = new Set(["group", "root", "chapter"]);
let vals = new Map();
function val(n) {
  let v = vals.get(n);
  if (v === undefined) { v = n.kind === "more" ? n.tile : SUMMED.has(n.kind) ? n.children.reduce((a, c) => a + val(c), 0) : AREAS[state.area].of(n); vals.set(n, v); }
  return v;
}
const leaves = n => n.children ? n.children.flatMap(leaves) : [n];
const countPosts = n => n.kind === "post" ? 1 : n.posts ?? n.children.reduce((a, c) => a + countPosts(c), 0);
const minutesOf = n => n.kind === "post" || n.kind === "sequence" || n.kind === "collection" ? n.minutes : n.children.reduce((a, c) => a + minutesOf(c), 0);
const itemCount = n => n.kind === "root" ? n.children.reduce((a, g) => a + g.children.length, 0) : n.children.length;

// ---------- layout ----------
// px² below which items fold into "N more": equal tiles get room for a title, as on the Best of LessWrong page.
const minCell = () => state.area === "equal" ? 105 * 105 : 68 * 64;
function capped(parent, kids, rect) {
  const allowed = Math.max(1, Math.floor(rect.w * rect.h / minCell()));
  if (kids.length <= allowed) return kids;
  const keep = kids.slice(0, allowed - 1), rest = kids.slice(allowed - 1);
  // "N more" is one tile the size of a typical one shown (the Best of LessWrong's "show all"),
  // not the true size of what it holds, or it would squeeze the rest into slivers.
  const more = { id: "more:" + parent.id, kind: "more", name: `${rest.length.toLocaleString("en")} more`, children: rest, parent, hue: parent.hue, topic: parent.topic,
    tile: keep.map(val).sort((a, b) => a - b)[Math.floor(keep.length / 2)] || 1 };
  nodes.set(more.id, more);
  return [...keep, more];
}
const WORK = new Set(["sequence", "collection", "chapter"]);
// Inside a work, posts keep their reading order unless sorted by size.
function ordered(focus) {
  const kids = focus.children.filter(c => val(c) > 0);
  if (WORK.has(focus.kind) && state.sort === "size") return kids.sort((a, b) => (state.dir === "up" ? -1 : 1) * (val(b) - val(a)));
  return kids;
}
function layout(focus, W, H) {
  const out = [], full = { x: 0, y: 0, w: W, h: H };
  if (focus.kind === "root") {
    const gs = ordered(focus);
    const rects = squarify(gs.map(val), full);
    gs.forEach((g, i) => {
      const r = rects[i], head = 26;
      out.push({ node: g, rect: r, role: "group" });
      if (r.w < 30 || r.h < head + 14) return;
      const inner = { x: r.x + 2, y: r.y + head, w: r.w - 4, h: r.h - head - 2 };
      const kids = capped(g, g.children, inner);
      const kr = squarify(kids.map(val), inner);
      kids.forEach((c, j) => out.push({ node: c, rect: kr[j], role: "cell" }));
    });
  } else {
    const kids = capped(focus, ordered(focus), full);
    const kr = squarify(kids.map(val), full);
    kids.forEach((c, j) => out.push({ node: c, rect: kr[j], role: "cell" }));
  }
  return out;
}

// ---------- colour and art ----------
const PAPER = [246, 241, 232];
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const quality = n => clamp((Math.log(Math.max(n.score ?? 1, 1)) - Math.log(8)) / (Math.log(400) - Math.log(8)));
function ink(n) {
  if (n.kind === "more") return { bg: "rgba(255,255,255,.35)", dark: false };
  const m = .1 + .72 * quality(n);
  return { bg: `rgb(${mix(PAPER, rgb(hueOf(n)), m).join(",")})`, dark: m > .5 };
}
// The art a stage shows at rest: the group's own (a topic's or year's), else its first item's picture.
function stageArt(n) {
  if (n.kind === "group") return n.art || n.children.find(c => ownArt(c))?.img || n.children.map(ownArt).find(Boolean) || null;
  if (n.kind === "more") return stageArt(n.parent);
  if (n.kind === "sequence" || n.kind === "collection") return n.banner || n.img;
  if (n.kind === "chapter") for (let p = parentOf(n); p; p = parentOf(p)) { const a = stageArt(p); if (a) return a; }
  return null;
}
const ownArt = n => n.kind === "post" ? n.winner?.art || null : n.img || null;

// ---------- drawing ----------
function cellHTML(n, r) {
  const { w, h } = r;
  if (w < 30 || h < 18) return "";
  const fs = Math.min(clamp(Math.sqrt(w * h) / 11, 11, 26), w / 4.6);
  if (fs < 10.5) return "";
  const pad = fs > 18 ? 11 : 7;
  let bits;
  if (n.kind === "more") bits = ["Show all", hrs(minutesOf(n))];
  else if (n.kind === "post") bits = [`${n.score} karma`, `${n.minutes} min`, n.winner ? `★ ${n.winner.year}` : n.year];
  else if (n.kind === "chapter") bits = [plural(countPosts(n), "post"), hrs(minutesOf(n))];
  else bits = [plural(n.posts, "post"), hrs(n.minutes), years(n)];
  const meta = h > fs * 1.2 + 30 && w > 76 ? `<div class="m">${bits.filter(Boolean).join(" · ")}</div>` : "";
  const kind = h > 70 && w > 120 && (n.kind === "sequence" || n.kind === "collection")
    ? `<div class="kind">${n.kind === "collection" ? "Core collection" : n.sources.has("curatedSeq") ? "Sequence" : "Community sequence"}</div>` : "";
  const lines = Math.max(1, Math.floor((h - 2 * pad - (meta ? 18 : 0) - (kind ? 15 : 0)) / (fs * 1.12)));
  const q = isQueued(n);
  const add = n.kind !== "more" && n.kind !== "chapter" && w > 60 && h > 40
    ? `<button class="add${q ? " on" : ""}" data-add="${esc(n.id)}" aria-label="Add to reading queue">${q ? "✓" : "+"}</button>` : "";
  return `<div class="lab" style="padding:${pad - 2}px ${pad}px">${kind}<div class="t" style="font-size:${fs.toFixed(1)}px;-webkit-line-clamp:${lines}">${esc(n.kind === "more" ? n.name : n.title)}</div>${meta}</div>${add}`;
}
function groupHead(n, r) {
  const share = Math.round(100 * val(n) / (val(root) || 1));
  const right = r.w > 170 ? `${share}% · ${n.children.length.toLocaleString("en")}` : r.w > 90 ? `${share}%` : "";
  return `<div class="gh" data-id="${esc(n.id)}"><span class="gn">${esc(n.name)}</span><span class="gs">${right}</span></div>`;
}
function setStageArt(el, url) {
  const a = el.querySelector(":scope > .art.rest");
  const want = url ? `url("${url}")` : "";
  if (a && a.style.backgroundImage !== want) a.style.backgroundImage = want;
}

function paint(layer, focus, { morph = false, enter = false } = {}) {
  vals = new Map();
  const W = map.clientWidth, H = map.clientHeight;
  const items = layout(focus, W, H);
  const old = layer._els || new Map(), els = new Map();
  layer._rects = new Map();
  const staged = focus.kind !== "root";
  layer.className = `layer look-${state.look}${staged ? " stage" : ""}${layer.classList.contains("fresh") ? " fresh" : ""}`;
  // A zoomed-in view is one stage: the map shows its art behind the cells.
  if (staged) {
    if (!layer.querySelector(":scope > .art")) layer.insertAdjacentHTML("afterbegin", `<div class="art rest"></div><div class="art hov"></div>`);
    setStageArt(layer, state.look === "art" ? stageArt(focus) : null);
  } else layer.querySelectorAll(":scope > .art").forEach(a => a.remove());
  if (morph) { layer.classList.add("morphing"); clearTimeout(layer._mt); layer._mt = setTimeout(() => layer.classList.remove("morphing"), 750); }
  let i = 0;
  for (const it of items) {
    const { node: n, rect: r } = it;
    const key = it.role + ":" + n.id;
    let el = old.get(key);
    const fresh = !el;
    if (fresh) { el = document.createElement("div"); el.dataset.id = n.id; }
    Object.assign(el.style, { left: `${r.x + .5}px`, top: `${r.y + .5}px`, width: `${Math.max(0, r.w - 1)}px`, height: `${Math.max(0, r.h - 1)}px` });
    layer._rects.set(n.id, r);
    if (it.role === "group") {
      const pic = state.look === "art" ? stageArt(n) : null;
      el.className = `group stage${pic ? "" : " bare"}`;
      el.style.setProperty("--hue", hueOf(n));
      if (fresh) el.innerHTML = `<div class="art rest"></div><div class="art hov"></div><div class="ghw"></div>`;
      setStageArt(el, pic);
      el.querySelector(".ghw").innerHTML = groupHead(n, r);
    } else {
      const own = n.kind === "post" && n.winner ? ownArt(n) : null;
      el.className = `cell k-${n.kind}${own ? " winner" : ""}${isRead(n) ? " read" : ""}${state.selected === n ? " sel" : ""}`;
      if (state.look === "ink") {
        const t = ink(n);
        el.classList.toggle("dark", t.dark || !!own);
        el.style.background = own ? `linear-gradient(rgba(20,16,10,.15), rgba(20,16,10,.6)), url("${own}") center / cover` : t.bg;
        el.style.color = t.dark || own ? "#fbf8f1" : "rgba(30,24,16,.9)";
      } else { el.style.background = ""; el.style.color = ""; el.classList.remove("dark"); }
      el.innerHTML = cellHTML(n, r);
    }
    if (fresh) {
      if (morph || enter) {
        el.style.opacity = 0;
        const d = enter ? Math.min(500, i * 3) : 160;
        setTimeout(() => requestAnimationFrame(() => { el.style.opacity = ""; }), d);
      }
      // Groups sit under the cells.
      if (it.role === "group") layer.insertBefore(el, layer.querySelector(":scope > .cell")); else layer.appendChild(el);
    }
    old.delete(key); els.set(key, el); i++;
  }
  for (const el of old.values()) {
    if (morph) { el.style.opacity = 0; el.style.pointerEvents = "none"; setTimeout(() => el.remove(), 450); } else el.remove();
  }
  layer._els = els;
}

// ---------- the Best of LessWrong hover: a stage's art turns into the hovered work's ----------
let hovStage = null;
function stageHover(cellEl, n) {
  if (state.look !== "art") return;
  const stage = cellEl && n ? stageOf(n) : null;
  if (hovStage && hovStage !== stage) hovStage.classList.remove("hovering");
  hovStage = stage;
  if (!stage) return;
  const url = ownArt(n), hov = stage.querySelector(":scope > .art.hov");
  if (!url || !hov) { stage.classList.remove("hovering"); return; }
  const want = `url("${url}")`;
  if (hov.style.backgroundImage === want) { stage.classList.add("hovering"); return; }
  const img = new Image();
  const show = () => { if (state.hover === n && hovStage === stage) { hov.style.backgroundImage = want; stage.classList.add("hovering"); } };
  img.onload = show; img.src = url;
  if (img.complete) show();
}
// The stage a cell stands on: its group at the top, the whole layer when zoomed in.
// (Cells are the groups' siblings, not children, so they can fly between groups.)
function stageOf(n) {
  if (state.focus.kind !== "root") return layer;
  const g = n.kind === "more" ? n.parent : parents.get(n.id);
  return g ? layer._els.get("group:" + g.id) || null : null;
}

// ---------- zooming ----------
let layer = null, busy = false;
const EASE = "cubic-bezier(.35,.05,.2,1)", DUR = 620;
const camera = (r, W, H) => `translate(${-r.x * W / r.w}px, ${-r.y * H / r.h}px) scale(${W / r.w}, ${H / r.h})`;
const shrink = (r, W, H) => `translate(${r.x}px, ${r.y}px) scale(${r.w / W}, ${r.h / H})`;
const isAncestor = (a, b) => { for (let x = parentOf(b); x; x = parentOf(x)) if (x === a) return true; return false; };

function setFocus(next, { push = true, enter = false } = {}) {
  const prev = state.focus;
  state.focus = next; state.selected = null; state.hover = null; hovStage = null;
  if (push) history.pushState(null, "", location.search + (next === root ? "" : "#" + encodeURIComponent(next.id)));
  const W = map.clientWidth, H = map.clientHeight;
  const neu = document.createElement("div");
  paint(neu, next, { enter });
  const oldLayer = layer;
  layer = neu; map.appendChild(neu);
  renderAll();
  if (!oldLayer || !prev || matchMedia("(prefers-reduced-motion: reduce)").matches) { oldLayer?.remove(); return; }
  const down = isAncestor(prev, next), up = isAncestor(next, prev);
  let r = null;
  if (down) for (let a = next; a && !r; a = parentOf(a)) r = oldLayer._rects.get(a.id);
  else if (up) for (let a = prev; a && !r; a = parentOf(a)) r = neu._rects.get(a.id);
  if (!r || r.w < 1 || r.h < 1) {
    neu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    oldLayer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).onfinish = () => oldLayer.remove();
    return;
  }
  neu.classList.add("fresh"); busy = true;
  if (down) {
    oldLayer.animate([{ transform: "none", opacity: 1 }, { transform: camera(r, W, H), opacity: 0 }], { duration: DUR, easing: EASE, fill: "forwards" });
    neu.animate([{ transform: shrink(r, W, H), opacity: .25 }, { transform: "none", opacity: 1 }], { duration: DUR, easing: EASE }).onfinish = done;
  } else {
    oldLayer.style.zIndex = 2;
    oldLayer.animate([{ transform: "none", opacity: 1 }, { transform: shrink(r, W, H), opacity: 0 }], { duration: DUR, easing: EASE, fill: "forwards" });
    neu.animate([{ transform: camera(r, W, H), opacity: .3 }, { transform: "none", opacity: 1 }], { duration: DUR, easing: EASE }).onfinish = done;
  }
  function done() { oldLayer.remove(); neu.classList.remove("fresh"); busy = false; }
}
const zoomOut = () => { const p = parentOf(state.focus); if (p) setFocus(p); };
function activate(n) {
  if (n.kind === "post") { window.open(n.url, "_blank", "noopener"); return; }
  if (n !== state.focus) setFocus(n);
}

// ---------- pointer on the map ----------
let lastPointer = "mouse";
const nodeAt = t => { const el = t.closest?.("[data-id]"); return el ? nodes.get(el.dataset.id) : null; };
map.addEventListener("pointerdown", e => { lastPointer = e.pointerType; });
map.addEventListener("pointermove", e => {
  if (e.pointerType !== "mouse" || busy) return;
  const el = e.target.closest?.(".cell"), n = el ? nodes.get(el.dataset.id) : nodeAt(e.target);
  if (n !== state.hover) { state.hover = n; stageHover(el, n); renderPanel(); }
});
map.addEventListener("pointerleave", () => { state.hover = null; stageHover(null, null); renderPanel(); });
map.addEventListener("click", e => {
  const add = e.target.closest("[data-add]");
  if (add) { e.stopPropagation(); toggleQueue(nodes.get(add.dataset.add), add); return; }
  const n = nodeAt(e.target);
  if (!n || busy) return;
  if (lastPointer === "touch" || lastPointer === "pen") { state.selected === n ? activate(n) : select1(n); return; }
  activate(n);
});
map.addEventListener("keydown", e => { if (e.key === "Escape" || e.key === "Backspace") { e.preventDefault(); zoomOut(); } });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.activeElement === document.body) zoomOut();
});
function select1(n) {
  state.selected = n; state.hover = null;
  layer.querySelectorAll(".sel").forEach(el => el.classList.remove("sel"));
  layer._els.get("cell:" + n.id)?.classList.add("sel");
  renderPanel();
}

// ---------- the reading list: queue → reading → read ----------
const QKEY = "atlas11:queue";
const STAGES = { queue: { name: "Queue", move: "↩ Queue", empty: "Press <b>+</b> on anything in the Atlas to queue it: posts and whole sequences, in the order you'll read them." },
  reading: { name: "Reading", move: "▸ Reading", empty: "What you've started. Hover a card above and move it here." },
  read: { name: "Read", move: "✓ Read", empty: "What you've finished lands here." } };
let queue = JSON.parse(localStorage.getItem(QKEY) || "[]").map(q => ({ stage: "queue", ...q }));
let showRead = localStorage.getItem("atlas11:showRead") === "1";
const baseId = n => n.kind === "post" ? "p:" + n.postId : n.id;
const entryOf = n => n ? queue.find(q => q.id === baseId(n)) : null;
const isQueued = n => !!entryOf(n);
const karmaOf = n => n.kind === "post" ? n.score : n.karma;
function saveQueue() { localStorage.setItem(QKEY, JSON.stringify(queue)); }
const isRead = n => entryOf(n)?.stage === "read";
// After the reading list changes: the + buttons, and which cells show as read.
function syncAddButtons() {
  layer?._els.forEach((el, key) => { if (key.startsWith("cell:")) { const m = nodes.get(el.dataset.id); if (m) el.classList.toggle("read", isRead(m)); } });
  document.querySelectorAll("[data-add]").forEach(b => {
    const m = nodes.get(b.dataset.add); if (!m) return;
    const e = entryOf(m); b.classList.toggle("on", !!e);
    b.textContent = b.classList.contains("qbtn") ? (e ? `✓ ${STAGES[e.stage].name === "Queue" ? "In your queue" : STAGES[e.stage].name}` : "+ Reading queue") : e ? "✓" : "+";
  });
}
function toggleQueue(n, from) {
  if (!n) return;
  const id = baseId(n);
  if (queue.some(q => q.id === id)) queue = queue.filter(q => q.id !== id);
  else {
    queue.push({ id, kind: n.kind, title: n.title, url: n.url, minutes: n.minutes, karma: karmaOf(n), author: n.author?.name || null,
      img: ownArt(n), hue: hueOf(n), winner: n.winner ? n.winner.year : null, stage: "queue" });
    renderQueue(); fly(from, n);
  }
  saveQueue(); renderQueue(); syncAddButtons();
}
// Changes to the list re-render it; the cards glide from where they were (FLIP).
function flip(change) {
  const before = new Map([...document.querySelectorAll(".qcard")].map(c => [c.dataset.qid, c.getBoundingClientRect()]));
  change(); saveQueue(); renderQueue(); syncAddButtons();
  for (const c of document.querySelectorAll(".qcard")) {
    const b = before.get(c.dataset.qid), a = c.getBoundingClientRect();
    if (!b) { c.animate([{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "none" }], { duration: 300, easing: "ease-out" }); continue; }
    const dx = b.left - a.left, dy = b.top - a.top;
    if (dx || dy) c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 420, easing: "cubic-bezier(.3,.7,.2,1)" });
  }
}
function moveTo(id, stage) {
  flip(() => { const i = queue.findIndex(q => q.id === id); const [e] = queue.splice(i, 1); e.stage = stage; queue.push(e); });
  if (stage === "read" && !showRead) $("#queue .lane[data-lane=read] .lhead")?.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 400 });
}
function fly(from, n) {
  const src = (from?.closest(".cell, .panel") || from)?.getBoundingClientRect();
  const slot = $("#queue .lane[data-lane=queue] .qcard:last-child")?.getBoundingClientRect();
  if (!src || !slot || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const g = document.createElement("div"), img = ownArt(n);
  g.className = "ghost";
  g.style.cssText = `left:${src.left}px;top:${src.top}px;width:${src.width}px;height:${src.height}px;background:${img ? `url('${img}') center/cover` : hueOf(n)}`;
  document.body.appendChild(g);
  const dx = slot.left - src.left, dy = slot.top - src.top;
  g.animate([{ transform: "none", opacity: .95 }, { transform: `translate(${dx}px, ${dy}px) scale(${slot.width / src.width}, ${slot.height / src.height})`, opacity: .35 }],
    { duration: 650, easing: "cubic-bezier(.5,0,.2,1)" }).onfinish = () => g.remove();
  $("#queue .lane[data-lane=queue] .qcard:last-child")?.animate([{ opacity: 0 }, { opacity: 0, offset: .8 }, { opacity: 1 }], { duration: 700 });
}
function cardHTML(x, i) {
  const karma = x.karma ?? (pool.get(x.id) ? karmaOf(pool.get(x.id)) : null);
  const meta = [x.kind === "post" ? null : x.kind === "collection" ? "Collection" : "Sequence", x.author ? esc(x.author) : null,
    hrs(x.minutes || 0), karma != null ? `${karma.toLocaleString("en")} karma` : null, x.winner ? `<span class="gold">★ ${x.winner}</span>` : null];
  const moves = Object.entries(STAGES).filter(([k]) => k !== x.stage).map(([k, st]) => `<button data-move="${k}">${st.move}</button>`).join("");
  return `<div class="qcard" draggable="true" data-qid="${esc(x.id)}">
    <a href="${esc(x.url)}" target="_blank" rel="noopener" class="qimg" style="${x.img ? `background-image:url('${esc(x.img)}')` : `background:${x.hue}`}"><span class="qn">${i + 1}</span></a>
    <div class="qt"><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a><span class="qm">${meta.filter(Boolean).join(" · ")}</span></div>
    <div class="qact">${moves}<button class="qx" data-qx aria-label="Remove">×</button></div></div>`;
}
function renderQueue() {
  $("#queue").innerHTML = Object.entries(STAGES).map(([k, st]) => {
    const items = queue.filter(q => q.stage === k), open = k !== "read" || showRead;
    const sum = items.length ? `${items.length} · ${hrs(items.reduce((a, x) => a + (x.minutes || 0), 0))}` : "";
    const head = k === "read"
      ? `<button class="lhead ui chevron" data-toggle-read aria-expanded="${open}"><span class="chev">›</span><span class="ql">${st.name}</span><span class="qs">${sum}</span></button>`
      : `<div class="lhead ui"><span class="ql">${st.name}</span><span class="qs">${sum}</span></div>`;
    return `<div class="lane${open ? "" : " shut"}" data-lane="${k}">${head}
      <div class="qcards">${items.map(cardHTML).join("") || `<div class="qempty">${st.empty}</div>`}</div></div>`;
  }).join("");
}
$("#queue").addEventListener("click", e => {
  const card = e.target.closest(".qcard");
  const mv = e.target.closest("[data-move]");
  if (mv && card) { e.preventDefault(); moveTo(card.dataset.qid, mv.dataset.move); return; }
  if (e.target.closest("[data-qx]") && card) { e.preventDefault(); flip(() => { queue = queue.filter(q => q.id !== card.dataset.qid); }); return; }
  if (e.target.closest("[data-toggle-read]")) { showRead = !showRead; localStorage.setItem("atlas11:showRead", showRead ? "1" : ""); flip(() => {}); }
});
// Dragging reorders a lane and moves cards between lanes (also onto the folded "Read").
let dragEl = null;
$("#queue").addEventListener("dragstart", e => { dragEl = e.target.closest(".qcard"); if (dragEl) { dragEl.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; } });
$("#queue").addEventListener("dragover", e => {
  const lane = e.target.closest(".lane"); if (!dragEl || !lane) return;
  e.preventDefault();
  const cards = lane.querySelector(".qcards"), over = e.target.closest(".qcard");
  cards.querySelector(".qempty")?.remove();
  if (over && over !== dragEl) {
    const r = over.getBoundingClientRect();
    cards.insertBefore(dragEl, e.clientX > r.left + r.width / 2 ? over.nextSibling : over);
  } else if (!over && dragEl.parentElement !== cards) cards.appendChild(dragEl);
});
$("#queue").addEventListener("drop", e => e.preventDefault());
$("#queue").addEventListener("dragend", () => {
  if (!dragEl) return;
  dragEl = null;
  const byId = new Map(queue.map(q => [q.id, q]));
  queue = [...document.querySelectorAll("#queue .lane")].flatMap(l => [...l.querySelectorAll(".qcard")].map(c => ({ ...byId.get(c.dataset.qid), stage: l.dataset.lane })));
  saveQueue(); renderQueue(); syncAddButtons();
});

// ---------- crumbs, lede, panel ----------
function renderCrumbs() {
  const path = []; for (let a = state.focus; a; a = parentOf(a)) path.unshift(a);
  crumbs.innerHTML = `<button class="up" ${parentOf(state.focus) ? "" : "disabled"} title="Zoom out (Esc)">↑ Out</button>`
    + path.map((a, i) => i === path.length - 1 ? `<span class="here">${esc(a.title || a.name)}</span>`
      : `<button data-id="${esc(a.id)}">${esc(a.title || a.name)}</button><span class="sep">›</span>`).join("");
}
crumbs.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || busy) return;
  if (b.classList.contains("up")) return zoomOut();
  setFocus(nodes.get(b.dataset.id));
});
const ORDER = { size: ["largest", "smallest"], karma: ["highest karma", "lowest karma"], date: ["newest", "oldest"], rank: ["best ranked", "lowest ranked"] };
function renderLede() {
  const names = SOURCES.filter(s => state.sources.has(s.key)).map(s => s.name === "Best of LessWrong" ? s.name : s.name.toLowerCase());
  const list = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names.at(-1) : names[0] || "nothing";
  $("#lede").innerHTML = loadingPosts ? `<span class="loading">Loading 19,000 posts…</span>`
    : `${itemCount(root).toLocaleString("en")} items from <b>${esc(list)}</b>, grouped by ${GROUPS[state.group].label.toLowerCase()}, ${ORDER[state.sort][state.dir === "down" ? 0 : 1]} first; area is ${AREAS[state.area].label.toLowerCase()}.`;
}
function renderPanel() {
  const n = state.selected || state.hover || state.focus;
  if (!n) return;
  const kind = { root: "Your selection", group: GROUPS[state.group].label, more: "The rest", collection: "Core collection", chapter: "Chapter",
    sequence: n.sources?.has("communitySeq") ? "Community sequence" : "Curated sequence",
    post: n.winner ? `Best of LessWrong ${n.winner.year}` : n.curatedAt ? "Curated post" : "Post" }[n.kind];
  const pic = n.kind === "post" ? n.winner?.art : n.kind === "group" || n.kind === "more" ? stageArt(n) : n.banner || n.img;
  const actions = [];
  if (n.kind === "post") actions.push(`<a class="btn primary" href="${esc(n.url)}" target="_blank" rel="noopener">Read ↗</a>`);
  if (n.kind === "sequence" || n.kind === "collection") actions.push(`<a class="btn" href="${esc(n.url)}" target="_blank" rel="noopener">Open ↗</a>`);
  if (n !== state.focus && n.children) actions.push(`<button class="btn primary" data-act="zoom" data-id="${esc(n.id)}">Zoom in</button>`);
  if (n.kind === "post" || n.kind === "sequence" || n.kind === "collection")
    actions.push(`<button class="btn qbtn${isQueued(n) ? " on" : ""}" data-add="${esc(n.id)}">${isQueued(n) ? "✓ In your queue" : "+ Reading queue"}</button>`);
  if (n === state.focus && parentOf(n)) actions.push(`<button class="btn" data-act="out">↑ Zoom out</button>`);
  const stat = (b, l) => `<div><b>${b}</b>${l}</div>`;
  const li = c => `<li><button data-act="zoom" data-id="${esc(c.id)}">${c.winner ? `<span class="gold">★</span> ` : ""}${esc(c.title || c.name)}</button><span class="n">${c.kind === "post" ? `${c.score} karma` : hrs(minutesOf(c))}</span></li>`;
  let by = "", body = "";
  if (n.kind === "post") {
    by = [n.author?.name, n.date ? new Date(n.date).toLocaleDateString("en", { year: "numeric", month: "short" }) : null].filter(Boolean).join(" · ");
    body = `<div class="p-stats">${stat(n.score, "karma")}${stat(`${n.minutes} min`, "reading")}${stat(esc(topicByKey[n.topic]?.name || ""), "topic")}</div>`
      + (n.winner ? `<p class="winline">Ranked #${n.winner.ranking + 1} in the ${n.winner.year} Review</p>` : "")
      + (n.tags?.length ? `<div class="tags">${n.tags.slice(0, 6).map(t => `<span>${esc(t)}</span>`).join("")}</div>` : "");
  } else if (n.kind === "sequence" || n.kind === "collection") {
    by = [n.author?.name, years(n)].filter(Boolean).join(" · ");
    body = `<div class="p-stats">${stat(hrs(n.minutes), "reading")}${stat(n.posts, n.posts === 1 ? "post" : "posts")}${stat(n.score, "median karma")}</div>`
      + (n.winners ? `<p class="winline">★ ${plural(n.winners, "Best of LessWrong winner")} inside</p>` : "")
      + (n.description ? `<p class="p-desc">${esc(n.description)}</p>` : "")
      + `<div class="p-h">Contents</div><ul class="p-list">${n.children.slice(0, 12).map(li).join("")}${n.children.length > 12 ? `<li class="muted">… ${n.children.length - 12} more</li>` : ""}</ul>`;
  } else if (n.kind === "root") {
    by = `${plural(itemCount(n), "item")}`;
    const tot = val(n) || 1;
    body = `<div class="p-h">Share of ${AREAS[state.area].label.toLowerCase()}</div><div class="bars">`
      + n.children.slice().sort((a, b) => val(b) - val(a)).map(g => `<button class="bar" data-act="zoom" data-id="${esc(g.id)}"><span class="bn">${esc(g.name)}</span><span class="bv">${Math.round(100 * val(g) / tot)}%</span><span class="track"><span class="fill" style="width:${(100 * val(g) / tot).toFixed(1)}%;background:${hueOf(g)}"></span></span></button>`).join("") + `</div>`
      + `<p class="hint">Hover a cell to see it; click to zoom in or open a post; <b>+</b> queues it. Esc zooms out.</p>`;
  } else {
    by = `${plural(n.children.length, "item")} · ${hrs(minutesOf(n))}`;
    body = `<div class="p-h">First in this ${n.kind === "chapter" ? "chapter" : "group"}</div><ul class="p-list">${n.children.slice(0, 10).map(li).join("")}</ul>`;
  }
  panel.innerHTML = `<button class="grab" aria-label="Show details"></button>${pic ? `<div class="p-img" style="background-image:url('${esc(pic)}')"></div>` : ""}
    <div class="p-body"><div class="p-kind" style="color:${hueOf(n)}"><span class="dot" style="background:${hueOf(n)}"></span>${esc(kind)}</div>
    <h2 class="p-title">${esc(n.title || n.name)}</h2>${by ? `<div class="p-by">${esc(by)}</div>` : ""}
    <div class="p-actions">${actions.join("")}</div>${body}</div>`;
}
panel.addEventListener("click", e => {
  const add = e.target.closest("[data-add]");
  if (add) { toggleQueue(nodes.get(add.dataset.add), add); return; }
  const b = e.target.closest("[data-act]");
  if (b?.dataset.act === "zoom") { const n = nodes.get(b.dataset.id); if (n) { panel.classList.remove("open"); activate(n); } return; }
  if (b?.dataset.act === "out") { zoomOut(); return; }
  if (e.target.closest(".grab") || (e.target.closest(".p-title, .p-kind") && innerWidth <= 800)) panel.classList.toggle("open");
});
function renderAll() { renderCrumbs(); renderPanel(); renderLede(); renderControls(); }

// ---------- controls ----------
function renderControls() {
  $("#sources").innerHTML = `<span class="seg-l">Show</span>` + SOURCES.map(s =>
    `<button class="src${state.sources.has(s.key) ? " on" : ""}" data-src="${s.key}" aria-pressed="${state.sources.has(s.key)}"${s.note ? ` data-note="${esc(s.note)}"` : ""}>${esc(s.name)}</button>`).join("");
  const seg = (id, dict, key) => {
    const el = $(id), label = el.querySelector(".seg-l").outerHTML;
    const opts = Object.entries(dict).filter(([k]) => k !== "rank" || state.sources.has("bolw"));
    // Sorts carry their direction: a click on the active one turns it round.
    const arrow = k => key !== "sort" ? "" : `<span class="dir${state.sort === k ? " on" : ""}">${state.sort === k && state.dir === "up" ? "↑" : "↓"}</span>`;
    el.innerHTML = label + opts.map(([k, v]) => `<button data-v="${k}" aria-pressed="${state[key] === k}">${v.label}${arrow(k)}</button>`).join("");
  };
  seg("#group", GROUPS, "group"); seg("#sort", SORTS, "sort"); seg("#area", AREAS, "area");
  $("#look").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === state.look));
  const active = PRESETS.find(p => p.g === state.group && p.o === state.sort && state.dir === "down" && p.a === state.area && p.s.length === state.sources.size && p.s.every(s => state.sources.has(s)));
  $("#presets").innerHTML = `<span class="seg-l">Views</span>` + PRESETS.map(p => `<button data-preset="${p.key}" class="${active === p ? "on" : ""}">${esc(p.name)}</button>`).join("");
}
async function apply(changes, { morph = true } = {}) {
  Object.assign(state, changes);
  if (!state.sources.has("bolw") && state.sort === "rank") state.sort = "karma";
  saveState();
  if ((state.sources.has("everything") || state.sources.has("curatedPosts")) && !posts) {
    loadingPosts ??= fetch("../../data/posts.json").then(r => r.json()).then(d => { posts = d; pool = buildPool(lib, art, posts); loadingPosts = null; });
    renderControls(); renderLede();
    await loadingPosts;
  }
  const chain = []; for (let a = state.focus; a; a = parentOf(a)) chain.push(a.id);
  rebuild();
  const keep = chain.map(id => nodes.get(id)).find(Boolean) || root;
  if (!layer) return setFocus(keep, { push: false, enter: true });
  if (keep.id !== state.focus.id) return setFocus(keep, { push: false }); // what we looked at is gone: fade to its nearest ancestor
  state.focus = keep; state.hover = null; state.selected = null; hovStage = null;
  paint(layer, keep, { morph });
  renderAll();
}
$("#sources").addEventListener("click", e => {
  const b = e.target.closest("[data-src]"); if (!b) return;
  const s = new Set(state.sources); s.has(b.dataset.src) ? s.delete(b.dataset.src) : s.add(b.dataset.src);
  apply({ sources: s });
});
for (const [id, key] of [["#group", "group"], ["#area", "area"], ["#look", "look"]])
  $(id).addEventListener("click", e => { const b = e.target.closest("button[data-v]"); if (b && state[key] !== b.dataset.v) apply({ [key]: b.dataset.v }); });
$("#sort").addEventListener("click", e => {
  const b = e.target.closest("button[data-v]"); if (!b) return;
  apply(state.sort === b.dataset.v ? { dir: state.dir === "down" ? "up" : "down" } : { sort: b.dataset.v, dir: "down" });
});
$("#presets").addEventListener("click", e => {
  const b = e.target.closest("[data-preset]"); if (!b) return;
  const p = PRESETS.find(p => p.key === b.dataset.preset);
  if (state.focus !== root) history.replaceState(null, "", location.search);
  apply({ sources: new Set(p.s), group: p.g, sort: p.o, dir: "down", area: p.a, look: p.key === "bolw" || p.key === "years" ? "art" : state.look, focus: root });
});

function fromHash() { const id = decodeURIComponent(location.hash.slice(1)); return id && nodes.get(id) || null; }
addEventListener("popstate", () => { const n = fromHash() || root; if (n !== state.focus) setFocus(n, { push: false }); });
let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => layer && paint(layer, state.focus), 120); }).observe(map);
$("#fetched").textContent = new Date(lib.fetchedAt).toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" });

renderQueue();
await apply({}, { morph: false });
{ const n = fromHash(); if (n && n !== root) setFocus(n, { push: false }); }
