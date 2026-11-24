// The explorable Atlas's model: every work the Library knows (sequences, core collections)
// and every post worth showing (Best of LessWrong, curated posts, all posts ≥ 25 karma)
// in one pool of items; the view picks some by source, groups, sorts and sizes them.
// Pure functions over the shared lib object and data/*.json.
import { image } from "../../shared/library.js";
import { topicOf as sequenceTopic } from "../09-atlas/atlas-data.js";

// The Best of LessWrong's six categories, in its order, with its art (lib/reviewWinnerSections.ts),
// and a seventh for what fits none of them.
const SECTION = "https://res.cloudinary.com/lesswrong-2-0/image/upload/f_auto,q_auto/";
export const TOPICS = [
  { key: "rationality", name: "Rationality", hue: "#4e7a4c", tag: "Rationality",
    art: SECTION + "v1708753260/ohabryka_Aquarelle_sketch_by_Thomas_W._Schaller_inspired_by_top_09275054-eb84-43c4-9cfa-4a05e1818c9e_rmov5i.png", crop: { x: .12, y: 0, w: .9 } },
  { key: "optimization", name: "Optimization", hue: "#6c5378", tag: "World Optimization",
    art: SECTION + "v1708753382/ohabryka_Aquarelle_sketch_by_Thomas_W._Schaller_inspired_by_top_242eda7f-95a9-4c3b-8090-991a1b11286f_xcjhxq.png", crop: { x: .1, y: .2, w: .99 } },
  { key: "modeling", name: "World", hue: "#8a6a38", tag: "World Modeling",
    art: SECTION + "v1708753450/ohabryka_Aquarelle_sketch_by_Thomas_W._Schaller_inspired_by_top_15ba02c3-b268-45f1-a780-322bbaa6fc22_eu9l0l.png", crop: { x: .05, y: 0, w: .78, flip: true } },
  { key: "practical", name: "Practical", hue: "#a05a3c", tag: "Practical",
    art: SECTION + "v1708974564/ohabryka_Aquarelle_sketch_by_Thomas_W._Schaller_inspired_by_top_4f6449e2-569b-48a3-b878-a400315b3ef0_hqutxe.png", crop: { x: .2, y: .05, w: .651 } },
  { key: "ai strategy", name: "AI Strategy", hue: "#4a7a7c", tag: "AI",
    art: SECTION + "v1708753570/ohabryka_Aquarelle_sketch_by_Thomas_W._Schaller_inspired_by_top_8dda30ee-71d6-4b24-80c7-a8499a5b25c6_uacvgk.png", crop: { x: 0, y: 0, w: .99 } },
  { key: "ai safety", name: "Technical AI Safety", hue: "#3d5a75", tag: "AI",
    art: "https://res.cloudinary.com/lesswrong-2-0/image/upload/f_auto,fl_progressive,q_auto/v1708570131/lwbot_topographic_watercolor_artwork_of_a_giant_robot_hand_gent_e4e9f305-9611-4787-8768-d7af3d702ed4_ta2ii9.png", crop: { x: .2, y: .3, w: .8 } },
  { key: "other", name: "Fiction & Community", hue: "#93566a", tag: null, art: null },
];
export const topicByKey = Object.fromEntries(TOPICS.map(t => [t.key, t]));

// The yearly section's art (reviewWinnerYearGroupsInfo), for year groups that have one.
export const YEAR_ART = {
  2018: [SECTION + "v1709008323/ruby37_green_on_white_aquarelle_sketch_by_thomas_schaller_of_ri_7a3fa89a-ac7a-466f-929f-b396cb4d9bd5_p8rh9t.png", { x: .01, y: .1, w: .99 }],
  2019: [SECTION + "v1709008331/ruby37_blue_on_white_aquarelle_sketch_by_thomas_schaller_of_gre_f421cc99-2bb5-4357-b164-d05c2f4fe84e_aib1co.png", { x: .01, y: .1, w: .99 }],
  2020: [SECTION + "v1709008346/ruby37_aquarelle_sketch_of_futuristic_landscape_by_thomas_schal_f07d5805-9fb0-4dcc-9295-7f063624e28c_slcokh.png", { x: .01, y: .01, w: .99 }],
  2021: ["https://res.cloudinary.com/lesswrong-2-0/image/upload/a_270/q_auto,f_auto/ohabryka_Topographic_aquarelle_book_cover_by_Thomas_W._Schaller_f9c9dbbe-4880-4f12-8ebb-b8f0b900abc1_m4k6dy_734413", { x: .01, y: .1, w: .8 }],
  2022: [SECTION + "v1709008351/ruby37_aquarelle_sketch_of_a_woman_focusing_hard_studying_in_an_2ac568ef-408e-4561-acc8-84c76bb42fba_gwt8uq.png", { x: 0, y: .1, w: .99 }],
};

