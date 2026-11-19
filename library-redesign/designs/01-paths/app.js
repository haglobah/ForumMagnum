import "../../shared/header.js";
import { loadLibrary, image, progress, fmt } from "../../shared/library.js";
import { STATIONS, LINES, ENTRANCES } from "./paths.js";

const lib = await loadLibrary();
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hrs = min => fmt.hours(Math.round(min));
const cleanDesc = d => (d || "").replace(/^\s*>\s?/gm, "").replace(/\s+/g, " ").trim();
const clip = (s, n) => s.length > n ? s.slice(0, s.lastIndexOf(" ", n)) + "…" : s;

// ---------- stations: resolve each to real data ----------
const st = {};
for (const [key, def] of Object.entries(STATIONS)) {
  let seqs, title, url, author, img, imgUrl;
  if (def.seq) {
    const s = lib.byId.get(def.seq);
    seqs = [s]; title = s.title.trim(); url = s.url; author = s.author.name; img = s.gridImageId;
  } else if (def.book) {
    const col = lib.core.find(c => c.collection === def.book[0]);
    const book = col.books[def.book[1]];
    seqs = book.sequences; title = def.title || book.title; url = col.url; author = "Eliezer Yudkowsky";
    img = seqs.find(s => s.gridImageId)?.gridImageId;
  } else {
    const col = lib.core.find(c => c.collection === def.core);
    seqs = def.onlyBook != null ? col.books[def.onlyBook].sequences : col.sequences;
    title = def.title || col.title; url = col.url; imgUrl = col.imageUrl;
    author = def.core === "hpmor" || def.core === "highlights" ? "Eliezer Yudkowsky" : "";
  }
  const posts = seqs.flatMap(s => s.posts);
  const minutes = posts.reduce((n, p) => n + p.minutes, 0);
  const years = posts.map(p => p.year).filter(Boolean);
  const desc = def.blurb || cleanDesc(seqs[0].description);
  st[key] = {
    key, ...def, title, url, author, seqs, posts, minutes, desc,
    image: imgUrl || (img ? image(img, { w: 240, h: 150 }) : null),
    years: years.length ? (Math.min(...years) === Math.max(...years) ? `${years[0]}` : `${Math.min(...years)}–${Math.max(...years)}`) : "",
    winners: posts.filter(p => p.winner).length,
    lines: LINES.filter(l => l.stations.includes(key)),
    composite: seqs.length > 1,
  };
}
for (const l of LINES) {
  l.minutes = l.stations.reduce((n, k) => n + st[k].minutes, 0);
  l.posts = l.stations.reduce((n, k) => n + st[k].posts.length, 0);
}
const prog = s => {
  const total = s.posts.length, read = s.posts.filter(p => progress.isRead(p.id)).length;
  return { read, total, share: total ? read / total : 0 };
};
const nextStop = l => {
  const started = l.stations.some(k => prog(st[k]).read > 0);
  const k = l.stations.find(k => prog(st[k]).share < 1);
  return { started, key: k };
};
const sizeText = s => `${s.posts.length} posts · ${hrs(s.minutes)}`;

// ---------- the map ----------
const UX = 62, UY = 58, PX = 70, PY = 70;
const X = u => PX + u * UX, Y = v => PY + v * UY;
const W = 1100, H = 750;
const svgNS = "http://www.w3.org/2000/svg";

