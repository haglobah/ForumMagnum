import "../../shared/header.js";
import { loadLibrary, image, fmt } from "../../shared/library.js";

const lib = await loadLibrary();
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = n => n.toLocaleString("en-US");

// ---------- The works: every sequence and every core-collection book, once ----------
const SHORT = { "Rationality: A-Z": "Rationality: A-Z", "The Sequences Highlights": "Sequences Highlights",
  "Harry Potter and the Methods of Rationality": "HPMOR", "The Codex": "The Codex", "Best of LessWrong": "Best of LessWrong" };
const membership = new Map();
lib.core.forEach((c, ci) => {
  let pos = 0;
  c.books.forEach(b => b.sequences.forEach(s => {
    if (!membership.has(s.id)) membership.set(s.id, []);
    membership.get(s.id).push({ core: SHORT[c.title] || c.title, book: b.title, rank: ci * 1000 + pos++ });
  }));
});

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const eraOf = y => y == null ? null : y <= 2012 ? "06" : y <= 2018 ? "13" : y <= 2022 ? "19" : "23";
const lenOf = m => m < 60 ? "lt1" : m < 180 ? "1-3" : m < 480 ? "3-8" : "8+";

const allSeqs = [...lib.sequences, ...lib.books];
const empty = allSeqs.filter(s => !s.posts.length).length;
const works = allSeqs.filter(s => s.posts.length).map((s, i) => {
  const mem = membership.get(s.id) || [];
  const src = new Set();
  if (s.kind === "curated") src.add("curated");
  if (mem.length || s.kind === "book") src.add("core");
  if (s.kind === "community") src.add("community");
  let topics = s.stats.topics.filter(t => t.share >= 0.34).map(t => t.name);
  if (!topics.length && s.stats.topics[0]) topics = [s.stats.topics[0].name];
  const dates = s.posts.map(p => p.postedAt).filter(Boolean).sort();
  const medYear = median(s.posts.map(p => p.year).filter(Boolean));
  const tagNames = [...new Set(s.stats.tags.map(t => t.name))];
  return {
    s, id: s.id, title: s.title || "Untitled sequence", mem, src, topics,
    len: lenOf(s.stats.minutes), era: eraOf(medYear),
    first: dates[0] || s.createdAt, last: dates[dates.length - 1] || s.createdAt,
    winners: s.stats.winners.length,
    author: s.author.name || "Unknown",
    editor: mem.length ? mem[0].rank : s.kind === "curated" ? 10000 + i : 20000 + i,
    tagNames,
    hay: { title: (s.title || "").toLowerCase() },
  };
});
const byId = new Map(works.map(w => [w.id, w]));

// ---------- Facets ----------
const FACETS = [
  { key: "topic", label: "Topic", kind: "list", hint: "Core tags covering a third or more of a work's posts",
    options: [...lib.topics.map(t => ({ v: t, label: t })), { v: "_none", label: "Untagged" }],
    test: (w, v) => v === "_none" ? !w.topics.length : w.topics.includes(v) },
  { key: "len", label: "Length", kind: "hist", hint: "Total reading time",
    options: [{ v: "lt1", label: "< 1 h" }, { v: "1-3", label: "1–3 h" }, { v: "3-8", label: "3–8 h" }, { v: "8+", label: "8 h +" }],
    test: (w, v) => w.len === v },
  { key: "era", label: "Era", kind: "hist", hint: "When its posts were written (median post)",
    options: [{ v: "06", label: "2006–12" }, { v: "13", label: "2013–18" }, { v: "19", label: "2019–22" }, { v: "23", label: "2023–" }],
    test: (w, v) => w.era === v },
  { key: "src", label: "Source", kind: "list",
    options: [{ v: "curated", label: "Curated" }, { v: "core", label: "Core collection" }, { v: "community", label: "Community" }],
    test: (w, v) => w.src.has(v) },
  { key: "win", label: "Quality", kind: "toggle",
    options: [{ v: "1", label: "Contains Best of LessWrong winners" }],
    test: w => w.winners > 0 },
  { key: "author", label: "Author", kind: "author", test: (w, v) => w.author === v },
];
const F = Object.fromEntries(FACETS.map(f => [f.key, f]));
const authorsAll = [...new Set(works.map(w => w.author))];

