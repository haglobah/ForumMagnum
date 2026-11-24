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
const state = { sources: new Set(PRESETS[0].s), group: "topic", sort: "size", dir: "down", area: "time",
  focus: null, hover: null, selected: null,
  expanded: null, grow: 0 }; // the group opened in place (the Best of LessWrong's click on a section title), and how many pages its "more" has added
{
  const u = new URLSearchParams(location.search);
  if (u.get("s")) state.sources = new Set(u.get("s").split(",").filter(k => SOURCES.some(s => s.key === k)));
  if (GROUPS[u.get("g")]) state.group = u.get("g");
  if (SORTS[u.get("o")]) state.sort = u.get("o");
  if (u.get("o") === "newest" || u.get("o") === "oldest") state.sort = "date"; // the old addresses
  if (u.get("d") === "up" || u.get("o") === "oldest") state.dir = "up";
  if (AREAS[u.get("a")]) state.area = u.get("a");
  state.expanded = u.get("x") || null;
  state.grow = state.expanded ? Math.max(0, parseInt(u.get("more")) || 0) : 0;
}
function saveState() {
  const u = new URLSearchParams();
  u.set("s", [...state.sources].join(",")); u.set("g", state.group); u.set("o", state.sort); u.set("a", state.area);
  if (state.dir === "up") u.set("d", "up");
  if (state.expanded) u.set("x", state.expanded);
  if (state.expanded && state.grow && (!state.focus || state.focus === root)) u.set("more", state.grow);
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
// px² below which items fold into "N more": every card gets room for a title, as on the Best of LessWrong page.
const minCell = () => state.area === "equal" ? 105 * 105 : 96 * 84;
const STRIP = 38, HEAD = 30;
// "N more" is one tile the size of a typical one shown (the Best of LessWrong's "show all"),
// not the true size of what it holds, or it would squeeze the rest into slivers.
function moreOf(parent, rest, shown) {
  const more = { id: "more:" + parent.id, kind: "more", name: `${rest.length.toLocaleString("en")} more`, children: rest, parent, hue: parent.hue, topic: parent.topic,
    tile: shown.map(val).sort((a, b) => a - b)[Math.floor(shown.length / 2)] || 1 };
  nodes.set(more.id, more);
  return more;
}
// Lays a parent's items out page by page: the first page in rect, each "more" click (state.grow) one more page below it,
// so the cards already shown stay where they are. Given slots (an earlier layout of the first page, already placed),
// the first page keeps them. Answers the cells and where the last page ends.
function paged(parent, kids, rect, grow, slots = null) {
  const out = [];
  let i = 0, y = rect.y;
  for (let p = 0; p <= grow && i < kids.length; p++) {
    const left = kids.length - i;
    const fits = p === 0 && slots ? slots.length : Math.max(1, Math.floor(rect.w * rect.h / minCell()));
    // A last, short page is only as tall as its cards need.
    const h = p === 0 ? rect.h : Math.min(rect.h, Math.max(110, Math.ceil(Math.min(left, fits) * minCell() * 1.5 / rect.w)));
    let page = kids.slice(i, i + fits), more = null;
    if (p === grow && left > fits) { page = kids.slice(i, i + fits - 1); more = moreOf(parent, kids.slice(i + fits - 1), page); }
    i += page.length;
    const cells = more ? [...page, more] : page;
    const rs = p === 0 && slots ? slots : squarify(cells.map(val), { x: rect.x, y, w: rect.w, h });
    cells.forEach((c, j) => out.push({ node: c, rect: rs[j], role: "cell" }));
    y += h;
  }
  return { out, bottom: y };
}
const WORK = new Set(["sequence", "collection", "chapter"]);
// Inside a work, posts keep their reading order unless sorted by size.
function ordered(focus) {
  const kids = focus.children.filter(c => val(c) > 0);
  if (WORK.has(focus.kind) && state.sort === "size") return kids.sort((a, b) => (state.dir === "up" ? -1 : 1) * (val(b) - val(a)));
  return kids;
}
const innerOf = r => ({ x: r.x, y: r.y + HEAD, w: r.w, h: r.h - HEAD });
const hasCells = r => r.w >= 30 && r.h >= HEAD + 14;
// Answers the cells and groups, and the height they need (more than H once pages grow below).
function layout(focus, W, H) {
  const full = { x: 0, y: 0, w: W, h: H };
  if (focus.kind !== "root") {
    const { out, bottom } = paged(focus, ordered(focus), full, state.grow);
    return { out, height: Math.max(H, bottom), pageH: H };
  }
  const gs = ordered(focus), rects = squarify(gs.map(val), full);
  const open = state.expanded && gs.find(g => g.id === state.expanded);
  if (!open) {
    const out = [];
    gs.forEach((g, i) => {
      out.push({ node: g, rect: rects[i], role: "group" });
      if (hasCells(rects[i])) out.push(...paged(g, g.children, innerOf(rects[i]), 0).out);
    });
    return { out, height: H };
  }
  return layoutOpen(gs, rects, open, W, H);
}
// One section opened in place: every other one is pushed to the edge it lay towards (left and right ones fold to
// titles on end, those above and below to title bars), and the open one grows into the room between, its cards
// where they were, only larger; "more" then adds pages below, and the map grows to hold them.
function layoutOpen(gs, rects, open, W, H) {
  const O = rects[gs.indexOf(open)], sides = { left: [], right: [], top: [], bottom: [] };
  gs.forEach((g, i) => {
    if (g === open) return;
    const r = rects[i];
    const side = r.x + r.w <= O.x + .5 ? "left" : r.x >= O.x + O.w - .5 ? "right" : r.y + r.h <= O.y + .5 ? "top" : "bottom";
    sides[side].push({ g, r });
  });
  sides.left.sort((a, b) => a.r.x - b.r.x || a.r.y - b.r.y); sides.right.sort((a, b) => a.r.x - b.r.x || a.r.y - b.r.y);
  sides.top.sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x); sides.bottom.sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
  const L = sides.left.length, R = sides.right.length, T = sides.top.length, B = sides.bottom.length;
  const cx = L * STRIP, cw = W - (L + R) * STRIP;
  const inner = { x: cx, y: T * HEAD + HEAD, w: cw, h: H - (T + B + 1) * HEAD };
  // The first page: the cards the section showed, scaled into its new room.
  let slots = null;
  if (hasCells(O)) {
    const oi = innerOf(O), first = paged(open, open.children, oi, 0).out;
    const sx = inner.w / oi.w, sy = inner.h / oi.h;
    slots = first.map(c => ({ x: inner.x + (c.rect.x - oi.x) * sx, y: inner.y + (c.rect.y - oi.y) * sy, w: c.rect.w * sx, h: c.rect.h * sy }));
  }
  const { out: cells, bottom } = paged(open, open.children, inner, state.grow, slots);
  const height = Math.max(H, bottom + B * HEAD), out = [];
  sides.left.forEach(({ g }, j) => out.push({ node: g, rect: { x: j * STRIP, y: 0, w: STRIP, h: height }, role: "group", strip: true }));
  sides.right.forEach(({ g }, j) => out.push({ node: g, rect: { x: W - (R - j) * STRIP, y: 0, w: STRIP, h: height }, role: "group", strip: true }));
  sides.top.forEach(({ g }, j) => out.push({ node: g, rect: { x: cx, y: j * HEAD, w: cw, h: HEAD }, role: "group", bar: true }));
  sides.bottom.forEach(({ g }, j) => out.push({ node: g, rect: { x: cx, y: height - (B - j) * HEAD, w: cw, h: HEAD }, role: "group", bar: true }));
  out.push({ node: open, rect: { x: cx, y: T * HEAD, w: cw, h: height - (T + B) * HEAD }, role: "group", open: true }, ...cells);
  return { out, height, pageH: inner.h };
}
// ---------- art ----------
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
// A cell is a card of the Best of LessWrong page (TopPostsPage's ImageGridPost): 13px Gill Sans in white at the
// bottom, a glow of black behind it, the author top right on hover; no numbers, the area says how big it is.
const LINE = 15; // 13px at line-height normal
function cellHTML(n, r) {
  const { w, h } = r;
  if (n.kind === "more") return w < 40 || h < 20 ? "" : `<div class="lab more">${esc(n.name)}</div>`;
  const q = isQueued(n);
  const add = n.kind !== "chapter" && w > 50 && h > 46
    ? `<button class="add${q ? " on" : ""}" data-add="${esc(n.id)}" aria-label="Add to reading list">${q ? "✓" : "+"}</button>` : "";
  // A card too small for a few words of its title shows none: the card above tells what it is.
  if (w < 76 || h < 2 * LINE + 6) return add;
  const by = n.author?.name && h > 3 * LINE + 8 ? `<div class="au">${esc(n.author.name)}</div>` : "<div></div>";
  const lines = Math.min(6, Math.max(1, Math.floor((h - 6 - (by.length > 11 ? LINE + 2 : 0)) / LINE)));
  return `<div class="lab">${by}<div class="t" style="-webkit-line-clamp:${lines}">${esc(n.title)}</div></div>${add}`;
}
function groupHead(n, r, { strip = false, open = false } = {}) {
  if (strip) return `<div class="gh" data-id="${esc(n.id)}"><span class="gn">${esc(n.name)}</span></div>`;
  if (r.w < 70 && !open) return `<div class="gh" data-id="${esc(n.id)}"></div>`;
  return `<div class="gh" data-id="${esc(n.id)}"><span class="gn">${esc(n.name)}</span>`
    + (open ? `<button class="gx" data-collapse aria-label="Close">×</button>` : "") + `</div>`;
}
// Grown below its first page (pageH tall), a stage's picture keeps its size and repeats below, mirrored every other
// time, as the Best of LessWrong's grids repeat theirs; so the picture behind the first page never moves.
function setStageArt(el, url, pageH = 0, total = 0) {
  const a = el.querySelector(":scope > .art.rest");
  const want = url ? `url("${url}")` : "";
  if (a && a.style.backgroundImage !== want) a.style.backgroundImage = want;
  el.querySelectorAll(":scope > .art.echo").forEach(e => e.remove());
  if (!a) return;
  const grown = url && pageH > 0 && total > pageH + 1;
  Object.assign(a.style, { height: grown ? `${pageH}px` : "", bottom: grown ? "auto" : "" });
  if (!grown) return;
  const top = a.offsetTop;
  for (let k = 1; k * pageH < total; k++)
    a.insertAdjacentHTML("afterend", `<div class="art echo" style="top:${top + k * pageH}px;height:${pageH}px;background-image:${want.replace(/"/g, "'")}${k % 2 ? ";transform:scaleY(-1)" : ""}"></div>`);
}

