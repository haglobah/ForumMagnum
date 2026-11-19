import "../../shared/header.js";
import { loadLibrary, image } from "../../shared/library.js";

const lib = await loadLibrary();

// ---------- basics ----------
const MIN_B = 10, MAX_B = 3000, AX_MIN = 5, AX_MAX = 3000;
const COLORS = ["var(--c0)", "var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)"];
const PRESETS = [
  { min: 20, label: "20 minutes", sub: "A coffee break" },
  { min: 150, label: "An evening", sub: "2–3 hours" },
  { min: 480, label: "A weekend", sub: "About 8 hours" },
  { min: 1050, label: "A month of lunches", sub: "15–20 hours" },
];
const MOODS = [
  { id: "any", label: "Anything good" },
  { id: "think", label: "Think better", topics: { Rationality: 1, "World Modeling": .8 }, cats: ["rationality", "modeling"] },
  { id: "ai", label: "Understand AI", topics: { AI: 1 }, cats: ["ai safety", "ai strategy"] },
  { id: "live", label: "Live better", topics: { Practical: 1, "World Optimization": .6, Community: .5 }, cats: ["practical", "optimization"] },
  { id: "story", label: "A story", fiction: true },
  { id: "surprise", label: "Surprise me" },
];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function hm(m) {
  m = Math.round(m);
  if (m < 60) return `${m} min`;
  if (m >= 600) return `${Math.round(m / 60)} h`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}
function nice(m) {
  const step = m < 60 ? 5 : m < 300 ? 10 : m < 1200 ? 30 : 60;
  return clamp(Math.round(m / step) * step, MIN_B, MAX_B);
}
function budgetName(B) {
  if (B <= 35) return "a coffee break";
  if (B <= 75) return "an hour";
  if (B <= 300) return "an evening";
  if (B <= 900) return "a weekend";
  if (B <= 1500) return "a month of lunches";
  return "a season of lunches";
}
const regime = B => B <= 75 ? "now" : B <= 300 ? "evening" : B <= 900 ? "weekend" : "lunch";
const sortedNums = xs => xs.slice().sort((a, b) => a - b);
function pct(v, arr) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; arr[m] < v ? lo = m + 1 : hi = m; } return lo / arr.length; }
function median(xs) { const s = sortedNums(xs); return s.length ? s[Math.floor(s.length / 2)] : 0; }
function rnd(seed, key) { let h = 2166136261 ^ seed; for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619); return ((h >>> 0) % 10007) / 10007; }
function sentence(text, max = 210) {
  text = (text || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const dot = cut.search(/[.!?][^.!?]*$/);
  return dot > 60 ? cut.slice(0, dot + 1) : cut.replace(/\s+\S*$/, "") + "…";
}
function sized(url, w, h) {
  if (!url) return null;
  return url.includes("/image/upload/") ? url.replace("/image/upload/", `/image/upload/c_fill,g_auto,w_${w},h_${h},q_auto,f_auto/`) : url;
}

// ---------- units: everything a plan can be made of ----------
const kmeds = sortedNums(lib.sequences.filter(s => s.stats.posts).map(s => s.stats.karmaMedian));
const units = [], byKey = new Map();
const add = u => {
  u.ids = u.posts.map(p => p.id);
  u.tagTop = new Set();
  const tc = new Map();
  for (const p of u.posts) for (const t of p.tags) if (!t.core && t.slug !== "fiction") tc.set(t.slug, (tc.get(t.slug) || 0) + 1);
  [...tc].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([s]) => u.tagTop.add(s));
  u.tagNames = new Map(u.posts.flatMap(p => p.tags.map(t => [t.slug, t.name])));
  u.mood = {};
  units.push(u); byKey.set(u.key, u);
  return u;
};
const coreOf = new Map();
lib.core.forEach(c => c.books.forEach((b, i) => b.sequences.forEach(s => coreOf.set(s.id, { core: c, book: b, i }))));
const roman = ["I", "II", "III", "IV", "V", "VI", "VII"];
const seqImg = s => s.gridImageId ? image(s.gridImageId, { w: 320, h: 220 }) : null;
const seqQ = (kmed, winners, bonus, posts) => .55 * pct(kmed, kmeds) + .2 * Math.min(winners, 3) / 3 + bonus + (posts >= 3 ? .05 : 0);