// A Cloudinary crop of an art image, as the Best of LessWrong page cuts its book grids.
export function cropArt(url, crop, width = 1200) {
  if (!url) return null;
  if (!crop) return url.replace("upload/", `upload/w_${width}/`);
  const c = n => Math.min(1, Math.max(0, n)).toFixed(3);
  return url.replace("upload/", `upload/c_crop,w_${c(crop.w)},x_${c(crop.x)},y_${c(crop.y)},h_1/${crop.flip ? "a_hflip/" : ""}w_${width}/`);
}
// A winner's own art, cut like the first book of a row on the Best of LessWrong page.
export function winnerArt(w, width = 900) {
  if (!w?.url) return null;
  const k = w.coords;
  return cropArt(w.url, k ? { x: k.leftXPct, y: k.leftYPct, w: 3 * k.leftWidthPct, flip: k.leftFlipped } : null, width)
    .replace("f_auto,q_auto", "f_auto,q_auto:eco");
}

// Where the sources come from.
export const SOURCES = [
  { key: "curatedSeq", name: "Curated sequences", group: "Sequences" },
  { key: "communitySeq", name: "Community sequences", group: "Sequences" },
  { key: "core", name: "Core collections", group: "Sequences" },
  { key: "bolw", name: "Best of LessWrong", group: "Posts" },
  { key: "curatedPosts", name: "Curated posts", group: "Posts" },
  { key: "everything", name: "Everything", group: "Posts", note: "all posts with 25+ karma, loads 6 MB" },
];

// ---------- topics of single posts ----------
const STRATEGY = /timelines|governance|takeoff|forecast|existential risk|threat model|risk concrete|coordination|compute|transformative|effective altruism|futurism|slowing down|success model|dealmaking|economic|fieldbuilding|regulation|rights|welfare|self-improvement|explosion|open source ai|politic|arms race|moratorium|public materials|negotiation|government|policy|capabilities|emulation|pivotal|multipolar|persuasion|automation|ai risk/i;
const CORE = { "Rationality": "rationality", "World Modeling": "modeling", "World Optimization": "optimization", "Practical": "practical", "Community": "other", "Site Meta": "other" };
export function postTopic(tagNames, winner) {
  if (winner?.category) return winner.category;
  if (tagNames.some(t => /^Fiction/.test(t))) return "other";
  const core = tagNames.find(t => t === "AI" || CORE[t]);
  if (core === "AI" || (!core && tagNames.some(t => /\bAI\b|alignment|interpretab|language model|machine learning/i.test(t)))) {
    return tagNames.some(t => t !== "AI" && STRATEGY.test(t)) ? "ai strategy" : "ai safety";
  }
  if (core) return CORE[core];
  return "modeling";
}
const SEQ_TOPIC = { "ai-align": "ai safety", "ai-strat": "ai strategy", "rationality": "rationality", "world-modeling": "modeling",
  "practical": "practical", "world-opt": "optimization", "community": "other", "fiction": "other" };