// ---------- State (mirrored in the query string) ----------
const state = { q: "", f: Object.fromEntries(FACETS.map(f => [f.key, new Set()])), sort: null, open: new Set(), focus: null, authorFind: "", authorsMore: false };
function readURL() {
  const p = new URLSearchParams(location.search);
  state.q = p.get("q") || "";
  for (const f of FACETS) state.f[f.key] = new Set((p.get(f.key) || "").split(",").filter(Boolean));
  state.sort = p.get("sort");
  state.open = new Set((p.get("open") || "").split(",").filter(id => byId.has(id)));
}
function writeURL() {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  for (const f of FACETS) if (state.f[f.key].size) p.set(f.key, [...state.f[f.key]].join(","));
  if (state.sort) p.set("sort", state.sort);
  if (state.open.size) p.set("open", [...state.open].join(","));
  const qs = p.toString().replace(/%2C/g, ",").replace(/%20/g, "+");
  history.replaceState(null, "", qs ? "?" + qs : location.pathname);
}
const effSort = () => { const s = state.sort || (state.q.trim() ? "match" : "editor"); return s === "match" && !state.q.trim() ? "editor" : s; };

// ---------- Search ----------
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let terms = [];
function compileQuery() {
  terms = state.q.toLowerCase().split(/\s+/).filter(Boolean).map(t => new RegExp("(?:^|[^\\p{L}\\p{N}])(" + reEsc(t) + ")", "iu"));
}
const hit = (re, text) => re.test(text || "");
function search(w) {
  if (!terms.length) return { score: 0 };
  const s = w.s;
  let score = 0; const posts = [], tags = [];
  for (const re of terms) {
    let found = false;
    if (hit(re, w.title)) { score += 40; found = true; }
    if (hit(re, w.author)) { score += 12; found = true; }
    if (w.mem.some(m => hit(re, m.core) || hit(re, m.book))) { score += 10; found = true; }
    const tg = w.tagNames.filter(t => hit(re, t));
    if (tg.length) { score += 8; found = true; tags.push(...tg); }
    if (hit(re, s.description)) { score += 4; found = true; }
    const ps = s.posts.filter(p => hit(re, p.title));
    if (ps.length) { score += Math.min(12, 4 * ps.length); found = true; posts.push(...ps); }
    if (!found) return null;
  }
  // posts that match most terms first
  const pc = new Map(); for (const p of posts) pc.set(p, (pc.get(p) || 0) + 1);
  const ranked = [...pc].sort((a, b) => b[1] - a[1] || b[0].karma - a[0].karma).map(x => x[0]);
  if (ranked[0] && pc.get(ranked[0]) === terms.length) score += 15;
  return { score, posts: ranked, tags: [...new Set(tags)] };
}
function mark(text) {
  text = String(text ?? "");
  if (!terms.length) return esc(text);
  const ranges = [];
  for (const re of terms) {
    const g = new RegExp(re.source, "giu"); let m;
    while ((m = g.exec(text))) { const st = m.index + m[0].length - m[1].length; ranges.push([st, st + m[1].length]); if (g.lastIndex === m.index) g.lastIndex++; }
  }
  if (!ranges.length) return esc(text);
  ranges.sort((a, b) => a[0] - b[0]);
  let out = "", at = 0;
  for (const [a, b] of ranges) { if (a < at) continue; out += esc(text.slice(at, a)) + "<mark>" + esc(text.slice(a, b)) + "</mark>"; at = b; }
  return out + esc(text.slice(at));
}
function snippet(text) {
  for (const re of terms) {
    const m = re.exec(text); if (!m) continue;
    const i = m.index; const a = Math.max(0, i - 50);
    return (a ? "…" : "") + mark(text.slice(a, i + 90).trim()) + (i + 90 < text.length ? "…" : "");
  }
  return "";
}

