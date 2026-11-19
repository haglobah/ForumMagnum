// The Library's data for the prototypes, normalized from data/library.json
// (a snapshot of lesswrong.com's public GraphQL, scripts/snapshot.ts).
//
//   import { loadLibrary, image, progress } from "../../shared/library.js";
//   const lib = await loadLibrary();
//
// lib.sequences: every sequence the Library shows (curated and community), each
//   { id, title, kind: "curated" | "community" | "book", collection (slug of the core
//     collection it belongs to, or null), author: {name, slug}, description,
//     url, gridImageId, bannerImageId, createdAt, curatedOrder,
//     chapters: [{ title, posts: [post] }], posts: [post] (all, in order),
//     stats: { posts, words, minutes, hours, firstYear, lastYear, karmaTotal,
//              karmaMedian, topPost, winners (review-winning posts in it),
//              topics: [{ name, share }] (core tags by share of posts, top first),
//              tags: [{ name, slug, count }] (all tags, most frequent first) } }
// post: { id, slug, title, url, karma, comments, words, minutes, postedAt, year,
//         author, winner: {year, category, ranking} | null, tags: [{name, slug, core}] }
//   (kind "book": a sequence that is only a book of a core collection, e.g. the
//   26 sequences of Rationality: A-Z; they are in lib.books, not lib.sequences)
// lib.books: those sequences
// lib.core: the five "Core Reading" entries as the page has them today
//   { title, subtitle, summary, imageUrl, url, collection, books: [{title, sequences}],
//     sequences: [sequence] (all of it, in reading order) }
// lib.collections: the collections with their books ({title, subtitle, sequenceIds})
// lib.reviewWinners: Best of LessWrong posts [post] with winner and art (splash art url)
// lib.topics: the core topics, most posts first
// lib.byId: Map id → sequence

const LW = "https://www.lesswrong.com";

export function image(id, { w = 600, h = 300, crop = "fill" } = {}) {
  if (!id) return null;
  return `https://res.cloudinary.com/lesswrong-2-0/image/upload/c_${crop},g_auto,dpr_2,w_${w},h_${h},q_auto,f_auto/${id}`;
}

function normPost(p) {
  const words = p.wordCount || 0;
  return {
    id: p._id, slug: p.slug, title: p.title,
    url: `${LW}/posts/${p._id}/${p.slug}`,
    karma: p.baseScore || 0, comments: p.commentCount || 0,
    words, minutes: p.readTimeMinutes || Math.max(1, Math.round(words / 250)),
    postedAt: p.postedAt, year: p.postedAt ? +p.postedAt.slice(0, 4) : null,
    author: p.user ? { name: p.user.displayName, slug: p.user.slug } : null,
    winner: p.reviewWinner ? { year: p.reviewWinner.reviewYear, category: p.reviewWinner.category, ranking: p.reviewWinner.reviewRanking } : null,
    art: p.reviewWinner?.reviewWinnerArt?.splashArtImageUrl || null,
    tags: (p.tags || []).filter(Boolean).map(t => ({ name: t.name, slug: t.slug, core: !!t.core })),
  };
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function normSequence(s, kind) {
  const chapters = (s.chapters || [])
    .slice().sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
    .map(c => ({ title: c.title, subtitle: c.subtitle, posts: (c.posts || []).filter(Boolean).map(normPost) }));
  const posts = chapters.flatMap(c => c.posts);
  const years = posts.map(p => p.year).filter(Boolean);
  const words = posts.reduce((n, p) => n + p.words, 0);
  const minutes = posts.reduce((n, p) => n + p.minutes, 0);
  const core = new Map(), tags = new Map();
  for (const p of posts) for (const t of p.tags) {
    if (t.core) core.set(t.name, (core.get(t.name) || 0) + 1);
    const e = tags.get(t.slug) || { name: t.name, slug: t.slug, count: 0 };
    e.count++; tags.set(t.slug, e);
  }
  return {
    id: s._id, title: s.title, kind,
    collection: s.canonicalCollectionSlug || null,
    author: { name: s.user?.displayName, slug: s.user?.slug },
    description: s.contents?.plaintextDescription || "",
    url: `${LW}/s/${s._id}`,
    gridImageId: s.gridImageId, bannerImageId: s.bannerImageId,
    createdAt: s.createdAt, curatedOrder: s.curatedOrder ?? null,
    chapters, posts,
    stats: {
      posts: posts.length, words, minutes, hours: Math.round(minutes / 6) / 10,
      firstYear: years.length ? Math.min(...years) : null,
      lastYear: years.length ? Math.max(...years) : null,
      karmaTotal: posts.reduce((n, p) => n + p.karma, 0),
      karmaMedian: median(posts.map(p => p.karma)),
      topPost: posts.reduce((a, p) => (!a || p.karma > a.karma ? p : a), null),
      winners: posts.filter(p => p.winner),
      topics: [...core].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, share: n / Math.max(1, posts.length) })),
      tags: [...tags.values()].sort((a, b) => b.count - a.count),
    },
  };
}