for (const s of [...lib.sequences, ...lib.books]) {
  if (!s.stats.minutes || !s.posts.length) continue;
  const home = coreOf.get(s.id);
  const bonus = s.kind === "curated" ? .15 : s.kind === "book" ? .18 : 0;
  const ctx = home ? `Part of ${home.core.title}${home.book.title ? `, ${home.book.title}` : ""}` : `${s.author.name || "Unknown author"} · ${s.kind === "curated" ? "curated sequence" : "community sequence"}`;
  add({
    key: "s:" + s.id, kind: s.kind === "book" ? "book" : "sequence", seq: s, title: s.title, url: s.url, posts: s.posts,
    minutes: s.stats.minutes, image: seqImg(s) || (home ? sized(home.core.imageUrl, 320, 220) : null),
    quality: seqQ(s.stats.karmaMedian, s.stats.winners.length, bonus, s.stats.posts) * (s.stats.posts < 2 ? .5 : 1),
    kmed: s.stats.karmaMedian, winners: s.stats.winners.length, curated: s.kind === "curated", core: !!home,
    context: ctx, blurb: s.description, anchorable: s.stats.posts >= 2, axis: true,
  });
}
const wholes = [];
for (const c of lib.core) {
  const book0 = c.books[0];
  const bolw = c.collection === "bestoflesswrong";
  c.books.forEach((b, i) => {
    if (!b.title || b.sequences.length < 2) return;
    const posts = b.sequences.flatMap(s => s.posts);
    add({
      key: `cb:${c.collection}:${i}`, kind: "collbook", title: b.title, url: c.url, posts, minutes: sum(posts, p => p.minutes),
      image: seqImg(b.sequences[0]) || sized(c.imageUrl, 320, 220),
      quality: seqQ(median(posts.map(p => p.karma)), posts.filter(p => p.winner).length, .25, posts.length),
      kmed: median(posts.map(p => p.karma)), winners: posts.filter(p => p.winner).length, core: true,
      context: bolw ? `${c.title}, the printed book of ${b.sequences.length} essays sets` : `Book ${roman[i]} of ${c.title} · ${b.sequences.length} sequences`,
      blurb: bolw ? `One of the printed Best of LessWrong volumes: the essays the community voted most worth keeping, grouped by theme.` : c.summary,
      anchorable: true, parentKey: "c:" + c.collection,
    });
  });
  if (bolw) continue;
  // The Highlights: its first book is the 50 posts; "Further Reading" is extra.
  const seqs = c.collection === "highlights" ? book0.sequences : c.sequences;
  const posts = seqs.flatMap(s => s.posts);
  const u = add({
    key: "c:" + c.collection, kind: "collection", coll: c, title: c.title, url: c.url, posts, minutes: sum(posts, p => p.minutes),
    image: sized(c.imageUrl, 320, 220), quality: seqQ(median(posts.map(p => p.karma)), posts.filter(p => p.winner).length, .3, posts.length) + .08,
    kmed: median(posts.map(p => p.karma)), winners: posts.filter(p => p.winner).length, core: true,
    context: `Core reading · ${posts.length} posts in ${seqs.length} sequences`, blurb: c.summary, anchorable: true,
  });
  wholes.push(u);
}
for (const s of lib.sequences) {
  if (s.kind !== "curated" || s.chapters.length < 2) continue;
  s.chapters.forEach((ch, i) => {
    if (!ch.title || ch.posts.length < 2 || /full.?text|related/i.test(ch.title)) return;
    add({
      key: `ch:${s.id}:${i}`, kind: "chapter", title: ch.title, url: s.url, posts: ch.posts, minutes: sum(ch.posts, p => p.minutes),
      image: seqImg(s), quality: seqQ(s.stats.karmaMedian, ch.posts.filter(p => p.winner).length, .12, ch.posts.length) - .03,
      kmed: median(ch.posts.map(p => p.karma)), winners: ch.posts.filter(p => p.winner).length, curated: true,
      context: `Part ${i + 1} of ${s.title} · ${ch.posts.length} posts`, blurb: s.description, anchorable: true, parentKey: "s:" + s.id,
    });
  });
}
// single posts: review winners, and the strongest posts of the curated works
const postHome = new Map();
for (const s of [...lib.sequences.filter(s => s.kind === "curated"), ...lib.books, ...lib.sequences]) for (const p of s.posts) if (!postHome.has(p.id)) postHome.set(p.id, s);
const winnerById = new Map(lib.reviewWinners.map(p => [p.id, p]));
const postPool = new Map();
for (const p of lib.reviewWinners) postPool.set(p.id, p);
for (const s of [...lib.sequences.filter(s => s.kind === "curated"), ...lib.books]) for (const p of s.posts) if (p.karma >= 150 && !postPool.has(p.id)) postPool.set(p.id, winnerById.get(p.id) || p);
const pKarmas = sortedNums([...postPool.values()].map(p => p.karma));
for (const p of postPool.values()) {
  if (p.minutes < 3 || p.minutes > 120) continue;
  const home = postHome.get(p.id);
  const w = p.winner;
  add({
    key: "p:" + p.id, kind: "post", post: p, title: p.title, url: p.url, posts: [p], minutes: p.minutes,
    image: sized(p.art, 320, 220) || (home ? seqImg(home) : null),
    quality: .5 * pct(p.karma, pKarmas) + (w ? .3 + .1 * (1 - Math.min(w.ranking ?? 50, 50) / 50) : 0) + (home?.kind === "curated" ? .05 : 0),
    context: [p.author?.name, p.year, home ? `from ${home.title}` : null].filter(Boolean).join(" · "),
    anchorable: true,
  });
}
// "the opening of" a big work: its first sitting, sized to the budget
function openings(B) {
  if (B < 30) return [];
  const out = [];
  for (const w of wholes) {
    if (w.minutes < 2.5 * B) continue;
    const posts = []; let t = 0;
    for (const p of w.posts) { if (t + p.minutes > B) break; posts.push(p); t += p.minutes; }
    if (posts.length < 2 || t < B * .6) continue;
    const u = {
      key: `o:${w.coll.collection}:${posts.length}`, kind: "opening", title: `The opening of ${w.title}`, url: posts[0].url, posts, minutes: t,
      image: w.image, quality: w.quality - .06, kmed: median(posts.map(p => p.karma)), winners: posts.filter(p => p.winner).length, core: true,
      context: `Posts 1–${posts.length} of ${w.posts.length}`, blurb: w.blurb, rest: w.minutes - t, anchorable: true, parentKey: w.key,
      ids: posts.map(p => p.id), tagTop: w.tagTop, tagNames: w.tagNames, mood: {},
    };
    byKey.set(u.key, u);
    out.push(u);
  }
  return out;
}