// ---------- Filtering ----------
let results = new Map();   // id → search result for works passing search
function passes(w, except) {
  for (const f of FACETS) {
    if (f.key === except) continue;
    const sel = state.f[f.key]; if (!sel.size) continue;
    let ok = false; for (const v of sel) if (f.test(w, v)) { ok = true; break; }
    if (!ok) return false;
  }
  return true;
}
const SORTS = {
  match: (a, b) => results.get(b.id).score - results.get(a.id).score || a.editor - b.editor,
  editor: (a, b) => a.editor - b.editor,
  loved: (a, b) => b.s.stats.karmaMedian - a.s.stats.karmaMedian || b.s.stats.karmaTotal - a.s.stats.karmaTotal,
  long: (a, b) => b.s.stats.minutes - a.s.stats.minutes,
  short: (a, b) => a.s.stats.minutes - b.s.stats.minutes,
  new: (a, b) => (b.first || "").localeCompare(a.first || ""),
  old: (a, b) => (a.first || "").localeCompare(b.first || ""),
};

// ---------- Facet column ----------
function buildFacets() {
  const body = $("#facetBody");
  body.innerHTML = FACETS.map(f => {
    let inner = "";
    if (f.kind === "list") inner = `<ul class="opts">${f.options.map(o => `
      <li><button type="button" class="opt" data-f="${f.key}" data-v="${esc(o.v)}" aria-pressed="false">
        <span class="box"></span><span class="lab">${esc(o.label)}</span><span class="bar"><i></i></span><span class="n"></span></button></li>`).join("")}</ul>`;
    else if (f.kind === "hist") inner = `<div class="hist">${f.options.map(o => `
      <button type="button" class="hbar" data-f="${f.key}" data-v="${esc(o.v)}" aria-pressed="false" title="${esc(o.label)}">
        <span class="n"></span><span class="col"><i></i></span><span class="lab">${esc(o.label)}</span></button>`).join("")}</div>`;
    else if (f.kind === "toggle") inner = `<button type="button" class="opt toggle" data-f="${f.key}" data-v="1" aria-pressed="false">
        <span class="sw"></span><span class="lab"><span class="star">★</span> ${esc(f.options[0].label)}</span><span class="n"></span></button>`;
    else if (f.kind === "author") inner = `<input class="afind" id="afind" type="search" placeholder="Find among ${authorsAll.length} authors" autocomplete="off"><ul class="opts" id="authorOpts"></ul>`;
    return `<section class="facet" data-key="${f.key}"><h4${f.hint ? ` title="${esc(f.hint)}"` : ""}>${esc(f.label)}<button type="button" class="fclear" data-clear="${f.key}">clear</button></h4>${inner}</section>`;
  }).join("");
  body.addEventListener("click", e => {
    const c = e.target.closest("[data-clear]");
    if (c) { state.f[c.dataset.clear].clear(); update(); return; }
    if (e.target.closest("#amore")) { state.authorsMore = !state.authorsMore; update(); return; }
    const b = e.target.closest("[data-f]"); if (!b) return;
    const set = state.f[b.dataset.f], v = b.dataset.v;
    set.has(v) ? set.delete(v) : set.add(v);
    update();
  });
  $("#afind").addEventListener("input", e => { state.authorFind = e.target.value; updateFacets(); });
}

function updateFacets(base) {
  base ??= lastBase;
  for (const f of FACETS) {
    const pool = base.filter(w => passes(w, f.key));
    const sec = document.querySelector(`.facet[data-key="${f.key}"]`);
    sec.classList.toggle("active", state.f[f.key].size > 0);
    if (f.kind === "author") { renderAuthors(pool); continue; }
    const counts = f.options.map(o => pool.filter(w => f.test(w, o.v)).length);
    const max = Math.max(1, ...counts);
    f.options.forEach((o, i) => {
      const el = sec.querySelector(`[data-v="${CSS.escape(o.v)}"]`);
      if (!el) return;
      const on = state.f[f.key].has(o.v);
      el.setAttribute("aria-pressed", on);
      el.classList.toggle("zero", !counts[i] && !on);
      el.querySelector(".n").textContent = counts[i];
      const bar = el.querySelector(".bar i, .col i");
      if (bar) bar.style[f.kind === "hist" ? "height" : "width"] = (counts[i] / max * 100).toFixed(1) + "%";
    });
  }
}
function renderAuthors(pool) {
  const counts = new Map();
  for (const w of pool) counts.set(w.author, (counts.get(w.author) || 0) + 1);
  const sel = state.f.author;
  const find = state.authorFind.trim().toLowerCase();
  let list = authorsAll.map(a => [a, counts.get(a) || 0]).filter(([a, n]) => sel.has(a) || (find ? a.toLowerCase().includes(find) : n > 0));
  list.sort((a, b) => (sel.has(b[0]) - sel.has(a[0])) || b[1] - a[1] || a[0].localeCompare(b[0]));
  const limit = state.authorsMore || find ? 60 : 8;
  const more = list.length > limit ? list.length - limit : 0;
  list = list.slice(0, Math.max(limit, sel.size));
  const max = Math.max(1, ...list.map(x => x[1]));
  $("#authorOpts").innerHTML = list.map(([a, n]) => `<li><button type="button" class="opt${!n && !sel.has(a) ? " zero" : ""}" data-f="author" data-v="${esc(a)}" aria-pressed="${sel.has(a)}">
    <span class="box"></span><span class="lab">${esc(a)}</span><span class="bar"><i style="width:${(n / max * 100).toFixed(1)}%"></i></span><span class="n">${n}</span></button></li>`).join("")
    + (more ? `<li><button type="button" class="more" id="amore">${num(more)} more</button></li>` : state.authorsMore && !find ? `<li><button type="button" class="more" id="amore">fewer</button></li>` : "")
    + (!list.length ? `<li class="none">No author by that name here</li>` : "");
}

