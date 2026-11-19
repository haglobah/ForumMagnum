import "../../shared/header.js";
import { loadLibrary, image, fmt } from "../../shared/library.js";

const lib = await loadLibrary();
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = n => n.toLocaleString("en-US");

// ---------- time ----------
const YEAR = 365.2425 * 864e5;
const T0 = Date.UTC(2006, 0, 1);
const NOW = Date.parse(lib.fetchedAt) || Date.now();
const LASTYEAR = new Date(NOW).getUTCFullYear();
const T1 = Date.UTC(LASTYEAR + 1, 0, 1);
const Y = y => Date.UTC(y, 0, 1);
const yearOf = t => new Date(t).getUTCFullYear();
const YEARS = []; for (let y = 2006; y <= LASTYEAR; y++) YEARS.push(y);

// ---------- topics ----------
const COLOR = {
  "Rationality": "#5f9b65", "World Modeling": "#8a6cb0", "AI": "#4f78a8", "World Optimization": "#c47a3c",
  "Practical": "#b5585b", "Community": "#3d999a", "Site Meta": "#8d8778", "Other": "#a8a196",
};
const ORDER = ["Rationality", "World Modeling", "AI", "World Optimization", "Practical", "Community", "Site Meta", "Other"];
const FALLBACK = [
  [/fiction|humor|heuristic|rationaliz|murphy|priming|ambition|heroic|instrumental|planning/i, "Rationality"],
  [/\bAI\b|machine learning|decision theory|acausal|alignment|counterfactual|oversight|superintelligence|openai/i, "AI"],
  [/ethic|philosoph|anthropic|space|covid|programming|math|game theory|logic|phenomenolog|conscious|experiment/i, "World Modeling"],
];
function topicOf(s) {
  if (s.stats.topics[0]) return s.stats.topics[0].name in COLOR ? s.stats.topics[0].name : "Other";
  for (const t of s.stats.tags) for (const [re, name] of FALLBACK) if (re.test(t.name)) return name;
  return "World Modeling";
}

// ---------- items ----------
const collTitle = Object.fromEntries(lib.core.map(c => [c.collection, c.title]));
const items = [...lib.sequences, ...lib.books].map(s => {
  const dated = s.posts.filter(p => p.postedAt).map(p => ({ p, t: Date.parse(p.postedAt) })).sort((a, b) => a.t - b.t);
  if (!dated.length || !s.title.trim()) return null;
  const ts = dated.map(d => d.t);
  const q = f => ts[Math.round(f * (ts.length - 1))];
  return {
    s, id: s.id, title: s.title.trim(), topic: topicOf(s),
    group: s.kind === "community" ? "community" : "curated",
    first: ts[0], last: ts.at(-1), lo: q(0.1), hi: q(0.9),
    winners: dated.filter(d => d.p.winner), kmed: s.stats.karmaMedian,
  };
}).filter(Boolean);
items.forEach((it, i) => { it.i = i; it.startYear = Math.max(2006, yearOf(it.lo)); });
const byId = new Map(items.map(it => [it.id, it]));
const topicsPresent = ORDER.filter(t => items.some(it => it.topic === t));
const kindLabel = it => it.s.kind === "community" ? "Community" : it.s.kind === "book" ? `Book of ${collTitle[it.s.collection] || "a collection"}` : it.s.collection && collTitle[it.s.collection] ? `Curated · ${collTitle[it.s.collection]}` : "Curated";
const opacity = it => 0.38 + 0.62 * Math.min(1, Math.log1p(it.kmed) / Math.log1p(250));

// ---------- eras ----------
const ERAS = [
  { id: "ob", name: "Overcoming Bias & the Sequences", short: "The Sequences", from: T0, to: Y(2010), years: "2006–2009",
    text: "Eliezer Yudkowsky writes a post a day on Overcoming Bias; in 2009 the posts move to a new site, LessWrong. Nearly all of Rationality: A-Z was written in these three years." },
  { id: "quiet", name: "The quiet years & the diaspora", short: "The quiet years", from: Y(2010), to: Y(2017), years: "2010–2016",
    text: "Posting thins out as writers leave for their own blogs. Much of what the Library keeps from these years was written elsewhere and brought back: the Codex, Replacing Guilt, HPMOR (finished 2015)." },
  { id: "lw2", name: "LessWrong 2.0", short: "LessWrong 2.0", from: Y(2017), to: Y(2020), years: "2017–2019",
    text: "A new team relaunches the site and sequences return as a form: Inadequate Equilibria, Hammertime, Embedded Agency, the Alignment Forum's research agendas, and the first annual Review." },
  { id: "align", name: "The alignment wave", short: "The alignment wave", from: Y(2020), to: Y(2023), years: "2020–2022",
    text: "The busiest years in the Library. AI becomes the majority topic: Infra-Bayesianism, Cartesian Frames, the MIRI conversations, and alongside them the CFAR Handbook." },
  { id: "gpt", name: "After ChatGPT", short: "After ChatGPT", from: Y(2023), to: T1, years: `2023–${LASTYEAR}`,
    text: "With capable language models in the world, sequences turn to the systems that exist: interpretability, Cyborgism, conditioning predictive models, and what AGI means for us (Otherness and control)." },
];
const eraOf = t => ERAS.find(e => t >= e.from && t < e.to) || ERAS[0];

