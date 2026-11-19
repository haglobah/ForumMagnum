import "../../shared/header.js";
import { loadLibrary, image, fmt } from "../../shared/library.js";

const lib = await loadLibrary();

// ---------- helpers ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
const phone = matchMedia("(max-width: 700px)");
const num = n => n.toLocaleString("en-US");
const hrs = m => m < 60 ? `${Math.max(1, Math.round(m))} min` : m < 600 ? `${(Math.round(m / 6) / 10).toString()} h` : `${Math.round(m / 60)} h`;
const short = m => m < 60 ? `${Math.max(1, Math.round(m))}m` : m < 600 ? `${Math.round(m / 6) / 10}h` : `${Math.round(m / 60)}h`;
const roman = n => ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n] || String(n);
const plural = (n, w) => `${num(n)} ${w}${n === 1 ? "" : "s"}`;

// Spine thickness: reading time, compressed (a 30-hour work is ~9x a 1-hour one, not 30x,
// or the short ones would vanish), the same scale everywhere on the page.
const spineW = m => Math.round(8 + 1.1 * Math.pow(Math.max(m, 1), 0.62));

// ---------- the shelves (topics) ----------
const SHELVES = [
  { name: "Rationality", hue: 134, sat: 24, lit: 29, blurb: "Thinking clearly on purpose: belief, evidence, bias, and changing your mind." },
  { name: "AI", hue: 214, sat: 32, lit: 30, blurb: "Alignment research, agent foundations, and arguments about the minds we are building." },
  { name: "World Modeling", hue: 8, sat: 40, lit: 31, blurb: "How the world works: science, economics, history, and the models we build of them." },
  { name: "World Optimization", hue: 38, sat: 46, lit: 34, blurb: "Making the world go better: coordination, institutions, effective altruism." },
  { name: "Practical", hue: 176, sat: 30, lit: 27, blurb: "Habits, productivity, and techniques you can try this week." },
  { name: "Community", hue: 292, sat: 17, lit: 31, blurb: "The rationalist community, its gatherings and its stories about itself." },
  { name: "Miscellany", hue: 28, sat: 12, lit: 33, blurb: "Works whose posts carry no single main subject tag." },
];
const shelfOf = s => {
  const t = s.stats.topics[0]?.name;
  return SHELVES.find(x => x.name === t) || SHELVES[SHELVES.length - 1];
};
function bindingColour(fam, id, year) {
  const r = hash(id), r2 = hash(id + "s");
  const h = fam.hue + (r - .5) * 14, s = fam.sat + (r2 - .5) * 14, l = fam.lit + (hash(id + "l") - .5) * 12;
  return `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}%)`;
}
const patina = y => !y ? .3 : Math.max(0, Math.min(1, (2024 - y) / 16));

// Works on the topic shelves: everything but the volumes of the boxed sets (four curated
// sequences are the first volumes of a core collection; they stand only in their box).
const works = lib.sequences.filter(s => !s.collection && s.posts.length);
const byShelf = new Map(SHELVES.map(f => [f.name, { curated: [], community: [] }]));
for (const s of works) byShelf.get(shelfOf(s).name)[s.kind].push(s);

// ---------- boxed sets ----------
const BOXES = {
  rationality: { short: "Rationality: A-Z", case: "hsl(150 22% 17%)", spine: ["hsl(150 24% 23%)", "hsl(150 20% 27%)"], text: "#e9d9a6" },
  highlights: { short: "The Sequences Highlights", case: "hsl(42 22% 70%)", spine: ["hsl(44 30% 86%)", "hsl(44 22% 80%)"], text: "#2c4a33" },
  hpmor: { short: "HPMOR", case: "hsl(352 40% 18%)", spine: ["hsl(352 42% 26%)", "hsl(352 36% 30%)"], text: "#e7cf8e" },
  codex: { short: "The Codex", case: "hsl(220 30% 15%)", spine: ["hsl(220 30% 22%)", "hsl(218 26% 27%)"], text: "#ece6d6" },
  bestoflesswrong: { short: "Best of LessWrong", case: "hsl(36 18% 62%)", spine: ["hsl(40 28% 90%)", "hsl(38 22% 84%)"], text: "#5a4718" },
};
const core = lib.core.filter(c => c.sequences.length);

