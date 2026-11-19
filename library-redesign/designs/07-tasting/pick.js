// Which post introduces a sequence: its best review winner, else its highest-karma post,
// skipping front matter (prefaces, indexes) when the sequence has anything else.
// candidates(seq) gives them in order, so a post already served by a stronger course
// can give way to the next one.
const FRONT = /^(preface|foreword|introduction|intro\b|sequence (introduction|index|summary)|table of contents|contents$|index$|epilogue|afterword|postscript|announcing|links? ?(post|list))/i;

export function candidates(seq, n = 3) {
  const posts = seq.posts.filter(p => p && p.title);
  const real = posts.filter(p => !FRONT.test(p.title.trim()));
  const pool = real.length ? real : posts;
  return pool.slice().sort((a, b) => (!!b.winner - !!a.winner) || b.karma - a.karma).slice(0, n);
}
export const strongest = seq => candidates(seq, 1)[0] || null;