// ---------- state ----------
const state = { topics: new Set(topicsPresent), kind: "all", dom: [T0, T1], hl: null, pinned: null };
const visible = () => items.filter(it => state.topics.has(it.topic) && (state.kind === "all" || it.group === state.kind));
const isZoomed = () => state.dom[0] > T0 + 864e5 || state.dom[1] < T1 - 864e5;

// posts per topic per year (unique posts; untagged posts count under their sequence's topic)
function topicYearCounts(its) {
  const seen = new Set(), m = new Map(YEARS.map(y => [y, Object.fromEntries(ORDER.map(t => [t, 0]))]));
  for (const it of its) for (const p of it.s.posts) {
    if (!p.year || seen.has(p.id) || !m.has(p.year)) continue;
    seen.add(p.id);
    let names = p.tags.filter(t => t.core).map(t => t.name in COLOR ? t.name : "Other");
    if (!names.length) names = [it.topic];
    for (const n of names) m.get(p.year)[n] += 1 / names.length;
  }
  return m;
}
const ALLCOUNTS = topicYearCounts(items);

// ---------- intro ----------
{
  const posts = new Set(items.flatMap(it => it.s.posts.map(p => p.id)));
  const wins = new Set(items.flatMap(it => it.winners.map(w => w.p.id)));
  $("#lede").innerHTML = `Every sequence in the Library, placed where its posts were written: <b>${items.length} sequences</b> and <b>${nf(posts.size)} posts</b> from ${yearOf(items.reduce((a, it) => Math.min(a, it.lo), Infinity))} to today, with <b>${wins.size}</b> Best of LessWrong winners in gold. The founding texts sit on the left; what the community is thinking about now, on the right.`;
  $("#snap").textContent = new Date(NOW).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
$("#dnote .dnote-x").onclick = () => $("#dnote").remove();

// ---------- controls ----------
function renderTopicChips() {
  const vis = items.filter(it => state.kind === "all" || it.group === state.kind);
  $("#topics").innerHTML = topicsPresent.map(t => `<button class="tchip" style="--c:${COLOR[t]}" data-topic="${esc(t)}" aria-pressed="${state.topics.has(t)}"><i></i>${esc(t)} <span class="n">${vis.filter(it => it.topic === t).length}</span></button>`).join("");
}
$("#topics").addEventListener("click", e => {
  const b = e.target.closest(".tchip"); if (!b) return;
  const t = b.dataset.topic, all = state.topics.size === topicsPresent.length;
  if (all) state.topics = new Set([t]);                       // first click: show only this topic
  else if (state.topics.has(t) && state.topics.size === 1) state.topics = new Set(topicsPresent); // click the only one: back to all
  else state.topics.has(t) ? state.topics.delete(t) : state.topics.add(t);
  update(true);
});
$("#kinds").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  state.kind = b.dataset.kind;
  for (const x of $("#kinds").children) x.setAttribute("aria-pressed", x === b);
  update(true);
});

// ---------- chart geometry ----------
const chart = $("#chart"), wrap = $("#tlwrap"), svg = $("#tl"), ov = $("#ov"), card = $("#card");
const G = { top: 50, groupHead: 21, lane: 10.5, bar: 6, minW: 5, gap: 4, bottom: 10 };
let layout = null;          // { vertical, W, H, groups:[{topic, y, lanes, items}], ... }
let placed = [];            // hit-test entries from the last render
const measure = (() => { const c = document.createElement("canvas").getContext("2d"); const cache = new Map();
  return (t, font = "10.5px 'Gill Sans', 'Gill Sans MT', Calibri, sans-serif") => { const k = font + t; if (!cache.has(k)) { c.font = font; cache.set(k, c.measureText(t).width); } return cache.get(k); }; })();

function packLanes(list, px, minW, gap) {
  const lanes = [];
  for (const it of [...list].sort((a, b) => a.first - b.first || b.last - a.last)) {
    const a = px(Math.max(it.first, T0)), b = Math.max(px(it.last), px(Math.max(it.lo, T0)) + minW);
    let k = lanes.findIndex(end => end + gap <= a);
    if (k < 0) { k = lanes.length; lanes.push(0); }
    lanes[k] = b; it.lane = k;
  }
  return lanes.length;
}

function buildLayout() {
  const W = chart.clientWidth, vertical = W < 640, vis = visible();
  if (!vertical) {
    const px = t => (t - T0) / (T1 - T0) * W;
    let y = G.top; const groups = [];
    for (const t of topicsPresent) {
      const its = vis.filter(it => it.topic === t); if (!its.length) continue;
      const n = packLanes(its, px, G.minW, G.gap);
      groups.push({ topic: t, y, items: its, lanes: n, laneY: y + G.groupHead });
      y += G.groupHead + n * G.lane + 8;
    }
    layout = { vertical, W, H: Math.max(y + G.bottom, 200), groups, vis };
  } else {
    const perYear = 74, top = 12, H = top + (T1 - T0) / YEAR * perYear + 10;
    const py = t => top + (t - T0) / (T1 - T0) * (H - top - 10);
    const n = packLanes(vis, py, 6, 3);
    const gut = 46, laneW = Math.max(3.2, Math.min(10, (W - gut - 8) / Math.max(n, 1)));
    layout = { vertical, W, H, top, py, lanes: n, gut, laneW, vis };
  }
  chart.classList.toggle("vertical", vertical);
}

