// The Atlas's model: the Library as one tree, topic → work → (book →) sequence → (chapter →) post.
// Pure functions over the shared lib object, so it can be tested outside the page.

export const TOPICS = [
  { key: "ai-align", name: "AI alignment research", hue: "#3d5a75",
    blurb: "Technical work on getting AI systems to do what we want: agent foundations, interpretability, inner and outer alignment, and the research agendas built on them." },
  { key: "ai-strat", name: "AI strategy & forecasting", hue: "#4a7a7c",
    blurb: "When transformative AI arrives, how fast it takes off, what could go wrong, and what labs, governments and the rest of us might do about it." },
  { key: "rationality", name: "Rationality", hue: "#4e7a4c",
    blurb: "The art of thinking clearly: noticing bias, updating on evidence, and the habits that help you believe true things and act on them." },
  { key: "world-modeling", name: "World modeling", hue: "#8a6a38",
    blurb: "How the world actually works: mathematics, science, economics, history and philosophy, and the models that tie them together." },
  { key: "practical", name: "Practical", hue: "#a05a3c",
    blurb: "Advice you can use this week: productivity, health, emotional skills, communication and getting things done." },
  { key: "world-opt", name: "World optimization", hue: "#6c5378",
    blurb: "Doing the most good: effective altruism, institutions, coordination problems and civilisational strategy." },
  { key: "community", name: "Community", hue: "#80675a",
    blurb: "LessWrong and the rationalist community itself: its history, norms, meetups and culture." },
  { key: "fiction", name: "Fiction", hue: "#93566a",
    blurb: "Stories that make the ideas visceral: Harry Potter and the Methods of Rationality, parables, short fiction and dialogues." },
];
export const topicByKey = Object.fromEntries(TOPICS.map(t => [t.key, t]));

const CORE_TO_TOPIC = { "Rationality": "rationality", "World Modeling": "world-modeling", "Practical": "practical",
  "World Optimization": "world-opt", "Community": "community", "Site Meta": "community" };

// Tags that mark a post as about AI strategy rather than alignment research.
const STRATEGY = new Set(["AI Timelines", "AI Governance", "AI Takeoff", "Forecasting & Prediction",
  "Technological Forecasting", "Existential risk", "Threat Models (AI)", "AI Risk Concrete Stories",
  "Coordination / Cooperation", "Law and Legal systems", "Compute", "Moore's Law", "Transformative AI",
  "Effective altruism", "Futurism", "History", "Slowing Down AI", "AI Success Models", "Dealmaking (AI)",
  "Economics", "Economic Consequences of AGI", "AI Alignment Fieldbuilding", "Regulation and AI Risk",
  "AI Rights / Welfare", "Recursive Self-Improvement", "Intelligence explosion", "Open Source AI", "Politics",
  "AI Arms Race", "Moratorium", "AI Safety Public Materials", "Negotiation",
  "Intellectual Progress (Society-Level)", "Government", "Policy", "AI Capabilities",
  "Whole Brain Emulation", "Biology", "Pivotal Acts", "Multipolar Scenarios", "AI Persuasion", "Automation"]);
const NEUTRAL = new Set(["AI", "AI Risk", "Superintelligence", "Scaling Laws", "Newsletters", "Fiction", "Fiction (Topic)", "Community", "Humor", "Poetry", "Art",
  "Music", "Narratives (stories)", "Rationality", "World Modeling", "World Optimization", "Practical", "Site Meta",
  "Language Models (LLMs)", "GPT", "ChatGPT", "OpenAI", "Anthropic (org)", "DeepMind", "Redwood Research",
  "MATS Program", "AI Safety Camp", "Refine", "Aether", "Interviews", "Podcasts", "Book Reviews / Media Reviews",
  "Distillation & Pedagogy", "Exercises / Problem-Sets"]);

// Sequences with no core tag at all: their most frequent tags say where they live.
const FALLBACK = [
  [/decision theory|acausal|anthropic|counterfactual|logic|math|philosoph|programming|space|astronomy|game theory|probability|sleeping beauty/i, "world-modeling"],
  [/machine learning|ai oversight|alignment|value learning|phenomenolog|consciousness|ontology/i, "ai-align"],
  [/covid|government|vaccin|policy/i, "world-opt"],
  [/rationaliz|heuristics|bias|priming|metaethic|ethics|moral|murphyjitsu|technique/i, "rationality"],
  [/fiction|humor/i, "fiction"],
];

