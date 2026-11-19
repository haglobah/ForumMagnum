import "../../shared/header.js";
import { loadLibrary, image, progress, fmt } from "../../shared/library.js";
import { themes, questions } from "./questions.js";

const lib = await loadLibrary();
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = t => String(t).normalize("NFKC").replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

$("#n-seq").textContent = lib.sequences.length;
const note = $("#note");
if (localStorage.getItem("q05:note") === "off") note.remove();
else note.querySelector(".note-x").onclick = () => { note.remove(); localStorage.setItem("q05:note", "off"); };

// ── where a sequence sits in a core collection ("Book 2 of Rationality: A-Z")
const partOf = new Map();
for (const c of lib.collections) c.books.forEach((b, i) => b.sequenceIds.forEach(id => partOf.set(id, { col: c, book: b, i })));
const coreImage = slug => lib.core.find(c => c.collection === slug)?.imageUrl;
const winnersById = new Map(lib.reviewWinners.map(p => [p.id, p]));

// ── resolve the hand-written answers against the data
function resolve(a) {
  if (a.post) {
    const seq = a.in ? lib.byId.get(a.in) : null;
    const post = seq ? seq.posts.find(p => norm(p.title) === norm(a.post))
                     : lib.reviewWinners.find(p => norm(p.title) === norm(a.post));
    if (!post) return null;
    const w = winnersById.get(post.id);
    return { kind: "post", post: { ...post, art: post.art || w?.art || null, winner: post.winner || w?.winner || null }, seq, why: a.why };
  }
  const seq = lib.byId.get(a.seq);
  if (!seq) return null;
  if (a.chapter) {
    const ch = seq.chapters.find(c => c.title === a.chapter);
    return ch ? { kind: "chapter", seq, chapter: ch, why: a.why } : null;
  }
  return { kind: "seq", seq, why: a.why };
}
const minutesOf = r => r.kind === "post" ? r.post.minutes : (r.chapter ? r.chapter.posts : r.seq.posts).reduce((n, p) => n + p.minutes, 0);
const missing = [];
for (const q of questions) {
  q.items = q.answers.map(a => resolve(a) || (missing.push(`${q.slug}: ${a.post || a.seq}`), null)).filter(Boolean);
  q.deeperSeq = lib.byId.get(q.deeper) || q.items.find(r => r.seq)?.seq;
  q.minutes = q.items.reduce((n, r) => n + minutesOf(r), 0);
  q.shortest = Math.min(...q.items.map(minutesOf));
}
if (missing.length) console.warn("Unresolved answers:", missing);

// ── the list of questions
const nav = $("#questions");
nav.innerHTML = themes.map((t, ti) => `
  <section class="theme" id="theme-${t.id}">
    <div class="theme-head"><span class="theme-num">${ROMAN[ti]}</span><span class="theme-name">${esc(t.name)}</span><span class="theme-lede">${esc(t.lede)}</span></div>
    <ul class="qlist">${questions.filter(q => q.theme === t.id).map(q => `
      <li><button class="q" data-slug="${q.slug}" aria-expanded="false" aria-controls="panel">${esc(q.q)}<span class="qmeta">${q.items.length} answers · from ${fmt.hours(q.shortest)}</span></button></li>`).join("")}
    </ul>
  </section>`).join("");

const panel = $("#panel"), side = $("#side");
const wide = matchMedia("(min-width: 961px)");
let state = { mode: "welcome", slug: null, query: "" };

nav.addEventListener("click", e => {
  const b = e.target.closest(".q"); if (!b) return;
  if (state.mode === "question" && state.slug === b.dataset.slug && !wide.matches) return show({ mode: "welcome" });
  show({ mode: "question", slug: b.dataset.slug }, { scroll: true });
});
panel.addEventListener("click", e => {
  const b = e.target.closest("[data-go]");
  if (b) { e.preventDefault(); show({ mode: "question", slug: b.dataset.go }, { scroll: true, focusList: true }); }
  if (e.target.closest(".close")) show({ mode: "welcome" });
});
wide.addEventListener("change", () => place());
addEventListener("hashchange", () => { const s = location.hash.slice(1); if (questions.some(q => q.slug === s) && s !== state.slug) show({ mode: "question", slug: s }); });
addEventListener("library-progress", () => render());