// ---------- render: horizontal ----------
function ticks(d0, d1, W) {
  const ppy = W / ((d1 - d0) / YEAR);
  const step = ppy > 44 ? 1 : ppy > 22 ? 2 : 5;
  const out = [];
  for (let y = Math.ceil(yearOf(d0)); y <= yearOf(d1); y++) if (Y(y) >= d0 - 1 && y % step === 0) out.push({ t: Y(y), label: String(y), major: true });
  if (ppy > 260) for (let y = yearOf(d0); y <= yearOf(d1); y++) for (let m = 1; m < 12; m++) {
    if (ppy < 700 && m % 3) continue;
    const t = Date.UTC(y, m, 1); if (t > d0 && t < d1) out.push({ t, label: new Date(t).toLocaleString("en-US", { month: "short", timeZone: "UTC" }), major: false });
  }
  return { out, ppy };
}

function renderH() {
  const { W, H, groups } = layout, [d0, d1] = state.dom, k = W / (d1 - d0), x = t => (t - d0) * k;
  const s = [];
  placed = [];
  // era bands
  ERAS.forEach((e, i) => {
    const a = Math.max(0, x(e.from)), b = Math.min(W, x(e.to)); if (b <= 0 || a >= W) return;
    if (i % 2) s.push(`<rect x="${a}" y="0" width="${b - a}" height="${H}" fill="rgba(0,0,0,.028)"/>`);
    if (x(e.from) > 0) s.push(`<line x1="${x(e.from)}" x2="${x(e.from)}" y1="0" y2="${H}" stroke="rgba(0,0,0,.12)" stroke-dasharray="3 3"/>`);
  });
  // axis
  const { out } = ticks(d0, d1, W);
  for (const tk of out) {
    const xx = x(tk.t);
    s.push(`<line x1="${xx}" x2="${xx}" y1="${G.top - 6}" y2="${H}" stroke="rgba(0,0,0,${tk.major ? .06 : .03})"/>`);
    s.push(`<text class="${tk.major ? "yr major" : "mo"}" x="${xx + 3}" y="${G.top - 9}">${tk.label}</text>`);
  }
  s.push(`<line x1="0" x2="${W}" y1="${G.top - 5}" y2="${G.top - 5}" stroke="rgba(0,0,0,.12)"/>`);
  // today
  const xn = x(NOW); if (xn > 0 && xn < W) s.push(`<line x1="${xn}" x2="${xn}" y1="${G.top - 5}" y2="${H}" stroke="rgba(0,0,0,.3)" stroke-dasharray="2 3"/><text class="today" x="${xn - 4}" y="${H - 4}" text-anchor="end">today</text>`);
  // groups
  for (const g of groups) {
    s.push(`<line x1="0" x2="${W}" y1="${g.y + 0.5}" y2="${g.y + 0.5}" stroke="rgba(0,0,0,.07)"/>`);
    const byLane = Array.from({ length: g.lanes }, () => []);
    for (const it of g.items) byLane[it.lane].push(it);
    const labels = [];
    for (const lane of byLane) {
      lane.sort((a, b) => a.first - b.first);
      lane.forEach((it, j) => {
        const cy = g.laneY + it.lane * G.lane + G.lane / 2;
        const xf = x(Math.max(it.first, T0)), xl = x(it.last), xlo = x(Math.max(it.lo, T0));
        const xhi = Math.max(x(it.hi), xlo + G.minW);
        const end = Math.max(xl, xhi);
        if (end < -2 || xf > W + 2) return;
        const c = COLOR[it.topic], op = opacity(it), hl = state.hl === it.id || state.pinned === it.id;
        let g1 = `<g opacity="${state.hl && !hl ? Math.min(op, .5) : op}">`;
        if (xl - xf > 1) g1 += `<line x1="${xf}" x2="${xl}" y1="${cy}" y2="${cy}" stroke="${c}" stroke-width="1.5" opacity=".55"/>`;
        if (it.first < T0 && xf >= -1) g1 += `<path d="M${xf + 4} ${cy - 3} L${xf} ${cy} L${xf + 4} ${cy + 3}" fill="none" stroke="${c}" stroke-width="1.2"/>`;
        g1 += `<rect x="${xlo}" y="${cy - G.bar / 2}" width="${xhi - xlo}" height="${G.bar}" rx="2" fill="${c}"${hl ? ` stroke="rgba(0,0,0,.8)" stroke-width="1.5"` : ""}/>`;
        g1 += `</g>`;
        s.push(g1);
        for (const w of it.winners) { const wx = x(w.t); if (wx > -4 && wx < W + 4) s.push(`<circle cx="${wx}" cy="${cy}" r="3.3" fill="#c8a23a" stroke="#fff" stroke-width="1.2"/>`); }
        placed.push({ it, a: Math.min(xf, xlo), b: end, y0: cy - G.lane / 2, y1: cy + G.lane / 2 });
        // label after the bar if the lane has room until the next bar
        const next = lane[j + 1], room = (next ? x(Math.max(next.first, T0)) - 8 : W - 4) - (end + 5);
        const tw = measure(it.title), lx = Math.max(end + 5, 4);
        if (tw <= room && lx + tw < W && (end + 5 >= 0 || (end > 0))) labels.push(`<text class="lbl${hl ? " hl" : ""}" x="${lx}" y="${cy + 3.6}">${esc(it.title)}</text>`);
        else if (hl) labels.push(`<text class="lbl hl" x="${Math.min(Math.max(end + 5, 4), W - tw - 4)}" y="${cy - 6}">${esc(it.title)}</text>`);
      });
    }
    s.push(...labels);
    const nseq = g.items.length;
    s.push(`<text class="gh" x="10" y="${g.y + 15}">${esc(g.topic)} <tspan>${nseq}</tspan></text>`);
  }
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", H);
  svg.innerHTML = s.join("");
  // era labels (HTML, so they can wrap and be clicked)
  $("#eraLabels").innerHTML = ERAS.map(e => {
    const a = Math.max(0, x(e.from)), b = Math.min(W, x(e.to)), w = b - a; if (w < 46) return "";
    return `<button class="eralabel" data-era="${e.id}" style="left:${a}px;width:${w}px" title="Zoom to ${esc(e.name)}"><b>${esc(w > 190 ? e.name : e.short)}</b><span>${e.years}</span></button>`;
  }).join("");
  chart.classList.toggle("zoomed", isZoomed());
}