// ---------- state ----------
const cells = new Map();   // id -> { id, el, seq|col, w, group, ctx }
const groups = [];         // { el, items: [cell], sortable, label }
let sortKey = "shelf";
let selected = null;

// ---------- glance + legend ----------
function renderGlance() {
  const tot = SHELVES.map(f => {
    const g = byShelf.get(f.name), all = [...g.curated, ...g.community];
    return { f, n: all.length, m: all.reduce((a, s) => a + s.stats.minutes, 0) };
  }).filter(x => x.n);
  const coreMin = core.reduce((a, c) => a + c.sequences.reduce((b, s) => b + s.stats.minutes, 0), 0);
  const sum = tot.reduce((a, x) => a + x.m, 0);
  const el = document.getElementById("glance");
  el.innerHTML = `<div class="glance-head"><span class="glance-title">What's on the shelves</span>
      <span class="meta">${num(works.length)} works and ${core.length} boxed sets, about ${num(Math.round((sum + coreMin) / 60))} hours of reading. Bar width is reading time.</span></div>
    <div class="glance-bar">${tot.map(x => {
      const share = x.m / sum;
      return `<a href="#shelf-${slug(x.f.name)}" class="seg" style="flex:${x.m};--c:hsl(${x.f.hue} ${x.f.sat}% ${x.f.lit + 6}%)" data-tip="${esc(x.f.name)}: ${x.n} works, ${hrs(x.m)} (${Math.round(share * 100)}%)">
        ${share > .07 ? `<span>${esc(x.f.name)}</span><small>${Math.round(share * 100)}%</small>` : ""}</a>`;
    }).join("")}</div>`;
  const lg = document.getElementById("legend");
  const sample = (m, l) => `<span class="lg-item"><span class="mini" style="width:${Math.round(spineW(m) * .5)}px"></span>${l}</span>`;
  lg.innerHTML = `<span class="lg-group" title="">${sample(15, "15 min")}${sample(60, "1 h")}${sample(300, "5 h")}${sample(1200, "20 h")}</span>
    <span class="lg-item"><span class="mini won"></span>review winner inside</span>
    <span class="lg-item"><span class="mini old"></span>faded: older</span>`;
}
const slug = s => s.toLowerCase().replace(/[^a-z]+/g, "-");

// ---------- spines ----------
function spine(seq, { colour, text, h, numeral, group, ctx }) {
  const m = seq.stats.minutes, w = spineW(m);
  const winners = seq.stats.winners.length;
  const variant = Math.floor(hash(seq.id + "v") * 4);
  const fs = Math.max(9, Math.min(17, Math.round(w * .5)));
  const b = document.createElement("button");
  b.className = "cell";
  b.style.setProperty("--w", w);
  b.dataset.id = seq.id;
  b.setAttribute("aria-label", `${seq.title}, ${hrs(m)}, ${plural(seq.stats.posts, "post")}${winners ? `, ${winners} review winner${winners > 1 ? "s" : ""}` : ""}`);
  const foot = numeral ? `<span class="ft num">${numeral}</span>` : w >= 19 ? `<span class="ft">${short(m)}</span>` : `<span class="ft"></span>`;
  b.innerHTML = `<span class="book v${variant}${winners ? " won" : ""}" style="--c:${colour};--t:${text};--h:${h};--p:${patina(seq.stats.firstYear).toFixed(2)};--fs:${fs}px">
    <span class="head">${winners ? `<span class="mark">★</span>` : ""}</span>
    <span class="lbl"><span class="tt">${esc(seq.title.trim())}</span>${w >= 44 && seq.author?.name ? `<span class="au">${esc(seq.author.name)}</span>` : ""}</span>
    ${foot}</span>`;
  const cell = { id: seq.id, el: b, seq, w, group, ctx };
  cells.set(seq.id, cell);
  wire(b, cell);
  return cell;
}

function wire(el, cell) {
  el.addEventListener("click", e => { e.stopPropagation(); selected === cell ? close() : open(cell); });
  el.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") showTip(cell); });
  el.addEventListener("pointerleave", hideTip);
  el.addEventListener("focus", () => { if (el.matches(":focus-visible")) showTip(cell); });
  el.addEventListener("blur", hideTip);
}

