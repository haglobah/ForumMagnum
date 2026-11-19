import "../../shared/header.js";
import { loadLibrary, image, fmt } from "../../shared/library.js";

const lib = await loadLibrary();
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const byTitle = t => lib.sequences.find(s => s.title.trim() === t);
const hm = min => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`; };
const roughH = min => min < 90 ? `${Math.round(min / 5) * 5 || 5} min` : `about ${Math.round(min / 60)} h`;
const NUM = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const word = n => NUM[n] ?? String(n);
const month = d => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const firstLine = (txt, max = 170) => {
  const t = (txt || "").replace(/^\s*>\s*/gm, "").replace(/\s*\n+\s*/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = t.match(/^(.{40,}?[.!?])\s/);
  const s = m && m[1].length <= max ? m[1] : t;
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, "") + "…" : s;
};

/* ---------- The edition ---------- */
const fetched = new Date(lib.fetchedAt);
const season = (() => { const m = fetched.getMonth(), y = fetched.getFullYear();
  return m === 11 ? `Winter ${y}–${String(y + 1).slice(2)}` : m <= 1 ? `Winter ${y}` : m <= 4 ? `Spring ${y}` : m <= 7 ? `Summer ${y}` : `Autumn ${y}`; })();
$("#edition").textContent = season;

document.querySelector(".note-x").addEventListener("click", () => { $("#note").remove(); try { localStorage.setItem("desk10:note", "x"); } catch {} });
try { if (localStorage.getItem("desk10:note")) $("#note").remove(); } catch {}

/* ---------- 1. From the Librarian's Desk ---------- */
{
  const s = byTitle("Otherness and control in the age of AGI");
  const st = s.stats;
  const longest = s.posts.reduce((a, p) => p.minutes > a.minutes ? p : a);
  const winners = new Set(st.winners.map(p => p.id));
  const top = s.posts.find(p => p.winner && p.winner.ranking === 0) || st.topPost;
  const banner = image(s.bannerImageId, { w: 1600, h: 560 }) || image(s.gridImageId, { w: 1600, h: 560 });
  const P = t => s.posts.find(p => p.title.startsWith(t));
  const link = (t, label) => { const p = P(t); return p ? `<a href="${p.url}">${esc(label || p.title)}</a>` : esc(label || t); };
  $("#desk").innerHTML = `
    <p class="kicker ui">From the Librarian's Desk <span>· ${esc(season)}</span></p>
    <div class="feature-head">
      <h2 id="feature-title" class="feature-title"><a href="${s.url}">${esc(s.title)}</a></h2>
      <p class="standfirst">${word(st.posts)[0].toUpperCase() + word(st.posts).slice(1)} essays on what we owe minds we did not make, and what we might lose by insisting on controlling them.</p>
      <p class="byline ui">By <a href="https://www.lesswrong.com/users/${s.author.slug}">${esc(s.author.name)}</a> · ${fmt.years(s)} · ${st.posts} essays · ${hm(st.minutes)} of reading · ${st.winners.length} in the Best of LessWrong</p>
    </div>
    ${banner ? `<figure class="banner"><img src="${banner}" alt="" loading="eager"></figure>` : ""}
    <div class="feature-body">
      <div class="essay">
        <p class="dropcap">Most writing about AI risk asks how we keep powerful systems under control. Joe Carlsmith's series asks what that project says about us. Across ${word(st.posts)} essays he works an old tension into new shape: between <i>yang</i>, the conviction that the universe will not steer itself and someone had better take the wheel, and something gentler, which he is careful not to dismiss as naive: curiosity, attunement, a willingness to let the Other stay other.</p>
        <p>The opening essays, ${link("Gentleness and the artificial Other")} and ${link("Deep atheism and AI risk")}, are the clearest statement anywhere of why so many people here distrust both nature and unaided minds, written by someone who shares much of that distrust and wants to examine it. The middle of the series tests it against ${link("On the abolition of man", "C. S. Lewis")} and against the worry that AI-risk thinking “others” the AIs. It ends somewhere few LessWrong sequences go: ${link("On green")}, a sympathetic reading of the value rationalists most often skip past, and ${link("Loving a world you don’t trust")}.</p>
        <blockquote class="pull">“They’re old questions – but I think that we will have to grapple with them in new ways as increasingly powerful AI systems come online.”<cite class="ui">${esc(s.author.name)}, introducing the series</cite></blockquote>
        <h3 class="run-in">Why now</h3>
        <p>The questions have stopped being hypothetical. Labs now write constitutions for their models and argue in public about model welfare; how much control to seek over minds that may have interests of their own is a question for this decade, not a thought experiment. The community seems to agree: in the 2024 Review, ${word(st.winners.length)} of these essays made the Best of LessWrong, and ${top ? `<a href="${top.url}">${esc(top.title)}</a>` : "one"} ranked first of the whole year. The essays are long and unhurried, and each can stand alone, but they reward being read in order, slowly.</p>
      </div>
      <aside class="toc" aria-label="Contents">
        <h3 class="toc-title ui">Contents</h3>
        <ol>${s.posts.map((p, i) => `<li><a href="${p.url}"><span class="n">${i + 1}</span><span class="t">${esc(p.title)}${winners.has(p.id) ? ` <span class="star" title="Best of LessWrong ${p.winner.year}${p.winner.ranking === 0 ? ", ranked first" : ""}">★</span>` : ""}</span><span class="m ui">${p.minutes} min</span></a></li>`).join("")}</ol>
        <div class="howlong ui">
          <div><b>${hm(st.minutes)}</b> in all, ${fmt.words(st.words)}</div>
          <div>At one essay an evening, ${word(st.posts)} evenings. The longest, “${esc(longest.title)}”, takes ${longest.minutes} minutes.</div>
          <div class="legend"><span class="star">★</span> Best of LessWrong ${st.winners[0]?.year ?? ""}</div>
        </div>
        <a class="cta ui" href="${s.posts[0].url}">Begin with the first essay →</a>
      </aside>
    </div>`;
}

/* ---------- 2. Start here ---------- */
{
  const [az, hl, hp, cx, bo] = ["rationality", "highlights", "hpmor", "codex", "bestoflesswrong"].map(c => lib.core.find(x => x.collection === c));
  const sum = seqs => { const ps = seqs.flatMap(s => s.posts); return { posts: ps.length, min: ps.reduce((n, p) => n + p.minutes, 0) }; };
  const hlMain = hl.books[0]?.sequences ?? hl.sequences;
  const hlS = sum(hlMain), azS = sum(az.sequences), hpS = sum(hp.sequences), cxS = sum(cx.sequences), boS = sum(bo.sequences);
  const img = hl.imageUrl;
  $("#start").innerHTML = `
    <h2 id="start-title" class="section-title">Start here</h2>
    <p class="sec-lede">Five ways in, but not five equals. Most people should begin with the first; the rest are for after, or for a different kind of reader.</p>
    <div class="start-grid">
      <a class="begin card" href="${hl.url}">
        <div class="begin-img" style="background-image:url('${img}')"></div>
        <div class="begin-text">
          <p class="step ui">1 · Begin here</p>
          <h3>${esc(hl.title)}</h3>
          <p>Fifty essays from Eliezer Yudkowsky's Sequences, chosen as the shortest route to the ideas the rest of the site takes for granted: what beliefs are for, how minds go wrong, and how to notice. In ${hlMain.length} parts, ${roughH(hlS.min)}; a long weekend.</p>
          <p class="meta">${hlS.posts} posts · ${hlMain.length} parts · ${hm(hlS.min)}</p>
          <span class="cta ui">Start with “${esc(hlMain[0].title)}” →</span>
        </div>
      </a>
      <ol class="ledger">
        <li><a href="${az.url}">
          <span class="step ui">2 · The full version</span>
          <span class="l-title">${esc(az.title)} <i>(“The Sequences”)</i></span>
          <span class="l-note">The book the Highlights are drawn from: ${az.books.length} books, from <i>${esc(az.books[0].title)}</i> to <i>${esc(az.books.at(-1).title)}</i>. Read it when the Highlights leave you wanting the arguments in full.</span>
          <span class="meta">${azS.posts} posts · ${roughH(azS.min)}</span></a></li>
        <li><a href="${hp.url}">
          <span class="step ui">Fiction</span>
          <span class="l-title">${esc(hp.title)}</span>
          <span class="l-note">The same ideas as a novel, and for many readers the way they first arrived. Not a summary of the Sequences; a story that makes them felt.</span>
          <span class="meta">${hpS.posts} chapters in ${hp.sequences.length} volumes · ${roughH(hpS.min)}</span></a></li>
        <li><a href="${cx.url}">
          <span class="step ui">Another voice</span>
          <span class="l-title">${esc(cx.title)}</span>
          <span class="l-note">Scott Alexander on reasoning, science and institutions; ${cx.books.filter(b => b.title !== "Epilogue").map(b => `<i>${esc(b.title)}</i>`).join(", ")}. Funnier than the Sequences and easier to dip into.</span>
          <span class="meta">${cxS.posts} essays · ${roughH(cxS.min)}</span></a></li>
        <li><a href="${bo.url}">
          <span class="step ui">In print</span>
          <span class="l-title">The Best of LessWrong books</span>
          <span class="l-note">Each December the community votes on which posts held up; the winners were printed as ${word(bo.books.length)} volumes: ${bo.books.map(b => `<i>${esc(b.title)}</i>`).join(", ")}. Essays, not a course: read in any order.</span>
          <span class="meta">${boS.posts} essays in ${bo.sequences.length} slim books · ${roughH(boS.min)}</span></a></li>
      </ol>
    </div>`;
}

/* ---------- 3. Staff shelf ---------- */
{
  const picks = [
    ["Replacing Guilt", "For anyone who runs on “should”. Nate Soares on putting guilt down and keeping the caring; start with “On Caring”."],
    ["Gears Which Turn The World", "What money cannot buy, and why coordination is the scarce resource. Short posts; an afternoon well spent."],
    ["Embedded Agency", "Why an agent that lives inside its world is so hard to reason about, told largely in drawings."],
    ["Inadequate Equilibria", "When to trust the experts and when you can do better. A short book that still starts arguments every year."],
    ["Babble and Prune", "Five posts, half an hour, and a model of creativity you will keep reaching for."],
    ["CFAR Handbook", "The workshop techniques, written down: Focusing, Resolve Cycles and the rest. Best done, not just read."],
    ["Three Worlds Collide", "Yudkowsky's first-contact novella: eight parts, two endings, no comfortable answer."],
    ["Intro to Naturalism", "Logan Strohl on patient observation: a slower, stranger kind of rationality than the rest of this page."],
  ].map(([t, note]) => ({ s: byTitle(t), note })).filter(x => x.s);
  $("#shelf").innerHTML = `
    <h2 id="shelf-title" class="section-title">Staff shelf</h2>
    <p class="sec-lede">Eight of the forty-two curated sequences we would hand a friend, each with the reason why.</p>
    <ul class="shelf-grid">${picks.map(({ s, note }) => {
      const im = image(s.gridImageId, { w: 480, h: 270 });
      return `<li><a href="${s.url}">
        <div class="sh-img"${im ? ` style="background-image:url('${im}')"` : ""}></div>
        <h3>${esc(s.title)}</h3>
        <p class="meta">${esc(s.author.name)} · ${s.stats.posts} posts · ${hm(s.stats.minutes)}</p>
        <p class="note">${esc(note)}</p></a></li>`; }).join("")}</ul>`;
}

/* ---------- 4. Earned its place ---------- */
const MIN_POSTS = 3, FULL_DEPTH = 8, PER_WINNER = 0.25, MAX_REVIEW = 2, RISING_FROM = 2025;
const community = lib.sequences.filter(s => s.kind === "community");
function scoreOf(s) {
  const n = s.stats.posts, m = s.stats.karmaMedian, w = s.stats.winners.length;
  const depth = Math.sqrt(Math.min(n, FULL_DEPTH) / FULL_DEPTH);
  const review = Math.min(MAX_REVIEW, 1 + PER_WINNER * w);
  return { n, m, w, depth, review, score: Math.round(m * depth * review) };
}
const eligible = community.filter(s => s.stats.posts >= MIN_POSTS && s.title.trim())
  .map(s => ({ s, sc: scoreOf(s) })).sort((a, b) => b.sc.score - a.sc.score);
eligible.forEach((e, i) => e.rank = i + 1);
const rising = eligible.filter(e => e.s.stats.lastYear >= RISING_FROM);
rising.forEach((e, i) => e.risingRank = i + 1);
const lastPost = s => s.posts.reduce((a, p) => !a || p.postedAt > a ? p.postedAt : a, null);

const boardState = { tab: "all", shown: 12 };
function renderBoard() {
  const list = boardState.tab === "all" ? eligible : rising;
  const rows = list.slice(0, boardState.shown);
  const maxScore = list[0]?.sc.score || 1;
  $("#board-list").innerHTML = rows.map((e, i) => {
    const { s, sc } = e;
    const im = image(s.gridImageId, { w: 160, h: 100 });
    const lp = lastPost(s);
    const desc = firstLine(s.description);
    return `<li class="row">
      <span class="rank">${i + 1}</span>
      <a class="thumb" href="${s.url}" tabindex="-1" aria-hidden="true"${im ? ` style="background-image:url('${im}')"` : ""}></a>
      <div class="r-main">
        <a class="r-title" href="${s.url}">${esc(s.title)}</a>
        <div class="meta">${esc(s.author.name)} · ${sc.n} posts · ${fmt.years(s)}${boardState.tab === "rising" && lp ? ` · last post ${month(lp)}` : ""}${sc.w ? ` · <span class="winner-badge">★ ${sc.w} in Best of LessWrong</span>` : ""}</div>
        ${desc ? `<p class="r-desc">${esc(desc)}</p>` : ""}
      </div>
      <div class="r-score">
        <span class="bar" aria-hidden="true"><span style="width:${Math.round(100 * sc.score / maxScore)}%"></span></span>
        <span class="num">${sc.score}</span>
        <button class="why ui" data-id="${s.id}" aria-label="Why is ${esc(s.title)} here?" aria-expanded="false">why?</button>
      </div>
    </li>`; }).join("");
  const more = $("#board-more");
  const left = list.length - rows.length;
  more.hidden = left <= 0;
  more.textContent = `Show the next ${Math.min(12, left)} of ${left} more`;
  $("#board-count").textContent = boardState.tab === "all"
    ? `${eligible.length} of ${community.length} community sequences have at least ${MIN_POSTS} posts and are ranked; ${community.length - eligible.length} shorter ones are not.`
    : `${rising.length} ranked sequences with a post in ${RISING_FROM} or ${RISING_FROM + 1}, by the same score.`;
}
{
  $("#board").innerHTML = `
    <h2 id="board-title" class="section-title">Earned its place</h2>
    <p class="sec-lede">The community's sequences, ranked by how well their posts were received, not by when they were made. Nobody hand-placed these; hover or tap <span class="why-demo ui">why?</span> on any row to see the arithmetic.</p>
    <div class="formula ui" aria-label="How the score works">
      <span class="f-term"><b>median karma</b><small>the middle post, so one hit can't carry a sequence</small></span>
      <span class="op">×</span>
      <span class="f-term"><b>depth</b><small>√(posts ÷ ${FULL_DEPTH}), full at ${FULL_DEPTH}; fewer than ${MIN_POSTS} posts aren't ranked</small></span>
      <span class="op">×</span>
      <span class="f-term"><b>Review bonus</b><small>+${PER_WINNER * 100}% per Best of LessWrong post, up to ×${MAX_REVIEW}</small></span>
    </div>
    <div class="tabs ui" role="tablist">
      <button role="tab" data-tab="all" aria-selected="true">All time</button>
      <button role="tab" data-tab="rising" aria-selected="false">Rising <small>active ${RISING_FROM}–${String(RISING_FROM + 1).slice(2)}</small></button>
      <span class="count" id="board-count"></span>
    </div>
    <ol class="board-list" id="board-list"></ol>
    <button class="more ui" id="board-more">Show more</button>`;
  $("#board").querySelectorAll("[role=tab]").forEach(b => b.addEventListener("click", () => {
    boardState.tab = b.dataset.tab; boardState.shown = 12;
    $("#board").querySelectorAll("[role=tab]").forEach(x => x.setAttribute("aria-selected", x === b));
    hideWhy(); renderBoard();
  }));
  $("#board-more").addEventListener("click", () => { boardState.shown += 12; renderBoard(); });
  renderBoard();
}

/* "Why is this here?" */
const pop = $("#why");
let pinned = null;
function whyHtml(e) {
  const { s, sc } = e;
  const ks = s.posts.map(p => p.karma).sort((a, b) => a - b);
  const top = s.stats.topPost;
  return `<p class="w-h">Why is this here?</p>
    <p class="w-rank">#${e.rank} of ${eligible.length} ranked community sequences${e.risingRank ? ` · #${e.risingRank} rising` : ""}</p>
    <table>
      <tr><td>Median karma</td><td class="v">${sc.m}</td><td class="x">middle of ${sc.n} posts (${ks[0]}–${ks.at(-1)})</td></tr>
      <tr><td>× Depth</td><td class="v">${sc.depth.toFixed(2)}</td><td class="x">${sc.n} posts${sc.n >= FULL_DEPTH ? ", full credit" : ` of the ${FULL_DEPTH} for full credit`}</td></tr>
      <tr><td>× Review</td><td class="v">${sc.review.toFixed(2)}</td><td class="x">${sc.w ? `${sc.w} Best of LessWrong post${sc.w > 1 ? "s" : ""}` : "no Review winners"}</td></tr>
      <tr class="tot"><td>= Score</td><td class="v">${sc.score}</td><td></td></tr>
    </table>
    ${sc.w ? `<p class="w-win">${s.stats.winners.slice(0, 3).map(p => `★ ${esc(p.title)} <span>(${p.winner.year})</span>`).join("<br>")}${sc.w > 3 ? `<br>and ${sc.w - 3} more` : ""}</p>` : ""}
    ${top ? `<p class="w-top">Strongest post: “${esc(top.title)}”, ${top.karma} karma</p>` : ""}`;
}
function showWhy(btn, pin = false) {
  const e = eligible.find(x => x.s.id === btn.dataset.id); if (!e) return;
  pop.innerHTML = whyHtml(e); pop.hidden = false;
  document.querySelectorAll(".why[aria-expanded=true]").forEach(b => b.setAttribute("aria-expanded", "false"));
  btn.setAttribute("aria-expanded", "true");
  pinned = pin ? btn : null;
  const r = btn.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = Math.min(innerWidth - pw - 10, Math.max(10, r.right - pw));
  let top = r.bottom + 8;
  if (top + ph > innerHeight - 10) top = Math.max(74, r.top - ph - 8);
  pop.style.left = left + "px"; pop.style.top = top + "px";
}
function hideWhy() { pop.hidden = true; pinned = null; document.querySelectorAll(".why[aria-expanded=true]").forEach(b => b.setAttribute("aria-expanded", "false")); }
const board = $("#board-list");
const canHover = matchMedia("(hover: hover)").matches;
if (canHover) {
  board.addEventListener("mouseover", ev => { const b = ev.target.closest(".why"); if (b && !pinned) showWhy(b); });
  board.addEventListener("mouseout", ev => { const b = ev.target.closest(".why"); if (b && !pinned && !b.contains(ev.relatedTarget)) hideWhy(); });
}
board.addEventListener("focusin", ev => { const b = ev.target.closest(".why"); if (b && !pinned && b.matches(":focus-visible")) showWhy(b); });
board.addEventListener("focusout", ev => { if (ev.target.closest(".why") && !pinned) hideWhy(); });
board.addEventListener("click", ev => { const b = ev.target.closest(".why"); if (!b) return; ev.stopPropagation(); pinned === b ? hideWhy() : showWhy(b, true); });
document.addEventListener("click", ev => { if (!pop.contains(ev.target)) hideWhy(); });
addEventListener("keydown", ev => { if (ev.key === "Escape") hideWhy(); });
addEventListener("scroll", () => { if (!pop.hidden) hideWhy(); }, { passive: true });

/* ---------- 5. New on the shelves ---------- */
{
  const fresh = community.filter(s => s.title.trim() && s.stats.posts >= 1)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  const ranked = new Map(eligible.map(e => [e.s.id, e]));
  $("#new").innerHTML = `
    <h2 id="new-title" class="section-title">New on the shelves</h2>
    <p class="sec-lede">Sequences started most recently. Too new to judge; some will be finished, some won't. Worth a look before the votes are in.</p>
    <ol class="fresh-list">${fresh.map(s => {
      const d = new Date(s.createdAt);
      const e = ranked.get(s.id);
      const desc = firstLine(s.description, 140);
      return `<li><a href="${s.url}">
        <time class="ui" datetime="${s.createdAt}"><b>${d.getDate()}</b> ${d.toLocaleDateString("en-GB", { month: "short" })}</time>
        <span class="f-main">
          <span class="f-title">${esc(s.title)}</span>
          <span class="meta">${esc(s.author.name)} · ${s.stats.posts} post${s.stats.posts > 1 ? "s" : ""} so far${e ? ` · score ${e.sc.score}` : ""}</span>
          ${desc ? `<span class="f-desc">${esc(desc)}</span>` : ""}
        </span></a></li>`; }).join("")}</ol>`;
}

/* ---------- Colophon ---------- */
$("#colophon").innerHTML = `
  <p><b>How this page is made.</b> The Desk and the Staff shelf are chosen and written by hand, and change each season. “Earned its place” is computed from the community's own votes with the formula shown, and nothing else; “New on the shelves” is simply the newest. Data from a snapshot of lesswrong.com, ${month(lib.fetchedAt)}.</p>
  <p><a href="https://www.lesswrong.com/library">The Library as it is today ↗</a> · <a href="../../">All prototypes</a></p>`;