// ---------- Rows ----------
const SRC_LABEL = { curated: "Curated", community: "Community" };
function srcTag(w) {
  if (w.mem.length) {
    const m = w.mem[0];
    const book = m.book && m.book !== w.title ? ` · ${m.book}` : "";
    return `<span class="src core" title="${esc(w.mem.map(m => m.core + (m.book ? " · " + m.book : "")).join("\n"))}">${esc(m.core)}${esc(book)}${w.mem.length > 1 ? ` <span class="plus">+${w.mem.length - 1}</span>` : ""}</span>`
      + (w.src.has("curated") ? ` <span class="src curated">Curated</span>` : "");
  }
  return `<span class="src ${w.s.kind}">${SRC_LABEL[w.s.kind] || ""}</span>`;
}
function rowHTML(w) {
  const s = w.s, st = s.stats, r = results.get(w.id);
  const open = state.open.has(w.id);
  const img = image(s.gridImageId, { w: 120, h: 80 });
  const desc = s.description.trim();
  const descLine = desc ? mark(desc.replace(/\s+/g, " ")) : `<i>${s.posts.slice(0, 3).map(p => esc(p.title)).join(" · ")}${s.posts.length > 3 ? " …" : ""}</i>`;
  let match = "";
  if (r && terms.length) {
    const bits = [];
    const titleHit = terms.some(re => re.test(w.title));
    if (r.posts?.length) bits.push(`<span class="mk">post</span> ${r.posts.slice(0, 2).map(p => `“${mark(p.title)}”`).join(", ")}${r.posts.length > 2 ? ` <span class="faint">+${r.posts.length - 2}</span>` : ""}`);
    if (r.tags?.length) bits.push(`<span class="mk">tag</span> ${r.tags.slice(0, 3).map(t => mark(t)).join(", ")}`);
    if (!titleHit && !r.posts?.length && desc && terms.some(re => re.test(desc))) bits.push(`<span class="mk">description</span> ${snippet(desc.replace(/\s+/g, " "))}`);
    if (bits.length) match = `<p class="match">${bits.join(`<span class="sep"></span>`)}</p>`;
  }
  return `<li class="row${open ? " open" : ""}${state.focus === w.id ? " focus" : ""}" data-id="${w.id}">
    <div class="row-main" aria-expanded="${open}">
      <span class="thumb">${img ? `<img loading="lazy" src="${img}" alt="">` : ""}</span>
      <div class="c-work">
        <div class="tline"><h3 class="title"><span class="caret" aria-hidden="true"></span>${mark(w.title)}</h3><span class="by">${mark(w.author)}</span></div>
        <p class="desc">${srcTag(w)}${descLine}</p>
        ${match}
        <p class="mobile-meta">${fmt.hours(st.minutes)} · ${st.posts} posts · ${fmt.years(s)}${w.winners ? ` · <span class="w">★ ${w.winners}</span>` : ""}</p>
      </div>
      <div class="c-topics">${w.topics.slice(0, 3).map(t => `<button type="button" class="chip${state.f.topic.has(t) ? " on" : ""}" data-topic="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      <div class="c-len"><b>${fmt.hours(st.minutes)}</b><span>${st.posts} post${st.posts === 1 ? "" : "s"}</span></div>
      <div class="c-years">${fmt.years(s)}</div>
      <div class="c-karma" title="Median karma of its ${st.posts} posts">${st.karmaMedian}</div>
      <div class="c-win">${w.winners ? `<span class="w" title="${w.winners} Best of LessWrong winner${w.winners > 1 ? "s" : ""}">★ ${w.winners}</span>` : `<span class="faint">–</span>`}</div>
    </div>
    ${open ? tocHTML(w) : ""}
  </li>`;
}
const catName = c => c.replace(/\bai\b/g, "AI").replace(/^./, x => x.toUpperCase());
function tocHTML(w) {
  const s = w.s, st = s.stats, r = results.get(w.id);
  const hits = new Set((r?.posts || []).map(p => p.id));
  const maxK = Math.max(1, ...s.posts.map(p => p.karma));
  let n = 0;
  const rows = s.chapters.map(c => {
    const head = (c.title || c.subtitle) && s.chapters.length > 0 && (c.title || "") !== w.title
      ? `<tr class="ch"><th colspan="4">${esc(c.title || "")}${c.subtitle ? ` <span>${esc(c.subtitle)}</span>` : ""}<em>${c.posts.length} post${c.posts.length === 1 ? "" : "s"} · ${fmt.hours(c.posts.reduce((m, p) => m + p.minutes, 0))}</em></th></tr>` : "";
    return head + c.posts.map(p => {
      n++;
      const other = p.author && p.author.name !== s.author.name ? `<span class="pa">${mark(p.author.name)}</span>` : "";
      const win = p.winner ? `<span class="wb" title="Best of LessWrong ${p.winner.year}${p.winner.category ? " · " + p.winner.category : ""}${p.winner.ranking != null ? " · ranked #" + (p.winner.ranking + 1) : ""}">★ ${p.winner.year}${p.winner.category ? ` ${esc(catName(p.winner.category))}` : ""}</span>` : "";
      return `<tr class="${hits.has(p.id) ? "hit" : ""}${p.winner ? " win" : ""}">
        <td class="pn">${n}</td>
        <td class="pt"><a href="${p.url}" target="_blank" rel="noopener">${mark(p.title)}</a>${other}${win}</td>
        <td class="pk"><span class="kbar"><i style="width:${(p.karma / maxK * 100).toFixed(1)}%"></i></span>${p.karma}</td>
        <td class="pm">${p.minutes} min</td></tr>`;
    }).join("");
  }).join("");
  const top = st.topPost;
  const desc = s.description.trim();
  return `<div class="toc">
    <div class="toc-side">
      ${desc ? `<p class="toc-desc">${mark(desc)}</p>` : ""}
      <dl class="toc-stats">
        <div><dt>Posts</dt><dd>${st.posts}</dd></div>
        <div><dt>Words</dt><dd>${fmt.words(st.words).replace(" words", "")}</dd></div>
        <div><dt>Reading</dt><dd>${fmt.hours(st.minutes)}</dd></div>
        <div><dt>Median karma</dt><dd>${st.karmaMedian}</dd></div>
        ${w.winners ? `<div><dt>Review winners</dt><dd class="w">★ ${w.winners}</dd></div>` : ""}
        <div><dt>Written</dt><dd>${fmt.years(s)}</dd></div>
      </dl>
      ${top ? `<p class="toc-top"><span>Strongest post</span><a href="${top.url}" target="_blank" rel="noopener">${esc(top.title)}</a> <b>${top.karma}</b></p>` : ""}
      ${st.tags.length ? `<p class="toc-tags">${st.tags.slice(0, 8).map(t => `<span>${mark(t.name)}</span>`).join("")}</p>` : ""}
      <p class="toc-actions"><a class="read" href="${s.posts[0]?.url || s.url}" target="_blank" rel="noopener">Start reading</a><a class="seq" href="${s.url}" target="_blank" rel="noopener">Sequence page ↗</a></p>
    </div>
    <div class="toc-scroll${s.posts.length > 40 ? " long" : ""}"><table class="toc-table"><thead><tr><th>#</th><th>Post</th><th class="pk">Karma</th><th class="pm">Time</th></tr></thead><tbody>${rows}</tbody></table></div>
  </div>`;
}

