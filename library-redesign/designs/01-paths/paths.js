// The editorial layer of "01 · Reading Paths": which stations exist, where they sit on
// the map (grid units; lines are routed octilinearly between them), and the lines.
// A station is one sequence (seq), one book of a core collection (book: [collection, n])
// or a whole core collection (core). Text here is editorial; numbers come from the data.

export const STATIONS = {
  highlights: { core: "highlights", onlyBook: 0, x: 1, y: 4.4, side: "n",
    blurb: "Fifty of the best posts from Eliezer Yudkowsky's Sequences, in six short parts: how to think better on purpose, the pitfalls of human cognition, the laws governing belief, and why we fight. A day or two of reading." },
  mt: { book: ["rationality", 0], x: 3, y: 4.4, side: "n", title: "Map and Territory",
    blurb: "Book I of Rationality: A-Z. What rationality is, why biases matter, and why beliefs should pay rent in anticipated experience." },
  hacym: { book: ["rationality", 1], x: 5, y: 4.4, side: "n", title: "How to Actually Change Your Mind",
    blurb: "Book II. Motivated reasoning, rationalization, politics as the mind-killer, and the hard part: actually updating when you're wrong." },
  mitg: { book: ["rationality", 2], x: 7, y: 4.4, side: "n", title: "The Machine in the Ghost",
    blurb: "Book III. Minds as physical processes: evolution as an alien optimizer, the fragility of goals, and how words carve up reality." },
  mereReality: { book: ["rationality", 3], x: 9, y: 4.4, side: "n", title: "Mere Reality",
    blurb: "Book IV. Reductionism, joy in the merely real, and quantum mechanics as a case study in getting science right." },
  mereGoodness: { book: ["rationality", 4], x: 11, y: 4.4, side: "n", title: "Mere Goodness",
    blurb: "Book V. What we value and why: fake preferences, value theory without mysticism, and humanism with numbers." },
  becomingStronger: { book: ["rationality", 5], x: 13, y: 4.4, side: "n", title: "Becoming Stronger",
    blurb: "Book VI. Eliezer's account of his own mistakes, how to attempt the difficult, and what it would take to build a community of rationalists." },

  hammertime: { seq: "qRxTKm7DAftSuTGvj", x: 2.2, y: 7.4, side: "s" },
  cfar: { seq: "KAv8z6oJCTxjR8vdR", x: 4.2, y: 7.4, side: "s" },
  babble: { seq: "pC6DYFLPMTCbEwH8W", x: 6.2, y: 7.4, side: "s" },
  luminous: { seq: "ynMFrq9K5iNMfSZNg", x: 8.2, y: 7.4, side: "s" },
  multiagent: { seq: "ZbmRyDN8TCpBTZSip", x: 10.2, y: 7.4, side: "s" },
  guilt: { seq: "pFatcKW3JJhTSxqAF", x: 12.2, y: 7.4, side: "s" },
  slack: { seq: "HXkpm9b8o964jbQ89", x: 14.4, y: 7.4, side: "s" },

  politics: { seq: "ZnSMHcWjRx6yT4H92", x: 6, y: 5.4, side: "s" },
  gameTheory: { seq: "ZNNi2uNx9E6iwGKKG", x: 8, y: 5.4, side: "s" },
  inadequate: { seq: "oLGCcbnvabyibnG9d", x: 10, y: 5.4, side: "s" },
  gears: { seq: "xEFeCwk3pdYdeG2rL", x: 12, y: 5.4, side: "s",
    blurb: "John Wentworth on gears-level models of the economy and technology: how constraints, not behaviours, shape what changes." },
  mazes: { seq: "kNANcHLNtJt5qeuSS", x: 14.4, y: 5.4, side: "e",
    blurb: "Zvi on what happens to people in organisations with many layers of middle management, why Moloch hasn't won, and how to stay out of the maze." },

  mic: { seq: "yYxggfHYRrqnJXuRx", x: 1, y: 1, side: "n" },
  agisfp: { seq: "mzgtmmTKKn5MuCzFJ", x: 3, y: 1, side: "n" },
  rlo: { seq: "r9tYkB2a8Fp4DN8yB", x: 5, y: 1, side: "n" },
  miri21: { seq: "n945eovrA3oDueqtq", x: 7, y: 1, side: "n" },
  miri22: { seq: "v55BhXbpJuaExkpcD", x: 9, y: 1, side: "n" },
  otherness: { seq: "BbAvHtorCZqp97X9W", x: 11, y: 1, side: "n" },

  valueLearning: { seq: "4dHMdK5TLN6xcqtyc", x: 6.2, y: 2.2, side: "s" },
  amplification: { seq: "EmDuGeRw749sD3GKd", x: 8.2, y: 2.2, side: "s" },
  predictive: { seq: "n3utvGrgC2SGi9xQX", x: 10.2, y: 2.2, side: "s" },
  embedded: { seq: "Rm6oQRJJmhGCcLvxh", x: 12.2, y: 2.2, side: "s" },
  cartesian: { seq: "2A7rrZ4ySx6R8mfoT", x: 14.2, y: 2.2, side: "s" },
  infrabayes: { seq: "CmrW8fCmSLK7E25sa", x: 15.4, y: 1, side: "n" },

  hpmor: { core: "hpmor", x: 1, y: 9.8, side: "s", title: "Harry Potter and the Methods of Rationality",
    blurb: "What if Harry Potter were a scientist? Six books, 122 chapters: the Sequences' ideas made visceral, in the most-read rationalist fiction there is." },
  twc: { seq: "qWoFR4ytMpQ5vw3FT", x: 4, y: 9.8, side: "s" },
  luna: { seq: "TF77XsD5PbucbJsG3", x: 6, y: 9.8, side: "s",
    blurb: "lsusr's short, strange HPMOR-universe stories about Luna Lovegood, who notices the things nobody else is looking at." },
  funTheory: { seq: "d3WgHDBAPYYScp5Em", x: 8, y: 9.8, side: "s" },
  stories: { seq: "dDMzozPbe4aJRkfTr", x: 10, y: 9.8, side: "s" },
};

