// Posts beyond the sequences, for the Atlas: every post with at least MIN_KARMA karma
// (year by year, since the API skips at most 5000), every curated post, the tags
// they carry, and the Best of LessWrong winners' art and crop coordinates.
// bun scripts/snapshot-posts.ts  →  data/posts.json (posts, tag names), data/art.json (winners' art, small)
const endpoint = "https://www.lesswrong.com/graphql";
const MIN_KARMA = 25;

async function gql(query: string) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
    const json: any = await res.json().catch(() => ({ errors: [{ message: `HTTP ${res.status}` }] }));
    if (!json.errors) return json.data;
    if (attempt >= 2) throw new Error(JSON.stringify(json.errors).slice(0, 500));
    await Bun.sleep(2000);
  }
}

const fields = `_id slug title baseScore commentCount postedAt readTimeMinutes curatedDate user { displayName slug } tagRelevance`;

// The top posts of [after, before), split in halves until a page reaches below MIN_KARMA.
async function range(after: Date, before: Date): Promise<any[]> {
  const page = (await gql(`{ posts(selector:{top:{after:"${after.toISOString()}", before:"${before.toISOString()}"}}, limit:5000) { results { ${fields} } } }`)).posts.results;
  const low = Math.min(...page.map((p: any) => p.baseScore));
  if (page.length < 5000 || low < MIN_KARMA) return page.filter((p: any) => p.baseScore >= MIN_KARMA);
  const mid = new Date((after.getTime() + before.getTime()) / 2);
  return [...await range(after, mid), ...await range(mid, before)];
}

const posts = new Map<string, any>();
for (let y = 2006; y <= new Date().getFullYear(); y++) {
  const got = await range(new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y + 1, 0, 1)));
  for (const p of got) posts.set(p._id, p);
  console.log(y, got.length);
}
const curated = (await gql(`{ posts(selector:{curated:{}}, limit:5000) { results { ${fields} } } }`)).posts.results;
for (const p of curated) posts.set(p._id, p);
console.log("curated", curated.length);

// Names of the tags in use (by id), keeping each post's five most relevant.
const tagIds = new Set<string>();
for (const p of posts.values()) {
  p.tagRelevance = Object.entries(p.tagRelevance || {}).filter(([, r]) => (r as number) > 0)
    .sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 5).map(([id]) => id);
  p.tagRelevance.forEach((id: string) => tagIds.add(id));
}
const tags: Record<string, { name: string, core: boolean }> = {};
const allTags = (await gql(`{ tags(selector:{allTagsAlphabetical:{}}, limit:6000) { results { _id name core } } }`)).tags.results;
for (const t of allTags) if (tagIds.has(t._id)) tags[t._id] = { name: t.name, core: !!t.core };

const winners = (await gql(`{ GetAllReviewWinners { _id reviewWinner { reviewYear category curatedOrder reviewRanking
  reviewWinnerArt { splashArtImageUrl activeSplashArtCoordinates {
    leftXPct leftYPct leftWidthPct leftHeightPct leftFlipped
    middleXPct middleYPct middleWidthPct middleHeightPct middleFlipped
    rightXPct rightYPct rightWidthPct rightHeightPct rightFlipped } } } } }`)).GetAllReviewWinners;
const art = Object.fromEntries(winners.map((w: any) => [w._id, {
  year: w.reviewWinner.reviewYear, category: w.reviewWinner.category, ranking: w.reviewWinner.reviewRanking,
  curatedOrder: w.reviewWinner.curatedOrder, url: w.reviewWinner.reviewWinnerArt?.splashArtImageUrl ?? null,
  coords: w.reviewWinner.reviewWinnerArt?.activeSplashArtCoordinates ?? null }]));

const out = {
  fetchedAt: new Date().toISOString(), minKarma: MIN_KARMA, tags,
  posts: [...posts.values()].map(p => ({
    id: p._id, slug: p.slug, title: p.title, karma: p.baseScore, comments: p.commentCount,
    postedAt: p.postedAt, minutes: p.readTimeMinutes, curatedAt: p.curatedDate || null,
    author: p.user ? { name: p.user.displayName, slug: p.user.slug } : null, tags: p.tagRelevance })),
};
await Bun.write(new URL("../data/posts.json", import.meta.url), JSON.stringify(out));
await Bun.write(new URL("../data/art.json", import.meta.url), JSON.stringify({ fetchedAt: out.fetchedAt, winners: art }));
console.log({ posts: out.posts.length, tags: Object.keys(tags).length, winners: Object.keys(art).length });
