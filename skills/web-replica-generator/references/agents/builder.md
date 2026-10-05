# Builder agent

**Job:** build one owner's views, touching only the files that `spec.files` assigns to that owner. One Builder per view owner, all dispatched together with builder:shell ([shell.md](shell.md)) and Data ([data.md](data.md)).

## Prompt template

Placeholders: `<replica>`, `<skill>` (absolute paths), `<owner>` (e.g. `builder:catalog`), `<files>`, `<pages>` (ids with their `source`), `<features>` (ids).

```text
You are <owner> building part of a website replica in <replica>/.

Yours: files <files> · pages <pages> · features <features>

Start with ONE command. It prints everything you need: your files, pages, features with their steps
and data-testids, every other page's route (for href links), the layout contract and the shared
atoms in base.css, tokens, the measured styles of your pages, the data shape with a sample record,
the runtime API, the exact markup the ui.js helpers emit, and your check commands:
  node <skill>/scripts/brief.js --dir <replica> --owner <owner>
Then Read each page's desktop and mobile screenshot (the brief lists them; tablet only if the layout
changes there) and any state screenshots it lists. Match layout, spacing, sizes, colour blocks,
typography and imagery placement.

Token budget: every tool call re-reads your whole context, so (number of calls) × (context size) is
what this build costs. Keep both small:
- At most 25 tool calls and 6 image Reads in total. Batch shell commands into one call.
- Read nothing but the brief, the screenshots and your own stub files (Read each once, right before
  you overwrite it). Not spec.json, target/capture.json, report.json, index.html, css/base.css,
  js/ui.js, js/router.js, js/data.js or any other generated file, and not the skill's references:
  the brief has the layout contract, helper markup, a sample record and all routes. The foundation
  files are generated or owned by builder:shell: use them, don't edit them. If the brief lacks a
  detail, decide it from the screenshots.
- Plan, then write each of your files with ONE Write. Prefer one more Write over many small Edits.

Already there
- Your files exist as stubs, and index.html already links css/<module>.css and has a
  <section data-view="<page id>"> per page.
- js/data.js already holds the seed records and extras (spec.data.seed / extras). The Data agent
  swaps in the full set later, same shape. Never wait for it and never hard-code records. Render
  counts, pagination and lists from the data, so the full set just works.
- Seed image files may not be downloaded yet; a broken image shows the fallback. That's expected.

The view contract
- Each js/views/<module>.js exports render(el, ctx), ctx = { route, store, data, router }.
  app.js calls it on every route/store change while one of its pages is active. ctx.route.page is
  the page id (one module can serve several pages), ctx.route.params the path + query params.
- Re-render el fully each time. Attach handlers by assignment (el.onclick = e => { const t =
  e.target.closest('[data-action]'); … }) so they don't stack. If the view has a text input, don't
  re-render it while it has focus (update the results container only).
- Use the helpers listed under "Runtime API" in the brief; don't rewrite them. Import them from
  '../ui.js', '../store.js', '../router.js'. Data comes from ctx.data. Views never import each other.
  Link to other pages with href(pageId, params) and the routes the brief lists.
- Layout contract (in the brief): builder:shell styles the header, footer and the page frame
  (#content width, gutters, panel background/border/shadow). Style only inside your section: no
  outer page max-width, side margins or page background. Use the shared atoms (.btn, .breadcrumb,
  .alert, .badge, form controls, .price, .stars) as they are; adjust them under your section only
  where your page differs. The header/footer (cart count, search box) belong to builder:shell.

Rules
- Styles use var(--…) from tokens.css, never raw hex. Scope CSS under your pages' sections
  ([data-view="<page id>"], one selector per page of a shared module).
- Every data-testid named in your features' steps must exist exactly as named.
- Responsive at 1440 / 768 / 375 with no horizontal overflow. Images have alt text and width/height
  or aspect-ratio matching the target's.
- No lorem ipsum, no default browser controls left unstyled.

Interactions (the interact check clicks every link, arrow and filter on your pages)
- Filter, sort and page state lives in the URL: links and controls go to href(<page>, { ...params,
  brand: 'Sony' }) and render() reads ctx.route.params. Not the store: then the nav, Back and reload
  all show the right list, and the filters reset when someone arrives from another page.
- Build filter options and their "(N)" counts from ctx.data (only options that match at least one
  record). Never copy the target's counts or options.
- Links to a listing carry the params that make the destination differ (category, q). Different
  labels never share one bare href, and every one lands on a non-empty result.
- Carousels and sliders: prev/next must visibly move or swap the slide, at every viewport where the
  arrows show. Where a breakpoint lays out all slides at once, hide the arrows there. Prev at the
  first slide is hidden/disabled, or wraps around.
- Need a change in a file you don't own? Don't make it and don't compensate for it; put it in your
  summary.

Self-check (the checker serves the replica itself; start no server). Hard cap: at most 4 checker
runs in total. Count them; after the 4th, stop and return whatever the state. Run the commands the
brief prints at its end, as printed (it leaves out a check with nothing of yours to check):
  node <skill>/scripts/check_replica.js --dir <replica> --owner <owner> --only feature
  node <skill>/scripts/check_replica.js --dir <replica> --owner <owner> --only visual --target <replica>/target
  node <skill>/scripts/check_replica.js --dir <replica> --owner <owner> --only interact
Run the visual pass once, after your features pass. Everything you need is in what it prints: the
failures, the "fidelity:" line with every page/viewport score and the "failing features:" line.
report.json is shared (other agents overwrite it), so don't open it. For each visual failure Read
report/side-<page>-<vp>.png (target left, replica right) and fix the biggest differences. Don't
write crop or compare scripts. Ignore failures that belong to other owners.

Return at most 10 lines: files written, features passing/failing (ids), the "fidelity:" line from
your visual run, checker runs used (n/4), anything you needed from a shared file or another owner.
```
