import "../../shared/header.js";
import { loadLibrary, image, fmt } from "../../shared/library.js";
import { buildTree, index, METRICS, topicByKey, TOPICS } from "./atlas-data.js";
import { squarify } from "./treemap.js";

const lib = await loadLibrary();
const $ = s => document.querySelector(s);
const map = $("#map"), panel = $("#panel"), crumbs = $("#crumbs");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const state = { metric: "time", scope: "core", focus: null, hover: null, selected: null };
let root, nodes;

// ---------- colour: a topic's ink on paper, deeper for better-received work ----------
const PAPER = [246, 241, 232], GOLD = [222, 190, 104];
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const css = c => `rgb(${c.join(",")})`;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const quality = n => n.kind === "post"
  ? clamp((Math.log(Math.max(n.post.karma, 1)) - Math.log(8)) / (Math.log(400) - Math.log(8)))
  : clamp((Math.log(Math.max(n.karmaMedian, 1)) - Math.log(8)) / (Math.log(260) - Math.log(8)));
function tone(n) {
  if (n.kind === "post" && n.post.winner) return { bg: css(GOLD), dark: false };
  const hue = rgb(topicByKey[n.topic].hue), m = .1 + .72 * quality(n);
  return { bg: css(mix(PAPER, hue, m)), dark: m > .5 };
}
const hueOf = n => topicByKey[n.topic]?.hue || "#777";

// ---------- numbers ----------
const val = n => METRICS[state.metric].of(n);
const kfmt = k => k >= 10000 ? `${Math.round(k / 1000)}k` : k >= 1000 ? `${(k / 1000).toFixed(1)}k` : `${k}`;
const hrs = min => min < 60 ? `${min} min` : min < 600 ? `${(min / 60).toFixed(1)} h` : `${Math.round(min / 60)} h`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const metricText = n => state.metric === "time" ? hrs(n.minutes) : state.metric === "posts" ? plural(n.posts.length, "post") : `${kfmt(n.karma)} karma`;
const years = n => !n.firstYear ? "" : n.firstYear === n.lastYear ? `${n.firstYear}` : `${n.firstYear}–${String(n.lastYear).slice(2)}`;
const stars = n => n.winners.length ? `<span class="star">★${n.winners.length > 1 ? n.winners.length : ""}</span>` : "";
const works = n => n.kind === "root" ? n.children.flatMap(t => t.children) : n.children;

// ---------- layout ----------
const GROUPED = new Set(["root", "collection", "sequence", "book"]); // focus kinds whose children are drawn as labelled groups
function layout(focus, W, H) {
  const out = []; // {node, rect, role: "group"|"cell"}
  const kids = focus.children.filter(c => val(c) > 0).sort((a, b) => val(b) - val(a));
  const rects = squarify(kids.map(val), { x: 0, y: 0, w: W, h: H });
  const grouped = GROUPED.has(focus.kind) && kids.some(k => k.children);
  kids.forEach((c, i) => {
    const r = rects[i];
    const gk = c.children?.filter(g => val(g) > 0).sort((a, b) => val(b) - val(a));
    const head = focus.kind === "root" ? 26 : 20;
    if (grouped && gk?.length && r.w > 34 && r.h > head + 16) {
      out.push({ node: c, rect: r, role: "group", head });
      const pad = 2, inner = { x: r.x + pad, y: r.y + head, w: r.w - 2 * pad, h: r.h - head - pad };
      const gr = squarify(gk.map(val), inner);
      gk.forEach((g, j) => out.push({ node: g, rect: gr[j], role: "cell" }));
    } else out.push({ node: c, rect: r, role: "cell" });
  });
  return out;
}