// ---------- render: vertical (phones) ----------
function renderV() {
  const { W, H, py, gut, laneW, vis } = layout;
  const s = []; placed = [];
  ERAS.forEach((e, i) => {
    const a = py(e.from), b = py(e.to);
    if (i % 2) s.push(`<rect x="0" y="${a}" width="${W}" height="${b - a}" fill="rgba(0,0,0,.03)"/>`);
    if (i) s.push(`<line x1="0" x2="${W}" y1="${a}" y2="${a}" stroke="rgba(0,0,0,.14)" stroke-dasharray="3 3"/>`);
  });
  for (const y of YEARS) {
    const yy = py(Y(y));
    s.push(`<line x1="${gut - 6}" x2="${W}" y1="${yy}" y2="${yy}" stroke="rgba(0,0,0,.05)"/><text class="yr${y % 5 === 0 ? " major" : ""}" x="6" y="${yy + 12}">${y}</text>`);
  }
  for (const it of vis) {
    const cx = gut + it.lane * laneW + laneW / 2, bw = Math.max(2.4, laneW * .68);
    const yf = py(Math.max(it.first, T0)), yl = py(it.last), ylo = py(Math.max(it.lo, T0)), yhi = Math.max(py(it.hi), ylo + 6);
    const c = COLOR[it.topic], hl = state.pinned === it.id;
    s.push(`<g opacity="${opacity(it)}">${yl - yf > 1 ? `<line x1="${cx}" x2="${cx}" y1="${yf}" y2="${yl}" stroke="${c}" stroke-width="1.2" opacity=".55"/>` : ""}<rect x="${cx - bw / 2}" y="${ylo}" width="${bw}" height="${yhi - ylo}" rx="1.5" fill="${c}"${hl ? ` stroke="#000" stroke-width="1.5"` : ""}/></g>`);
    for (const w of it.winners) s.push(`<circle cx="${cx}" cy="${py(w.t)}" r="${Math.min(3, laneW * .45)}" fill="#c8a23a" stroke="#fff" stroke-width=".8"/>`);
    placed.push({ it, a: Math.min(yf, ylo), b: Math.max(yl, yhi), y0: cx - laneW / 2, y1: cx + laneW / 2, vertical: true });
  }
  ERAS.forEach(e => s.push(`<text class="eraname" x="${gut}" y="${py(e.from) + 14}">${esc(e.name)}</text>`));
  const yn = py(NOW); s.push(`<line x1="${gut - 6}" x2="${W}" y1="${yn}" y2="${yn}" stroke="rgba(0,0,0,.3)" stroke-dasharray="2 3"/><text class="today" x="${W - 4}" y="${yn - 4}" text-anchor="end">today</text>`);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", H);
  svg.innerHTML = s.join("");
  $("#eraLabels").innerHTML = "";
}

// ---------- overview (brush) ----------
function areaPaths(counts, x, y, normalize) {
  const pts = YEARS.map(yr => ({ yr, c: counts.get(yr), tot: ORDER.reduce((n, t) => n + counts.get(yr)[t], 0) }));
  const base = pts.map(() => 0), paths = [];
  for (const t of ORDER) {
    const top = pts.map((p, i) => base[i] + (normalize ? (p.tot ? p.c[t] / p.tot : 0) : p.c[t]));
    if (top.every((v, i) => v === base[i])) continue;
    const X = i => x(Y(pts[i].yr) + YEAR / 2);
    const up = top.map((v, i) => `${X(i)},${y(v)}`), down = base.map((v, i) => `${X(i)},${y(v)}`).reverse();
    paths.push({ t, d: `M${x(T0)},${y(top[0])} L${up.join(" L")} L${x(T1)},${y(top.at(-1))} L${x(T1)},${y(base.at(-1))} L${down.join(" L")} L${x(T0)},${y(base[0])} Z`, top: [...top], base: [...base], pts });
    top.forEach((v, i) => base[i] = v);
  }
  return paths;
}
function renderOverview() {
  if (layout.vertical) return;
  const W = ov.clientWidth, H = 64, pad = 13, x = t => (t - T0) / (T1 - T0) * W;
  const counts = topicYearCounts(layout.vis);
  const max = Math.max(1, ...YEARS.map(y => ORDER.reduce((n, t) => n + counts.get(y)[t], 0)));
  const y = v => H - pad - v / max * (H - pad - 4);
  const s = [];
  for (const p of areaPaths(counts, x, y, false)) s.push(`<path d="${p.d}" fill="${COLOR[p.t]}" opacity=".8"/>`);
  for (const yr of YEARS) if (yr % 2 === 0) s.push(`<text x="${x(Y(yr)) + 2}" y="${H - 2}">${yr}</text>`);
  for (const e of ERAS.slice(1)) s.push(`<line x1="${x(e.from)}" x2="${x(e.from)}" y1="2" y2="${H - pad}" stroke="rgba(0,0,0,.25)" stroke-dasharray="2 2"/>`);
  const a = x(state.dom[0]), b = x(state.dom[1]);
  if (isZoomed()) {
    s.push(`<rect class="shade" x="0" y="0" width="${a}" height="${H}"/><rect class="shade" x="${b}" y="0" width="${W - b}" height="${H}"/>`);
    s.push(`<rect class="win" x="${a}" y="1" width="${b - a}" height="${H - pad - 1}"/>`);
    s.push(`<rect class="handle" x="${a - 2.5}" y="${(H - pad) / 2 - 10}" width="5" height="20" rx="2"/><rect class="handle" x="${b - 2.5}" y="${(H - pad) / 2 - 10}" width="5" height="20" rx="2"/>`);
  }
  ov.setAttribute("viewBox", `0 0 ${W} ${H}`);
  ov.innerHTML = s.join("");
}