// ---------- Update ----------
let lastBase = works, visible = [];
function update({ keepScroll = false } = {}) {
  compileQuery();
  results = new Map();
  for (const w of works) { const r = search(w); if (r) results.set(w.id, r); }
  const base = works.filter(w => results.has(w.id));
  lastBase = base;
  visible = base.filter(w => passes(w)).sort(SORTS[effSort()]);
  if (state.focus && !visible.some(w => w.id === state.focus)) state.focus = null;
  updateFacets(base);
  renderStatus();
  $("#rows").innerHTML = visible.length ? visible.map(rowHTML).join("") : emptyHTML();
  // sort controls
  const sortSel = $("#sort");
  sortSel.querySelector('[value="match"]').hidden = !state.q.trim();
  sortSel.value = effSort();
  for (const b of document.querySelectorAll(".colhead [data-sort]")) {
    const k = b.dataset.sort, e = effSort();
    const on = k === "long" ? (e === "long" || e === "short") : k === "old" ? (e === "old" || e === "new") : e === k;
    b.classList.toggle("on", on);
    b.dataset.dir = on ? ({ long: "↓", short: "↑", old: "↑", new: "↓", loved: "↓" }[e] || "") : "";
  }
  const nf = FACETS.reduce((n, f) => n + state.f[f.key].size, 0);
  $("#filtersCount").textContent = nf ? `· ${nf}` : "";
  $("#sheetShow").textContent = `Show ${visible.length} work${visible.length === 1 ? "" : "s"}`;
  writeURL();
}
function chipsActive() {
  const out = [];
  for (const f of FACETS) for (const v of state.f[f.key]) {
    const label = f.key === "author" ? v : f.key === "win" ? "★ Has review winners" : (f.options.find(o => o.v === v)?.label || v);
    out.push(`<button type="button" class="achip" data-rm="${f.key}" data-v="${esc(v)}" title="Remove">${esc(label)}<span>×</span></button>`);
  }
  if (state.q.trim()) out.unshift(`<button type="button" class="achip q" data-rmq title="Clear search">“${esc(state.q.trim())}”<span>×</span></button>`);
  return out;
}
function renderStatus() {
  const mins = visible.reduce((n, w) => n + w.s.stats.minutes, 0);
  const posts = visible.reduce((n, w) => n + w.s.stats.posts, 0);
  const chips = chipsActive();
  $("#status").innerHTML = `<span class="count"><b>${num(visible.length)}</b> of ${num(works.length)} works · ${num(posts)} posts · ${num(Math.round(mins / 60))} hours</span>
    ${chips.length ? `<span class="achips">${chips.join("")}${chips.length > 1 ? `<button type="button" class="clear-link" data-clearall>Clear all</button>` : ""}</span>` : ""}`;
}
function emptyHTML() {
  const chips = chipsActive();
  return `<li class="empty"><p>Nothing in the Library matches all of these at once.</p><p class="meta">Remove one: ${chips.join(" ")}</p></li>`;
}