// ---------- shelves ----------
const shelvesEl = document.getElementById("shelves");

function renderCore() {
  const sec = document.createElement("section");
  sec.className = "bookcase top";
  sec.id = "shelf-core";
  const total = core.reduce((a, c) => a + c.sequences.reduce((b, s) => b + s.stats.minutes, 0), 0);
  sec.innerHTML = `<header class="shelf-head"><span class="plate"><i style="--c:#c8a23a"></i>The core collections</span>
    <span class="meta">${core.length} boxed sets · ${num(core.reduce((a, c) => a + c.sequences.length, 0))} volumes · ${hrs(total)}</span>
    <p class="blurb">The works LessWrong was built around, boxed in reading order. If you are new, the Highlights are a weekend; Rationality: A-Z is a season.</p></header>
    <div class="case"></div>`;
  shelvesEl.append(sec);
  const group = { el: sec.querySelector(".case"), items: [], sortable: false, label: null };
  groups.push(group);
  for (const c of core) {
    const st = BOXES[c.collection] || BOXES.codex;
    const box = document.createElement("div");
    box.className = "box";
    box.style.setProperty("--case", st.case);
    const inner = document.createElement("div");
    inner.className = "box-in";
    let w = 0;
    c.books.forEach((bk, bi) => {
      const vol = document.createElement("div");
      vol.className = "vol";
      bk.sequences.forEach((s, si) => {
        const cell = spine(s, { colour: st.spine[bi % 2], text: st.text, h: 196, numeral: c.books.length > 1 ? roman(bi + 1) : roman(si + 1), group, ctx: { col: c, book: bk, bookIndex: bi } });
        cell.inBox = true;
        vol.append(cell.el);
        w += cell.w + 1;
      });
      inner.append(vol);
      w += 3;
    });
    const minutes = c.sequences.reduce((a, s) => a + s.stats.minutes, 0);
    const label = document.createElement("button");
    label.className = "box-label";
    label.innerHTML = `<b>${esc(st.short)}</b><span>${c.books.length > 1 ? `${c.books.length} books · ` : ""}${hrs(minutes)}</span>`;
    box.append(inner, label);
    const colCell = { id: "c-" + c.collection, el: label, col: c, w: w + 14, group, box };
    cells.set(colCell.id, colCell);
    wire(label, colCell);
    group.items.push({ el: box, w: Math.max(w + 14, 150) + 14, box: true, cells: [...box.querySelectorAll(".cell")].map(e => cells.get(e.dataset.id)) });
  }
}

function renderShelves() {
  for (const f of SHELVES) {
    const g = byShelf.get(f.name);
    const all = [...g.curated, ...g.community];
    if (!all.length) continue;
    const m = all.reduce((a, s) => a + s.stats.minutes, 0);
    const winners = all.reduce((a, s) => a + s.stats.winners.length, 0);
    const sec = document.createElement("section");
    sec.className = "bookcase";
    sec.id = "shelf-" + slug(f.name);
    sec.innerHTML = `<header class="shelf-head"><span class="plate"><i style="--c:hsl(${f.hue} ${f.sat}% ${f.lit + 6}%)"></i>${esc(f.name)}</span>
      <span class="meta">${plural(all.length, "work")} · ${hrs(m)}${winners ? ` · <span class="gold">★ ${winners}</span> review-winning posts` : ""}</span>
      <p class="blurb">${esc(f.blurb)}</p></header>`;
    shelvesEl.append(sec);
    for (const kind of ["curated", "community"]) {
      const list = g[kind];
      if (!list.length) continue;
      const el = document.createElement("div");
      el.className = "case " + kind;
      sec.append(el);
      const group = { el, items: [], sortable: true, kind, label: kind === "curated" ? `Curated · ${list.length}` : `From the community · ${list.length}` };
      groups.push(group);
      list.forEach((s, i) => {
        const h = 168 + Math.round(hash(s.id + "h") * 40);
        const cell = spine(s, { colour: bindingColour(f, s.id), text: f.name === "World Optimization" ? "#f6ecd2" : "#efe6cf", h, group, ctx: { shelf: f, kind } });
        cell.order = i;
        group.items.push(cell);
      });
    }
  }
}