// ---------- the insight panel ----------
function renderInsight() {
  const el = $("#mix"), W = el.clientWidth || 600, H = el.clientHeight || 200, pad = 16;
  const x = t => (t - T0) / (T1 - T0) * W, y = v => 4 + (1 - v) * (H - pad - 4);
  const s = [];
  const paths = areaPaths(ALLCOUNTS, x, y, true);
  for (const p of paths) {
    s.push(`<path d="${p.d}" fill="${COLOR[p.t]}" opacity=".88"><title>${esc(p.t)}</title></path>`);
    // label the band at its widest year, if wide enough
    let bi = 0, bw = 0; p.top.forEach((v, i) => { const w = v - p.base[i]; if (w > bw && i > 1 && i < YEARS.length - 2) { bw = w; bi = i; } });
    const tw = measure(p.t, "600 11.5px 'Gill Sans', Calibri, sans-serif");
    if ((H - pad) * bw > 15 && W > 300) s.push(`<text class="lab" x="${Math.min(W - tw - 4, Math.max(4, x(Y(YEARS[bi]) + YEAR / 2) - tw / 2))}" y="${y((p.top[bi] + p.base[bi]) / 2) + 4}">${esc(p.t)}</text>`);
  }
  for (const e of ERAS.slice(1)) s.push(`<line x1="${x(e.from)}" x2="${x(e.from)}" y1="0" y2="${H - pad}" stroke="rgba(255,255,255,.9)" stroke-width="1.5"/>`);
  for (const yr of YEARS) if (yr % (W < 500 ? 5 : 2) === 0) s.push(`<text x="${x(Y(yr)) + 2}" y="${H - 3}">${yr}</text>`);
  el.setAttribute("viewBox", `0 0 ${W} ${H}`);
  el.innerHTML = s.join("");
}
function eraMix(e) {
  const tot = Object.fromEntries(ORDER.map(t => [t, 0])); let n = 0;
  for (const yr of YEARS) if (Y(yr) >= e.from && Y(yr) < e.to) for (const t of ORDER) { tot[t] += ALLCOUNTS.get(yr)[t]; n += ALLCOUNTS.get(yr)[t]; }
  return { n, share: t => n ? tot[t] / n : 0 };
}
const pct = v => `${Math.round(v * 100)}%`;
{
  const m = ERAS.map(eraMix);
  const ai = m.map(x => x.share("AI")), ra = m.map(x => x.share("Rationality")), wm = m.map(x => x.share("World Modeling"));
  const peak = YEARS.reduce((a, y) => { const t = ORDER.reduce((n, k) => n + ALLCOUNTS.get(y)[k], 0); return t > a.n ? { y, n: t } : a; }, { y: 0, n: 0 });
  $("#insightText").innerHTML = `
    <p><span class="k" style="color:${COLOR.AI}">AI</span> is ${pct(ai[0])} of the Library's posts from the Overcoming Bias years, ${pct(ai[2])} in LessWrong 2.0, and ${pct(ai[3])} in the alignment wave. Since ChatGPT it has held at ${pct(ai[4])}.</p>
    <p><span class="k" style="color:${COLOR.Rationality}">Rationality</span>, the founding subject, goes from ${pct(ra[0])} to ${pct(ra[4])}, while <span class="k" style="color:${COLOR["World Modeling"]}">World Modeling</span> grows from ${pct(wm[1])} to ${pct(wm[4])}.</p>
    <p class="meta">Share of posts per year by core topic, ${YEARS[0]}–${LASTYEAR}. The busiest year is ${peak.y}, with ${nf(Math.round(peak.n))} posts that sit in sequences. Posts without a topic tag (most of those before 2018) count under their sequence's topic.</p>`;
}

