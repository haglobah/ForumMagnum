// Prefetch the opening paragraphs of each sequence's strongest post from
// lesswrong.com's GraphQL (the browser can't: CORS allows only the EA Forum).
//   bun designs/07-tasting/fetch-excerpts.ts
import { readFileSync, writeFileSync } from "fs";
import { candidates } from "./pick.js";

const here = new URL(".", import.meta.url).pathname;
const raw = JSON.parse(readFileSync(here + "../../data/library.json", "utf8"));
// minimal normalization (same fields pick.js uses)
const norm = (s: any) => ({ title: s.title, posts: (s.chapters || []).flatMap((c: any) => (c.posts || []).filter(Boolean)).map((p: any) => ({ id: p._id, title: p.title, karma: p.baseScore || 0, winner: p.reviewWinner })) });
const ids = new Set<string>();
for (const s of [...raw.curated, ...raw.community]) for (const p of candidates(norm(s), 3)) ids.add(p.id);
console.log(ids.size, "posts");

const decode = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const BOILER = /^(\(|\[|reply to|part of|parts? \d|follow-?up to|related to|related:|previously|prerequisites?:|disclaimer|thanks to|acknowledg|this is (the|a|my|part) (first|second|third|\w+ part|post|sequence|cross)|this post (is|was)|cross-?posted|epistemic|tl;?dr|note:|content warning|summary:|edit:|update:|written|co-?authored|audio|podcast|previous post|next post|see also|sequence:|this is part|warning|spoilers?|executive summary|abstract:)/i;
function paragraphs(html: string) {
  const all: string[] = [];
  for (const m of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const t = decode(m[1].replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (t.length >= 40) all.push(t);
  }
  let i = 0;
  const META = /(cross-?post|contributed|helped (develop|with)|developed by|thanks to|in this (series|sequence)|part of (a|the|my) (series|sequence)|this (series|sequence)|participants include|widely considered|podcast|audio version|text-based version|blog here|first (post|part|in a series)|\bsequence\b.*\bpost\b|overview of)/i;
  const CONNECT = /^(having said that|that said|however|but |also|so,|anyway|--|—|-)/i;
  const skip = (t: string) => BOILER.test(t) || /contributed equally|equal contribution|image source|\(source/i.test(t) || CONNECT.test(t) || (t.length < 400 && META.test(t));
  while (i < all.length && i < 5 && skip(all[i])) i++;   // skip the preamble, not the post   // skip the preamble, not the post
  const out: string[] = []; let total = 0;
  for (const t of all.slice(i)) {
    out.push(t); total += t.length;
    if (total > 700 || out.length >= 3) break;
  }
  return out;
}

const all = [...ids], out: Record<string, string[]> = {};
for (let i = 0; i < all.length; i += 15) {
  const batch = all.slice(i, i + 15);
  const q = "{" + batch.map((id, k) => `p${k}: post(input:{selector:{_id:"${id}"}}) { result { _id contents { htmlHighlight } } }`).join("\n") + "}";
  const r = await fetch("https://www.lesswrong.com/graphql", { method: "POST", headers: { "content-type": "application/json", "user-agent": "library-redesign-prototype" }, body: JSON.stringify({ query: q }) });
  const j: any = await r.json();
  for (const v of Object.values(j.data || {}) as any[]) {
    const res = v?.result; if (!res) continue;
    const ps = paragraphs(res.contents?.htmlHighlight || "");
    if (ps.length) out[res._id] = ps;
  }
  console.log(i + batch.length, "/", all.length, j.errors ? JSON.stringify(j.errors).slice(0, 200) : "");
}
writeFileSync(here + "excerpts.json", JSON.stringify(out));
console.log("saved", Object.keys(out).length);
