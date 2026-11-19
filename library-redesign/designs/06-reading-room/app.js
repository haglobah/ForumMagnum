import "../../shared/header.js";
import { loadLibrary, image, progress, fmt } from "../../shared/library.js";

const lib = await loadLibrary();
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plural = (n, w, ws = w + "s") => `${n} ${n === 1 ? w : ws}`;

// ---------- data ----------
const all = [...lib.sequences, ...lib.books];
const seqById = new Map(all.map(s => [s.id, s]));
const postById = new Map();
for (const s of all) for (const p of s.posts) if (!postById.has(p.id)) postById.set(p.id, p);
for (const p of lib.reviewWinners) if (!postById.has(p.id)) postById.set(p.id, p);

// Which core collection (and book) a sequence belongs to, for "next in …".
const membership = new Map();
for (const c of lib.core) c.sequences.forEach((s, i) => {
  const m = membership.get(s.id);
  if (!m || (s.collection && s.collection === c.collection && m.core.collection !== c.collection)) membership.set(s.id, { core: c, i });
});
const nextInCollection = s => {
  const m = membership.get(s.id);
  return m && m.core.sequences[m.i + 1] ? { core: m.core, seq: m.core.sequences[m.i + 1] } : null;
};

// Similarity: tf-idf over post tags, plus a bonus for the same author.
const df = new Map();
for (const s of all) for (const t of s.stats.tags) df.set(t.slug, (df.get(t.slug) || 0) + 1);
const vecs = new Map(all.map(s => {
  const v = new Map(); let norm = 0;
  for (const t of s.stats.tags) {
    const w = (t.count / Math.max(1, s.posts.length)) * Math.log(all.length / df.get(t.slug));
    v.set(t.slug, { w, name: t.name }); norm += w * w;
  }
  return [s.id, { v, norm: Math.sqrt(norm) || 1 }];
}));
function similarity(a, b) {
  const A = vecs.get(a.id), B = vecs.get(b.id);
  let dot = 0; const shared = [];
  for (const [slug, x] of A.v) { const y = B.v.get(slug); if (y) { dot += x.w * y.w; shared.push([x.name, x.w * y.w]); } }
  const sameAuthor = a.author.slug && a.author.slug === b.author.slug;
  const score = dot / (A.norm * B.norm) + (sameAuthor ? .18 : 0) + .015 * Math.log1p(b.stats.karmaMedian);
  return { score, sameAuthor, shared: shared.sort((x, y) => y[1] - x[1]).map(x => x[0]) };
}

// ---------- personal state (beside shared progress) ----------
const READ_KEY = "library-prototypes:read";       // shared/library.js's store, read for order only
const QUEUE_KEY = "library-prototypes:06:queue";
const RECENT_KEY = "library-prototypes:06:recent";
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
};
const queue = () => store.get(QUEUE_KEY, []);
const touch = seqId => { const r = store.get(RECENT_KEY, {}); r[seqId] = Date.now(); store.set(RECENT_KEY, r); };

function snapshot() {
  const order = store.get(READ_KEY, []);
  const read = new Set(order.filter(id => progress.isRead(id)));
  const pos = new Map(order.map((id, i) => [id, i]));
  const recent = store.get(RECENT_KEY, {});
  const prog = new Map();
  for (const s of all) {
    let n = 0, last = -1, next = null, nextCh = 0;
    s.chapters.forEach((c, ci) => c.posts.forEach(p => {
      if (read.has(p.id)) { n++; last = Math.max(last, pos.get(p.id) ?? 0); }
      else if (!next) { next = p; nextCh = ci; }
    }));
    const total = s.posts.length;
    prog.set(s.id, { read: n, total, share: total ? n / total : 0, next, nextCh,
      when: recent[s.id] ?? null, rank: recent[s.id] ? 1e13 + recent[s.id] : last,
      left: s.posts.filter(p => !read.has(p.id)).reduce((m, p) => m + p.minutes, 0) });
  }
  const P = id => prog.get(id);
  const visible = s => s.kind !== "book" || P(s.id).when;
  const inProgress = all.filter(s => { const p = P(s.id); return p.read > 0 && p.read < p.total && visible(s); })
    .sort((a, b) => P(b.id).rank - P(a.id).rank);
  const finished = all.filter(s => { const p = P(s.id); return p.total > 0 && p.read === p.total; })
    .sort((a, b) => P(b.id).rank - P(a.id).rank);
  const readPosts = [...read].map(id => postById.get(id)).filter(Boolean);
  return { read, prog, P, inProgress, finished, queue: queue(),
    minutes: readPosts.reduce((m, p) => m + p.minutes, 0), posts: readPosts.length,
    winners: readPosts.filter(p => p.winner) };
}