// ---------- era cards ----------
function renderEras() {
  const vis = visible();
  $("#eras").innerHTML = ERAS.map(e => {
    const m = eraMix(e), began = vis.filter(it => it.lo >= e.from && it.lo < e.to);
    const wins = new Set(began.flatMap(it => it.winners.map(w => w.p.id))).size;
    const on = isZoomed() && Math.abs(state.dom[0] - e.from) < 864e5 * 2 && Math.abs(state.dom[1] - e.to) < 864e5 * 2;
    return `<button class="era${on ? " on" : ""}" data-era="${e.id}" aria-pressed="${on}">
      <span class="yrs">${e.years}</span><h3>${esc(e.name)}</h3><p>${esc(e.text)}</p>
      <span class="mixbar" title="Topic mix of the posts written in these years">${ORDER.map(t => m.share(t) > .004 ? `<i style="width:${m.share(t) * 100}%;background:${COLOR[t]}" title="${esc(t)} ${pct(m.share(t))}"></i>` : "").join("")}</span>
      <span class="st">${began.length} sequences begin · ${nf(Math.round(m.n))} posts${wins ? ` · <span style="color:var(--winner);font-weight:600">${wins} winners</span>` : ""}</span></button>`;
  }).join("");
}
function zoomTo(a, b) {
  const span = Math.max(YEAR / 2, Math.min(T1 - T0, b - a));
  let a2 = Math.max(T0, Math.min(a, T1 - span)); state.dom = [a2, a2 + span];
  scheduleRender(); renderList(); renderEras();
}
function toggleEra(id) {
  const e = ERAS.find(e => e.id === id);
  const on = Math.abs(state.dom[0] - e.from) < 864e5 * 2 && Math.abs(state.dom[1] - e.to) < 864e5 * 2;
  on ? zoomTo(T0, T1) : zoomTo(e.from, e.to);
}
$("#eras").addEventListener("click", e => { const b = e.target.closest(".era"); if (!b) return; toggleEra(b.dataset.era);
  if (!layout.vertical) chart.scrollIntoView({ behavior: "smooth", block: "start" }); else $("#yearsTitle").scrollIntoView({ behavior: "smooth" }); });
$("#eraLabels").addEventListener("click", e => { const b = e.target.closest(".eralabel"); if (b) toggleEra(b.dataset.era); });

// ---------- year by year ----------
function renderList() {
  const [d0, d1] = state.dom, zoomed = isZoomed();
  const vis = visible().filter(it => !zoomed || (it.lo >= d0 && it.lo < d1));
  const rb = $("#rangebar");
  if (zoomed) {
    const a = yearOf(d0 + 864e5), b = yearOf(d1 - 864e5);
    rb.hidden = false;
    rb.innerHTML = `<span>Showing the ${vis.length} sequences that begin in <b>${a === b ? a : `${a}–${b}`}</b>, the period selected on the timeline.</span><button id="showAll">Show all years</button>`;
    $("#showAll").onclick = () => zoomTo(T0, T1);
  } else rb.hidden = true;
  const html = []; let era = null;
  for (const y of YEARS) {
    const its = vis.filter(it => it.startYear === y).sort((a, b) => b.s.stats.karmaTotal - a.s.stats.karmaTotal);
    if (!its.length) continue;
    const e = eraOf(Y(y));
    if (e !== era) { era = e; html.push(`<div class="era-h">${esc(e.name)} · ${e.years}</div>`); }
    const posts = Math.round(ORDER.reduce((n, t) => n + ALLCOUNTS.get(y)[t], 0));
    html.push(`<section class="year" aria-labelledby="y${y}"><div class="year-h"><div class="y" id="y${y}">${y}</div><div class="s">${its.length} ${its.length === 1 ? "sequence begins" : "sequences begin"}<br>${nf(posts)} posts written</div></div><ul class="rows">${its.map(row).join("")}</ul></section>`);
  }
  $("#years").innerHTML = html.join("") || `<p class="empty">No sequences match these filters.</p>`;
}
function spanText(it) {
  const a = yearOf(it.lo), b = yearOf(it.hi), f = yearOf(it.first), l = yearOf(it.last);
  let t = a === b ? `${a}` : `${a}–${b}`;
  if (f < a || l > b) t += ` <span title="first to last post">(posts ${f === l ? f : `${f}–${l}`})</span>`;
  return t;
}
function row(it) {
  const s = it.s, w = it.winners.length;
  const kb = s.kind === "community" ? "" : `<span class="kb">${esc(s.kind === "book" ? collTitle[s.collection] || "Core" : "Curated")}</span> · `;
  return `<li class="row" data-id="${it.id}" style="--c:${COLOR[it.topic]}"><span class="dot" title="${esc(it.topic)}"></span>
    <div><div class="t"><a href="${s.url}">${esc(it.title)}</a></div>
    <div class="m">${kb}${esc(s.author?.name || "")} · ${esc(it.topic)}${w ? ` · <span class="w">${w} review winner${w > 1 ? "s" : ""}</span>` : ""}</div></div>
    <span class="r">${spanText(it)} · ${s.stats.posts} posts · ${fmt.hours(s.stats.minutes)}</span></li>`;
}
$("#years").addEventListener("pointerover", e => { const r = e.target.closest(".row"); const id = r?.dataset.id || null; if (id !== state.hl) { state.hl = id; if (!layout.vertical) scheduleRender(); } });
$("#years").addEventListener("pointerleave", () => { state.hl = null; scheduleRender(); });