// ---------- drawing ----------
function cellHTML(n, r, rich) {
  const { w, h } = r;
  if (w < 26 || h < 16) return "";
  const isPost = n.kind === "post";
  const area = w * h;
  let fs = clamp(Math.sqrt(area) / (rich ? 10 : 12), 11, rich ? 30 : 22);
  fs = Math.min(fs, w / 5.5);
  if (fs < 10.5) return "";
  const pad = fs > 18 ? 12 : 7;
  const metaH = h > fs * 1.2 + 30 && w > 70 ? 18 : 0;
  let bits = [];
  if (isPost) {
    const p = n.post;
    bits = [`${p.karma} karma`, `${p.minutes} min`, p.year];
  } else {
    bits = [metricText(n)];
    if (state.metric !== "posts" && n.kind !== "chapter") bits.push(plural(n.posts.length, "post"));
    if (state.metric !== "time") bits.push(hrs(n.minutes));
    if (rich && w > 200) bits.push(years(n));
  }
  const kind = rich && (n.kind === "collection") && h > 120 && w > 140 ? `<div class="kind">Core collection</div>` : "";
  const wtag = isPost && n.post.winner && h > 60 && w > 110 ? `<div class="wtag">Best of LessWrong ${n.post.winner.year}</div>` : "";
  const kindH = (kind || wtag) ? 16 : 0;
  const lines = Math.max(1, Math.floor((h - 2 * pad + 4 - metaH - kindH) / (fs * 1.12)));
  const desc = rich && n.seq?.description && w > 250 && h > 230 && n.kind === "sequence"
    ? `<div class="d" style="-webkit-line-clamp:${Math.min(6, Math.floor((h - 2 * pad - lines * fs * 1.12 - 40) / 18))}">${esc(n.seq.description)}</div>` : "";
  const titleLines = desc ? Math.min(lines, 3) : lines;
  return `<div class="lab" style="padding:${pad - 2}px ${pad}px">${kind}${wtag}<div class="t" style="font-size:${fs.toFixed(1)}px;-webkit-line-clamp:${titleLines}">${esc(n.name)}</div>`
    + (metaH ? `<div class="m">${bits.filter(Boolean).join(" · ")} ${isPost ? "" : stars(n)}</div>` : "")
    + desc + `</div>`;
}
function bgFor(n, r) {
  if (r.w < 90 || r.h < 60) return "";
  const url = n.img ? image(n.img, { w: 500, h: 340 }) : n.imgUrl || (n.kind === "book" ? null : null);
  return url ? `<div class="bg" style="background-image:url('${url}')"></div>` : "";
}
function groupHTML(n, r, focus) {
  const share = focus.kind === "root" ? `${Math.round(100 * val(n) / val(focus))}%` : "";
  const right = r.w > 150 ? [share, metricText(n)].filter(Boolean).join(" · ") : share;
  return `<div class="gh" data-id="${esc(n.id)}" style="height:${focus.kind === "root" ? 23 : 20}px;line-height:${focus.kind === "root" ? 23 : 20}px"><span class="gn">${esc(n.name)}</span><span class="gs">${right}</span></div>`;
}

function paint(layer, focus, { morph = false } = {}) {
  const W = map.clientWidth, H = map.clientHeight;
  const items = layout(focus, W, H);
  const old = layer._els || new Map(), els = new Map();
  layer._rects = new Map();
  const rich = !GROUPED.has(focus.kind) || !focus.children.some(c => c.children);
  if (morph) { layer.classList.add("morphing"); clearTimeout(layer._mt); layer._mt = setTimeout(() => layer.classList.remove("morphing"), 700); }
  for (const it of items) {
    const { node: n, rect: r } = it;
    const key = it.role + ":" + n.id;
    let el = old.get(key);
    const fresh = !el;
    if (fresh) { el = document.createElement("div"); el.dataset.id = n.id; }
    const g = it.role === "group" ? 2 : 1; // gaps between cells
    Object.assign(el.style, { left: `${r.x + g / 2}px`, top: `${r.y + g / 2}px`, width: `${Math.max(0, r.w - g)}px`, height: `${Math.max(0, r.h - g)}px` });
    layer._rects.set(n.id, r);
    if (it.role === "group") {
      el.className = `group g-${n.kind}${focus.kind !== "root" ? " g-small" : ""}`;
      el.style.color = hueOf(n);
      el.style.background = focus.kind === "root" ? `color-mix(in srgb, ${hueOf(n)} 7%, #f3eee5)` : "rgba(255,255,255,.35)";
      el.innerHTML = groupHTML(n, r, focus);
    } else {
      const t = tone(n);
      el.className = `cell k-${n.kind}${t.dark ? " dark" : ""}${n.kind === "post" && n.post.winner ? " winner" : ""}${state.selected === n ? " sel" : ""}`;
      el.style.background = t.bg;
      el.style.color = t.dark ? "#fbf8f1" : "rgba(30,24,16,.9)";
      el.innerHTML = bgFor(n, r) + cellHTML(n, r, rich);
    }
    if (fresh) { if (morph) { el.style.opacity = 0; requestAnimationFrame(() => requestAnimationFrame(() => el.style.opacity = 1)); } layer.appendChild(el); }
    old.delete(key); els.set(key, el);
  }
  for (const el of old.values()) { if (morph) { el.style.opacity = 0; setTimeout(() => el.remove(), 400); } else el.remove(); }
  layer._els = els;
}