// ---------- ui state ----------
const ui = { open: new Set(), filter: "all", q: "", more: false, anchor: null };
let S;

// ---------- small pieces ----------
function ago(ts) {
  if (!ts) return "";
  const d = Math.floor((Date.now() - ts) / 864e5);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`;
}
const hue = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
function thumb(s, w, h, cls = "thumb") {
  const src = s.gridImageId ? image(s.gridImageId, { w, h }) : s.imageUrl || null;
  return src ? `<img class="${cls}" src="${src}" alt="" loading="lazy" width="${w}" height="${h}">`
    : `<span class="${cls} noimg" style="--h:${hue(s.title)}">${esc(s.title.slice(0, 1))}</span>`;
}
function ring(share, size = 92) {
  const r = size / 2 - 6, c = 2 * Math.PI * r;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-bg"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - share)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="50%" dy=".36em" text-anchor="middle">${Math.round(share * 100)}%</text></svg>`;
}
function chapterBar(s) {
  const chs = s.chapters.filter(c => c.posts.length);
  return `<div class="chbar" role="img" aria-label="${S.P(s.id).read} of ${s.posts.length} posts read">${chs.map(c => {
    const n = c.posts.filter(p => S.read.has(p.id)).length;
    return `<span class="seg" style="flex:${c.posts.length}" title="${esc(c.title || "")} ${n}/${c.posts.length}"><i style="width:${100 * n / c.posts.length}%"></i></span>`;
  }).join("")}</div>`;
}
const miniBar = share => `<span class="mini"><i style="width:${share * 100}%"></i></span>`;
const saved = id => S.queue.includes(id);
const saveBtn = (s, cls = "") => s.posts.length ? `<button class="save ${cls} ${saved(s.id) ? "on" : ""}" data-act="save" data-seq="${s.id}" aria-pressed="${saved(s.id)}">${saved(s.id) ? "Saved" : "Save for later"}</button>` : "";
const tocBtn = (key, label = "Contents") => `<button class="tocbtn ${ui.open.has(key) ? "open" : ""}" data-act="toc" data-key="${key}" aria-expanded="${ui.open.has(key)}">${label}<span class="chev" aria-hidden="true"></span></button>`;
function seqMeta(s, { author = true } = {}) {
  const st = s.stats, w = st.winners.length;
  return [author && s.author.name ? esc(s.author.name) : null, plural(st.posts, "post"), st.posts ? fmt.hours(st.minutes) : null, fmt.years(s) || null,
    w ? `<span class="winner-badge" title="Posts that won the LessWrong Review">★ ${plural(w, "review winner")}</span>` : null].filter(Boolean).join(" · ");
}
const chapterLabel = (s, ci) => {
  const c = s.chapters[ci];
  if (s.chapters.length < 2) return "";
  return `Chapter ${ci + 1} of ${s.chapters.length}${c?.title ? ` · ${esc(c.title)}` : ""}`;
};

function toc(s, key) {
  if (!ui.open.has(key)) return "";
  const p = S.P(s.id);
  return `<div class="toc">${s.chapters.map((c, ci) => {
    if (!c.posts.length) return "";
    const n = c.posts.filter(x => S.read.has(x.id)).length;
    return `<div class="toc-ch">
      ${s.chapters.length > 1 || c.title ? `<div class="toc-ch-h"><span>${c.title ? esc(c.title) : `Chapter ${ci + 1}`}</span><span class="meta">${n === c.posts.length ? "✓ " : ""}${n}/${c.posts.length}</span></div>` : ""}
      <ol>${c.posts.map(x => {
        const r = S.read.has(x.id), nx = p.next && p.next.id === x.id;
        return `<li class="${r ? "is-read" : ""} ${nx ? "is-next" : ""}">
          <button class="tick" data-act="read" data-post="${x.id}" data-seq="${s.id}" aria-pressed="${r}" aria-label="${r ? "Mark as unread" : "Mark as read"}: ${esc(x.title)}" title="${r ? "Read · click to mark unread" : "Mark as read"}"></button>
          <a href="${x.url}" target="_blank" rel="noopener">${esc(x.title)}</a>
          <span class="meta">${nx ? `<span class="next-tag">next</span>` : ""}${x.winner ? `<span class="winner-badge" title="Review winner ${x.winner.year}">★</span> ` : ""}${x.minutes} min</span>
        </li>`;
      }).join("")}</ol></div>`;
  }).join("")}
  <div class="toc-foot meta">
    ${p.read < p.total ? `<button class="link" data-act="all" data-seq="${s.id}">Mark all as read</button>` : ""}
    ${p.read ? `<button class="link" data-act="reset" data-seq="${s.id}">Clear my progress</button>` : ""}
    <a href="${s.url}" target="_blank" rel="noopener">Open on LessWrong ↗</a>
  </div></div>`;
}