// ---------- Events ----------
function setFocus(id, scroll = true) {
  state.focus = id;
  for (const el of document.querySelectorAll(".row.focus")) el.classList.remove("focus");
  const el = id && document.querySelector(`.row[data-id="${id}"]`);
  if (el) { el.classList.add("focus"); if (scroll) el.scrollIntoView({ block: "nearest" }); }
}
function toggle(id) {
  state.open.has(id) ? state.open.delete(id) : state.open.add(id);
  const w = byId.get(id), el = document.querySelector(`.row[data-id="${id}"]`);
  if (el) { el.outerHTML = rowHTML(w); }
  state.focus = id; setFocus(id, false);
  const nel = document.querySelector(`.row[data-id="${id}"]`);
  const r = nel.getBoundingClientRect();
  if (r.top < 110 || r.top > innerHeight - 80) nel.scrollIntoView({ block: "start" });
  writeURL();
}
$("#rows").addEventListener("click", e => {
  const chip = e.target.closest("[data-topic]");
  if (chip) { const t = chip.dataset.topic, s = state.f.topic; s.has(t) ? s.delete(t) : s.add(t); update(); return; }
  if (e.target.closest("a, .achip")) return;
  const main = e.target.closest(".row-main"); if (!main) return;
  if (getSelection().toString()) return;
  toggle(main.parentElement.dataset.id);
});
document.addEventListener("click", e => {
  const rm = e.target.closest("[data-rm]");
  if (rm) { state.f[rm.dataset.rm].delete(rm.dataset.v); update(); return; }
  if (e.target.closest("[data-rmq]")) { state.q = ""; $("#q").value = ""; update(); return; }
  if (e.target.closest("[data-clearall]")) { clearAll(); return; }
});
function clearAll() { for (const f of FACETS) state.f[f.key].clear(); state.q = ""; $("#q").value = ""; update(); }
$("#sheetClear").onclick = () => { for (const f of FACETS) state.f[f.key].clear(); update(); };