// ---------- zooming ----------
let layer = null, busy = false;
const EASE = "cubic-bezier(.35,.05,.2,1)", DUR = 620;
const camera = (r, W, H) => `translate(${-r.x * W / r.w}px, ${-r.y * H / r.h}px) scale(${W / r.w}, ${H / r.h})`;
const shrink = (r, W, H) => `translate(${r.x}px, ${r.y}px) scale(${r.w / W}, ${r.h / H})`;

function setFocus(next, { push = true, from = null } = {}) {
  const prev = state.focus;
  state.focus = next; state.selected = null; state.hover = null;
  if (push) history.pushState(null, "", next === root ? location.pathname + location.search : "#" + encodeURIComponent(next.id));
  const W = map.clientWidth, H = map.clientHeight;
  const neu = document.createElement("div");
  neu.className = "layer";
  paint(neu, next);
  const oldLayer = layer;
  layer = neu;
  map.appendChild(neu);
  renderCrumbs(); renderPanel(); renderLede();
  if (!oldLayer || !prev || matchMedia("(prefers-reduced-motion: reduce)").matches) { oldLayer?.remove(); return; }
  const down = isAncestor(prev, next), up = isAncestor(next, prev);
  let r = null;
  if (down) { // the cell we came from, in the old layer: next, or the ancestor of next shown there
    for (let a = next; a && !r; a = a.parent) r = oldLayer._rects.get(a.id);
  } else if (up) {
    for (let a = prev; a && !r; a = a.parent) r = neu._rects.get(a.id);
  }
  if (!r || r.w < 1 || r.h < 1) {
    neu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    oldLayer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 }).onfinish = () => oldLayer.remove();
    return;
  }
  neu.classList.add("fresh");
  busy = true;
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
const isAncestor = (a, b) => { for (let x = b?.parent; x; x = x.parent) if (x === a) return true; return false; };
const zoomOut = () => { if (state.focus.parent) setFocus(state.focus.parent); };

// What a click on a node does: zoom into it, or open the post.
function activate(n) {
  if (n.kind === "post") { window.open(n.post.url, "_blank", "noopener"); return; }
  if (n === state.focus) return;
  setFocus(n);
}

// ---------- pointer ----------
let lastPointer = "mouse";
map.addEventListener("pointerdown", e => { lastPointer = e.pointerType; });
map.addEventListener("pointermove", e => {
  if (e.pointerType !== "mouse" || busy) return;
  const n = nodeAt(e.target);
  if (n && n !== state.hover) { state.hover = n; renderPanel(); }
});
map.addEventListener("click", e => {
  const n = nodeAt(e.target);
  if (!n || busy) return;
  if (lastPointer === "touch" || lastPointer === "pen") {
    // touch: the first tap shows the details, the second one goes in
    if (state.selected === n) activate(n);
    else select(n);
    return;
  }
  activate(n);
});
map.addEventListener("keydown", e => { if (e.key === "Escape" || e.key === "Backspace") { e.preventDefault(); zoomOut(); } });
document.addEventListener("keydown", e => { if (e.key === "Escape" && document.activeElement === document.body) zoomOut(); });
const nodeAt = t => { const el = t.closest?.("[data-id]"); return el ? nodes.get(el.dataset.id) : null; };
function select(n) {
  state.selected = n; state.hover = null;
  layer.querySelectorAll(".sel").forEach(el => el.classList.remove("sel"));
  layer._els.get("cell:" + n.id)?.classList.add("sel");
  renderPanel();
}