// ---------- the shelf (returning reader) ----------
function hero(s) {
  const p = S.P(s.id), x = p.next, after = s.posts.slice(s.posts.indexOf(x) + 1).filter(q => !S.read.has(q.id)).slice(0, 2);
  const key = `hero:${s.id}`;
  return `<section class="hero card" data-anchor="${key}">
    <a class="hero-art" href="${s.url}" target="_blank" rel="noopener" aria-label="${esc(s.title)}">${thumb(s, 360, 440, "hero-img")}</a>
    <div class="hero-body">
      <div class="kicker">Continue reading${p.when ? ` <span class="muted">· last read ${ago(p.when)}</span>` : ""}</div>
      <div class="hero-seq"><a href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a>${s.author.name ? ` <span class="by">by ${esc(s.author.name)}</span>` : ""}</div>
      ${chapterLabel(s, p.nextCh) ? `<div class="hero-ch">${chapterLabel(s, p.nextCh)}</div>` : ""}
      <h2 class="hero-post"><a href="${x.url}" target="_blank" rel="noopener">${esc(x.title)}</a></h2>
      <div class="meta">Post ${s.posts.indexOf(x) + 1} of ${s.posts.length} · ${x.minutes} min read${x.year ? ` · ${x.year}` : ""} · ${x.karma} karma${x.winner ? ` · <span class="winner-badge">★ Review winner ${x.winner.year}</span>` : ""}</div>
      <div class="hero-actions">
        <a class="btn primary" href="${x.url}" target="_blank" rel="noopener">Read now</a>
        <button class="btn" data-act="read" data-post="${x.id}" data-seq="${s.id}" data-undo="1">Mark as read</button>
        ${tocBtn(key)}
      </div>
      ${after.length ? `<div class="hero-then meta">Then: ${after.map(q => `<a href="${q.url}" target="_blank" rel="noopener">${esc(q.title)}</a>`).join(" · ")}</div>` : ""}
    </div>
    <div class="hero-ring">
      ${ring(p.share, 112)}
      <div class="meta"><b>${p.read}</b> of ${p.total} posts</div>
      <div class="meta">${fmt.hours(p.left)} left</div>
    </div>
    <div class="hero-bar">${chapterBar(s)}</div>
    ${toc(s, key)}
  </section>`;
}

function progressCard(s) {
  const p = S.P(s.id), key = `prog:${s.id}`;
  return `<article class="pcard card" data-anchor="${key}">
    <div class="pcard-top">
      <a href="${s.url}" target="_blank" rel="noopener">${thumb(s, 120, 120)}</a>
      <div class="pcard-main">
        <a class="pcard-title" href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a>
        <div class="meta">${s.author.name ? esc(s.author.name) + " · " : ""}${p.when ? `read ${ago(p.when)}` : `${plural(p.read, "post")} read`}</div>
        ${chapterBar(s)}
        <div class="meta pcard-nums"><span><b>${p.read}</b>/${p.total} posts · ${Math.round(p.share * 100)}%</span><span>${fmt.hours(p.left)} left</span></div>
      </div>
    </div>
    <div class="pcard-next">
      <span class="meta">Next${chapterLabel(s, p.nextCh) ? ` · ${chapterLabel(s, p.nextCh)}` : ""}</span>
      <div class="pcard-next-row">
        <a href="${p.next.url}" target="_blank" rel="noopener">${esc(p.next.title)}</a>
        <button class="tick small" data-act="read" data-post="${p.next.id}" data-seq="${s.id}" data-undo="1" aria-pressed="false" title="Mark as read" aria-label="Mark as read: ${esc(p.next.title)}"></button>
      </div>
    </div>
    <div class="pcard-foot">${tocBtn(key)}</div>
    ${toc(s, key)}
  </article>`;
}