const median = xs => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// ---------- the pool ----------
// item: { id, kind: "post" | "sequence" | "collection", title, url, author, minutes, karma (for area),
//   score (karma, or a work's median post karma), date, year, topic, sources: Set, img (url or null),
//   winner { year, category, ranking, order, art } | null, curatedAt, children (works: chapter/post nodes) }
export function buildPool(lib, art, posts) {
  const items = new Map();
  const winnerOf = id => { const w = art.winners[id]; return w ? { year: w.year, category: w.category, ranking: w.ranking, order: w.curatedOrder ?? Infinity, art: winnerArt(w), artFull: w.url } : null; };

  const postItem = (p, tagNames, sources) => {
    const id = "p:" + p.id, have = items.get(id);
    if (have) { sources.forEach(s => have.sources.add(s)); return have; }
    const winner = winnerOf(p.id);
    const it = { id, kind: "post", postId: p.id, title: p.title, url: p.url, author: p.author, minutes: Math.max(1, p.minutes || 1),
      karma: Math.max(1, p.karma), score: p.karma, date: p.postedAt, year: p.postedAt ? +p.postedAt.slice(0, 4) : null,
      topic: postTopic(tagNames, winner), winner, curatedAt: p.curatedAt || null, tags: tagNames, sources: new Set(sources),
      img: winner?.art || null };
    if (winner) it.sources.add("bolw");
    if (it.curatedAt) it.sources.add("curatedPosts");
    items.set(id, it);
    return it;
  };

  // Posts: the review winners always (they're small), all posts when loaded.
  for (const p of lib.reviewWinners) postItem(p, p.tags.map(t => t.name), ["bolw"]);
  if (posts) {
    const name = id => posts.tags[id]?.name;
    for (const p of posts.posts) {
      const url = `https://www.lesswrong.com/posts/${p.id}/${p.slug}`;
      const it = postItem({ ...p, url }, p.tags.map(name).filter(Boolean), ["everything"]);
      it.sources.add("everything");
      if (p.curatedAt) { it.curatedAt = p.curatedAt; it.sources.add("curatedPosts"); }
    }
  }

  // Works: curated and community sequences, and the core collections as single works.
  const workNode = (id, title, topic, chapters) => {
    let i = 0;
    const post = p => ({ id: `${id}/p:${p.id}:${i++}`, kind: "post", title: p.title, url: p.url, postId: p.id, author: p.author,
      minutes: Math.max(1, p.minutes), karma: Math.max(1, p.karma), score: p.karma, date: p.postedAt, year: p.year, topic,
      winner: winnerOf(p.id), img: winnerOf(p.id)?.art || null });
    const kids = chapters.filter(c => c.posts.length);
    if (kids.length > 1 || kids[0]?.title)
      return kids.map((c, ci) => ({ id: `${id}/c:${ci}`, kind: "chapter", title: c.title || `Part ${ci + 1}`, topic, children: c.posts.map(post) }));
    return (kids[0]?.posts || []).map(post);
  };
  const work = (id, kind, title, url, author, topic, img, chapters, sources, extra = {}) => {
    const children = workNode(id, title, topic, chapters);
    const leaves = flatPosts(children);
    const years = leaves.map(p => p.year).filter(Boolean);
    const dates = leaves.map(p => p.date).filter(Boolean).sort();
    items.set(id, { id, kind, title, url, author, topic, img, children, sources: new Set(sources),
      minutes: leaves.reduce((a, p) => a + p.minutes, 0), karma: leaves.reduce((a, p) => a + p.karma, 0),
      score: median(leaves.map(p => p.score)), date: dates[0] || null, lastDate: dates.at(-1) || null,
      year: years.length ? Math.min(...years) : null, lastYear: years.length ? Math.max(...years) : null,
      posts: leaves.length, winners: leaves.filter(p => p.winner).length, winner: null, ...extra });
  };
  const SHOWN = { rationality: "rationality", hpmor: "other", codex: "modeling" };
  for (const c of lib.core) {
    if (!SHOWN[c.collection]) continue;
    // A collection's books become its chapters, each book's sequences its posts' groups.
    const chapters = c.books.map(b => ({ title: b.title, posts: b.sequences.flatMap(s => s.posts) }));
    work("col:" + c.collection, "collection", c.title, c.url, c.sequences[0]?.author, SHOWN[c.collection], c.imageUrl, chapters, ["core"],
      { description: c.summary });
  }
  for (const s of lib.sequences) {
    if (!s.posts.length || (s.collection && (SHOWN[s.collection] || s.collection === "highlights"))) continue;
    work("s:" + s.id, "sequence", s.title, s.url, s.author, SEQ_TOPIC[sequenceTopic(s)] || "other",
      s.gridImageId ? image(s.gridImageId, { w: 600, h: 380 }) : null, s.chapters, [s.kind === "curated" ? "curatedSeq" : "communitySeq"],
      { description: s.description, banner: s.bannerImageId ? image(s.bannerImageId, { w: 1200, h: 500 }) : null });
  }
  return items;
}
export const flatPosts = ns => ns.flatMap(n => n.children ? flatPosts(n.children) : [n]);