// ---------- hover card ----------
function cardHTML(it) {
  const s = it.s, c = COLOR[it.topic], img = image(s.gridImageId || s.bannerImageId, { w: 330, h: 120 });
  const top = s.stats.topPost, f = yearOf(it.first), l = yearOf(it.last);
  const wins = it.winners.slice().sort((a, b) => (a.p.winner.ranking ?? 99) - (b.p.winner.ranking ?? 99));
  return `<button class="x" aria-label="Close">×</button>
    <div class="cover${img ? "" : " none"}" style="--c:${c};${img ? `background-image:url('${img}')` : ""}">${img ? "" : esc(it.title[0])}</div>
    <div class="body" style="--c2:${c}">
      <div class="kind">${esc(kindLabel(it))} · ${esc(it.topic)}</div>
      <h3>${esc(it.title)}</h3>
      <div class="meta">${s.author?.name ? `by ${esc(s.author.name)} · ` : ""}${f === l ? f : `${f}–${l}`}${(yearOf(it.lo) !== f || yearOf(it.hi) !== l) && yearOf(it.lo) !== yearOf(it.hi) ? `, mostly ${yearOf(it.lo)}–${yearOf(it.hi)}` : (yearOf(it.lo) !== f || yearOf(it.hi) !== l) ? `, mostly ${yearOf(it.lo)}` : ""}</div>
      <div class="meta">${s.stats.posts} posts · ${fmt.hours(s.stats.minutes)} · median karma ${s.stats.karmaMedian}</div>
      ${s.description ? `<p class="desc">${esc(s.description)}</p>` : ""}
      ${top ? `<div class="top">Top post: <a href="${top.url}">${esc(top.title)}</a> · ${top.karma}</div>` : ""}
      ${wins.length ? `<ul class="wins">${wins.slice(0, 3).map(w => `<li><a href="${w.p.url}">${esc(w.p.title)}</a> <span class="y">Best of ${w.p.winner.year}</span></li>`).join("")}${wins.length > 3 ? `<li style="color:var(--muted)">and ${wins.length - 3} more</li>` : ""}</ul>` : ""}
      <a class="open" href="${s.url}">Open the sequence →</a>
    </div>`;
}
let hideTimer = 0;
function showCard(it, px, py, pinned) {
  clearTimeout(hideTimer);
  const asSheet = layout.vertical || (pinned && matchMedia("(pointer: coarse)").matches);
  if (card.dataset.id !== it.id || card.hidden) { card.innerHTML = cardHTML(it); card.dataset.id = it.id; }
  card.hidden = false;
  card.classList.toggle("sheet", asSheet);
  card.classList.toggle("pinned", !!pinned);
  if (!asSheet) {
    const cw = 330, ch = card.offsetHeight, W = wrap.clientWidth, H = wrap.clientHeight;
    let left = px + 18; if (left + cw > W - 8) left = px - cw - 18; left = Math.max(8, left);
    let top = py - 40; top = Math.max(8, Math.min(top, H - ch - 8));
    card.style.left = left + "px"; card.style.top = top + "px";
  } else { card.style.left = ""; card.style.top = ""; }
}
function hideCard(delay = 180) { clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (state.pinned) return; card.hidden = true; if (state.hl) { state.hl = null; scheduleRender(); } }, delay); }
function unpin() { state.pinned = null; card.hidden = true; state.hl = null; scheduleRender(); }
card.addEventListener("pointerenter", () => clearTimeout(hideTimer));
card.addEventListener("pointerleave", () => hideCard());
card.addEventListener("click", e => { if (e.target.closest(".x")) unpin(); });
addEventListener("keydown", e => { if (e.key === "Escape") unpin(); });
document.addEventListener("pointerdown", e => { if (state.pinned && !card.contains(e.target) && !svg.contains(e.target)) unpin(); });

function hit(ev) {
  const r = svg.getBoundingClientRect(), sx = layout.W / r.width;
  const px = (ev.clientX - r.left) * sx, py = (ev.clientY - r.top) * sx;
  const [lc, tc] = layout.vertical ? [px, py] : [py, px];
  let best = null, bd = 9;
  for (const p of placed) {
    if (lc < p.y0 - 1 || lc > p.y1 + 1) continue;
    const d = tc < p.a ? p.a - tc : tc > p.b ? tc - p.b : 0;
    if (d < bd) { bd = d; best = p; }
  }
  return { it: best?.it, px, py };
}