// ---------- moods ----------
function postMood(p, mood) {
  if (mood.fiction) return p.tags.some(t => t.slug === "fiction") ? 1 : 0;
  let v = 0;
  for (const t of p.tags) if (t.core && mood.topics[t.name]) v = Math.max(v, mood.topics[t.name]);
  if (p.winner && mood.cats.includes(p.winner.category)) v = 1;
  return v;
}
function unitMood(u, mood) {
  if (!mood.topics && !mood.fiction) return 1;
  if (u.mood[mood.id] == null) {
    const tot = sum(u.posts, p => p.minutes) || 1;
    u.mood[mood.id] = sum(u.posts, p => p.minutes * postMood(p, mood)) / tot;
  }
  return u.mood[mood.id];
}
const moodOk = (u, mood) => !mood.topics && !mood.fiction ? true : unitMood(u, mood) >= (mood.fiction ? .5 : .45);

// ---------- planning ----------
const overlap = (a, b) => { const s = new Set(a.ids); let n = 0; for (const id of b.ids) if (s.has(id)) n++; return n / Math.max(1, Math.min(a.ids.length, b.ids.length)); };
const related = (a, b) => { let n = 0; for (const t of b.tagTop) if (a.tagTop.has(t)) n++; return n / 6; };
function sharedTag(a, b) { for (const t of b.tagTop) if (a.tagTop.has(t)) return a.tagNames.get(t); return null; }