const coreReading = [
  { title: "Rationality: A-Z", subtitle: 'Also known as "The Sequences"', collection: "rationality", url: `${LW}/rationality`,
    summary: "How can we think better on purpose? Why should we think better on purpose? For two years Eliezer Yudkowsky wrote a blogpost a day, braindumping thoughts on rationality, ambition and artificial intelligence. Those posts were edited into this introductory collection, recommended reading for all LessWrong users.",
    imageUrl: "https://res.cloudinary.com/lesswrong-2-0/image/upload/v1657767459/mississippi-compass_gwqjvs.png" },
  { title: "The Sequences Highlights", collection: "highlights", url: `${LW}/highlights`,
    summary: "LessWrong can be kind of intimidating - there's a lot of concepts to learn. We recommend getting started with the Highlights, a collection of 50 top posts from Eliezer's Sequences. A day or two read, covering the foundations of rationality.",
    imageUrl: "https://res.cloudinary.com/lesswrong-2-0/image/upload/c_crop,g_custom/c_fill,dpr_auto,q_auto,f_auto,g_auto:faces,w_auto,h_280/sequences/rdl8pwokejuqyxipg6vx" },
  { title: "Harry Potter and the Methods of Rationality", collection: "hpmor", url: `${LW}/hpmor`,
    summary: "What if Harry Potter was a scientist? What would you do if the universe had magic in it? A story that conveys many rationality concepts, making them more visceral and emotionally compelling.",
    imageUrl: "https://res.cloudinary.com/lesswrong-2-0/image/upload/v1657774172/DALL_E_2022-07-13_21.49.04_-_11_year_old_wizard_boy_with_short_messy_black_hair_and_glasses_standing_upright_looking_intently_at_the_camera_casting_a_question_spell_glowing_wh_l1ls1k.png" },
  { title: "The Codex", collection: "codex", url: `${LW}/codex`,
    summary: "Essays by Scott Alexander exploring science, medicine, philosophy, futurism, and politics. (There's also one about hallucinatory cactus people but it's not representative).",
    imageUrl: "https://res.cloudinary.com/lesswrong-2-0/image/upload/v1657688283/codex_u7ptgt.png" },
  { title: "Best of LessWrong", collection: "bestoflesswrong", url: `${LW}/bestoflesswrong`,
    summary: "Each December, the LessWrong community reviews the best posts from the previous year, and votes on which ones have stood the tests of time.",
    imageUrl: "https://res.cloudinary.com/lesswrong-2-0/image/upload/v1657778273/DALL_E_2022-07-13_22.57.43_-_Books_and_emerald_compass_displayed_on_a_pedastal_aquarelle_painting_by_da_vinci_and_thomas_shaler_magic_the_gathering_concept_art_as_digital_art_ayufzo.png" },
];

let cached;
export function loadLibrary() {
  return cached ??= (async () => {
    const raw = await (await fetch(new URL("../data/library.json", import.meta.url))).json();
    const sequences = [
      ...raw.curated.map(s => normSequence(s, "curated")),
      ...raw.community.map(s => normSequence(s, "community")),
    ];
    const books = (raw.inCollections || []).map(s => normSequence(s, "book"));
    const byId = new Map([...sequences, ...books].map(s => [s.id, s]));
    const collections = raw.collections.map(c => ({
      id: c._id, slug: c.slug, title: c.title, url: `${LW}/${c.slug}`,
      books: (c.books || []).sort((a, b) => (a.number ?? 0) - (b.number ?? 0)).map(b => ({
        title: b.title, subtitle: b.subtitle,
        sequenceIds: (b.sequences || []).map(s => s._id),
      })),
    }));
    const topicCount = new Map();
    for (const s of sequences) for (const t of s.stats.topics) topicCount.set(t.name, (topicCount.get(t.name) || 0) + 1);
    return {
      fetchedAt: raw.fetchedAt,
      sequences, books, byId, collections,
      core: coreReading.map(c => {
        const col = collections.find(x => x.slug === c.collection);
        const parts = (col?.books || []).map(b => ({ title: b.title, sequences: b.sequenceIds.map(id => byId.get(id)).filter(Boolean) }));
        return { ...c, books: parts, sequences: parts.flatMap(b => b.sequences) };
      }),
      reviewWinners: raw.reviewWinners.map(normPost),
      topics: [...topicCount].sort((a, b) => b[1] - a[1]).map(([name]) => name),
    };
  })();
}

// Reading progress, simulated in localStorage (logged out, the API has none).
// progress.read(postId) / progress.isRead(postId) / progress.of(sequence) → {read, total, share}
// progress.demo(lib) marks a plausible reader's history; progress.clear().
const KEY = "library-prototypes:read";
const readSet = () => new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
export const progress = {
  isRead: id => readSet().has(id),
  read(id, on = true) {
    const s = readSet(); on ? s.add(id) : s.delete(id);
    localStorage.setItem(KEY, JSON.stringify([...s]));
    dispatchEvent(new Event("library-progress"));
  },
  of(seq) {
    const s = readSet();
    const read = seq.posts.filter(p => s.has(p.id)).length;
    return { read, total: seq.posts.length, share: seq.posts.length ? read / seq.posts.length : 0 };
  },
  demo(lib) {
    const pick = t => lib.sequences.find(s => s.title === t);
    const ids = [];
    const take = (t, n) => { const s = pick(t); if (s) ids.push(...s.posts.slice(0, n).map(p => p.id)); };
    take("Predictably Wrong", 12); take("Thinking Better on Purpose", 5); take("Embedded Agency", 3);
    take("Replacing Guilt", 9); take("Hammertime", 2);
    localStorage.setItem(KEY, JSON.stringify(ids));
    dispatchEvent(new Event("library-progress"));
  },
  clear() { localStorage.removeItem(KEY); dispatchEvent(new Event("library-progress")); },
};

export const fmt = {
  hours(min) { return min < 60 ? `${min} min` : `${Math.round(min / 6) / 10} h`; },
  words(n) { return n >= 1000 ? `${Math.round(n / 1000)}k words` : `${n} words`; },
  years(s) { const { firstYear: a, lastYear: b } = s.stats; return !a ? "" : a === b ? `${a}` : `${a}–${b}`; },
};