export const LINES = [
  { id: "foundations", name: "Foundations of Rationality", short: "Foundations", color: "#3f8a4a",
    stations: ["highlights", "mt", "hacym", "mitg", "mereReality", "mereGoodness", "becomingStronger"],
    tagline: "The Sequences: the Highlights first, then all six books of Rationality: A-Z.",
    outcome: "You'll share LessWrong's working vocabulary (map and territory, belief in belief, noticing confusion) and have the habit of asking what you'd expect to see if you were wrong." },
  { id: "practical", name: "Practical Rationality", short: "Practical", color: "#d07a24",
    stations: ["highlights", "hammertime", "cfar", "babble", "luminous", "multiagent", "guilt", "slack"],
    tagline: "Techniques to try on yourself this week, then the slower work of motivation and rest.",
    outcome: "You'll have a toolkit you've actually used (goal factoring, TAPs, focusing, double crux) and a model of your own motivation that doesn't run on guilt." },
  { id: "society", name: "Society & Coordination", short: "Society", color: "#1f8a8c",
    stations: ["hacym", "politics", "gameTheory", "inadequate", "gears", "mazes", "slack"],
    tagline: "Why civilization leaves money on the sidewalk, and what incentives do to the people inside institutions.",
    outcome: "You'll be able to tell when to trust the experts and when an inadequate equilibrium means you might beat them, and you'll recognise Moloch, mazes and the value of slack." },
  { id: "airisk", name: "Understanding AI Risk", short: "AI risk", color: "#c0392b",
    stations: ["mic", "agisfp", "rlo", "miri21", "miri22", "otherness"],
    tagline: "The case that advanced AI may be this century's defining event, and why it could go badly.",
    outcome: "You'll be able to state the argument for AI risk in your own words, along with its strongest disagreements, as argued by the people who hold them." },
  { id: "alignment", name: "The Alignment Frontier", short: "Alignment", color: "#2c67b0",
    stations: ["rlo", "valueLearning", "amplification", "predictive", "embedded", "cartesian", "infrabayes"],
    tagline: "Research agendas, from inner alignment and amplification to the mathematics of embedded agents.",
    outcome: "You'll know the main agendas well enough to read current alignment research and have your own view on which bets look promising." },
  { id: "stories", name: "Stories", short: "Stories", color: "#8a5aa8",
    stations: ["hpmor", "twc", "luna", "funTheory", "stories"],
    tagline: "Rationality as fiction: a scientist Harry Potter, first contact, and what a good future would feel like.",
    outcome: "You'll have felt the ideas rather than only read them, and met many of the Sequences' concepts in a form that sticks." },
];

// Entrances: where a newcomer may begin, drawn as callouts on the map.
export const ENTRANCES = [
  { station: "highlights", label: "Start here", sub: "new to LessWrong", main: true },
  { station: "mic", label: "Start here", sub: "for AI" },
  { station: "hpmor", label: "Or start here", sub: "prefer fiction" },
];
