You are building ONE design prototype for a redesign of LessWrong's Library page (https://www.lesswrong.com/library). Nine other agents build nine other designs in parallel, each in its own folder; stay in yours.

## Setting
- Project dir: ~/projects/ForumMagnum-library/library-redesign/ (a folder of static prototypes in a worktree of ForumMagnum, LessWrong's codebase). It's served by a static server on http://127.0.0.1:4420/ (the owner sees it in a preview pane at /_dev/library/, so ALL links and imports must be RELATIVE: `../../shared/library.js`, never `/shared/...`).
- Write files only with bash (heredocs, python) — the file tools are restricted to another directory. Only write inside `designs/<your-slug>/` (index.html, plus .js/.css files there if you like). Do NOT edit shared/, data/, index.html or other designs. If the shared module lacks something, compute it in your own files.
- Read first: `shared/library.js` (the data API, documented at its top: loadLibrary(), image(), progress, fmt), `shared/base.css` (LessWrong's look: variables --bg --panel --primary --winner --serif --display --ui, classes .page .page-title .section-title .card .meta .pill), `shared/header.js` (`<lw-header design="NN · Name">`), and the hub `index.html` (the owner's brief and the analysis of what's wrong with today's page; read it to understand what the designs are answering).
- Data: data/library.json, a real snapshot of lesswrong.com: 42 curated + 271 community sequences with chapters and posts (karma, words, reading minutes, dates, tags, review-winner info), the 5 "core" collections with all their book-sequences (lib.core, lib.books), and 339 Best of LessWrong review winners. Use real titles, numbers and images (lib images via `image(gridImageId, {w,h})` from Cloudinary; review winners have `art` splash images). Links go to the real lesswrong.com URLs (`seq.url`, `post.url`).
- Skeleton:
```html
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NN · Name — Library prototype</title>
<link rel="stylesheet" href="../../shared/base.css">
<style>/* yours */</style></head><body>
<lw-header design="NN · Name"></lw-header>
<main class="page">…</main>
<script type="module">
import "../../shared/header.js";
import { loadLibrary, image, progress, fmt } from "../../shared/library.js";
const lib = await loadLibrary();
…
</script></body></html>
```
No build step, no npm: plain HTML/CSS/JS modules (you may import a library from a CDN like https://esm.sh/ if it truly earns its place, e.g. d3 for a layout; prefer none).

## Quality bar
- It must feel like a real, considered LessWrong page, not a wireframe: the site's typography (serif body, ET Book display, Gill Sans UI), its calm paper background, restraint. Responsive: it must work on a phone (≈390px) as well as desktop (1440px).
- The page's idea must be strong and obvious within 5 seconds of looking at it. Depth over breadth: one idea executed well beats five half-features. Interactions should actually work on the real data.
- Under the header, at the top of the page, a short "design note" box (class of your own, small UI font, muted, dismissible or collapsible is fine) in ENGLISH: 2–4 sentences on which problem of today's page this design answers and what it trades away.
- Make editorial content where the design needs it (path descriptions, questions, blurbs) but ground it in the real data (real sequences, real posts); keep invented editorial text short, plausible and in LessWrong's voice. Handle sequences with missing images/descriptions gracefully.
- Verify: open your page with the browser tool (action "open" with target "draft" once, then "goto" with the full URL http://127.0.0.1:4420/designs/<slug>/ — use the full http URL), check the console log for errors, look at the screenshot on desktop, and check a phone layout (open with device "phone"). Fix what looks off. If the browser tool is busy or flaky (other agents use browsers too), retry a little later; at minimum make sure the page loads without JS errors.
- Report back in 3–6 sentences: what you built, the key interactions, anything unfinished or any shortcut (e.g. invented data). No need to paste code.