// ---------- breadcrumb & lede ----------
function renderCrumbs() {
  const path = []; for (let a = state.focus; a; a = a.parent) path.unshift(a);
  crumbs.innerHTML = `<button class="up" ${state.focus.parent ? "" : "disabled"} title="Zoom out (Esc)">↑ Out</button>`
    + path.map((a, i) => i === path.length - 1
      ? `<span class="here">${esc(a.name)}</span>`
      : `<button data-id="${esc(a.id)}">${esc(a.name)}</button><span class="sep">›</span>`).join("");
}
crumbs.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || busy) return;
  if (b.classList.contains("up")) return zoomOut();
  setFocus(nodes.get(b.dataset.id));
});
function renderLede() {
  const all = works(root);
  const ai = root.children.filter(t => t.topic.startsWith("ai")).reduce((a, t) => a + t.minutes, 0);
  $("#lede").innerHTML = `<b>${Math.round(root.minutes / 60)} hours</b> of reading in <b>${all.length} works</b>
    and ${root.posts.length.toLocaleString("en")} posts. Area is ${METRICS[state.metric].label.toLowerCase()};
    AI is <b>${Math.round(100 * ai / root.minutes)}%</b> of the reading time. Click a topic or a work to zoom in.`;
}

// ---------- panel ----------
function renderPanel() {
  const n = state.selected || state.hover || state.focus;
  const touch = lastPointer === "touch";
  const kindLabel = { root: "The whole Library", topic: "Topic", collection: "Core collection", book: "Book", sequence: n.seq?.kind === "community" ? "Community sequence" : n.seq?.kind === "book" ? "Sequence in a core collection" : "Curated sequence", chapter: "Chapter", post: "Post" }[n.kind];
  const dot = n.topic ? `<span class="dot" style="background:${hueOf(n)}"></span>` : "";
  const topicName = n.topic && n.kind !== "topic" ? ` · <span style="color:${hueOf(n)}">${esc(topicByKey[n.topic].name)}</span>` : "";
  let img = "", body = "";
  const actions = [];
  if (n !== state.focus && n.kind !== "post" && n.children) actions.push(`<button class="btn primary" data-act="zoom" data-id="${esc(n.id)}">Zoom in</button>`);
  if (n.kind === "post") actions.push(`<a class="btn primary" href="${n.post.url}" target="_blank" rel="noopener">Read on LessWrong ↗</a>`);
  else if (n.kind === "sequence") actions.push(`<a class="btn" href="${n.seq.url}" target="_blank" rel="noopener">Open sequence ↗</a>`);
  else if (n.kind === "collection") actions.push(`<a class="btn" href="${n.collection.url}" target="_blank" rel="noopener">Open ${esc(n.name.length > 22 ? "collection" : n.name)} ↗</a>`);
  if (n === state.focus && n.parent) actions.push(`<button class="btn" data-act="out">↑ Zoom out</button>`);

  let by = "";
  const stat = (b, l) => `<div><b>${b}</b>${l}</div>`;
  if (n.kind === "root") {
    by = `${works(n).length} works, ${n.posts.length.toLocaleString("en")} posts, ${Math.round(n.minutes / 60)} hours`;
    const tot = val(n);
    body = `<div class="p-h">Share of ${METRICS[state.metric].label.toLowerCase()}</div><div class="bars">`
      + n.children.slice().sort((a, b) => val(b) - val(a)).map(t => `<button class="bar" data-act="zoom" data-id="${esc(t.id)}">
          <span class="bn">${esc(t.name)}</span><span class="bv">${Math.round(100 * val(t) / tot)}% · ${metricText(t)}</span>
          <span class="track"><span class="fill" style="display:block;width:${(100 * val(t) / tot).toFixed(1)}%;background:${hueOf(t)}"></span></span></button>`).join("")
      + `</div>` + legend()
      + `<p class="hint">${touch ? "Tap a cell to see what it is, tap again to zoom in." : "Hover a cell to see what it is; click to zoom in. Esc zooms out."}</p>`;
  } else if (n.kind === "topic") {
    const ws = n.children.slice().sort((a, b) => val(b) - val(a));
    by = `${plural(ws.length, "work")} · ${hrs(n.minutes)} · ${Math.round(100 * n.minutes / root.minutes)}% of the Library's reading time`;
    body = `<p class="p-desc">${esc(n.meta.blurb)}</p>`
      + stats(n)
      + `<div class="p-h">Largest by ${METRICS[state.metric].label.toLowerCase()}</div>` + list(ws.slice(0, 7))
      + (n.winners.length ? `<p class="share">${plural(n.winners.length, "Best of LessWrong winner")} inside.</p>` : "");
  } else if (n.kind === "collection") {
    img = n.imgUrl;
    by = n.collection.subtitle || (n.collection.collection === "codex" ? "Scott Alexander" : "Eliezer Yudkowsky");
    body = stats(n) + `<p class="p-desc">${esc(n.collection.summary)}</p>`
      + (n.collection.collection === "rationality" ? `<p class="share">New to it? <a href="https://www.lesswrong.com/highlights" target="_blank" rel="noopener" style="color:var(--primary-dark)">The Sequences Highlights</a> are 50 of these posts, a day or two of reading.</p>` : "")
      + `<div class="p-h">Books</div>` + list(n.children);
  } else if (n.kind === "book") {
    by = `Book ${n.parent.children.indexOf(n) + 1} of ${esc(n.parent.name)}`;
    body = stats(n) + `<div class="p-h">Sequences</div>` + list(n.children);
  } else if (n.kind === "sequence") {
    const s = n.seq;
    img = s.gridImageId ? image(s.gridImageId, { w: 660, h: 310 }) : null;
    by = [s.author?.name, years(n)].filter(Boolean).join(" · ");
    const top = n.posts.slice().sort((a, b) => b.karma - a.karma).slice(0, 4);
    body = stats(n)
      + (n.winners.length ? `<p class="winline">★ ${plural(n.winners.length, "Best of LessWrong winner")}</p>` : "")
      + (s.description ? `<p class="p-desc">${esc(s.description)}</p>` : `<p class="share">No description; the posts speak for it.</p>`)
      + `<div class="p-h">Strongest posts</div><ul class="p-list">${top.map(p => `<li><a href="${p.url}" target="_blank" rel="noopener">${p.winner ? "★ " : ""}${esc(p.title)}</a><span class="n">${p.karma}</span></li>`).join("")}</ul>`
      + (n.children[0]?.kind === "chapter" ? `<div class="p-h">${n.children.length} chapters</div>` + list(n.children, false) : "");
  } else if (n.kind === "chapter") {
    by = `Chapter of ${esc(n.seq.title)}`;
    body = (n.subtitle ? `<p class="p-desc">${esc(n.subtitle)}</p>` : "") + stats(n)
      + `<div class="p-h">Posts</div><ul class="p-list">${n.posts.map(p => `<li><a href="${p.url}" target="_blank" rel="noopener">${p.winner ? "★ " : ""}${esc(p.title)}</a><span class="n">${p.minutes} min</span></li>`).join("")}</ul>`;
  } else if (n.kind === "post") {
    const p = n.post;
    img = p.winner ? (lib.reviewWinners.find(w => w.id === p.id)?.art || null) : null;
    by = [p.author?.name, p.postedAt ? new Date(p.postedAt).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" }) : ""].filter(Boolean).join(" · ");
    const pos = n.seq.posts.indexOf(p);
    body = (p.winner ? `<p class="winline">★ Best of LessWrong ${p.winner.year}${p.winner.category ? ` · ${esc(p.winner.category)}` : ""}${p.winner.ranking != null ? ` · #${p.winner.ranking + 1}` : ""}</p>` : "")
      + `<div class="p-stats">${stat(p.karma, "karma")}${stat(p.comments, "comments")}${stat(p.minutes + " min", fmt.words(p.words))}</div>`
      + `<p class="share">Post ${pos + 1} of ${n.seq.posts.length} in <i>${esc(n.seq.title)}</i>.</p>`
      + (p.tags.length ? `<div class="tags">${p.tags.slice(0, 8).map(t => `<span>${esc(t.name)}</span>`).join("")}</div>` : "");
  }
  panel.innerHTML = `<button class="grab" aria-label="Show details"></button>`
    + (img ? `<img class="p-img" src="${img}" alt="" loading="lazy" onerror="this.remove()">` : "")
    + `<div class="p-body"><div class="p-kind" style="color:${n.topic ? hueOf(n) : "var(--muted)"}">${dot}<span style="color:var(--muted)">${kindLabel}</span>${topicName}</div>
      <h2 class="p-title">${esc(n.name)}</h2>${by ? `<div class="p-by">${by}</div>` : ""}
      ${actions.length ? `<div class="p-actions" style="margin:0 0 14px">${actions.join("")}</div>` : ""}${body}</div>`;
}
function stats(n) {
  const s = (b, l) => `<div><b>${b}</b>${l}</div>`;
  return `<div class="p-stats">${s(hrs(n.minutes), "reading")}${s(n.posts.length, n.posts.length === 1 ? "post" : "posts")}${s(n.karmaMedian, "median karma")}</div>`;
}
function list(ns, withMetric = true) {
  return `<ul class="p-list">${ns.map(c => `<li><button data-act="zoom" data-id="${esc(c.id)}">${c.winners.length ? `<span style="color:#b08414">★</span> ` : ""}${esc(c.name)}</button><span class="n">${withMetric ? metricText(c) : hrs(c.minutes)}</span></li>`).join("")}</ul>`;
}
function legend() {
  const hue = rgb(TOPICS[2].hue);
  return `<div class="legend"><div class="p-h" style="margin-top:6px">Colour</div>
    Depth of colour is a work's median post karma.
    <div class="ramp">${[0, .2, .4, .6, .8, 1].map(q => `<span style="background:${css(mix(PAPER, hue, .1 + .72 * q))}"></span>`).join("")}</div>
    <div class="ends"><span>median 8</span><span>30</span><span>260+</span></div>
    <div style="margin-top:9px"><span class="gold"></span>A Best of LessWrong winner (inside a sequence), ★ on works that contain them.</div></div>`;
}
panel.addEventListener("click", e => {
  const b = e.target.closest("[data-act]");
  if (b?.dataset.act === "zoom") { const n = nodes.get(b.dataset.id); if (n) { panel.classList.remove("open"); n.kind === "post" ? activate(n) : setFocus(n); } return; }
  if (b?.dataset.act === "out") { zoomOut(); return; }
  if (e.target.closest(".grab") || (e.target.closest(".p-title, .p-kind") && innerWidth <= 800)) panel.classList.toggle("open");
});

// ---------- toggles ----------
function segment(id, key) {
  const el = $(id);
  el.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b || state[key] === b.dataset.v) return;
    state[key] = b.dataset.v;
    el.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
    rebuild({ morph: true });
  });
}
segment("#metric", "metric"); segment("#scope", "scope");