function route(a, b) {
  // octilinear: straight along the major axis first, then 45° into the next stop
  const x1 = X(a.x), y1 = Y(a.y), x2 = X(b.x), y2 = Y(b.y);
  const dx = x2 - x1, dy = y2 - y1, ax = Math.abs(dx), ay = Math.abs(dy);
  if (!ax || !ay) return `L${x2},${y2}`;
  const sx = Math.sign(dx), sy = Math.sign(dy);
  if (ax > ay) return `L${x1 + sx * (ax - ay)},${y1} L${x2},${y2}`;
  return `L${x1},${y1 + sy * (ay - ax)} L${x2},${y2}`;
}
function wrap(text, n = 17) {
  const out = []; let cur = "";
  for (const w of text.split(/\s+/)) {
    if ((cur + " " + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}
function label(s) {
  const x = X(s.x), y = Y(s.y), lines = wrap(s.title, s.key === "hpmor" ? 22 : 17);
  const lh = 14.5, total = lines.length * lh + 13;
  let anchor = "middle", tx = x, ty;
  const r = s.lines.length > 1 ? 10 : 7;
  if (s.side === "n") ty = y - r - 8 - total + lh - 2;
  else if (s.side === "s") ty = y + r + 16;
  else { anchor = "start"; tx = x + r + 8; ty = y - total / 2 + lh - 3; }
  const t = lines.map((ln, i) => `<tspan x="${tx}" y="${ty + i * lh}">${esc(ln)}</tspan>`).join("");
  return `<text class="lbl" text-anchor="${anchor}">${t}<tspan class="sz" x="${tx}" y="${ty + lines.length * lh}">${sizeText(s)}</tspan></text>`;
}

function drawMap() {
  const svg = $("#map");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  let h = `<defs><filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-opacity=".18"/></filter></defs>`;
  // faint grid of the "city"
  h += `<g class="lines-g">`;
  for (const l of LINES) {
    const pts = l.stations.map(k => st[k]);
    let d = `M${X(pts[0].x)},${Y(pts[0].y)}`;
    for (let i = 1; i < pts.length; i++) d += " " + route(pts[i - 1], pts[i]);
    h += `<path class="line" data-line="${l.id}" d="${d}" stroke="${l.color}"/>`;
  }
  h += `</g>`;
  // entrances: a plate to the left of the first stop, as if the line began there
  for (const e of ENTRANCES) {
    const s = st[e.station], x = X(s.x), y = Y(s.y), w = 106, hh = e.main ? 34 : 30;
    const rx = x - 18 - w;
    h += `<g class="entrance${e.main ? " main" : ""}" data-key="${s.key}">
      <rect x="${rx}" y="${y - hh / 2}" width="${w}" height="${hh}" rx="4"/>
      <path class="arrow" d="M${rx + w} ${y - 6} L${rx + w + 8} ${y} L${rx + w} ${y + 6} Z"/>
      <text x="${rx + w / 2}" y="${y - (e.main ? 2 : 2)}" text-anchor="middle" class="e1">${esc(e.label)}</text>
      <text x="${rx + w / 2}" y="${y + (e.main ? 11 : 10)}" text-anchor="middle" class="e2">${esc(e.sub)}</text></g>`;
  }
  // legend
  {
    const lx = X(11.6), ly = Y(8.75), rh = 23;
    h += `<g class="legend"><rect class="lbox" x="${lx}" y="${ly}" width="${W - lx - 6}" height="${34 + LINES.length * rh + 30}" rx="4"/>
      <text class="lhead" x="${lx + 14}" y="${ly + 22}">Lines</text><text class="lhead r" x="${W - 20}" y="${ly + 22}" text-anchor="end">total</text>`;
    LINES.forEach((l, i) => {
      const y = ly + 42 + i * rh;
      h += `<g class="litem" data-line="${l.id}"><rect class="lhit" x="${lx + 4}" y="${y - 12}" width="${W - lx - 14}" height="${rh}"/>
        <line x1="${lx + 14}" x2="${lx + 40}" y1="${y - 4}" y2="${y - 4}" stroke="${l.color}" stroke-width="7" stroke-linecap="round"/>
        <text x="${lx + 50}" y="${y}">${esc(l.name)}</text><text class="lh" x="${W - 20}" y="${y}" text-anchor="end">${hrs(l.minutes)}</text></g>`;
    });
    const ky = ly + 42 + LINES.length * rh + 6;
    h += `<circle cx="${lx + 20}" cy="${ky - 4}" r="6" class="kdot"/><text class="lk" x="${lx + 32}" y="${ky}">a sequence</text>
      <circle cx="${lx + 122}" cy="${ky - 4}" r="8" class="kdot i"/><text class="lk" x="${lx + 136}" y="${ky}">interchange: on two lines</text></g>`;
  }
  // stations
  for (const s of Object.values(st)) {
    const x = X(s.x), y = Y(s.y), inter = s.lines.length > 1, r = inter ? 10 : 7;
    const col = s.lines[0].color;
    h += `<g class="st${inter ? " inter" : ""}" data-key="${s.key}" data-lines="${s.lines.map(l => l.id).join(" ")}" tabindex="0" role="button" aria-label="${esc(s.title)}, ${sizeText(s)}">
      <circle class="hit" cx="${x}" cy="${y}" r="20"/>
      <circle class="ring" cx="${x}" cy="${y}" r="${r + 4.5}" stroke="${inter ? "#222" : col}" transform="rotate(-90 ${x} ${y})"/>
      <circle class="dot" cx="${x}" cy="${y}" r="${r}" stroke="${inter ? "#222" : col}" style="--c:${col}"/>
      ${label(s)}</g>`;
  }
  svg.innerHTML = h;
  paintProgress();
}
function paintProgress() {
  for (const g of document.querySelectorAll("#map .st")) {
    const s = st[g.dataset.key], p = prog(s), ring = g.querySelector(".ring");
    const r = +ring.getAttribute("r"), c = 2 * Math.PI * r;
    ring.style.strokeDasharray = `${p.share * c} ${c}`;
    ring.style.opacity = p.read ? 1 : 0;
    g.classList.toggle("done", p.share === 1);
  }
  for (const l of LINES) {
    const n = nextStop(l);
    document.querySelectorAll(`#map .st[data-next~="${l.id}"]`).forEach(g => g.removeAttribute("data-next"));
    if (n.started && n.key) {
      const g = document.querySelector(`#map .st[data-key="${n.key}"]`);
      g.dataset.next = ((g.dataset.next || "") + " " + l.id).trim();
    }
  }
  const all = [...new Set(Object.values(st).flatMap(s => s.posts.map(p => p.id)))];
  const read = all.filter(id => progress.isRead(id)).length;
  $("#progress-sum").textContent = read ? `${read} of ${all.length} posts on the map read` : "";
}

// ---------- preview card ----------
function previewHTML(s, { inline = false } = {}) {
  const p = prog(s);
  const first = s.posts.slice(0, 3).map(x => `<li class="${progress.isRead(x.id) ? "read" : ""}"><a href="${x.url}" target="_blank" rel="noopener">${esc(x.title.trim())}</a><span class="meta"> ${x.minutes} min${x.winner ? ` · <span class="winner-badge">Best of ${x.winner.year}</span>` : ""}</span></li>`).join("");
  const contains = s.composite ? `<p class="contains meta">${s.seqs.length} parts: ${s.seqs.map(q => `<a href="${q.url}" target="_blank" rel="noopener">${esc(q.title)}</a>`).join(" · ")}</p>` : "";
  const chips = s.lines.map(l => `<button class="lchip" data-line="${l.id}" style="--c:${l.color}">${esc(l.short)}</button>`).join("");
  return `${!inline && s.image ? `<img class="pimg" src="${s.image}" alt="" loading="lazy" onerror="this.remove()">` : ""}
    <div class="pbody">
      ${inline ? "" : `<div class="plines">${chips}${s.lines.length > 1 ? `<span class="meta">interchange</span>` : ""}</div>
      <h3 class="ptitle">${esc(s.title)}</h3>`}
      <div class="meta">${[s.author, s.years].filter(Boolean).map(esc).join(" · ")}</div>
      <div class="meta strong">${s.posts.length} posts · ${hrs(s.minutes)} · ${fmt.words(s.posts.reduce((n, x) => n + x.words, 0))}${s.winners ? ` · <span class="winner-badge">${s.winners} Best of LessWrong</span>` : ""}</div>
      ${s.desc ? `<p class="pdesc">${esc(clip(s.desc, 240))}</p>` : `<p class="pdesc muted">Begins with “${esc(s.posts[0]?.title)}”.</p>`}
      ${contains}
      <div class="pfirst meta">First posts</div><ol class="plist">${first}</ol>
      <div class="pactions ui">
        <a class="go" href="${s.url}" target="_blank" rel="noopener">${p.read ? (p.share === 1 ? "Read again" : "Continue reading") : "Start reading"} →</a>
        <button class="pill mark" data-key="${s.key}">${p.share === 1 ? "Mark unread" : "Mark as read"}</button>
        ${p.read ? `<span class="meta">${p.read}/${p.total} read</span>` : ""}
      </div></div>`;
}
const pop = $("#pop"), wrapEl = $("#map-wrap");
let pinned = null, hideT;
function showPop(key, pin = false) {
  clearTimeout(hideT);
  const s = st[key];
  pop.innerHTML = previewHTML(s);
  pop.hidden = false; pop.dataset.key = key;
  const scale = wrapEl.clientWidth / W;
  const x = X(s.x) * scale, y = Y(s.y) * scale;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = Math.min(Math.max(8, x - pw / 2), wrapEl.clientWidth - pw - 8);
  let top = s.y < 5 ? y + 26 * scale + 40 : y - ph - 24;
  if (s.side === "s" && s.y >= 5) top = y - ph - 18;
  if (s.side === "n" && s.y < 5) top = y + 22;
  pop.style.left = left + "px"; pop.style.top = Math.max(4, top) + "px";
  if (pin) pinned = key;
  document.querySelectorAll("#map .st").forEach(g => g.classList.toggle("active", g.dataset.key === key));
}
function hidePop(force = false) {
  if (pinned && !force) return;
  pinned = null; pop.hidden = true;
  document.querySelectorAll("#map .st.active").forEach(g => g.classList.remove("active"));
}
$("#map").addEventListener("pointerover", e => {
  const g = e.target.closest(".st"); if (!g || e.pointerType === "touch") return;
  if (!pinned) showPop(g.dataset.key);
});
$("#map").addEventListener("pointermove", e => {
  const li = e.target.closest(".litem");
  if (li) setFocus(li.dataset.line); else if ($("#map").dataset.focus && !focus && !e.target.closest(".st")) setFocus(null);
});
$("#map").addEventListener("pointerleave", () => { if (!focus) setFocus(null); });
$("#map").addEventListener("pointerout", e => {
  const g = e.target.closest(".st"); if (!g || pinned) return;
  hideT = setTimeout(() => hidePop(), 250);
});
pop.addEventListener("pointerenter", () => clearTimeout(hideT));
pop.addEventListener("pointerleave", () => { if (!pinned) hideT = setTimeout(() => hidePop(), 250); });
$("#map").addEventListener("click", e => {
  const li = e.target.closest(".litem");
  if (li) { setFocus(li.dataset.line, focus !== li.dataset.line); return; }
  const g = e.target.closest(".st, .entrance");
  if (!g) { hidePop(true); if (focus) setFocus(null, false); return; }
  if (pinned === g.dataset.key) hidePop(true); else showPop(g.dataset.key, true);
});
$("#map").addEventListener("keydown", e => {
  const g = e.target.closest(".st");
  if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); showPop(g.dataset.key, true); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") hidePop(true); });
document.addEventListener("click", e => {
  if (pinned && !e.target.closest("#pop, #map, [data-open]")) hidePop(true);
});

// ---------- line focus ----------
let focus = null;
function setFocus(id, sticky) {
  if (sticky !== undefined) focus = sticky ? id : null;
  const f = id || focus, svg = $("#map");
  if (f) svg.dataset.focus = f; else delete svg.dataset.focus;
  svg.querySelectorAll(".line, .litem").forEach(el => el.classList.toggle("on", el.dataset.line === f));
  svg.querySelectorAll(".st").forEach(el => el.classList.toggle("on", !!f && el.dataset.lines.split(" ").includes(f)));
  document.querySelectorAll(".linecard").forEach(c => c.classList.toggle("on", c.dataset.line === f));
}

// ---------- the line cards (desktop) ----------
function drawLines() {
  $("#lines").innerHTML = LINES.map(l => {
    const n = nextStop(l), k = n.key || l.stations[0], s = st[k];
    const stops = l.stations.map(k => {
      const p = prog(st[k]);
      return `<span class="mini${st[k].lines.length > 1 ? " i" : ""}${p.share === 1 ? " done" : p.read ? " part" : ""}" title="${esc(st[k].title)}"></span>`;
    }).join("");
    return `<article class="linecard card" data-line="${l.id}" style="--c:${l.color}">
      <header><span class="bullet"></span><h3>${esc(l.name)}</h3></header>
      <div class="meta strong">${l.stations.length} stops · ${hrs(l.minutes)} · ${l.posts} posts</div>
      <div class="minis">${stops}</div>
      <p class="tagline">${esc(l.tagline)}</p>
      <p class="outcome"><span class="ui">By the end</span> ${esc(l.outcome)}</p>
      <button class="board ui" data-open="${k}">${n.started ? (n.key ? "Next stop" : "Line complete, review") : "Board at"}: <b>${esc(s.title)}</b> →</button>
    </article>`;
  }).join("");
}
$("#lines").addEventListener("pointerover", e => { const c = e.target.closest(".linecard"); if (c) setFocus(c.dataset.line); });
$("#lines").addEventListener("pointerleave", () => setFocus(null));
$("#lines").addEventListener("click", e => {
  const b = e.target.closest("[data-open]"); if (b) return;
  const c = e.target.closest(".linecard"); if (c) setFocus(c.dataset.line, focus !== c.dataset.line);
});
document.addEventListener("click", e => {
  const b = e.target.closest("[data-open]"); if (!b) return;
  e.preventDefault();
  openStation(b.dataset.open);
});
function openStation(key) {
  if (isPhone()) {
    const l = LINES.find(l => l.stations.includes(key) && l.id === phoneLine) || st[key].lines[0];
    phoneLine = l.id; openRow = key; drawPhone();
    document.querySelector(`.vrow[data-key="${key}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  } else {
    wrapEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    showPop(key, true);
  }
}
pop.addEventListener("click", e => {
  const m = e.target.closest(".mark");
  if (m) { toggleRead(m.dataset.key); showPop(m.dataset.key, true); return; }
  const lc = e.target.closest(".lchip");
  if (lc) setFocus(lc.dataset.line, focus !== lc.dataset.line);
});
function toggleRead(key) {
  const s = st[key], done = prog(s).share === 1;
  const ids = JSON.parse(localStorage.getItem("library-prototypes:read") || "[]");
  const set = new Set(ids);
  for (const p of s.posts) done ? set.delete(p.id) : set.add(p.id);
  localStorage.setItem("library-prototypes:read", JSON.stringify([...set]));
  dispatchEvent(new Event("library-progress"));
}

// ---------- phone: one line at a time, drawn vertically ----------
const isPhone = () => matchMedia("(max-width: 760px)").matches;
let phoneLine = "foundations", openRow = null;
function drawPhone() {
  $("#chips").innerHTML = LINES.map(l => `<button role="tab" class="chip${l.id === phoneLine ? " on" : ""}" data-line="${l.id}" style="--c:${l.color}" aria-selected="${l.id === phoneLine}"><span class="bullet"></span>${esc(l.short)}<span class="h">${hrs(l.minutes)}</span></button>`).join("");
  const l = LINES.find(l => l.id === phoneLine), n = nextStop(l);
  const entr = ENTRANCES.find(e => e.station === l.stations[0]);
  $("#vline").innerHTML = `<div class="vhead" style="--c:${l.color}">
      <h3>${esc(l.name)}</h3>
      <div class="meta strong">${l.stations.length} stops · ${hrs(l.minutes)} · ${l.posts} posts</div>
      <p class="tagline">${esc(l.tagline)}</p></div>
    <ol class="vstops" style="--c:${l.color}">${l.stations.map((k, i) => {
      const s = st[k], p = prog(s), other = s.lines.filter(x => x.id !== l.id);
      const isNext = n.started && n.key === k;
      return `<li class="vrow${s.lines.length > 1 ? " inter" : ""}${p.share === 1 ? " done" : ""}${openRow === k ? " open" : ""}${isNext ? " next" : ""}" data-key="${k}">
        <button class="vbtn" aria-expanded="${openRow === k}"><span class="vdot" style="--p:${p.share}"></span>
          <span class="vt">${i === 0 && entr ? `<span class="vstart">${esc(entr.label)}</span>` : ""}${isNext ? `<span class="vstart">Next stop</span>` : ""}<span class="vtitle">${esc(s.title)}</span>
          <span class="meta">${sizeText(s)}${p.read ? ` · ${p.read}/${p.total} read` : ""}</span></span></button>
        ${other.length ? `<div class="change meta">Change for ${other.map(o => `<button class="lchip" data-line="${o.id}" style="--c:${o.color}">${esc(o.short)}</button>`).join(" ")}</div>` : ""}
        ${openRow === k ? `<div class="vprev">${previewHTML(s, { inline: true })}</div>` : ""}
      </li>`;
    }).join("")}</ol>
    <p class="outcome vout" style="--c:${l.color}"><span class="ui">By the end</span> ${esc(l.outcome)}</p>`;
}
$("#phone").addEventListener("click", e => {
  const chip = e.target.closest(".chip, .lchip");
  if (chip) { phoneLine = chip.dataset.line; drawPhone(); $("#phone").scrollIntoView({ block: "start", behavior: "smooth" }); return; }
  const m = e.target.closest(".mark"); if (m) { toggleRead(m.dataset.key); return; }
  const r = e.target.closest(".vbtn");
  if (r) { const k = r.closest(".vrow").dataset.key; openRow = openRow === k ? null : k; drawPhone(); }
});

// ---------- the index ----------
const onMap = new Set(Object.values(st).flatMap(s => s.seqs.map(q => q.id)));
const topicOf = s => {
  const t = s.stats.topics[0]?.name;
  if (!t) return "Fiction & other";
  if (t === "AI") return "AI & alignment";
  if (t === "Rationality") return "Rationality";
  if (t === "World Modeling") return "World modeling";
  return "Practice & the world";
};
const row = s => `<a class="irow" href="${s.url}" target="_blank" rel="noopener">
    <span class="it">${esc(s.title.trim())}</span>
    <span class="ia meta">${esc(s.author.name || "")}${fmt.years(s) ? " · " + fmt.years(s) : ""}</span>
    <span class="in meta">${s.stats.posts} posts · ${hrs(s.stats.minutes)}${s.kind === "community" ? ` · <span title="median karma of its posts">▲${s.stats.karmaMedian}</span>` : ""}${s.stats.winners.length ? ` · <span class="winner-badge">${s.stats.winners.length}★</span>` : ""}</span></a>`;
const curatedLeft = lib.sequences.filter(s => s.kind === "curated" && !onMap.has(s.id) && !s.collection);
const community = lib.sequences.filter(s => s.kind === "community" && !onMap.has(s.id))
  .sort((a, b) => (b.stats.posts >= 3) - (a.stats.posts >= 3) || b.stats.karmaMedian - a.stats.karmaMedian);
let showAll = false;
function drawIndex() {
  const q = $("#q").value.trim().toLowerCase();
  const match = s => !q || [s.title, s.author.name, ...s.stats.topics.map(t => t.name), ...s.stats.tags.slice(0, 6).map(t => t.name)].join(" ").toLowerCase().includes(q);
  const groups = new Map();
  for (const s of curatedLeft.filter(match)) { const g = topicOf(s); groups.set(g, [...(groups.get(g) || []), s]); }
  $("#curated").innerHTML = [...groups].map(([g, xs]) => `<div class="igroup"><div class="ig meta">${g}</div>${xs.map(row).join("")}</div>`).join("") || `<p class="meta">Nothing matches.</p>`;
  const cm = community.filter(match), shown = showAll || q ? cm : cm.slice(0, 24);
  $("#community").innerHTML = shown.map(row).join("") || `<p class="meta">Nothing matches.</p>`;
  $("#more").hidden = !!q;
  $("#more").textContent = showAll ? "Show only the best 24" : `Show all ${community.length} community sequences`;
}
$("#q").addEventListener("input", drawIndex);
$("#more").addEventListener("click", () => { showAll = !showAll; drawIndex(); });
$("#collections").innerHTML = ["rationality", "codex", "bestoflesswrong"].map(slug => {
  const c = lib.core.find(c => c.collection === slug);
  const min = c.sequences.reduce((n, s) => n + s.stats.minutes, 0), posts = c.sequences.reduce((n, s) => n + s.stats.posts, 0);
  const note = { rationality: "All six books, as one collection (on the map as the Foundations line).", codex: "Essays by Scott Alexander on reasoning, science and designing the world.", bestoflesswrong: "The community's annual review winners, gathered into books by theme." }[slug];
  return `<a class="coll card" href="${c.url}" target="_blank" rel="noopener"><img src="${c.imageUrl}" alt="" loading="lazy" onerror="this.remove()"><span><b>${esc(c.title)}</b><span class="meta">${c.sequences.length} parts · ${posts} posts · ${hrs(min)}</span><span class="meta">${note}</span></span></a>`;
}).join("");

// ---------- demo progress ----------
const demoBtn = $("#demo");
const syncDemo = () => demoBtn.setAttribute("aria-pressed", String(!!JSON.parse(localStorage.getItem("library-prototypes:read") || "[]").length));
demoBtn.addEventListener("click", () => { demoBtn.getAttribute("aria-pressed") === "true" ? progress.clear() : progress.demo(lib); });
addEventListener("library-progress", () => {
  paintProgress(); drawLines(); drawPhone(); syncDemo();
  if (!pop.hidden && pinned) showPop(pinned, true);
});
$("#note .note-x").addEventListener("click", () => { $("#note").hidden = true; });

drawMap(); drawLines(); drawPhone(); drawIndex(); syncDemo();
addEventListener("resize", () => { if (!pop.hidden) showPop(pop.dataset.key, !!pinned); });