// ---------- pointer: hover, pan, zoom ----------
let drag = null;
svg.addEventListener("pointermove", ev => {
  if (drag) {
    const dx = ev.clientX - drag.x;
    if (Math.abs(dx) > 3) drag.moved = true;
    if (drag.moved && !layout.vertical && isZoomed()) {
      chart.classList.add("dragging");
      const span = drag.dom[1] - drag.dom[0], dt = -dx / svg.getBoundingClientRect().width * span;
      const a = Math.max(T0, Math.min(T1 - span, drag.dom[0] + dt)); state.dom = [a, a + span]; scheduleRender();
    }
    return;
  }
  if (ev.pointerType === "touch" || state.pinned) return;
  const { it, px, py } = hit(ev);
  if (it) { if (state.hl !== it.id) { state.hl = it.id; scheduleRender(); } showCard(it, px, py, false); svg.style.cursor = "pointer"; }
  else { svg.style.cursor = ""; hideCard(); }
});
svg.addEventListener("pointerleave", () => { if (!drag) hideCard(); });
svg.addEventListener("pointerdown", ev => {
  if (ev.button) return;
  drag = { x: ev.clientX, dom: [...state.dom], moved: false, id: ev.pointerId };
  if (ev.pointerType !== "touch" && isZoomed()) svg.setPointerCapture(ev.pointerId);
});
svg.addEventListener("pointerup", ev => {
  const d = drag; drag = null; chart.classList.remove("dragging");
  if (!d || d.moved) { if (d?.moved) { renderList(); renderEras(); } return; }
  const { it, px, py } = hit(ev);
  if (it) { state.pinned = it.id; state.hl = it.id; showCard(it, px, py, true); scheduleRender(); }
  else unpin();
});
svg.addEventListener("pointercancel", () => { drag = null; chart.classList.remove("dragging"); });
let wheelTimer = 0;
svg.addEventListener("wheel", ev => {
  if (layout.vertical) return;
  const zoom = ev.ctrlKey || ev.metaKey, pan = !zoom && Math.abs(ev.deltaX) > Math.abs(ev.deltaY);
  if (!zoom && !pan) return;
  ev.preventDefault();
  const r = svg.getBoundingClientRect(), [d0, d1] = state.dom, span = d1 - d0;
  if (zoom) {
    const f = Math.exp(ev.deltaY * 0.01), tc = d0 + (ev.clientX - r.left) / r.width * span;
    const ns = Math.max(YEAR / 2, Math.min(T1 - T0, span * f));
    let a = tc - (tc - d0) * ns / span; a = Math.max(T0, Math.min(T1 - ns, a)); state.dom = [a, a + ns];
  } else if (isZoomed()) {
    const a = Math.max(T0, Math.min(T1 - span, d0 + ev.deltaX / r.width * span)); state.dom = [a, a + span];
  }
  scheduleRender();
  clearTimeout(wheelTimer); wheelTimer = setTimeout(() => { renderList(); renderEras(); }, 250);
}, { passive: false });
const zoomBy = f => { const [d0, d1] = state.dom, c = (d0 + d1) / 2, ns = (d1 - d0) * f; zoomTo(c - ns / 2, c + ns / 2); };
$("#zoomIn").onclick = () => zoomBy(0.5);
$("#zoomOut").onclick = () => zoomBy(2);
$("#zoomReset").onclick = () => zoomTo(T0, T1);

// brush on the overview
let brush = null;
ov.addEventListener("pointerdown", ev => {
  const r = ov.getBoundingClientRect(), t = T0 + (ev.clientX - r.left) / r.width * (T1 - T0);
  const ax = (state.dom[0] - T0) / (T1 - T0) * r.width + r.left, bx = (state.dom[1] - T0) / (T1 - T0) * r.width + r.left;
  let mode = "new";
  if (isZoomed()) { if (Math.abs(ev.clientX - ax) < 7) mode = "l"; else if (Math.abs(ev.clientX - bx) < 7) mode = "r"; else if (ev.clientX > ax && ev.clientX < bx) mode = "move"; }
  brush = { mode, t, dom: [...state.dom], moved: false };
  ov.setPointerCapture(ev.pointerId);
});
ov.addEventListener("pointermove", ev => {
  const r = ov.getBoundingClientRect();
  if (!brush) {
    const ax = (state.dom[0] - T0) / (T1 - T0) * r.width + r.left, bx = (state.dom[1] - T0) / (T1 - T0) * r.width + r.left;
    ov.style.cursor = !isZoomed() ? "crosshair" : Math.abs(ev.clientX - ax) < 7 || Math.abs(ev.clientX - bx) < 7 ? "ew-resize" : ev.clientX > ax && ev.clientX < bx ? "move" : "crosshair";
    return;
  }
  const t = Math.max(T0, Math.min(T1, T0 + (ev.clientX - r.left) / r.width * (T1 - T0)));
  brush.moved = true;
  const [a, b] = brush.dom, min = YEAR / 2;
  if (brush.mode === "new") { if (Math.abs(t - brush.t) > YEAR / 12) state.dom = [Math.min(t, brush.t), Math.max(t, brush.t)]; }
  else if (brush.mode === "l") state.dom = [Math.min(t, b - min), b];
  else if (brush.mode === "r") state.dom = [a, Math.max(t, a + min)];
  else { const span = b - a, na = Math.max(T0, Math.min(T1 - span, a + t - brush.t)); state.dom = [na, na + span]; }
  scheduleRender();
});
ov.addEventListener("pointerup", ev => {
  const b = brush; brush = null; if (!b) return;
  if (!b.moved) { // a click: open a 3-year window around it (or reset if clicking inside the window)
    if (b.mode === "move") zoomTo(T0, T1); else zoomTo(b.t - 1.5 * YEAR, b.t + 1.5 * YEAR);
    return;
  }
  if (state.dom[1] - state.dom[0] < YEAR / 2) zoomTo(state.dom[0], state.dom[0] + YEAR / 2);
  renderList(); renderEras();
});

// ---------- render loop ----------
let raf = 0;
function scheduleRender() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); }
function render() {
  layout.vertical ? renderV() : renderH();
  renderOverview();
}
function update(repack) {
  if (repack) { buildLayout(); renderTopicChips(); renderList(); renderEras(); }
  if (state.pinned && !visible().some(it => it.id === state.pinned)) unpin();
  render();
}
let lastW = 0;
new ResizeObserver(() => { const w = chart.clientWidth; if (w !== lastW) { lastW = w; buildLayout(); render(); renderInsight(); } }).observe(chart);

buildLayout(); renderTopicChips(); renderList(); renderEras(); renderInsight(); render();