function rebuild({ morph = false } = {}) {
  const chain = []; for (let a = state.focus; a; a = a.parent) chain.push(a.id);
  root = buildTree(lib, { scope: state.scope }); nodes = index(root);
  const keep = chain.map(id => nodes.get(id)).find(Boolean) || root;
  if (!layer) return setFocus(fromHash() || root, { push: false });
  state.focus = keep; state.hover = null; state.selected = null;
  paint(layer, keep, { morph });
  renderCrumbs(); renderPanel(); renderLede();
}
function fromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  let n = id && nodes.get(id);
  if (!n && id && state.scope === "core") { // a community work: widen the scope to show it
    const all = index(buildTree(lib, { scope: "all" }));
    if (all.get(id)) { state.scope = "all"; $("#scope").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x.dataset.v === "all")); root = buildTree(lib, { scope: "all" }); nodes = index(root); n = nodes.get(id); }
  }
  return n || null;
}
addEventListener("popstate", () => { const n = fromHash() || root; if (n !== state.focus) setFocus(n, { push: false }); });
let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => layer && paint(layer, state.focus), 120); }).observe(map);

const note = $("#note");
if (localStorage.getItem("atlas:note-hidden")) note.classList.add("hidden");
note.querySelector(".note-x").onclick = () => { note.classList.add("hidden"); localStorage.setItem("atlas:note-hidden", "1"); };
$("#fetched").textContent = new Date(lib.fetchedAt).toLocaleDateString("en", { year: "numeric", month: "long", day: "numeric" });

rebuild();