export function topicOf(seq) {
  const posts = seq.posts;
  const fiction = posts.filter(p => p.tags.some(t => /^Fiction/.test(t.name))).length;
  if (posts.length && fiction / posts.length >= .5) return "fiction";
  const core = seq.stats.topics[0]?.name;
  if (core === "AI") {
    let s = 0, t = 0;
    for (const p of posts) {
      if (p.tags.some(x => STRATEGY.has(x.name))) s++;
      if (p.tags.some(x => !STRATEGY.has(x.name) && !NEUTRAL.has(x.name) && !x.core)) t++;
    }
    return s > t && s > 0 ? "ai-strat" : "ai-align";
  }
  if (core && CORE_TO_TOPIC[core]) return CORE_TO_TOPIC[core];
  const tagText = seq.stats.tags.slice(0, 4).map(t => t.name).join(" ") + " " + seq.title;
  for (const [re, k] of FALLBACK) if (re.test(tagText)) return k;
  return "world-modeling";
}

// The core collections shown as works of their own. The Highlights are a selection from
// Rationality: A-Z and Best of LessWrong is a ranking of single posts, so neither is a work here.
const COLLECTION_TOPIC = { rationality: "rationality", hpmor: "fiction", codex: "world-modeling" };

export const median = xs => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

function seqNode(seq, idPrefix, topic) {
  const id = `${idPrefix}s:${seq.id}`;
  const chapters = seq.chapters.filter(c => c.posts.length);
  const postNode = (p, i) => ({ id: `${id}/p:${p.id}:${i}`, kind: "post", name: p.title, post: p, topic, seq });
  let children;
  if (chapters.length > 1 || (chapters.length === 1 && chapters[0].title)) {
    let i = 0;
    children = chapters.map((c, ci) => ({ id: `${id}/c:${ci}`, kind: "chapter", name: c.title || `Part ${ci + 1}`, subtitle: c.subtitle,
      topic, seq, children: c.posts.map(p => postNode(p, i++)) }));
  } else children = (chapters[0]?.posts || []).map(postNode);
  return { id, kind: "sequence", name: seq.title, seq, topic, img: seq.gridImageId, children };
}

export function buildTree(lib, { scope = "core" } = {}) {
  const works = [];
  const inShownCollection = new Set(["rationality", "hpmor", "codex", "highlights"]);
  for (const c of lib.core) {
    const topic = COLLECTION_TOPIC[c.collection];
    if (!topic) continue;
    const id = `col:${c.collection}`;
    const books = c.books.map((b, bi) => ({ id: `${id}/b:${bi}`, kind: "book", name: b.title, topic, collection: c,
      children: b.sequences.map(s => seqNode(s, `${id}/b:${bi}/`, topic)) }));
    // A collection of one book (HPMOR has six, the Codex several) still reads best by book.
    works.push({ id, kind: "collection", name: c.title, collection: c, topic, imgUrl: c.imageUrl, children: books });
  }
  for (const s of lib.sequences) {
    if (!s.posts.length) continue;
    if (s.collection && inShownCollection.has(s.collection)) continue; // already inside its collection
    if (scope === "core" && s.kind !== "curated") continue;
    const topic = topicOf(s);
    works.push(seqNode(s, "", topic));
  }
  const topics = TOPICS.map(t => ({ id: `t:${t.key}`, kind: "topic", name: t.name, topic: t.key, meta: t,
    children: works.filter(w => w.topic === t.key) })).filter(t => t.children.length);
  const root = { id: "root", kind: "root", name: "The Library", children: topics };
  annotate(root, null, 0);
  return root;
}

function annotate(n, parent, depth) {
  n.parent = parent; n.depth = depth;
  if (n.children) {
    for (const c of n.children) annotate(c, n, depth + 1);
    n.posts = n.children.flatMap(c => c.posts);
  } else n.posts = [n.post];
  n.minutes = n.posts.reduce((a, p) => a + p.minutes, 0);
  n.karma = n.posts.reduce((a, p) => a + Math.max(0, p.karma), 0);
  n.karmaMedian = median(n.posts.map(p => p.karma));
  n.winners = n.posts.filter(p => p.winner);
  const ys = n.posts.map(p => p.year).filter(Boolean);
  n.firstYear = ys.length ? Math.min(...ys) : null; n.lastYear = ys.length ? Math.max(...ys) : null;
}

export const METRICS = {
  time: { label: "Reading time", of: n => n.minutes },
  posts: { label: "Posts", of: n => n.posts.length },
  karma: { label: "Karma", of: n => n.karma },
};

export function index(root) {
  const m = new Map();
  (function walk(n) { m.set(n.id, n); n.children?.forEach(walk); })(root);
  return m;
}
