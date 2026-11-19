// Snapshot of what the Library shows, from lesswrong.com's public GraphQL, for the prototypes.
// bun scripts/snapshot.ts  →  data/library.json
const endpoint = "https://www.lesswrong.com/graphql";

async function gql(query: string) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json: any = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 800));
  return json.data;
}

const post = `_id slug title baseScore commentCount wordCount postedAt readTimeMinutes
  user { displayName slug }
  reviewWinner { reviewYear category reviewRanking }
  tags { name slug core }`;

const sequence = `_id title createdAt lastUpdated canonicalCollectionSlug curatedOrder postsCount
  contents { plaintextDescription }
  user { _id displayName slug }
  gridImageId bannerImageId
  chapters { title subtitle number posts { ${post} } }`;

async function sequences(view: string, limit: number) {
  const data = await gql(`{ sequences(selector:{${view}:{}}, limit:${limit}) { results { ${sequence} } } }`);
  return data.sequences.results;
}

const collectionIds = (await gql(`{ collections(limit:20) { results { _id slug } } }`)).collections.results;
const collections = await Promise.all(collectionIds.map(async ({ _id }: { _id: string }) => {
  const data = await gql(`{ collection(selector:{documentId:"${_id}"}) { result {
    _id slug title gridImageId firstPageLink
    user { displayName slug }
    books { _id title subtitle number sequences { _id title } } } } }`);
  return data.collection.result;
}));

const curated = await sequences("curatedSequences", 200);
const community = await sequences("communitySequences", 1000);

// The core collections' books hold sequences that are neither curated nor community ones.
const known = new Set([...curated, ...community].map((s: any) => s._id));
const bookIds = [...new Set(collections.flatMap((c: any) => c.books.flatMap((b: any) => b.sequences.map((s: any) => s._id))))]
  .filter(id => !known.has(id));
const inCollections = [];
for (let i = 0; i < bookIds.length; i += 8) {
  inCollections.push(...await Promise.all(bookIds.slice(i, i + 8).map(async id =>
    (await gql(`{ sequence(selector:{documentId:"${id}"}) { result { ${sequence} } } }`)).sequence.result)));
}

const winners = (await gql(`{ GetAllReviewWinners { _id slug title baseScore wordCount postedAt
  user { displayName slug }
  reviewWinner { reviewYear category reviewRanking reviewWinnerArt { splashArtImageUrl } }
  tags { name slug core } } }`)).GetAllReviewWinners;

const out = { fetchedAt: new Date().toISOString(), collections, curated, community, inCollections, reviewWinners: winners };
await Bun.write(new URL("../data/library.json", import.meta.url), JSON.stringify(out));
console.log({ collections: collections.length, curated: curated.length, community: community.length, inCollections: inCollections.length, winners: winners.length });