// ---------- sorting ----------
const SORTS = {
  shelf: (a, b) => a.group.kind === "community" ? b.seq.stats.karmaMedian - a.seq.stats.karmaMedian || a.order - b.order : a.order - b.order,
  length: (a, b) => b.seq.stats.minutes - a.seq.stats.minutes,
  year: (a, b) => (a.seq.stats.firstYear || 9999) - (b.seq.stats.firstYear || 9999) || (a.seq.createdAt || "").localeCompare(b.seq.createdAt || ""),
  karma: (a, b) => b.seq.stats.karmaMedian - a.seq.stats.karmaMedian,
};
function applySort() {
  for (const g of groups) if (g.sortable) g.items.sort(SORTS[sortKey]);
}

// ---------- packing into rows ----------
function layout() {
  const scroll = phone.matches;
  for (const g of groups) {
    const width = g.el.clientWidth - 28;
    const rows = [];
    let row = [], x = 0;
    for (const it of g.items) {
      const w = it.box ? it.w : it.w + 1;
      if (!scroll && row.length && x + w > width) { rows.push(row); row = []; x = 0; }
      row.push(it); x += w;
    }
    if (row.length) rows.push(row);
    const frag = document.createDocumentFragment();
    rows.forEach((r, i) => {
      const rowEl = document.createElement("div");
      rowEl.className = "row";
      const track = document.createElement("div");
      track.className = "track";
      for (const it of r) track.append(it.el);
      if (i === 0 && g.label) track.insertAdjacentHTML("beforeend", `<span class="edge">${g.label}</span>`);
      rowEl.append(track);
      frag.append(rowEl);
      if (scroll) rowEl.addEventListener("scroll", () => selected && placeNotch(), { passive: true });
    });
    g.el.replaceChildren(frag);
  }
  if (selected) placePanel(false);
}

function withFlip(fn) {
  const list = [...cells.values()].filter(c => !c.inBox && c.seq);
  const vh = innerHeight;
  const first = new Map(list.map(c => [c, c.el.getBoundingClientRect()]));
  fn();
  for (const c of list) {
    const a = first.get(c), b = c.el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if (!dx && !dy) continue;
    if ((a.bottom < -200 || a.top > vh + 200) && (b.bottom < -200 || b.top > vh + 200)) continue;
    c.el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 560 + Math.min(240, Math.abs(dy) * .15), easing: "cubic-bezier(.22,.8,.24,1)" });
  }
}

document.querySelectorAll("[data-sort]").forEach(btn => btn.addEventListener("click", () => {
  if (sortKey === btn.dataset.sort) return;
  sortKey = btn.dataset.sort;
  document.querySelectorAll("[data-sort]").forEach(b => b.setAttribute("aria-pressed", String(b === btn)));
  withFlip(() => { applySort(); layout(); });
}));