function upNext() {
  const items = S.queue.map(id => seqById.get(id)).filter(s => s && S.P(s.id).read === 0);
  return `<h2 class="section-title">Up next <span class="count">${items.length || ""}</span></h2>
    ${items.length ? `<ol class="queue">${items.map((s, i) => `<li class="qitem card" data-anchor="q:${s.id}">
      <span class="qn">${i + 1}</span>
      <a href="${s.url}" target="_blank" rel="noopener">${thumb(s, 96, 96)}</a>
      <div class="qmain">
        <a class="qtitle" href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a>
        <div class="meta">${seqMeta(s)}</div>
        <div class="qactions meta">
          <a class="start" href="${s.posts[0].url}" target="_blank" rel="noopener">Start with “${esc(s.posts[0].title)}”</a>
        </div>
      </div>
      <div class="qbtns">
        ${i ? `<button class="icon" data-act="up" data-seq="${s.id}" title="Move up" aria-label="Move up">↑</button>` : ""}
        <button class="icon" data-act="save" data-seq="${s.id}" title="Remove from Up next" aria-label="Remove from Up next">×</button>
      </div>
    </li>`).join("")}</ol>`
    : `<p class="empty meta">Nothing saved yet. Use <b>Save for later</b> on any sequence below to line it up here.</p>`}`;
}