function paint(layer, focus, { morph = false, enter = false } = {}) {
  vals = new Map();
  const W = map.clientWidth;
  // Pages grown below make the map taller; otherwise it keeps its own height.
  map.style.height = "";
  const H = map.clientHeight, { out: items, height, pageH } = layout(focus, W, H);
  if (height > H) map.style.height = `${height}px`;
  const old = layer._els || new Map(), els = new Map();
  layer._rects = new Map();
  const staged = focus.kind !== "root";
  layer.className = `layer${staged ? " stage" : ""}${layer.classList.contains("fresh") ? " fresh" : ""}`;
  // A zoomed-in view is one stage: the map shows its art behind the cells.
  if (staged) {
    if (!layer.querySelector(":scope > .art")) layer.insertAdjacentHTML("afterbegin", `<div class="art rest"></div><div class="art hov"></div>`);
    setStageArt(layer, stageArt(focus), pageH, height);
  } else layer.querySelectorAll(":scope > .art").forEach(a => a.remove());
  if (morph) { layer.classList.add("morphing"); clearTimeout(layer._mt); layer._mt = setTimeout(() => layer.classList.remove("morphing"), 750); }
  let i = 0;
  for (const it of items) {
    const { node: n, rect: r } = it;
    const key = it.role + ":" + n.id;
    let el = old.get(key);
    const fresh = !el;
    if (fresh) { el = document.createElement("div"); el.dataset.id = n.id; }
    // Cells meet, so the picture behind them runs on unbroken; their white seams are their own borders.
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${Math.max(0, r.w)}px`, height: `${Math.max(0, r.h)}px` });
    layer._rects.set(n.id, r);
    if (it.role === "group") {
      const pic = !it.strip && !it.bar ? stageArt(n) : null;
      el.className = `group stage${pic ? "" : " bare"}${it.strip ? " strip" : ""}${it.bar ? " bar" : ""}${it.open ? " open" : ""}`;
      el.style.setProperty("--hue", hueOf(n));
      if (fresh) el.innerHTML = `<div class="art rest"></div><div class="art hov"></div><div class="ghw"></div>`;
      setStageArt(el, pic, it.open ? pageH : 0, r.h - HEAD);
      el.querySelector(".ghw").innerHTML = groupHead(n, r, it);
    } else {
      const own = n.kind === "post" && n.winner ? ownArt(n) : null;
      el.className = `cell k-${n.kind}${own ? " winner" : ""}${isRead(n) ? " read" : ""}${state.selected === n ? " sel" : ""}`;
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

// ---------- opening a card ----------
// A card opens by growing, as it is, until it fills the map (its picture with it); its own cards then come in.
// Going back, the open view shrinks into the card it came from. Nothing is magnified.
let layer = null, busy = false;
const EASE = "cubic-bezier(.35,.05,.2,1)", DUR = 520;
const isAncestor = (a, b) => { for (let x = parentOf(b); x; x = parentOf(x)) if (x === a) return true; return false; };
const clipTo = (r, W, H) => `inset(${r.y}px ${Math.max(0, W - r.x - r.w)}px ${Math.max(0, H - r.y - r.h)}px ${r.x}px)`;

function setFocus(next, { push = true, enter = false } = {}) {
  const prev = state.focus;
  state.focus = next; state.selected = null; state.hover = null; state.grow = 0; hovStage = null;
  if (push) history.pushState(null, "", location.search + (next === root ? "" : "#" + encodeURIComponent(next.id)));
  const neu = document.createElement("div");
  map.appendChild(neu);
  paint(neu, next, { enter });
  const oldLayer = layer;
  layer = neu;
  renderAll();
  if (!oldLayer || !prev || matchMedia("(prefers-reduced-motion: reduce)").matches) { oldLayer?.remove(); return; }
  const W = map.clientWidth, H = map.clientHeight;
  const down = isAncestor(prev, next), up = isAncestor(next, prev);
  let r = null;
  if (down) for (let a = next; a && !r; a = parentOf(a)) r = oldLayer._rects.get(a.id);
  else if (up) for (let a = prev; a && !r; a = parentOf(a)) r = neu._rects.get(a.id);
  if (!r || r.w < 1 || r.h < 1) {
    neu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    oldLayer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).onfinish = () => oldLayer.remove();
    return;
  }
  busy = true;
  if (down) {
    neu.classList.add("fresh");
    neu.animate([{ clipPath: clipTo(r, W, H) }, { clipPath: clipTo({ x: 0, y: 0, w: W, h: H }, W, H) }], { duration: DUR, easing: EASE }).onfinish = done;
  } else {
    map.appendChild(oldLayer); // the open view stays on top while it shrinks back into its card
    oldLayer.animate([{ clipPath: clipTo({ x: 0, y: 0, w: W, h: H }, W, H), opacity: 1 }, { clipPath: clipTo(r, W, H), opacity: .4 }],
      { duration: DUR, easing: EASE, fill: "forwards" }).onfinish = done;
  }
  function done() { oldLayer.remove(); neu.classList.remove("fresh"); busy = false; }
}
const zoomOut = () => { const p = parentOf(state.focus); if (p) setFocus(p); };
function activate(n) {
  if (n.kind === "post") { window.open(n.url, "_blank", "noopener"); return; }
  if (n.kind === "group" && state.focus === root) return expand(n.id === state.expanded ? null : n.id);
  if (n.kind === "more") {
    // At the top, "N more" opens its section in place; in an open section or a work, it adds the next page below.
    if (state.focus === root && state.expanded !== n.parent.id) return expand(n.parent.id);
    return growMore();
  }
  if (n !== state.focus) setFocus(n);
}
function expand(id) {
  state.expanded = id; state.grow = 0; state.hover = null; hovStage = null;
  saveState();
  paint(layer, state.focus, { morph: true });
  renderPanel();
}
function growMore() {
  const before = map.clientHeight;
  state.grow++; state.hover = null; hovStage = null;
  saveState();
  paint(layer, state.focus, { morph: true });
  renderPanel();
  // Bring the new page into view.
  const top = map.getBoundingClientRect().top + scrollY + before - 160;
  if (top > scrollY) scrollTo({ top, behavior: "smooth" });
}

// ---------- pointer on the map ----------
let lastPointer = "mouse";
const nodeAt = t => { const el = t.closest?.("[data-id]"); return el ? nodes.get(el.dataset.id) : null; };
map.addEventListener("pointerdown", e => { lastPointer = e.pointerType; lastX = e.clientX; lastY = e.clientY; });
let lastX = 0, lastY = 0;
map.addEventListener("pointermove", e => {
  lastX = e.clientX; lastY = e.clientY;
  if (e.pointerType !== "mouse" || busy) return;
  placeCard();
  const el = e.target.closest?.(".cell"), n = el ? nodes.get(el.dataset.id) : nodeAt(e.target);
  if (n !== state.hover) { state.hover = n; stageHover(el, n); dim(n); renderPanel(); }
});
map.addEventListener("pointerleave", () => { state.hover = null; stageHover(null, null); dim(null); renderPanel(); });
// As on the Best of LessWrong page: while one card is hovered, the other cards of its section darken.
const groupOf = n => n.kind === "more" ? n.parent : parents.get(n.id);
function dim(n) {
  const top = state.focus.kind === "root";
  const g = n && n.kind !== "group" ? (top ? groupOf(n) : state.focus) : null;
  layer?._els.forEach((el, key) => {
    if (!key.startsWith("cell:")) return;
    const m = nodes.get(el.dataset.id);
    el.classList.toggle("dim", !!g && !!m && m !== n && (!top || groupOf(m) === g));
  });
}
map.addEventListener("click", e => {
  if (e.target.closest("[data-collapse]")) { e.stopPropagation(); expand(null); return; }
  const add = e.target.closest("[data-add]");
  if (add) { e.stopPropagation(); toggleQueue(nodes.get(add.dataset.add), add); return; }
  const n = nodeAt(e.target);
  if (!n || busy) return;
  if (lastPointer === "touch" || lastPointer === "pen") { state.selected === n ? activate(n) : select1(n); return; }
  activate(n);
});
const back = () => state.expanded && state.focus === root ? expand(null) : zoomOut();
map.addEventListener("keydown", e => { if (e.key === "Escape" || e.key === "Backspace") { e.preventDefault(); back(); } });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && document.activeElement === document.body) back();
});
function select1(n) {
  state.selected = n; state.hover = null;
  layer.querySelectorAll(".sel").forEach(el => el.classList.remove("sel"));
  layer._els.get("cell:" + n.id)?.classList.add("sel");
  renderPanel();
}

// ---------- the reading list: one row, what you're reading first, then what's next; what you've read behind its count ----------
const QKEY = "atlas12:queue";
let queue = JSON.parse(localStorage.getItem(QKEY) || localStorage.getItem("atlas11:queue") || "[]").map(q => ({ stage: "queue", ...q }));
let showRead = localStorage.getItem("atlas12:showRead") === "1";
const baseId = n => n.kind === "post" ? "p:" + n.postId : n.id;
const entryOf = n => n ? queue.find(q => q.id === baseId(n)) : null;
const isQueued = n => !!entryOf(n);
const karmaOf = n => n.kind === "post" ? n.score : n.karma;
function saveQueue() { localStorage.setItem(QKEY, JSON.stringify(queue)); }
const isRead = n => entryOf(n)?.stage === "read";
const ON_LIST = { queue: "✓ On your list", reading: "✓ Reading", read: "✓ Read" };
// After the reading list changes: the + buttons, and which cells show as read.
function syncAddButtons() {
  layer?._els.forEach((el, key) => { if (key.startsWith("cell:")) { const m = nodes.get(el.dataset.id); if (m) el.classList.toggle("read", isRead(m)); } });
  document.querySelectorAll("[data-add]").forEach(b => {
    const m = nodes.get(b.dataset.add); if (!m) return;
    const e = entryOf(m); b.classList.toggle("on", !!e);
    b.textContent = b.classList.contains("qbtn") ? (e ? ON_LIST[e.stage] : "+ Reading list") : e ? "✓" : "+";
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
  if (stage === "read" && !showRead) $("#queue .qread")?.animate([{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], { duration: 400 });
}
function fly(from, n) {
  const src = (from?.closest(".cell, .panel") || from)?.getBoundingClientRect();
  const card = $(`#queue .qcard[data-qid="${CSS.escape(baseId(n))}"]`), slot = card?.getBoundingClientRect();
  if (!src || !slot || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const g = document.createElement("div"), img = ownArt(n);
  g.className = "ghost";
  g.style.cssText = `left:${src.left}px;top:${src.top}px;width:${src.width}px;height:${src.height}px;background:${img ? `url('${img}') center/cover` : hueOf(n)}`;
  document.body.appendChild(g);
  const dx = slot.left - src.left, dy = slot.top - src.top;
  g.animate([{ transform: "none", opacity: .95 }, { transform: `translate(${dx}px, ${dy}px) scale(${slot.width / src.width}, ${slot.height / src.height})`, opacity: .35 }],
    { duration: 650, easing: "cubic-bezier(.5,0,.2,1)" }).onfinish = () => g.remove();
  card.animate([{ opacity: 0 }, { opacity: 0, offset: .8 }, { opacity: 1 }], { duration: 700 });
}
// A card of the list is a card of the Best of LessWrong page too, square, with its moves on hover.
const MOVES = { queue: [["reading", "Start"]], reading: [["read", "Done"], ["queue", "Later"]], read: [["queue", "Again"]] };
function cardHTML(x) {
  const n = nodes?.get(x.id), img = x.img || (n && stageArt(groupOf(n) || n)); // what was listed without art shows its section's
  return `<div class="qcard s-${x.stage}" draggable="true" data-qid="${esc(x.id)}" style="${img ? `background-image:url('${esc(img)}')` : `background-color:${x.hue}`}">
    <a class="qbody" href="${esc(x.url)}" target="_blank" rel="noopener"><span class="au">${esc(x.author || "")}</span><span class="t">${esc(x.title)}</span></a>
    <div class="qact">${MOVES[x.stage].map(([k, l]) => `<button data-move="${k}">${l}</button>`).join("")}<button class="qx" data-qx aria-label="Remove">×</button></div></div>`;
}
function renderQueue() {
  const el = $("#queue"), by = k => queue.filter(q => q.stage === k);
  const ahead = [...by("reading"), ...by("queue")], done = by("read");
  el.hidden = !queue.length;
  if (!queue.length) { el.innerHTML = ""; return; }
  const sum = ahead.length ? `${ahead.length} · ${hrs(ahead.reduce((a, x) => a + (x.minutes || 0), 0))}` : "all read";
  el.innerHTML = `<div class="qhead ui"><span class="ql">Reading list</span><span class="qs">${sum}</span>`
    + (done.length ? `<button class="qread" data-toggle-read aria-expanded="${showRead}">${done.length} read</button>` : "") + `</div>`
    + `<div class="qcards">${[...ahead, ...(showRead ? done : [])].map(cardHTML).join("")}</div>`;
}
$("#queue").addEventListener("click", e => {
  const card = e.target.closest(".qcard");
  const mv = e.target.closest("[data-move]");
  if (mv && card) { e.preventDefault(); moveTo(card.dataset.qid, mv.dataset.move); return; }
  if (e.target.closest("[data-qx]") && card) { e.preventDefault(); flip(() => { queue = queue.filter(q => q.id !== card.dataset.qid); }); return; }
  if (e.target.closest("[data-toggle-read]")) { showRead = !showRead; localStorage.setItem("atlas12:showRead", showRead ? "1" : ""); flip(() => {}); }
});
// Dragging reorders the row (what you're reading stays in front).
let dragEl = null;
$("#queue").addEventListener("dragstart", e => { dragEl = e.target.closest(".qcard"); if (dragEl) { dragEl.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; } });
$("#queue").addEventListener("dragover", e => {
  if (!dragEl) return;
  e.preventDefault();
  const over = e.target.closest(".qcard");
  if (over && over !== dragEl) {
    const r = over.getBoundingClientRect();
    over.parentElement.insertBefore(dragEl, e.clientX > r.left + r.width / 2 ? over.nextSibling : over);
  }
});
$("#queue").addEventListener("drop", e => e.preventDefault());
$("#queue").addEventListener("dragend", () => {
  if (!dragEl) return;
  dragEl = null;
  const order = [...document.querySelectorAll("#queue .qcard")].map(c => c.dataset.qid);
  const at = q => { const i = order.indexOf(q.id); return i < 0 ? Infinity : i; };
  queue.sort((a, b) => at(a) - at(b));
  saveQueue(); renderQueue(); syncAddButtons();
});

// ---------- crumbs, lede, the card ----------
// Zoomed in, the path takes the lede's place under the title.
function renderCrumbs() {
  const path = []; for (let a = state.focus; a; a = parentOf(a)) path.unshift(a);
  const zoomed = path.length > 1;
  crumbs.hidden = !zoomed;
  if (!zoomed) { crumbs.innerHTML = ""; return; }
  const name = a => a === root ? "All" : a.title || a.name;
  crumbs.innerHTML = `<button class="up" title="Zoom out (Esc)">↑ Out</button>`
    + path.map((a, i) => i === path.length - 1 ? `<span class="here">${esc(name(a))}</span>`
      : `<button data-id="${esc(a.id)}">${esc(name(a))}</button><span class="sep">›</span>`).join("");
}
crumbs.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || busy) return;
  if (b.classList.contains("up")) return zoomOut();
  setFocus(nodes.get(b.dataset.id));
});
function renderLede() {
  $("#lede").innerHTML = loadingPosts ? `<span class="loading">Loading 19,000 posts…</span>` : "";
}
// The card: what the pointer rests on, following it beside the pointer; on touch, what was tapped, with its buttons.
let showTimer = null;
function renderPanel() {
  const n = state.selected || (state.hover && state.hover.kind !== "root" ? state.hover : null);
  clearTimeout(showTimer);
  if (!n) { panel.classList.remove("show", "sel"); return; }
  panel.innerHTML = cardFor(n, !!state.selected);
  panel.classList.toggle("sel", !!state.selected);
  placeCard();
  if (state.selected || panel.classList.contains("show")) panel.classList.add("show");
  else showTimer = setTimeout(() => panel.classList.add("show"), 250);
}
// Right of and below the pointer; left of it where the screen ends, and kept inside it from top to bottom.
function placeCard() {
  if (innerWidth <= 800) { panel.style.transform = ""; return; }
  const w = panel.offsetWidth, h = panel.offsetHeight, gap = 18;
  const x = lastX + gap + w > innerWidth - 8 ? lastX - gap - w : lastX + gap;
  const y = Math.max(72, Math.min(lastY + gap, innerHeight - 8 - h));
  panel.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
function cardFor(n, buttons) {
  const kind = { group: GROUPS[state.group].label, more: "The rest", collection: "Core collection", chapter: "Chapter",
    sequence: n.sources?.has("communitySeq") ? "Community sequence" : "Curated sequence",
    post: n.winner ? `Best of LessWrong ${n.winner.year} · #${n.winner.ranking + 1}` : n.curatedAt ? "Curated post" : "Post" }[n.kind];
  const pic = n.kind === "post" ? n.winner?.art : n.kind === "group" || n.kind === "more" ? stageArt(n) : n.banner || n.img;
  const date = n.date ? new Date(n.date).toLocaleDateString("en", { year: "numeric", month: "short" }) : null;
  const work = n.kind === "sequence" || n.kind === "collection";
  const meta = n.kind === "post" ? [n.author?.name, date, `${n.score} karma`, `${n.minutes} min`]
    : work ? [n.author?.name, years(n), plural(n.posts, "post"), hrs(n.minutes)]
    : [plural(n.children.length, "item"), hrs(minutesOf(n))];
  const actions = [];
  if (buttons) {
    if (n.kind === "post") actions.push(`<a class="btn primary" href="${esc(n.url)}" target="_blank" rel="noopener">Read ↗</a>`);
    if (work) actions.push(`<a class="btn" href="${esc(n.url)}" target="_blank" rel="noopener">Open ↗</a>`);
    if (n.children) actions.push(`<button class="btn${work ? "" : " primary"}" data-act="zoom" data-id="${esc(n.id)}">Zoom in</button>`);
    if (n.kind === "post" || work) {
      const e = entryOf(n);
      actions.push(`<button class="btn qbtn${e ? " on" : ""}" data-add="${esc(n.id)}">${e ? ON_LIST[e.stage] : "+ Reading list"}</button>`);
    }
  }
  return `${buttons ? `<button class="grab" aria-label="Close"></button>` : ""}${pic ? `<div class="p-img" style="background-image:url('${esc(pic)}')"></div>` : ""}
    <div class="p-body"><div class="p-kind">${esc(kind)}</div><h2 class="p-title">${esc(n.title || n.name)}</h2>
    <div class="p-by">${meta.filter(Boolean).map(esc).join(" · ")}</div>
    ${work && n.description ? `<p class="p-desc">${esc(n.description)}</p>` : ""}${actions.length ? `<div class="p-actions">${actions.join("")}</div>` : ""}</div>`;
}
function deselect() { state.selected = null; layer?.querySelectorAll(".sel").forEach(el => el.classList.remove("sel")); renderPanel(); }
panel.addEventListener("click", e => {
  const add = e.target.closest("[data-add]");
  if (add) { toggleQueue(nodes.get(add.dataset.add), add); return; }
  const b = e.target.closest("[data-act]");
  if (b?.dataset.act === "zoom") { const n = nodes.get(b.dataset.id); deselect(); if (n) activate(n); return; }
  if (e.target.closest(".grab")) deselect();
});
function renderAll() { renderCrumbs(); renderPanel(); renderLede(); renderControls(); }

// ---------- controls: the views, and behind "Customize" what they are made of ----------
function renderControls() {
  $("#sources").innerHTML = `<span class="seg-l">Show</span>` + SOURCES.map(s =>
    `<button class="src${state.sources.has(s.key) ? " on" : ""}" data-src="${s.key}" aria-pressed="${state.sources.has(s.key)}"${s.note ? ` data-note="${esc(s.note)}"` : ""}>${esc(s.name)}</button>`).join("");
  const seg = (id, dict, key) => {
    const el = $(id), label = el.querySelector(".seg-l").outerHTML;
    const opts = Object.entries(dict).filter(([k]) => k !== "rank" || state.sources.has("bolw"));
    // The active sort carries its direction: a click on it turns it round.
    const arrow = k => key === "sort" && state.sort === k ? `<span class="dir">${state.dir === "up" ? "↑" : "↓"}</span>` : "";
    el.innerHTML = label + opts.map(([k, v]) => `<button data-v="${k}" aria-pressed="${state[key] === k}">${v.label}${arrow(k)}</button>`).join("");
  };
  seg("#group", GROUPS, "group"); seg("#sort", SORTS, "sort");
  const active = PRESETS.find(p => p.g === state.group && p.o === state.sort && state.dir === "down" && p.a === state.area && p.s.length === state.sources.size && p.s.every(s => state.sources.has(s)));
  $("#presets").innerHTML = PRESETS.map(p => `<button data-preset="${p.key}" class="${active === p ? "on" : ""}">${esc(p.name)}</button>`).join("");
  $("#customize").classList.toggle("on", !active);
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
  if (state.expanded && !root.children.some(g => g.id === state.expanded)) { state.expanded = null; state.grow = 0; saveState(); }
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
$("#group").addEventListener("click", e => { const b = e.target.closest("button[data-v]"); if (b && state.group !== b.dataset.v) apply({ group: b.dataset.v }); });
$("#customize").addEventListener("click", e => { const c = $("#custom"); c.hidden = !c.hidden; e.currentTarget.setAttribute("aria-expanded", String(!c.hidden)); });
$("#sort").addEventListener("click", e => {
  const b = e.target.closest("button[data-v]"); if (!b) return;
  apply(state.sort === b.dataset.v ? { dir: state.dir === "down" ? "up" : "down" } : { sort: b.dataset.v, dir: "down" });
});
$("#presets").addEventListener("click", e => {
  const b = e.target.closest("[data-preset]"); if (!b) return;
  const p = PRESETS.find(p => p.key === b.dataset.preset);
  if (state.focus !== root) history.replaceState(null, "", location.search);
  apply({ sources: new Set(p.s), group: p.g, sort: p.o, dir: "down", area: p.a, focus: root, expanded: null, grow: 0 });
});

function fromHash() { const id = decodeURIComponent(location.hash.slice(1)); return id && nodes.get(id) || null; }
addEventListener("popstate", () => { const n = fromHash() || root; if (n !== state.focus) setFocus(n, { push: false }); });
// Only a change of width lays the map out anew (its height follows the layout).
let rt, lastW = 0;
new ResizeObserver(() => { if (map.clientWidth === lastW) return; lastW = map.clientWidth; clearTimeout(rt); rt = setTimeout(() => layer && paint(layer, state.focus), 120); }).observe(map);

renderQueue();
await apply({}, { morph: false });
renderQueue(); // again, now the cards can borrow their sections' art
{ const n = fromHash(); if (n && n !== root) setFocus(n, { push: false }); }