// ---------- hover card ----------
const tip = document.getElementById("tip");
function showTip(cell) {
  if (selected === cell) return;
  let html;
  if (cell.seq) {
    const s = cell.seq, st = s.stats, w = st.winners.length;
    html = `<b>${esc(s.title)}</b><span>${esc(s.author?.name || "")}</span>
      <span>${plural(st.posts, "post")} · ${hrs(st.minutes)}${fmt.years(s) ? ` · ${fmt.years(s)}` : ""}</span>
      ${w ? `<span class="gold">★ ${w} review-winning post${w > 1 ? "s" : ""}</span>` : ""}`;
  } else {
    const c = cell.col;
    html = `<b>${esc(c.title)}</b><span>${plural(c.sequences.length, "volume")} · ${hrs(c.sequences.reduce((a, s) => a + s.stats.minutes, 0))}</span><span>Open the box</span>`;
  }
  tip.innerHTML = html;
  tip.hidden = false;
  const r = (cell.el.querySelector(".book") || cell.el).getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  let x = r.left + r.width / 2 - t.width / 2;
  x = Math.max(8, Math.min(innerWidth - t.width - 8, x));
  let y = r.top - t.height - 10;
  if (y < 70) y = r.bottom + 10;
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
function hideTip() { tip.hidden = true; }
addEventListener("scroll", hideTip, { passive: true });

// ---------- the pulled-out book ----------
const panel = document.createElement("section");
panel.className = "pullout";
panel.setAttribute("aria-live", "polite");

function open(cell) {
  hideTip();
  const was = !!selected;
  if (selected) selected.el.classList.remove("out");
  selected = cell;
  cell.el.classList.add("out");
  panel.innerHTML = cell.seq ? seqPanel(cell) : colPanel(cell);
  panel.querySelector(".po-x").addEventListener("click", close);
  panel.querySelectorAll("[data-open]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); const c = cells.get(a.dataset.open); if (c) open(c); }));
  panel.querySelectorAll("[data-nav]").forEach(a => a.addEventListener("click", () => step(+a.dataset.nav)));
  const more = panel.querySelector(".desc-more");
  if (more) more.addEventListener("click", () => { panel.querySelector(".desc").classList.add("full"); more.remove(); });
  const prevRow = panel.previousElementSibling;
  placePanel(true);
  if (!was || prevRow !== panel.previousElementSibling) panel.animate([{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "ease-out" });
  history.replaceState(null, "", "#" + cell.id);
  requestAnimationFrame(() => {
    const row = cell.el.closest(".row"), rr = row.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    if (phone.matches) { const tr = cell.el.getBoundingClientRect(); if (tr.left < 0 || tr.right > innerWidth) row.scrollBy({ left: tr.left - innerWidth / 2 + tr.width / 2, behavior: "smooth" }); }
    if (rr.top < 110 || pr.bottom > innerHeight) {
      const want = Math.min(rr.top - 120, pr.bottom - innerHeight + 16);
      scrollBy({ top: Math.max(rr.top - 120 < 0 ? rr.top - 120 : 0, want), behavior: "smooth" });
    }
  });
}
function placePanel() {
  const row = selected.el.closest(".row");
  if (row.nextElementSibling !== panel) row.after(panel);
  placeNotch();
}
function placeNotch() {
  const r = (selected.el.querySelector(".book") || selected.el).getBoundingClientRect(), p = panel.getBoundingClientRect();
  panel.style.setProperty("--nx", `${Math.max(16, Math.min(p.width - 16, r.left + r.width / 2 - p.left))}px`);
}
function close() {
  if (!selected) return;
  selected.el.classList.remove("out");
  const el = selected.el;
  selected = null;
  panel.remove();
  history.replaceState(null, "", location.pathname + location.search);
  el.focus({ preventScroll: true });
}
function navList() {
  const g = selected.group;
  if (!g.sortable) return g.items.flatMap(it => it.cells || [it]);
  return g.items;
}
function step(d) {
  if (!selected || !selected.seq) return;
  const list = navList(), i = list.indexOf(selected);
  const next = list[i + d];
  if (next) { open(next); next.el.focus({ preventScroll: true }); }
}
addEventListener("keydown", e => {
  if (!selected) return;
  if (e.key === "Escape") close();
  else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !e.target.closest("input,textarea")) { e.preventDefault(); step(e.key === "ArrowRight" ? 1 : -1); }
});
addEventListener("resize", () => selected && placeNotch());

function cover(id, title, colour) {
  const src = image(id, { w: 520, h: 300 });
  return src ? `<img class="cover" src="${src}" alt="" loading="lazy">` : `<div class="cover blank" style="--c:${colour}"><span>${esc(title)}</span></div>`;
}

function seqPanel(cell) {
  const s = cell.seq, st = s.stats, ctx = cell.ctx || {};
  const kicker = ctx.col
    ? `<a href="#c-${ctx.col.collection}" data-open="c-${ctx.col.collection}">${esc(BOXES[ctx.col.collection]?.short || ctx.col.title)}</a>${ctx.col.books.length > 1 ? ` · Book ${roman(ctx.bookIndex + 1)}${ctx.book.title ? `: ${esc(ctx.book.title.trim())}` : ""}` : ""}`
    : `${ctx.kind === "curated" ? "Curated" : "Community"} · ${esc(ctx.shelf?.name || "")}`;
  const list = navList(), i = list.indexOf(cell);
  const first = s.posts[0];
  const desc = s.description.trim();
  const winners = st.winners;
  const chapters = s.chapters.filter(c => c.posts.length);
  const many = st.posts > 40;
  const colour = cell.el.querySelector(".book")?.style.getPropertyValue("--c");
  return `<div class="po-bar"><span class="kicker">${kicker}</span>
      <span class="po-nav"><button data-nav="-1" ${i <= 0 ? "disabled" : ""} aria-label="Previous book">‹</button><button data-nav="1" ${i >= list.length - 1 ? "disabled" : ""} aria-label="Next book">›</button></span>
      <button class="po-x" aria-label="Put the book back">×</button></div>
    <div class="po-grid">
      <div class="po-cover">${cover(s.gridImageId, s.title, colour)}
        <div class="size"><span class="size-bar" style="width:${Math.round(spineW(st.minutes) / spineW(1900) * 100)}%"></span></div>
        <dl class="facts">
          <div><dt>Reading time</dt><dd>${hrs(st.minutes)}</dd></div>
          <div><dt>Posts</dt><dd>${num(st.posts)}</dd></div>
          <div><dt>Words</dt><dd>${num(Math.round(st.words / 1000))}k</dd></div>
          <div><dt>Written</dt><dd>${fmt.years(s) || "–"}</dd></div>
          <div><dt>Median karma</dt><dd>${st.karmaMedian}</dd></div>
          <div><dt>Review winners</dt><dd>${winners.length ? `<span class="gold">★ ${winners.length}</span>` : "–"}</dd></div>
        </dl>
      </div>
      <div class="po-main">
        <h2 class="po-title">${esc(s.title)}</h2>
        <div class="meta">by ${esc(s.author?.name || "unknown")}</div>
        ${desc ? `<p class="desc${desc.length > 420 ? "" : " full"}">${esc(desc)}</p>${desc.length > 420 ? `<button class="desc-more">Read more</button>` : ""}` : `<p class="desc empty">No description. ${st.topPost ? `Its most upvoted post is “${esc(st.topPost.title)}”.` : ""}</p>`}
        ${st.topPost ? `<div class="top-post"><span class="label">Most upvoted</span><a href="${st.topPost.url}" target="_blank" rel="noopener">${esc(st.topPost.title)}</a> <span class="meta">${st.topPost.karma} karma${st.topPost.winner ? ` · <span class="gold">★ Best of ${st.topPost.winner.year}</span>` : ""}</span></div>` : ""}
        ${winners.length ? `<div class="top-post"><span class="label gold">Best of LessWrong</span>${winners.slice(0, 4).map(p => `<a href="${p.url}" target="_blank" rel="noopener">${esc(p.title)}</a> <span class="meta">${p.winner.year}</span>`).join("<br>")}${winners.length > 4 ? `<br><span class="meta">and ${winners.length - 4} more</span>` : ""}</div>` : ""}
        <div class="po-actions">
          ${first ? `<a class="start" href="${first.url}" target="_blank" rel="noopener">Start reading <span>→</span></a>` : ""}
          <a class="seqlink" href="${s.url}" target="_blank" rel="noopener">Sequence page ↗</a>
        </div>
      </div>
      <div class="po-toc">
        <div class="toc-head">Contents <span class="meta">${plural(chapters.length, "chapter")} · ${plural(st.posts, "post")}</span></div>
        <div class="toc-scroll">${chapters.map((c, ci) => `
          <details ${!many || ci < 2 ? "open" : ""}><summary>${esc(c.title || (chapters.length > 1 ? `Part ${ci + 1}` : "Posts"))}<span class="meta">${c.posts.length} · ${hrs(c.posts.reduce((a, p) => a + p.minutes, 0))}</span></summary>
            <ol>${c.posts.map(p => `<li><a href="${p.url}" target="_blank" rel="noopener">${esc(p.title)}</a>${p.winner ? ` <span class="gold" title="">★</span>` : ""}<span class="pm">${p.minutes}m · ${p.karma}</span></li>`).join("")}</ol>
          </details>`).join("")}</div>
      </div>
    </div>`;
}

function colPanel(cell) {
  const c = cell.col, st = BOXES[c.collection] || BOXES.codex;
  const seqs = c.sequences, minutes = seqs.reduce((a, s) => a + s.stats.minutes, 0);
  const posts = seqs.reduce((a, s) => a + s.stats.posts, 0);
  const ys = seqs.flatMap(s => [s.stats.firstYear, s.stats.lastYear]).filter(Boolean);
  const winners = seqs.reduce((a, s) => a + s.stats.winners.length, 0);
  const firstPost = seqs[0]?.posts[0];
  return `<div class="po-bar"><span class="kicker">Boxed set</span><span class="po-nav"></span><button class="po-x" aria-label="Close the box">×</button></div>
    <div class="po-grid">
      <div class="po-cover"><img class="cover" src="${c.imageUrl}" alt="" loading="lazy">
        <dl class="facts">
          <div><dt>Reading time</dt><dd>${hrs(minutes)}</dd></div>
          <div><dt>Volumes</dt><dd>${seqs.length}</dd></div>
          <div><dt>Posts</dt><dd>${num(posts)}</dd></div>
          <div><dt>Written</dt><dd>${ys.length ? `${Math.min(...ys)}–${Math.max(...ys)}` : "–"}</dd></div>
          ${winners ? `<div><dt>Review winners</dt><dd><span class="gold">★ ${winners}</span></dd></div>` : ""}
        </dl>
      </div>
      <div class="po-main">
        <h2 class="po-title">${esc(c.title)}</h2>
        ${c.subtitle ? `<div class="meta">${esc(c.subtitle)}</div>` : ""}
        <p class="desc full">${esc(c.summary)}</p>
        <div class="po-actions">
          ${firstPost ? `<a class="start" href="${firstPost.url}" target="_blank" rel="noopener">Start reading <span>→</span></a>` : ""}
          <a class="seqlink" href="${c.url}" target="_blank" rel="noopener">Collection page ↗</a>
        </div>
      </div>
      <div class="po-toc">
        <div class="toc-head">In the box <span class="meta">${c.books.length > 1 ? `${c.books.length} books · ` : ""}${plural(seqs.length, "volume")}</span></div>
        <div class="toc-scroll">${c.books.map((b, bi) => `
          <details open><summary>${c.books.length > 1 ? `Book ${roman(bi + 1)}${b.title ? `: ${esc(b.title.trim())}` : ""}` : "Volumes"}<span class="meta">${hrs(b.sequences.reduce((a, s) => a + s.stats.minutes, 0))}</span></summary>
            <ol>${b.sequences.map(s => `<li><a href="#${s.id}" data-open="${s.id}">${esc(s.title)}</a>${s.stats.winners.length ? ` <span class="gold">★</span>` : ""}<span class="pm">${plural(s.stats.posts, "post")} · ${hrs(s.stats.minutes)}</span></li>`).join("")}</ol>
          </details>`).join("")}</div>
      </div>
    </div>`;
}

// ---------- boot ----------
renderGlance();
renderCore();
renderShelves();
applySort();
layout();

document.querySelector(".glance").addEventListener("pointerover", e => {
  const seg = e.target.closest(".seg");
  if (!seg) return;
  tip.innerHTML = `<b>${esc(seg.dataset.tip)}</b>`; tip.hidden = false;
  const r = seg.getBoundingClientRect(), t = tip.getBoundingClientRect();
  tip.style.transform = `translate(${Math.round(Math.max(8, Math.min(innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2)))}px, ${Math.round(r.top - t.height - 8)}px)`;
});
document.querySelector(".glance").addEventListener("pointerout", hideTip);

let lastW = shelvesEl.clientWidth;
new ResizeObserver(() => { if (shelvesEl.clientWidth !== lastW) { lastW = shelvesEl.clientWidth; layout(); } }).observe(shelvesEl);

document.querySelector(".note-x").addEventListener("click", () => { document.getElementById("note").remove(); sessionStorage.setItem("shelf-note", "x"); });
if (sessionStorage.getItem("shelf-note")) document.getElementById("note")?.remove();

const h = decodeURIComponent(location.hash.slice(1));
if (h && cells.has(h)) open(cells.get(h));