function makePlans(B, st) {
  const surprise = st.mood.id === "surprise";
  const pool = [...units, ...openings(B)].filter(u => moodOk(u, st.mood));
  const score = u => {
    const r = u.minutes / B, fit = r <= 1 ? r : Math.max(0, 1 - (r - 1) * 10);
    return u.quality * .6 + fit * .35 + (u.kind === "post" ? 0 : .06) + (surprise ? rnd(st.seed, u.key) * .55 : 0);
  };
  const anchors = pool.filter(u => u.anchorable && u.minutes <= B * 1.06 && u.minutes >= B * .2 && (u.kind !== "post" || B <= 90))
    .map(u => [score(u), u]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  const chosen = [];
  const pinned = st.pin && byKey.get(st.pin);
  if (pinned) chosen.push(pinned);
  for (const u of anchors) {
    if (chosen.length >= 4) break;
    if (chosen.some(c => c === u || overlap(c, u) > .3 || (c.parentKey && c.parentKey === u.parentKey) || c.key === u.parentKey || u.key === c.parentKey)) continue;
    chosen.push(u);
  }
  const plans = chosen.map(a => fill([a], B, pool, st));
  if (!plans.length) plans.push(fill([], B, pool, st));
  return plans;
}
function fill(items, B, pool, st) {
  const surprise = st.mood.id === "surprise";
  const used = new Set(items.flatMap(u => u.ids));
  const meta = items.map(() => ({ before: B }));
  let rem = B - sum(items, u => u.minutes);
  const anchor = items[0];
  while (rem >= 6 && items.length < 5) {
    let best = null, bs = -Infinity;
    for (const u of pool) {
      if (u.minutes > rem * 1.04 || u.minutes < 3) continue;
      if (u.kind !== "post" && (rem < 30 || !u.anchorable)) continue;
      if (u.ids.some(id => used.has(id))) continue;
      if (u.parentKey && items.some(i => i.parentKey === u.parentKey || i.key === u.parentKey)) continue;
      const s = u.quality * .6 + (u.minutes / rem) * .3 + (anchor ? related(anchor, u) * .3 : 0) + (surprise ? rnd(st.seed + 7, u.key) * .4 : 0);
      if (s > bs) { bs = s; best = u; }
    }
    if (!best) break;
    meta.push({ before: rem });
    items.push(best); best.ids.forEach(id => used.add(id)); rem -= best.minutes;
  }
  return { items, meta, B, total: B - rem };
}

function reasons(u, plan, idx) {
  const out = [], B = plan.B, anchor = plan.items[0];
  if (idx === 0) out.push({ t: `Fits: ${hm(u.minutes)} of your ${hm(B)}` });
  else out.push({ t: `Fills ${hm(u.minutes)} of the ${hm(plan.meta[idx].before)} left` });
  if (u.kind === "post") {
    const w = u.post.winner;
    if (w) out.push({ t: `Best of LessWrong ${w.year}${w.ranking != null ? ` · #${w.ranking + 1} in ${w.category}` : ""}`, c: "gold" });
    out.push({ t: `${u.post.karma} karma` });
  } else {
    const p = pct(u.kmed, kmeds);
    if (p >= .7) out.push({ t: `Median post karma ${u.kmed}, top ${Math.max(1, Math.round((1 - p) * 100))}% of the Library` });
    if (u.winners) out.push({ t: `${u.winners} Best of LessWrong winner${u.winners > 1 ? "s" : ""}`, c: "gold" });
    if (u.kind === "collection" || u.kind === "collbook" || u.kind === "opening") out.push({ t: "Core reading", c: "plain" });
    else if (u.curated) out.push({ t: "Curated", c: "plain" });
    if (u.kind === "opening") out.push({ t: `${hm(u.rest)} more when you want it`, c: "plain" });
    if (u.kind !== "post" && u.posts.length > 1 && idx === 0) out.push({ t: `${u.posts.length} posts, ~${Math.round(u.minutes / u.posts.length)} min each`, c: "plain" });
  }
  if (idx > 0 && anchor) { const t = sharedTag(anchor, u); if (t) out.push({ t: `Also about ${t}`, c: "plain" }); }
  if (plan.mood && (plan.mood.topics || plan.mood.fiction) && idx === 0) out.push({ t: `${Math.round(unitMood(u, plan.mood) * 100)}% ${plan.mood.label.toLowerCase()}`, c: "plain" });
  return out;
}

// ---------- state ----------
const params = new URLSearchParams(location.hash.slice(1));
const st = {
  B: clamp(+params.get("t") || 150, MIN_B, MAX_B),
  mood: MOODS.find(m => m.id === params.get("m")) || MOODS[0],
  seed: 1, pin: null, plans: [], dayOpen: 0, showAll: false,
};
const saveHash = () => history.replaceState(null, "", `#t=${st.B}${st.mood.id !== "any" ? `&m=${st.mood.id}` : ""}`);

// ---------- hero controls ----------
const $ = id => document.getElementById(id);
const axisUnits = units.filter(u => u.axis);
const inBand = (m, B) => m >= B / 2 && m <= B;
const countBand = B => axisUnits.filter(u => inBand(u.minutes, B) && moodOk(u, st.mood)).length;
const toSlider = m => Math.round(1000 * Math.log(m / MIN_B) / Math.log(MAX_B / MIN_B));
const fromSlider = v => MIN_B * Math.pow(MAX_B / MIN_B, v / 1000);
const axFrac = m => (Math.log(clamp(m, AX_MIN, AX_MAX)) - Math.log(AX_MIN)) / (Math.log(AX_MAX) - Math.log(AX_MIN));

$("presets").innerHTML = PRESETS.map((p, i) => `<button class="preset" data-i="${i}" aria-pressed="false">
  <span class="p-label">${p.label}</span><span class="p-sub">${p.sub}</span>
  <span class="p-bar"><i style="width:${(axFrac(p.min) * 100).toFixed(1)}%"></i></span><span class="p-count"></span></button>`).join("");
$("presets").addEventListener("click", e => {
  const b = e.target.closest(".preset"); if (!b) return;
  setBudget(PRESETS[+b.dataset.i].min);
});
$("moods").innerHTML = `<span class="lead">In the mood to</span>` + MOODS.map(m =>
  `<button class="mood${m.id === "surprise" ? " dice" : ""}" data-id="${m.id}" aria-pressed="false"><span class="d">${m.label}</span></button>`).join("");
$("moods").addEventListener("click", e => {
  const b = e.target.closest(".mood"); if (!b) return;
  const m = MOODS.find(x => x.id === b.dataset.id);
  if (m.id === "surprise") { st.seed = (Math.random() * 1e9) | 0; b.querySelector(".d").style.animation = "none"; b.offsetWidth; b.querySelector(".d").style.animation = ""; }
  st.mood = m; st.pin = null; st.dayOpen = 0; st.showAll = false;
  render();
});
const slider = $("slider");
slider.addEventListener("input", () => setBudget(nice(fromSlider(+slider.value)), { fromSlider: true }));

function setBudget(B, { fromSlider = false, pin = null } = {}) {
  st.B = clamp(B, MIN_B, MAX_B); st.pin = pin; st.dayOpen = 0; st.showAll = false;
  if (!fromSlider) slider.value = toSlider(st.B);
  schedule();
}
let raf = 0;
const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

function renderControls() {
  const B = st.B;
  if (document.activeElement !== slider) slider.value = toSlider(B);
  slider.style.setProperty("--fill", `${slider.value / 10}%`);
  $("budget-out").innerHTML = `${hm(B)}<small>${budgetName(B)}</small>`;
  document.querySelectorAll(".preset").forEach((b, i) => {
    const p = PRESETS[i];
    b.setAttribute("aria-pressed", Math.abs(Math.log(B / p.min)) < .18 ? "true" : "false");
    const n = countBand(p.min);
    b.querySelector(".p-count").textContent = `${n} ${n === 1 ? "work" : "works"} this long`;
  });
  document.querySelectorAll(".mood").forEach(b => {
    b.setAttribute("aria-pressed", b.dataset.id === st.mood.id ? "true" : "false");
    if (b.dataset.id === "surprise") b.querySelector(".d").textContent = st.mood.id === "surprise" ? "Surprise me again" : "Surprise me";
  });
}

// ---------- the plan ----------
const planEl = $("plan");
planEl.innerHTML = `<div class="plan-head"><div><div class="plan-kicker"></div><h2 class="plan-title"></h2></div><div class="plan-total"></div></div>
  <div class="bar"></div><div class="bar-scale"></div><div class="plan-body"><div class="items"></div><div class="sched"></div></div>`;
const segEls = new Map();
let lastSig = "";

function thumb(u, color) {
  const ph = `<span class="ph" style="background:linear-gradient(135deg, ${color}, rgba(0,0,0,.25))">${esc((u.title.match(/[A-Za-z0-9]/) || ["·"])[0])}</span>`;
  return `<a class="thumb" href="${esc(u.url)}" target="_blank" rel="noopener" style="--c:${color}" tabindex="-1">${ph}${u.image ? `<img src="${esc(u.image)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</a>`;
}
function itemHTML(u, plan, i) {
  const color = COLORS[i % COLORS.length], main = i === 0;
  const why = reasons(u, plan, i).map(r => `<li class="${r.c || ""}">${esc(r.t)}</li>`).join("");
  const blurb = main && u.blurb ? `<p class="blurb">${esc(sentence(u.blurb, 230))}</p>` : "";
  return `<article class="item${main ? "" : " small"}">${thumb(u, color)}<div>
    <h3><a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.title)}</a></h3>
    <div class="sub"><span class="mins">${hm(u.minutes)}</span> · ${esc(u.context)}</div>${blurb}<ul class="why">${why}</ul></div></article>`;
}
function titleHTML(plan) {
  const B = plan.B, it = plan.items;
  const lead = { now: B <= 35 ? `In ${hm(B)}, read` : `In an hour, read`, evening: "Tonight, read", weekend: "This weekend, read", lunch: B <= 1500 ? "Over a month of lunches, read" : "Over a season of lunches, read" }[regime(B)];
  if (!it.length) return `Nothing fits ${hm(B)} in this mood. Try a little more time.`;
  const t = u => `<em>${esc(u.title)}</em>`;
  if (it.length === 1) return `${lead} ${t(it[0])}.`;
  if (it.length === 2) return `${lead} ${t(it[0])}, then ${t(it[1])}.`;
  return `${lead} ${t(it[0])}, then ${it.length - 1} shorter pieces.`;
}
function renderPlan() {
  const plan = st.plans[0];
  plan.mood = st.mood;
  const B = plan.B, span = Math.max(B, plan.total);
  const sig = plan.items.map(u => u.key).join("|");
  const same = sig === lastSig; lastSig = sig;
  planEl.classList.toggle("noanim", same);
  planEl.querySelector(".plan-kicker").textContent = `Your reading plan · ${budgetName(B)}`;
  planEl.querySelector(".plan-title").innerHTML = titleHTML(plan);
  const spare = B - plan.total;
  planEl.querySelector(".plan-total").innerHTML = `<b>${hm(plan.total)}</b>of ${hm(B)}${spare >= 1 ? ` · ${hm(spare)} to spare` : ""}`;
  // the bar, keyed so widths animate
  const bar = planEl.querySelector(".bar");
  const keep = new Set();
  plan.items.forEach((u, i) => {
    let el = segEls.get(u.key);
    if (!el) { el = document.createElement("div"); el.className = "seg"; el.style.width = "0%"; segEls.set(u.key, el); }
    keep.add(u.key);
    el.style.backgroundColor = COLORS[i % COLORS.length];
    const w = u.minutes / span * 100;
    let acc = 0;
    const ticks = u.posts.length > 1 && u.posts.length < 80 ? u.posts.slice(0, -1).map(p => { acc += p.minutes; return `<i style="left:${(acc / u.minutes * 100).toFixed(2)}%"></i>`; }).join("") : "";
    el.innerHTML = `<div class="ticks">${ticks}</div><span>${esc(u.title)} · ${hm(u.minutes)}</span>`;
    el.title = "";
    bar.appendChild(el);
    requestAnimationFrame(() => { el.style.width = `${w}%`; });
  });
  for (const [k, el] of segEls) if (!keep.has(k)) { el.remove(); segEls.delete(k); }
  let sp = bar.querySelector(".spare");
  if (!sp) { sp = document.createElement("div"); sp.className = "spare"; }
  bar.appendChild(sp);
  sp.textContent = spare >= 3 ? `${hm(spare)} free` : "";
  // scale under the bar
  const marks = [0, .25, .5, .75].map(f => `<span style="left:${f * 100}%">${f ? hm(span * f) : "0"}</span>`).join("");
  planEl.querySelector(".bar-scale").innerHTML = marks + `<span class="end" style="left:100%">${hm(span)}</span>`;
  planEl.querySelector(".items").innerHTML = plan.items.map((u, i) => itemHTML(u, plan, i)).join("");
  planEl.querySelector(".sched").innerHTML = scheduleHTML(plan);
}

// ---------- the schedule ----------
function pack(entries, cap) {
  const parts = [];
  for (const e of entries) {
    if (e.p.minutes > cap * 1.5) {
      const k = Math.ceil(e.p.minutes / cap);
      for (let j = 0; j < k; j++) parts.push({ ...e, min: e.p.minutes / k, part: j + 1, parts: k });
    } else parts.push({ ...e, min: e.p.minutes });
  }
  const out = []; let cur = null;
  for (const e of parts) {
    if (!cur || (cur.total > 0 && cur.total + e.min > cap * 1.15)) { cur = { entries: [], total: 0 }; out.push(cur); }
    cur.entries.push(e); cur.total += e.min;
  }
  return out;
}
const flat = plan => plan.items.flatMap((u, i) => u.posts.map(p => ({ p, i })));
const clock = mins => { const d = new Date(2000, 0, 1, 0, Math.round(mins)); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };
const partName = e => `${esc(e.p.title)}${e.parts > 1 ? ` <span class="muted">(${e.part}/${e.parts})</span>` : ""}`;
const plink = e => `<a href="${esc(e.p.url)}" target="_blank" rel="noopener">${partName(e)}</a>`;

function scheduleHTML(plan) {
  const B = plan.B, list = flat(plan), reg = regime(B);
  if (!list.length) return "";
  if (reg === "now" || reg === "evening") {
    const now = new Date();
    let t = reg === "now" ? Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5 : 19 * 60 + 30;
    const startT = t;
    const rows = list.map(e => { const r = { e, t }; t += e.p.minutes; return r; });
    const limit = st.showAll ? rows.length : 12;
    const shown = rows.length > limit + 2 ? rows.slice(0, limit) : rows;
    const li = shown.map(({ e, t }) => `<li style="--c:${COLORS[e.i % COLORS.length]}"><span class="t">${clock(t)}</span><span class="dot"></span><span class="n">${plink({ p: e.p })}</span><span class="m">${e.p.minutes} min</span></li>`).join("");
    const more = shown.length < rows.length ? `<li class="more"><button class="linkish" data-act="all">Show all ${rows.length} posts</button></li>` : "";
    return `<h4>${reg === "now" ? "Start now" : "Tonight"}</h4>
      <p class="lede">${reg === "now" ? `Begin at ${clock(startT)}, done by ${clock(t)}.` : `Start at 19:30 with a cup of tea, done by ${clock(t)}.`}</p>
      <ol class="rows">${li}${more}<li class="end"><span class="t">${clock(t)}</span><span>Done. ${plan.items.length > 1 ? `${plan.items.length} pieces read.` : ""}</span></li></ol>`;
  }
  if (reg === "weekend") {
    const n = clamp(Math.round(B / 120), 2, 6);
    const names = { 2: ["Saturday", "Sunday"], 3: ["Saturday morning", "Saturday afternoon", "Sunday morning"],
      4: ["Saturday morning", "Saturday afternoon", "Sunday morning", "Sunday afternoon"],
      5: ["Saturday morning", "Saturday afternoon", "Saturday evening", "Sunday morning", "Sunday afternoon"],
      6: ["Saturday morning", "Saturday afternoon", "Saturday evening", "Sunday morning", "Sunday afternoon", "Sunday evening"] }[n];
    const ses = pack(list, plan.total / n);
    const html = ses.map((s, k) => {
      const mini = s.entries.map(e => `<i style="--c:${COLORS[e.i % COLORS.length]};flex:${e.min}"></i>`).join("");
      const shown = s.entries.slice(0, 5).map(e => `<li>${plink(e)}</li>`).join("");
      const more = s.entries.length > 5 ? `<li class="more">and ${s.entries.length - 5} more</li>` : "";
      return `<div class="session"><div class="h">${names[k] || `Extra session ${k - n + 1}`}<span>${hm(s.total)}</span></div><div class="mini">${mini}</div><ol>${shown}${more}</ol></div>`;
    }).join("");
    return `<h4>Your weekend</h4><p class="lede">${ses.length} sittings of about ${hm(plan.total / ses.length)}.</p><div class="sessions">${html}</div>`;
  }
  const daily = clamp(Math.round(plan.total / 30 / 5) * 5, 20, 50);
  const days = pack(list, daily);
  st.days = days;
  const dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(d => `<div class="dow">${d}</div>`).join("");
  const cells = days.map((d, k) => {
    const c = COLORS[d.entries[0].i % COLORS.length];
    return `<div class="day${k === st.dayOpen ? " on" : ""}" data-day="${k}" style="--c:${c}"><span class="dn">${k + 1}</span><span class="dm">${Math.round(d.total)}′</span><span class="dt">${esc(d.entries[0].p.title)}</span></div>`;
  }).join("");
  return `<h4>${days.length} lunches</h4><p class="lede">About ${daily} minutes a day, starting on a Monday. Tap a day to see it.</p>
    <div class="cal">${dows}${cells}</div><div class="cal-detail">${dayDetail(days[st.dayOpen] || days[0], st.dayOpen)}</div>`;
}
function dayDetail(d, k) {
  if (!d) return "";
  return `<b>Day ${k + 1}</b> · ${Math.round(d.total)} min<ol>${d.entries.map(e => `<li>${plink(e)} <span class="muted">${Math.round(e.min)} min</span></li>`).join("")}</ol>`;
}
planEl.addEventListener("click", e => {
  const b = e.target.closest("[data-act=all]");
  if (b) { st.showAll = true; planEl.querySelector(".sched").innerHTML = scheduleHTML(st.plans[0]); }
});
const pickDay = el => {
  const k = +el.dataset.day; st.dayOpen = k;
  planEl.querySelectorAll(".day").forEach(d => d.classList.toggle("on", d === el));
  planEl.querySelector(".cal-detail").innerHTML = dayDetail(st.days[k], k);
};
planEl.addEventListener("mouseover", e => { const d = e.target.closest(".day"); if (d) pickDay(d); });
planEl.addEventListener("click", e => { const d = e.target.closest(".day"); if (d) pickDay(d); });

// ---------- alternatives ----------
const altEl = $("alts");
let lastAltSig = "";
function renderAlts() {
  const alts = st.plans.slice(1);
  if (!alts.length) { altEl.innerHTML = ""; lastAltSig = ""; return; }
  const sig = alts.map(p => p.items[0].key).join("|");
  altEl.classList.toggle("noanim", sig === lastAltSig); lastAltSig = sig;
  altEl.innerHTML = `<h2>Or spend ${hm(st.B)} on</h2><div class="alt-list">${alts.map(p => {
    const a = p.items[0], span = Math.max(p.B, p.total);
    const segs = p.items.map((u, i) => `<i style="width:${u.minutes / span * 100}%;background:${COLORS[i % COLORS.length]}"></i>`).join("");
    return `<button class="alt" data-key="${esc(a.key)}"><span class="a-title">${esc(a.title)}${p.items.length > 1 ? ` <span class="muted">+ ${p.items.length - 1}</span>` : ""}</span>
      <span class="a-sub">${hm(a.minutes)} · ${esc(a.context)}</span><span class="a-bar">${segs}</span></button>`;
  }).join("")}</div>`;
}
altEl.addEventListener("click", e => {
  const b = e.target.closest(".alt"); if (!b) return;
  st.pin = b.dataset.key; render();
  planEl.scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- the length axis ----------
const svg = $("axis"), wrap = $("axis-wrap"), tip = $("tip");
const NS = "http://www.w3.org/2000/svg";
let ax = null; // layout
function layoutAxis() {
  const W = wrap.clientWidth, small = W < 600;
  const pad = small ? 14 : 26, R = small ? 2.7 : 3.5;
  const X = m => pad + axFrac(m) * (W - 2 * pad);
  const mFromX = x => AX_MIN * Math.pow(AX_MAX / AX_MIN, clamp((x - pad) / (W - 2 * pad), 0, 1));
  // beeswarm, strongest works nearest the axis line
  const pts = axisUnits.map(u => ({ u, x: X(u.minutes), r: u.curated || u.kind === "book" ? R + .9 : R })).sort((a, b) => b.u.quality - a.u.quality);
  const bins = new Map(), bw = 2 * (R + 1);
  let maxY = 0;
  for (const p of pts) {
    const b0 = Math.floor(p.x / bw);
    const near = [];
    for (let b = b0 - 1; b <= b0 + 1; b++) for (const q of bins.get(b) || []) near.push(q);
    for (let k = 0; ; k++) {
      const y = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (R * .9);
      if (near.every(q => (q.x - p.x) ** 2 + (q.y - y) ** 2 >= (q.r + p.r + .7) ** 2)) { p.y = y; break; }
    }
    maxY = Math.max(maxY, Math.abs(p.y) + p.r);
    (bins.get(b0) || bins.set(b0, []).get(b0)).push(p);
  }
  // the big core collections as labelled markers above
  const colls = wholes.map(u => ({ u, x: X(u.minutes), label: `${u.title.replace("Harry Potter and the Methods of Rationality", "HPMOR")} · ${hm(u.minutes)}` })).sort((a, b) => a.x - b.x);
  const rowsEnd = [];
  for (const c of colls) {
    const w = c.label.length * 6.4;
    let row = rowsEnd.findIndex(e => e < c.x - w - 8);
    if (row < 0) { row = rowsEnd.length; rowsEnd.push(0); }
    rowsEnd[row] = c.x; c.row = row; c.w = w;
  }
  const top = 22 + rowsEnd.length * 17 + 8, cy = top + maxY + 4, axisY = cy + maxY + 10, H = axisY + 52;
  ax = { W, H, X, mFromX, pts, colls, cy, axisY, top, pad };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("height", H);
  const ticks = [10, 30, 60, 180, 600, 1800].map(m => `<g class="tick"><line x1="${X(m)}" x2="${X(m)}" y1="${axisY}" y2="${axisY + 5}"/><text x="${X(m)}" y="${axisY + 18}" text-anchor="middle">${hm(m)}</text></g>`).join("");
  const pm = PRESETS.map((p, i) => `<g class="preset-mark"><line x1="${X(p.min)}" x2="${X(p.min)}" y1="${axisY + 22}" y2="${axisY + 30}"/><text x="${X(p.min)}" y="${axisY + 42}" text-anchor="${i === 0 ? "start" : i === 3 ? "end" : "middle"}" dx="${i === 0 ? -6 : i === 3 ? 8 : 0}">${["coffee", "evening", "weekend", "month of lunches"][i]}</text></g>`).join("");
  const collG = colls.map((c, i) => {
    const y = 22 + c.row * 17;
    return `<g class="coll" data-coll="${i}"><line x1="${c.x}" x2="${c.x}" y1="${y + 4}" y2="${axisY}" stroke-dasharray="1 3"/><rect x="${c.x - 4}" y="${y - 4}" width="8" height="8" transform="rotate(45 ${c.x} ${y})"/><text x="${c.x - 9}" y="${y + 4}" text-anchor="end">${esc(c.label)}</text></g>`;
  }).join("");
  svg.innerHTML = `<rect class="band" y="0" height="${axisY}"/><line class="band-edge" y1="0" y2="${axisY}"/><text class="band-label" y="13"></text>
    ${collG}<line x1="${pad}" x2="${W - pad}" y1="${axisY}" y2="${axisY}" stroke="rgba(0,0,0,.25)"/>${ticks}${pm}<g class="dots"></g>`;
  const g = svg.querySelector(".dots");
  for (const [i, p] of pts.entries()) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", p.x.toFixed(1)); c.setAttribute("cy", (cy + p.y).toFixed(1)); c.setAttribute("r", p.r);
    c.dataset.i = i; c.setAttribute("class", "dot");
    p.el = c; g.appendChild(c);
  }
  updateAxis();
}
function planKeys() {
  const s = new Set();
  for (const u of st.plans[0]?.items || []) { s.add(u.key); if (u.parentKey) s.add(u.parentKey); if (u.post) { const h = postHome.get(u.post.id); if (h) s.add("s:" + h.id); } }
  return s;
}
function updateAxis() {
  if (!ax) return;
  const B = st.B, keys = planKeys();
  const x0 = ax.X(B / 2), x1 = ax.X(Math.min(B, AX_MAX));
  const band = svg.querySelector(".band"); band.setAttribute("x", x0); band.setAttribute("width", Math.max(0, x1 - x0));
  const edge = svg.querySelector(".band-edge"); edge.setAttribute("x1", x1); edge.setAttribute("x2", x1);
  const lab = svg.querySelector(".band-label"); lab.textContent = `your ${hm(B)}`;
  const right = x1 > ax.W - 90; lab.setAttribute("x", right ? x1 - 6 : x1 + 6); lab.setAttribute("text-anchor", right ? "end" : "start");
  let n = 0;
  for (const p of ax.pts) {
    const ok = moodOk(p.u, st.mood), fit = ok && inBand(p.u.minutes, B);
    if (fit) n++;
    p.el.setAttribute("class", `dot ${keys.has(p.u.key) ? "inplan" : fit ? "fit" : ok ? "out" : "dim"}${p.u.winners ? " win" : ""}`);
  }
  svg.querySelectorAll(".coll").forEach((g, i) => {
    const u = ax.colls[i].u;
    g.setAttribute("class", `coll${keys.has(u.key) ? " inplan" : inBand(u.minutes, B) && moodOk(u, st.mood) ? " fit" : ""}`);
  });
  const mood = st.mood.topics || st.mood.fiction ? ` that suit “${st.mood.label.toLowerCase()}”` : "";
  $("axis-caption").innerHTML = `Each dot is one of the Library's ${axisUnits.length} sequences, placed by reading time (log scale). <b>${n} ${n === 1 ? "work" : "works"}</b>${mood} take between ${hm(B / 2)} and ${hm(B)}, the green band; everything to its left fits too.`;
}
function showTip(p, isColl) {
  const u = p.u;
  const meta = isColl ? `${u.posts.length} posts · ${hm(u.minutes)}` :
    `${esc(u.seq.author.name || "")} · ${u.posts.length} post${u.posts.length > 1 ? "s" : ""} · ${hm(u.minutes)}${u.seq.stats.firstYear ? ` · ${u.seq.stats.firstYear}` : ""}`;
  const q = u.kmed ? `<br>Median karma ${u.kmed}${u.winners ? ` · <span class="winner-badge">${u.winners} review winner${u.winners > 1 ? "s" : ""}</span>` : ""}` : "";
  tip.innerHTML = `<b>${esc(u.title)}</b>${meta}${q}<div class="hint">Click to plan around it</div>`;
  tip.hidden = false;
  const rect = svg.getBoundingClientRect(), scale = rect.width / ax.W;
  const px = p.x * scale, py = (isColl ? 22 + p.row * 17 : ax.cy + p.y) * scale + 6;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = `${clamp(px - tw / 2, 4, rect.width - tw - 4)}px`;
  tip.style.top = `${py - th - 12 < 0 ? py + 14 : py - th - 12}px`;
}
const hideTip = () => { tip.hidden = true; svg.querySelector(".dot.hover")?.classList.remove("hover"); };
let drag = null;
const svgX = e => { const r = svg.getBoundingClientRect(); return (e.clientX - r.left) * ax.W / r.width; };
const targetOf = e => {
  const d = e.target.closest?.(".dot"); if (d) return { p: ax.pts[+d.dataset.i], el: d };
  const c = e.target.closest?.(".coll"); if (c) return { p: ax.colls[+c.dataset.coll], coll: true };
  return null;
};
svg.addEventListener("pointerdown", e => { drag = { x: e.clientX, moved: false, t: targetOf(e) }; svg.setPointerCapture(e.pointerId); });
svg.addEventListener("pointermove", e => {
  if (drag) {
    if (Math.abs(e.clientX - drag.x) > 4) drag.moved = true;
    if (drag.moved) { hideTip(); setBudget(nice(ax.mFromX(svgX(e)))); }
    return;
  }
  const t = targetOf(e);
  svg.querySelector(".dot.hover")?.classList.remove("hover");
  if (t) { t.el?.classList.add("hover"); showTip(t.p, t.coll); } else hideTip();
});
svg.addEventListener("pointerup", e => {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.moved) return;
  if (d.t) {
    const u = d.t.p.u;
    setBudget(Math.max(nice(u.minutes * 1.1), nice(u.minutes + 5)), { pin: u.key });
    hideTip();
    planEl.scrollIntoView({ behavior: "smooth", block: "start" });
  } else setBudget(nice(ax.mFromX(svgX(e))));
});
svg.addEventListener("pointerleave", () => { if (!drag) hideTip(); });
svg.addEventListener("pointercancel", () => { drag = null; });
let lastW = 0;
new ResizeObserver(() => { if (wrap.clientWidth !== lastW) { lastW = wrap.clientWidth; layoutAxis(); } }).observe(wrap);

// ---------- render ----------
function render() {
  st.plans = makePlans(st.B, st);
  renderControls();
  renderPlan();
  renderAlts();
  updateAxis();
  saveHash();
}
slider.value = toSlider(st.B);
render();