function show(next, { scroll = false, focusList = false } = {}) {
  state = { ...state, ...next };
  if (state.mode === "question") history.replaceState(null, "", "#" + state.slug);
  else if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  render(); place();
  if (scroll) {
    const btn = nav.querySelector(`.q[data-slug="${state.slug}"]`);
    if (!wide.matches && btn) btn.scrollIntoView({ block: "start", behavior: "smooth" });
    else if (wide.matches) { panel.scrollTop = 0; if (focusList && btn) btn.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    if (wide.matches && side.getBoundingClientRect().top > innerHeight * .6) side.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

function place() {
  nav.querySelectorAll(".q").forEach(b => b.setAttribute("aria-expanded", String(state.mode === "question" && b.dataset.slug === state.slug)));
  panel.classList.toggle("ask-results", state.mode === "ask");
  if (wide.matches) { panel.classList.remove("inline"); if (panel.parentElement !== side) side.append(panel); return; }
  panel.classList.add("inline");
  if (state.mode === "question") nav.querySelector(`.q[data-slug="${state.slug}"]`).closest("li").append(panel);
  else if (state.mode === "ask") $("#ask").after(panel);
  else { side.append(panel); panel.innerHTML = ""; }
}

function render() {
  if (state.mode === "question") return renderQuestion(questions.find(q => q.slug === state.slug));
  if (state.mode === "ask") return renderAsk(state.query);
  renderWelcome();
}

// ── a question's answers
function kindLine(r, i) {
  const start = i === 0 ? `<b class="start">Start here</b> · ` : "";
  if (r.kind === "post") {
    const p = r.post, read = progress.isRead(p.id) ? ` · <span class="read-mark">✓ read</span>` : "";
    const win = p.winner ? ` · <span class="winner-badge">★ Best of LessWrong ${p.winner.year}</span>` : "";
    return `${start}<b>Post</b> · ${fmt.hours(p.minutes)} · ${p.karma} karma${p.author ? ` · ${esc(p.author.name)}` : ""}${win}${read}`;
  }
  const posts = r.chapter ? r.chapter.posts : r.seq.posts;
  const pr = progress.of({ posts });
  const read = pr.read ? ` · <span class="read-mark">${pr.read}/${pr.total} read</span>` : "";
  const label = r.kind === "chapter" ? "Chapter" : partOf.has(r.seq.id) && r.seq.kind === "book" ? "Book" : "Sequence";
  return `${start}<b>${label}</b> · ${posts.length} posts · ${fmt.hours(posts.reduce((n, p) => n + p.minutes, 0))}${r.seq.author?.name ? ` · ${esc(r.seq.author.name)}` : ""}${read}`;
}
function answerHTML(r, i, { why = r.why, hit = false } = {}) {
  const title = r.kind === "post" ? r.post.title : r.kind === "chapter" ? r.chapter.title : r.seq.title;
  const url = r.kind === "post" ? r.post.url : r.seq.url;
  let from = "";
  if (r.kind === "post" && r.seq) from = `in <a href="${r.seq.url}" target="_blank" rel="noopener">${esc(r.seq.title)}</a>`;
  else if (r.kind === "post") from = `in <a href="https://www.lesswrong.com/bestoflesswrong" target="_blank" rel="noopener">Best of LessWrong</a>`;
  else if (r.kind === "chapter") from = `a chapter of <a href="${r.seq.url}" target="_blank" rel="noopener">${esc(r.seq.title)}</a>`;
  else if (partOf.has(r.seq.id)) { const { col, book } = partOf.get(r.seq.id); from = `part of <a href="${col.url}" target="_blank" rel="noopener">${esc(col.title)}</a>${book.title && book.title !== col.title ? ` · ${esc(book.title)}` : ""}`; }
  return `<li class="answer${hit ? " hit" : ""}"><div class="n">${i + 1}</div><div>
    <div class="kind">${kindLine(r, hit ? -1 : i)}</div>
    <a class="title" href="${url}" target="_blank" rel="noopener">${hit ? hl(title) : esc(title)}</a>
    ${why ? `<p class="why">${why}</p>` : ""}
    ${from ? `<div class="from">${from}</div>` : ""}
  </div></li>`;
}
function deeperHTML(seq) {
  if (!seq) return "";
  const img = image(seq.gridImageId || seq.bannerImageId, { w: 240, h: 240 }) || coreImage(seq.collection) || coreImage(partOf.get(seq.id)?.col.slug);
  const part = partOf.get(seq.id);
  const desc = (seq.description || "").replace(/^>\s*/, "").trim();
  return `<div class="deeper card">
    ${img ? `<img src="${img}" alt="" loading="lazy">` : `<div class="ph">${esc(seq.title[0] || "?")}</div>`}
    <div>
      <div class="label">Then go deeper</div>
      <h3><a href="${seq.url}" target="_blank" rel="noopener">${esc(seq.title)}</a></h3>
      <div class="meta">${seq.author?.name ? esc(seq.author.name) + " · " : ""}${seq.stats.posts} posts · ${fmt.hours(seq.stats.minutes)}${fmt.years(seq) ? " · " + fmt.years(seq) : ""}${seq.stats.winners.length ? ` · <span class="winner-badge">★ ${seq.stats.winners.length}</span>` : ""}</div>
      ${desc ? `<p>${esc(desc)}</p>` : ""}
      <a class="go" href="${seq.url}" target="_blank" rel="noopener">Read the whole sequence →</a>
      ${part ? `<div class="part">Part of <a href="${part.col.url}" target="_blank" rel="noopener">${esc(part.col.title)}</a>${part.book.title && part.book.title !== part.col.title ? `, in “${esc(part.book.title)}”` : ""}</div>` : ""}
    </div></div>`;
}
function renderQuestion(q) {
  const i = questions.indexOf(q), prev = questions[i - 1], next = questions[i + 1];
  const theme = themes.find(t => t.id === q.theme);
  panel.innerHTML = `
    <div class="label">${esc(theme.name)}<button class="close" aria-label="Close">×</button></div>
    <h2>${esc(q.q)}</h2>
    <p class="sum">${q.items.length} places to start, about ${fmt.hours(q.minutes)} if you read them all.</p>
    <ol class="answers">${q.items.map((r, i) => answerHTML(r, i)).join("")}</ol>
    ${deeperHTML(q.deeperSeq)}
    <div class="pager">
      ${prev ? `<button data-go="${prev.slug}">← ${esc(prev.q)}</button>` : "<span></span>"}
      ${next ? `<button data-go="${next.slug}">${esc(next.q)} →</button>` : "<span></span>"}
    </div>`;
}
function renderWelcome() {
  if (!wide.matches) { panel.innerHTML = ""; return; }
  const seqs = new Set(questions.flatMap(q => q.items.filter(r => r.seq).map(r => r.seq.id)));
  const total = questions.reduce((n, q) => n + q.items.length, 0);
  panel.innerHTML = `<div class="welcome">
    <div class="label">How this works</div>
    <p>Choose a question on the left. You get two to five answers, chosen by hand: sometimes a whole sequence, sometimes one chapter, often a single post. Each comes with a sentence on why it is there, and every question ends with one longer work to commit to.</p>
    <div class="stats"><div><b>${questions.length}</b>questions</div><div><b>${total}</b>answers</div><div><b>${seqs.size}</b>sequences behind them</div></div>
    <p>If you don’t know where to begin, most readers start here:</p>
    <button class="try" data-go="fooling-myself">How do I notice when I’m fooling myself?</button>
  </div>`;
}

// ── "Ask your own question": a small client-side matcher
const STOP = new Set("a about am an and any are as at be been being but by can could did do does doing for from get got had has have how i if in into is it its just me more most my no not of on or our should so some than that the their them then there these they this to too up us was we were what when where which who why will with would you your yours make makes really much many very want need thing things good better best way ways well stop actually all us anything everything someone people".split(" "));
const SYN = {
  procrastinat: ["akrasia", "motivat", "productiv"], lazy: ["akrasia", "motivat"], burnout: ["guilt", "rest", "slack"], tired: ["rest", "slack"],
  ai: ["artificial", "agi", "alignment"], agi: ["ai", "alignment"], robot: ["ai"], llm: ["language", "gpt"], chatgpt: ["gpt", "language"],
  sad: ["emotion", "depress"], anxious: ["fear", "anxiety"], anxiety: ["fear"], happy: ["happi", "fun"], happiness: ["happi", "fun"],
  moral: ["ethic", "metaethic", "value"], ethics: ["moral", "metaethic"], meaning: ["value", "purpose"],
  argue: ["argument", "disagree", "debate"], argument: ["disagree", "debate"], debate: ["disagree", "argument"],
  wrong: ["mistake", "bias", "error"], bias: ["biase", "rational"], lie: ["honest", "decept"], honest: ["honesty", "lie"],
  math: ["mathemat"], statistics: ["statistic", "study"], study: ["studie", "research"], money: ["econom", "wealth"],
  learn: ["learning", "study"], death: ["mortal", "aging", "die"], aging: ["death", "longevity"], god: ["religion", "faith"],
  write: ["writing"], kid: ["children", "parent"], kids: ["children", "parent"], child: ["children", "parent"], kill: ["extinction", "risk", "danger"], die: ["death", "extinction"], faster: ["speed", "quick"], believe: ["belief"], religion: ["god", "faith"], creativity: ["creativ", "babble", "idea"], focus: ["attention", "concentrat"], habit: ["habits", "tap"],
};
function stem(w) {
  w = w.replace(/'s$/, "");
  for (const suf of ["isations", "izations", "isation", "ization", "ations", "ation", "nesses", "ness", "ments", "ment", "ings", "ing", "ies", "ied", "edly", "ed", "es", "ly", "s"])
    if (w.length - suf.length >= 4 && w.endsWith(suf)) return suf === "ies" || suf === "ied" ? w.slice(0, -suf.length) + "y" : w.slice(0, -suf.length);
  return w;
}
const words = t => norm(t).replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter(w => w && !STOP.has(w));
const terms = t => [...new Set(words(t).map(stem))];
const matchSet = (set, qt) => { if (set.has(qt)) return true; if (qt.length < 4) return false; for (const t of set) if (t.startsWith(qt) || (t.length >= 5 && qt.startsWith(t))) return true; return false; };

// documents: sequences, named chapters, posts (deduplicated, with the best sequence to read them in)
const docs = [];
const ctxRank = s => (s.kind === "curated" ? 0 : s.kind === "book" ? 1 : 2);
const allSeqs = [...lib.sequences, ...lib.books].filter(s => s.title && s.posts.length);
const postCtx = new Map();
for (const s of allSeqs) for (const p of s.posts) {
  const c = postCtx.get(p.id);
  if (!c || ctxRank(s) < ctxRank(c.seq)) postCtx.set(p.id, { post: p, seq: s });
}
for (const s of allSeqs) {
  if (s.posts.length < 2) continue;
  docs.push({ r: { kind: "seq", seq: s }, fields: [[terms(s.title), 5], [terms(s.stats.tags.slice(0, 8).map(t => t.name).join(" ")), 1.6], [terms(s.description.slice(0, 600)), 1.2], [terms(s.posts.map(p => p.title).join(" ")), 0.8]],
    prior: Math.log10(10 + s.stats.karmaMedian) * 0.6 + (s.kind === "curated" ? 0.5 : 0) + (s.posts.length >= 4 ? 0.3 : 0) });
  for (const c of s.chapters) if (c.title && c.title.length > 2 && c.posts.length >= 2 && c.posts.length < s.posts.length)
    docs.push({ r: { kind: "chapter", seq: s, chapter: c }, fields: [[terms(c.title), 4], [terms(c.posts.map(p => p.title).join(" ")), 1]], prior: Math.log10(10 + s.stats.karmaMedian) * 0.5 });
}
for (const { post, seq } of postCtx.values()) if (post.karma >= 20)
  docs.push({ r: { kind: "post", post: { ...post, winner: post.winner || winnersById.get(post.id)?.winner || null }, seq }, fields: [[terms(post.title), 5], [terms(post.tags.map(t => t.name).join(" ")), 1.5]], prior: Math.log10(10 + post.karma) * 0.7 + (post.winner ? 0.4 : 0) });
for (const p of lib.reviewWinners) if (!postCtx.has(p.id))
  docs.push({ r: { kind: "post", post: p, seq: null }, fields: [[terms(p.title), 5], [terms(p.tags.map(t => t.name).join(" ")), 1.5]], prior: Math.log10(10 + p.karma) * 0.7 + 0.4 });
for (const d of docs) d.sets = d.fields.map(([ts, w]) => [new Set(ts), w]);
const qdocs = questions.map(q => ({ q, sets: [[new Set(terms(q.q)), 3], [new Set(terms(q.keys || "")), 2]] }));

const idfCache = new Map();
function idf(t) {
  if (!idfCache.has(t)) {
    let df = 0;
    for (const d of docs) if (d.sets.some(([set]) => matchSet(set, t))) df++;
    idfCache.set(t, Math.log(1 + docs.length / (1 + df)));
  }
  return idfCache.get(t);
}
// each query term is a group [term, ...synonyms]; a document scores by the rarest
// field-weighted match per group, and its coverage is the share of the query's
// rarity it matched (so "real" in "is consciousness real" counts for little)
function scoreDoc(d, qts, weights) {
  let s = 0, got = 0, total = 0;
  qts.forEach((group, gi) => {
    const wq = weights[gi]; total += wq;
    let best = 0;
    for (const t of group) for (const [set, w] of d.sets) { const v = w * (t === group[0] ? 1 : 0.45); if (v > best && matchSet(set, t)) best = v; }
    if (best) { got += wq; s += best * wq; }
  });
  return got ? { s: s / total, cover: got / total } : null;
}
let hlTerms = [];
function hl(text) {
  let h = esc(text);
  if (!hlTerms.length) return h;
  const re = new RegExp(`\\b(${hlTerms.map(t => t.replace(/[^a-z0-9]/g, "")).filter(Boolean).join("|")})[a-z]*`, "gi");
  return h.replace(re, m => `<mark>${m}</mark>`);
}
function search(query) {
  const base = terms(query);
  const qts = base.map(t => [t, ...(SYN[t] || []), ...Object.entries(SYN).filter(([k]) => t.startsWith(k) && k !== t).flatMap(([, v]) => v)]);
  hlTerms = base.filter(t => t.length >= 3);
  if (!qts.length) return { qs: [], hits: [] };
  const weights = qts.map(g => idf(g[0]));
  const qs = qdocs.map(d => ({ q: d.q, m: scoreDoc(d, qts, weights) })).filter(x => x.m && x.m.cover >= 0.6)
    .sort((a, b) => b.m.s * b.m.cover - a.m.s * a.m.cover).slice(0, 2).map(x => x.q);
  const scored = [];
  for (const d of docs) { const m = scoreDoc(d, qts, weights); if (m && m.cover >= 0.34) scored.push({ d, v: m.s * m.cover * m.cover + d.prior }); }
  scored.sort((a, b) => b.v - a.v);
  const perSeq = new Map(), seen = new Set(), hits = [];
  for (const { d } of scored) {
    const r = d.r, key = r.kind === "post" ? "p" + r.post.id : r.kind === "chapter" ? "c" + r.seq.id + r.chapter.title : "s" + r.seq.id;
    const sid = r.seq?.id || "rw";
    if (seen.has(key) || (perSeq.get(sid) || 0) >= 2) continue;
    seen.add(key); perSeq.set(sid, (perSeq.get(sid) || 0) + 1); hits.push(r);
    if (hits.length >= 8) break;
  }
  return { qs, hits };
}
function renderAsk(query) {
  const { qs, hits } = search(query);
  const why = r => {
    if (r.kind === "seq") { const d = r.seq.description.replace(/^>\s*/, "").trim(); return d ? hl(d.length > 170 ? d.slice(0, 165).replace(/\s+\S*$/, "") + "…" : d) : ""; }
    if (r.kind === "chapter") return hl(r.chapter.posts.slice(0, 3).map(p => p.title).join(" · ")) + (r.chapter.posts.length > 3 ? " …" : "");
    const tags = r.post.tags.filter(t => hlTerms.some(h => matchSet(new Set(terms(t.name)), h))).map(t => t.name);
    return tags.length ? `Tagged ${hl(tags.slice(0, 3).join(", "))}` : "";
  };
  panel.innerHTML = `
    <div class="label">Your question<button class="close" aria-label="Close">×</button></div>
    <h2>“${esc(query)}”</h2>
    ${qs.length ? `<div class="related"><p class="sum">Close to a question we have answers for:</p>${qs.map(q => `<button data-go="${q.slug}">${esc(q.q)}</button>`).join("")}</div>` : ""}
    ${hits.length ? `<p class="sum">Best matches in the Library, by title, description, post titles and tags:</p>
      <ol class="answers">${hits.map((r, i) => answerHTML(r, i, { why: why(r), hit: true })).join("")}</ol>`
      : `<p class="empty">Nothing in the Library matches that closely. Try fewer or plainer words, or pick one of the questions${wide.matches ? " on the left" : " below"}.</p>`}`;
}

const input = $("#ask-input");
let timer;
const runAsk = () => {
  const v = input.value.trim();
  if (v.length < 2) { if (state.mode === "ask") show({ mode: state.slug ? "question" : "welcome" }); return; }
  show({ mode: "ask", query: v });
};
input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(runAsk, 180); });
$("#ask").addEventListener("submit", e => { e.preventDefault(); clearTimeout(timer); runAsk(); if (!wide.matches) input.blur(); });

// ── start
const initial = location.hash.slice(1);
if (questions.some(q => q.slug === initial)) show({ mode: "question", slug: initial });
else show({ mode: "welcome" });
window.__q05 = { questions, search, missing };