function finished() {
  const f = S.finished;
  const stats = [
    [fmt.hours(S.minutes), "read in total"],
    [S.posts, plural(S.posts, "post", "posts").replace(/^\d+ /, "") + " read"],
    [S.winners.length, `review ${S.winners.length === 1 ? "winner" : "winners"} read`],
    [f.length, `${f.length === 1 ? "sequence" : "sequences"} finished`],
  ];
  const closest = S.inProgress.slice().sort((a, b) => S.P(a.id).left - S.P(b.id).left)[0];
  return `<h2 class="section-title">Finished</h2>
  <div class="finished card">
    <div class="laurel" aria-hidden="true">${laurel()}</div>
    <div class="fstats">${stats.map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join("")}</div>
    ${S.winners.length ? `<div class="fwinners meta">Review winners you've read: ${S.winners.slice(0, 4).map(p => `<a href="${p.url}" target="_blank" rel="noopener">${esc(p.title)}</a>`).join(", ")}${S.winners.length > 4 ? ` and ${S.winners.length - 4} more` : ""}</div>` : ""}
  </div>
  ${f.length ? `<div class="fgrid">${f.map(s => {
    const nx = nextInCollection(s);
    return `<article class="fcard card" data-anchor="fin:${s.id}">
      <span class="seal" aria-hidden="true">✓</span>
      <a href="${s.url}" target="_blank" rel="noopener" class="ftitle">${esc(s.title)}</a>
      <div class="meta">${plural(s.stats.posts, "post")} · ${fmt.hours(s.stats.minutes)}${S.P(s.id).when ? ` · finished ${ago(S.P(s.id).when)}` : ""}</div>
      ${nx && S.P(nx.seq.id).read < nx.seq.posts.length ? `<div class="fnext meta">Next in ${esc(nx.core.title)}: <a href="${nx.seq.url}" target="_blank" rel="noopener">${esc(nx.seq.title)}</a> ${saveBtn(nx.seq, "tiny")}</div>` : ""}
    </article>`;
  }).join("")}</div>`
    : `<p class="empty meta">Nothing finished yet${closest ? ` — <b>${esc(closest.title)}</b> is closest, ${fmt.hours(S.P(closest.id).left)} to go` : ""}.</p>`}`;
}
const laurel = () => `<svg viewBox="0 0 64 64" width="56" height="56"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
  <path d="M32 54c-10-2-18-11-19-24"/><path d="M32 54c10-2 18-11 19-24"/>
  ${[0, 1, 2, 3, 4].map(i => { const y = 48 - i * 7, x = 22 - i * 1.6; return `<path d="M${x} ${y}c-5-1-7-4-7-8 4 0 7 3 7 8z"/><path d="M${64 - x} ${y}c5-1 7-4 7-8-4 0-7 3-7 8z"/>`; }).join("")}
  </g><text x="32" y="38" text-anchor="middle" font-size="16" fill="currentColor" font-family="ETBookRoman, Georgia, serif">✓</text></svg>`;

function recommendations() {
  const sources = [...S.finished, ...S.inProgress.filter(s => S.P(s.id).read >= 3).sort((a, b) => S.P(b.id).read - S.P(a.id).read)]
    .filter((s, i, a) => a.indexOf(s) === i).slice(0, 2);
  const used = new Set();
  const groups = sources.map(src => {
    const srcPosts = new Set(src.posts.map(p => p.id));
    const recs = all.filter(c => c.id !== src.id && c.posts.length >= 3 && S.P(c.id).read === 0 && !saved(c.id) && !used.has(c.id)
        && c.posts.filter(p => srcPosts.has(p.id)).length / c.posts.length < .3)
      .map(c => ({ c, ...similarity(src, c) })).sort((a, b) => b.score - a.score).slice(0, 3);
    recs.forEach(r => used.add(r.c.id));
    return { src, recs };
  }).filter(g => g.recs.length);
  if (!groups.length) return "";
  return groups.map(({ src, recs }) => `<h2 class="section-title">Because you read <i>${esc(src.title)}</i></h2>
    <div class="recs">${recs.map(({ c, sameAuthor, shared }) => `<article class="rec card" data-anchor="rec:${c.id}">
      <a href="${c.url}" target="_blank" rel="noopener" class="rec-img">${thumb(c, 400, 180, "rec-thumb")}</a>
      <div class="rec-body">
        <div class="why meta">${[sameAuthor ? `Also by ${esc(c.author.name)}` : null, shared.length ? `shares ${shared.slice(0, 2).map(esc).join(", ")}` : null].filter(Boolean).join(" · ")}</div>
        <a class="rec-title" href="${c.url}" target="_blank" rel="noopener">${esc(c.title)}</a>
        <div class="meta">${seqMeta(c)}</div>
        ${c.description ? `<p class="blurb">${esc(c.description.slice(0, 150))}${c.description.length > 150 ? "…" : ""}</p>` : ""}
        <div class="rec-foot">${saveBtn(c)}</div>
      </div>
    </article>`).join("")}</div>`).join("");
}

function shelf() {
  const [top, ...rest] = S.inProgress;
  const lead = top || null;
  return `
  <header class="shelf-head">
    <div class="kicker">The Library</div>
    <h1 class="page-title">Your shelf</h1>
    <p class="summary meta">You've read <b>${plural(S.posts, "post")}</b> · <b>${fmt.hours(S.minutes)}</b> · <b>${S.winners.length}</b> Best of LessWrong ${S.winners.length === 1 ? "winner" : "winners"} · <b>${S.inProgress.length}</b> in progress · <b>${S.finished.length}</b> finished</p>
  </header>
  ${lead ? hero(lead) : `<div class="hero card hero-done"><div class="hero-body"><div class="kicker">Nothing in progress</div><h2 class="hero-post">You're between books.</h2><p class="meta">Pick one from Up next or the suggestions below.</p></div></div>`}
  ${rest.length ? `<h2 class="section-title">In progress <span class="count">${rest.length}</span></h2><div class="pgrid">${rest.map(progressCard).join("")}</div>` : ""}
  ${upNext()}
  ${finished()}
  ${recommendations()}`;
}

// ---------- the welcome (new reader) ----------
function welcome() {
  const hl = lib.core.find(c => c.collection === "highlights");
  const book = hl.books[0], seqs = book.sequences, first = seqs[0];
  const mins = seqs.reduce((m, s) => m + s.stats.minutes, 0), posts = seqs.reduce((m, s) => m + s.stats.posts, 0);
  const picks = [
    ["If you'd rather have a story", "The Methods of Rationality"],
    ["If you want to practise", "Hammertime"],
    ["If you came here for AI", "AGI safety from first principles"],
  ].map(([why, t]) => [why, lib.sequences.find(s => s.title === t)]).filter(x => x[1]);
  return `
  <header class="shelf-head">
    <div class="kicker">The Library</div>
    <h1 class="page-title">Welcome to the Library</h1>
    <p class="summary meta">Long-form writing from LessWrong, in order. As you read, this page becomes your shelf: where you left off, what you've saved, what you've finished.</p>
  </header>
  <section class="welcome card" data-anchor="welcome">
    <div class="welcome-art" style="background-image:url('${hl.imageUrl}')"></div>
    <div class="welcome-body">
      <div class="kicker">Your shelf is empty</div>
      <h2 class="welcome-title">Start with the Sequence Highlights</h2>
      <p class="welcome-lede">${posts} essays from Eliezer Yudkowsky's Sequences on how to think better on purpose, chosen as the place to begin. About <b>${fmt.hours(mins)}</b> — a day or two of reading, in six short parts.</p>
      <ol class="stations">${seqs.map((s, i) => `<li><span class="dot">${i + 1}</span><a href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a><span class="meta">${s.stats.posts} · ${fmt.hours(s.stats.minutes)}</span></li>`).join("")}</ol>
      <div class="hero-actions">
        <a class="btn primary" href="${first.posts[0].url}" target="_blank" rel="noopener">Read the first essay</a>
        <button class="btn" data-act="read" data-post="${first.posts[0].id}" data-seq="${first.id}">I've read “${esc(first.posts[0].title)}”</button>
        ${saveBtn(first)}
      </div>
    </div>
  </section>
  <h2 class="section-title">Or start somewhere else</h2>
  <div class="picks">${picks.map(([why, s]) => `<article class="pick card" data-anchor="pick:${s.id}">
    <a href="${s.url}" target="_blank" rel="noopener">${thumb(s, 400, 200, "pick-thumb")}</a>
    <div class="pick-body">
      <div class="why meta">${why}</div>
      <a class="rec-title" href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a>
      <div class="meta">${seqMeta(s)}</div>
      <p class="blurb">${esc(s.description.split(/\n+/).slice(0, 2).join(" ").slice(0, 140))}${s.description.length > 140 ? "…" : ""}</p>
      <div class="rec-foot"><a class="start meta" href="${s.posts[0].url}" target="_blank" rel="noopener">First post: ${esc(s.posts[0].title)}</a>${saveBtn(s)}</div>
    </div></article>`).join("")}</div>
  ${S.queue.length ? upNext() : ""}
  <div class="ghost-shelf" aria-hidden="true">
    ${["Continue reading", "In progress", "Up next", "Finished"].map(t => `<div><span>${t}</span></div>`).join("")}
  </div>`;
}

// ---------- the whole library ----------
const FILTERS = [["all", "All"], ["unread", "Not started"], ["progress", "In progress"], ["finished", "Finished"], ["saved", "Saved"]];
function stateOf(s) {
  const p = S.P(s.id);
  return !p.total ? "empty" : p.read === p.total ? "finished" : p.read ? "progress" : "unread";
}
function matches(s) {
  const st = stateOf(s);
  if (ui.filter === "saved" ? !saved(s.id) : ui.filter !== "all" && ui.filter !== st) return false;
  if (!ui.q) return true;
  const q = ui.q.toLowerCase();
  return s.title.toLowerCase().includes(q) || (s.author.name || "").toLowerCase().includes(q);
}
function stateCell(s) {
  const p = S.P(s.id), st = stateOf(s);
  if (st === "finished") return `<span class="st st-done">✓ Finished</span>`;
  if (st === "progress") return `<span class="st st-prog">${miniBar(p.share)}<span>${p.read}/${p.total}</span></span>`;
  if (st === "empty") return `<span class="st st-none">No posts</span>`;
  return `<span class="st st-none">Not started</span>`;
}
function row(s, prefix) {
  const key = `${prefix}:${s.id}`;
  return `<div class="row-wrap st-${stateOf(s)}" data-anchor="${key}"><div class="row">
    <a href="${s.url}" target="_blank" rel="noopener" class="row-thumb">${thumb(s, 88, 88)}</a>
    <div class="row-main">
      <a class="row-title" href="${s.url}" target="_blank" rel="noopener">${esc(s.title)}</a>
      <div class="meta">${seqMeta(s)}</div>
    </div>
    <div class="row-state">${stateCell(s)}</div>
    <div class="row-btns">${saveBtn(s, "tiny")}${s.posts.length ? tocBtn(key, "") : ""}</div>
  </div>${toc(s, key)}</div>`;
}
function collectionRow(c) {
  const ids = new Set(c.sequences.flatMap(s => s.posts.map(p => p.id)));
  const n = [...ids].filter(id => S.read.has(id)).length, share = ids.size ? n / ids.size : 0;
  const mins = c.sequences.reduce((m, s) => m + s.stats.minutes, 0);
  const key = `core:${c.collection}`, open = ui.open.has(key);
  const shown = c.sequences.filter(matches);
  if (!shown.length && (ui.q || ui.filter !== "all")) return "";
  return `<div class="row-wrap coll" data-anchor="${key}"><div class="row">
    <a href="${c.url}" target="_blank" rel="noopener" class="row-thumb"><img class="thumb" src="${c.imageUrl}" alt="" loading="lazy"></a>
    <div class="row-main">
      <a class="row-title" href="${c.url}" target="_blank" rel="noopener">${esc(c.title)}</a>
      <div class="meta">${c.subtitle ? esc(c.subtitle) + " · " : ""}${plural(c.sequences.length, "sequence")} · ${ids.size} posts · ${fmt.hours(mins)}</div>
    </div>
    <div class="row-state">${n === ids.size && n ? `<span class="st st-done">✓ Finished</span>` : n ? `<span class="st st-prog">${miniBar(share)}<span>${n}/${ids.size}</span></span>` : `<span class="st st-none">Not started</span>`}</div>
    <div class="row-btns">${tocBtn(key, "")}</div>
  </div>
  ${open || ui.q || ui.filter !== "all" ? `<div class="coll-books">${c.books.map(b => {
      const ss = b.sequences.filter(matches);
      return ss.length ? `${b.title && c.books.length > 1 ? `<div class="book-h">${esc(b.title)}</div>` : ""}${ss.map(s => row(s, `in-${c.collection}`)).join("")}` : "";
    }).join("")}</div>` : ""}
  </div>`;
}
function library() {
  $("#filters").innerHTML = FILTERS.map(([k, l]) => {
    const n = k === "all" ? "" : lib.sequences.filter(s => k === "saved" ? saved(s.id) : stateOf(s) === k).length;
    return `<button class="pill" data-act="filter" data-f="${k}" aria-pressed="${ui.filter === k}">${l}${n !== "" ? ` <span class="pn">${n}</span>` : ""}</button>`;
  }).join("");
  const curated = lib.sequences.filter(s => s.kind === "curated").sort((a, b) => (a.curatedOrder ?? 1e9) - (b.curatedOrder ?? 1e9)).filter(matches);
  const community = lib.sequences.filter(s => s.kind === "community").sort((a, b) => b.stats.karmaMedian - a.stats.karmaMedian).filter(matches);
  const limit = ui.more || ui.q || ui.filter !== "all" ? community.length : 20;
  const core = lib.core.map(collectionRow).join("");
  return `
    ${core ? `<h3 class="group-h">Core reading <span class="meta">the five collections · open one to see its sequences</span></h3><div class="rows">${core}</div>` : ""}
    ${curated.length ? `<h3 class="group-h">Curated sequences <span class="meta">${curated.length}</span></h3><div class="rows">${curated.map(s => row(s, "lib")).join("")}</div>` : ""}
    ${community.length ? `<h3 class="group-h">Community sequences <span class="meta">${community.length} · highest median karma first</span></h3><div class="rows">${community.slice(0, limit).map(s => row(s, "lib")).join("")}</div>
      ${community.length > limit ? `<button class="more" data-act="more">Show all ${community.length} community sequences</button>` : ""}` : ""}
    ${!core && !curated.length && !community.length ? `<p class="empty meta">Nothing here${ui.q ? ` for “${esc(ui.q)}”` : ""}.</p>` : ""}`;
}

// ---------- render ----------
function render() {
  S = snapshot();
  const returning = S.read.size > 0;
  $("#as-new").setAttribute("aria-pressed", !returning);
  $("#as-demo").setAttribute("aria-pressed", returning);
  $("#viewing-hint").textContent = returning ? "Progress is simulated in this browser. Tick posts in any table of contents." : "";
  $("#shelf").innerHTML = returning ? shelf() : welcome();
  $("#library").innerHTML = library();
  if (ui.anchor) {
    const el = document.querySelector(`[data-anchor="${CSS.escape(ui.anchor.key)}"]`);
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - ui.anchor.top);
    ui.anchor = null;
  }
}

let toastTimer;
function toast(html, undo) {
  const t = $("#toast");
  t.innerHTML = `<span>${html}</span>${undo ? `<button data-act="undo">Undo</button>` : ""}`;
  t.hidden = false; t.onclick = e => { if (e.target.dataset.act === "undo") { undo(); t.hidden = true; } };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 5000);
}

function markRead(postId, seqId, on, withUndo) {
  const s = seqById.get(seqId), before = S.P(seqId).read;
  if (on) touch(seqId);
  progress.read(postId, on);  // fires "library-progress" → render()
  const p = S.P(seqId);
  if (on && p.total && p.read === p.total && before < p.total) {
    toast(`<b>Finished ${esc(s.title)}.</b> ${plural(p.total, "post")}, ${fmt.hours(s.stats.minutes)}. Well read.`, () => progress.read(postId, false));
  } else if (on && withUndo) {
    toast(`Marked “${esc(postById.get(postId)?.title)}” as read.`, () => progress.read(postId, false));
  }
}

function demo() {
  progress.clear();
  const day = 864e5, now = Date.now(), find = t => lib.sequences.find(s => s.title === t);
  const r = {};
  [["Replacing Guilt", 1], ["Hammertime", 3], ["Embedded Agency", 6], ["Thinking Better on Purpose", 11], ["Predictably Wrong", 19]]
    .forEach(([t, d]) => { const s = find(t); if (s) r[s.id] = now - d * day - 3600e3 * 3; });
  store.set(RECENT_KEY, r);
  if (!queue().length) store.set(QUEUE_KEY, ["Inadequate Equilibria", "Fun Theory", "CFAR Handbook"].map(find).filter(Boolean).map(s => s.id));
  progress.demo(lib);
}
function fresh() {
  localStorage.removeItem(RECENT_KEY); localStorage.removeItem(QUEUE_KEY);
  progress.clear();
}

document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]");
  if (!b || b.closest("#toast")) return;
  const a = b.dataset.act, anchorEl = b.closest("[data-anchor]");
  if (anchorEl) ui.anchor = { key: anchorEl.dataset.anchor, top: anchorEl.getBoundingClientRect().top };
  const id = b.dataset.seq;
  switch (a) {
    case "read": markRead(b.dataset.post, id, !S.read.has(b.dataset.post), !!b.dataset.undo); break;
    case "all": touch(id); batch(() => seqById.get(id).posts.forEach(p => !S.read.has(p.id) && progress.read(p.id))); break;
    case "reset": batch(() => seqById.get(id).posts.forEach(p => S.read.has(p.id) && progress.read(p.id, false))); break;
    case "save": {
      const q = queue(), had = q.includes(id);
      store.set(QUEUE_KEY, had ? q.filter(x => x !== id) : [...q, id]);
      if (!had) toast(`Saved <b>${esc(seqById.get(id).title)}</b> to Up next.`);
      render(); break;
    }
    case "up": { const q = queue(), i = q.indexOf(id); if (i > 0) { [q[i - 1], q[i]] = [q[i], q[i - 1]]; store.set(QUEUE_KEY, q); } render(); break; }
    case "toc": { const k = b.dataset.key; ui.open.has(k) ? ui.open.delete(k) : ui.open.add(k); render(); break; }
    case "filter": ui.filter = b.dataset.f; ui.anchor = null; render(); break;
    case "more": ui.more = true; render(); break;
    case "demo": ui.anchor = null; demo(); break;
    case "new": ui.anchor = null; fresh(); break;
    case "note": $("#note").hidden = true; localStorage.setItem("library-prototypes:06:note", "hidden"); break;
  }
});
let qTimer;
$("#q").addEventListener("input", e => { clearTimeout(qTimer); qTimer = setTimeout(() => { ui.q = e.target.value.trim(); $("#library").innerHTML = library(); }, 120); });
let quiet = false;
function batch(f) { quiet = true; try { f(); } finally { quiet = false; } render(); }
addEventListener("library-progress", () => quiet || render());
addEventListener("storage", render);
if (localStorage.getItem("library-prototypes:06:note") === "hidden") $("#note").hidden = true;
render();