// ---------- the view: pick, group, sort ----------
export const GROUPS = {
  topic: { label: "Topic" }, year: { label: "Year" }, author: { label: "Author" }, kind: { label: "Kind" }, none: { label: "None" },
};
export const SORTS = {
  size: { label: "Size" }, karma: { label: "Karma" }, newest: { label: "Newest" }, oldest: { label: "Oldest" }, rank: { label: "Review rank" },
};
export const AREAS = {
  time: { label: "Reading time", of: it => it.minutes },
  karma: { label: "Karma", of: it => Math.max(1, it.karma) },
  equal: { label: "Equal", of: () => 1 },
};

export function select(items, { sources, query }) {
  const q = query?.trim().toLowerCase();
  const out = [];
  for (const it of items.values()) {
    let on = false; for (const s of it.sources) if (sources.has(s)) { on = true; break; }
    if (!on) continue;
    if (q && !(it.title.toLowerCase().includes(q) || it.author?.name?.toLowerCase().includes(q))) continue;
    out.push(it);
  }
  return out;
}

const time = d => d ? Date.parse(d) : 0;
export function comparator(sort, area) {
  const v = AREAS[area].of;
  return {
    size: (a, b) => v(b) - v(a) || b.score - a.score,
    karma: (a, b) => b.score - a.score,
    newest: (a, b) => time(b.lastDate || b.date) - time(a.lastDate || a.date),
    oldest: (a, b) => time(a.date) - time(b.date),
    rank: (a, b) => (a.winner?.order ?? Infinity) - (b.winner?.order ?? Infinity) || (a.winner?.ranking ?? 1e9) - (b.winner?.ranking ?? 1e9) || b.score - a.score,
  }[sort];
}

const KIND_GROUPS = [["bolw", "Best of LessWrong"], ["curatedPosts", "Curated posts"], ["everything", "Other posts"],
  ["core", "Core collections"], ["curatedSeq", "Curated sequences"], ["communitySeq", "Community sequences"]];

// Group the picked items: [{ key, name, hue, art, items }], in the order the grouping wants.
export function group(picked, by, sort, sources, area) {
  const groups = new Map();
  const put = (key, name, extra) => { if (!groups.has(key)) groups.set(key, { key, name, items: [], ...extra }); return groups.get(key); };
  if (by === "topic") {
    for (const t of TOPICS) put("t:" + t.key, t.name, { hue: t.hue, art: cropArt(t.art, t.crop), topic: t.key });
    for (const it of picked) groups.get("t:" + it.topic).items.push(it);
  } else if (by === "year") {
    // Review winners sit in their review year, as on the Best of LessWrong page.
    for (const it of picked) {
      const y = (it.winner && sources.has("bolw") && !sources.has("everything") ? it.winner.year : it.year) ?? "Undated";
      const a = YEAR_ART[y];
      put("y:" + y, String(y), { year: y, hue: "#5f7f6a", art: a ? cropArt(a[0], a[1]) : null }).items.push(it);
    }
  } else if (by === "author") {
    for (const it of picked) { const n = it.author?.name || "Unknown"; put("a:" + n, n, { hue: "#6b6257" }).items.push(it); }
  } else if (by === "kind") {
    for (const [k, name] of KIND_GROUPS) put("k:" + k, name, { hue: "#5f6f7f" });
    for (const it of picked) {
      const k = KIND_GROUPS.find(([k]) => it.sources.has(k) && sources.has(k))?.[0] || "everything";
      groups.get("k:" + k).items.push(it);
    }
  } else put("all", "Everything selected", { hue: "#5f7f6a" }).items.push(...picked);

  const cmp = comparator(sort, area);
  let out = [...groups.values()].filter(g => g.items.length);
  for (const g of out) g.items.sort(cmp);
  if (by === "year") out.sort((a, b) => sort === "newest" ? (b.year > a.year ? 1 : -1) : (a.year > b.year ? 1 : -1));
  if (by === "author") {
    out.sort((a, b) => b.items.length - a.items.length);
    if (out.length > 23) { // the long tail of authors in one group
      const rest = out.splice(23); const o = { key: "a:*", name: `${rest.length} more authors`, hue: "#8a8275", items: rest.flatMap(g => g.items).sort(cmp) };
      out.push(o);
    }
  }
  return out;
}