let qTimer;
$("#q").addEventListener("input", e => { state.q = e.target.value; clearTimeout(qTimer); qTimer = setTimeout(() => { if (state.sort === "match" && !state.q.trim()) state.sort = null; update(); window.scrollTo({ top: Math.min(scrollY, $(".toolbar").offsetTop - 70) }); }, 60); });
$("#sort").addEventListener("change", e => { state.sort = e.target.value; update(); });
$("#colhead").addEventListener("click", e => {
  const b = e.target.closest("[data-sort]"); if (!b) return;
  const k = b.dataset.sort, cur = effSort();
  state.sort = k === "long" ? (cur === "long" ? "short" : "long") : k === "old" ? (cur === "old" ? "new" : "old") : k;
  update();
});

// phone sheet
const openSheet = on => document.body.classList.toggle("sheet-open", on);
$("#filtersBtn").onclick = () => openSheet(true);
$("#sheetClose").onclick = $("#sheetShow").onclick = $("#backdrop").onclick = () => openSheet(false);

document.addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const inField = e.target.matches("input, select, textarea");
  if (inField) {
    if (e.key === "Escape") { if (e.target.id === "q" && e.target.value) { e.target.value = ""; state.q = ""; update(); } e.target.blur(); }
    if (e.target.id === "q" && (e.key === "Enter" || e.key === "ArrowDown")) { e.preventDefault(); e.target.blur(); if (visible[0]) setFocus(visible[0].id); }
    return;
  }
  if (e.key === "/") { e.preventDefault(); $("#q").focus(); $("#q").select(); return; }
  if (document.body.classList.contains("sheet-open")) { if (e.key === "Escape") openSheet(false); return; }
  const i = visible.findIndex(w => w.id === state.focus);
  if (e.key === "j" || e.key === "k") {
    e.preventDefault();
    const n = i < 0 ? 0 : Math.max(0, Math.min(visible.length - 1, i + (e.key === "j" ? 1 : -1)));
    if (visible[n]) setFocus(visible[n].id);
  } else if (e.key === "Enter" && state.focus && !e.target.closest("a, button")) { e.preventDefault(); toggle(state.focus); }
  else if (e.key === "o" && state.focus) { window.open(byId.get(state.focus).s.url, "_blank", "noopener"); }
  else if (e.key === "Escape") {
    if (state.focus && state.open.has(state.focus)) toggle(state.focus); else setFocus(null);
  }
});

// note
$("#note .note-x").onclick = () => { $("#note").remove(); localStorage.setItem("cat03-note", "hidden"); };
if (localStorage.getItem("cat03-note") === "hidden") $("#note").remove();

// subtitle
{
  const cur = works.filter(w => w.s.kind === "curated").length, com = works.filter(w => w.s.kind === "community").length;
  const books = works.filter(w => w.s.kind === "book").length;
  const mins = works.reduce((n, w) => n + w.s.stats.minutes, 0), posts = works.reduce((n, w) => n + w.s.stats.posts, 0);
  $("#sub").innerHTML = `Every sequence, book and collection on LessWrong in one list: ${cur} curated sequences, ${books} books of the ${lib.core.length} core collections and ${com} community sequences. ${num(posts)} posts, about ${num(Math.round(mins / 60))} hours of reading.`;
}

readURL();
$("#q").value = state.q;
buildFacets();
update();
if (state.open.size) { const first = document.querySelector(".row.open"); if (first) { state.focus = first.dataset.id; setFocus(first.dataset.id, false); first.scrollIntoView({ block: "start" }); } }
