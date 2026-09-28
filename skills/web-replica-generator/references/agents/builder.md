# Builder agent

**Job:** build one owner's views, touching only the files that `spec.files` assigns to that owner. One Builder per view owner, all dispatched together with builder:shell ([shell.md](shell.md)) and Data ([data.md](data.md)).

## Prompt template

Placeholders: `<replica>`, `<skill>` (absolute paths), `<owner>` (e.g. `builder:catalog`), `<files>`, `<pages>` (ids with their `source`), `<features>` (ids).

```text
You are <owner> building part of a website replica in <replica>/.

Yours
- Files (write ONLY these): <files>
- Pages: <pages>
- Features: <features>
Details of each are in <replica>/spec.json (pages[], features[] with owner "<owner>", data).

Read first
- Your pages' screenshots: <replica>/target/screens/<source>-desktop.png, -tablet.png, -mobile.png,
  and target/states/*.png. Use the Read tool to look at them and match them: layout, spacing, sizes,
  colour blocks, typography, imagery placement. Card/element styles are in target/capture.json
  (pages[].keyElements, cardGroups[].itemStyle).
- The generated foundation (read it, use it, DO NOT edit it): js/store.js, js/router.js, js/ui.js,
  js/app.js, css/tokens.css; and css/base.css + index.html, which builder:shell is editing right now.
- <skill>/references/design-token-system.md and media-and-asset-pipeline.md.

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
- Use the helpers, don't rewrite them:
  js/ui.js     esc(s), uid(prefix), priceHtml(n, { split }), starsHtml(rating, { max })
  js/store.js  store.get() / store.set(patch | fn), addItem, setItemQty, removeItem, countItems,
               sumItems(list, priceOf), money(n)
  js/router.js href(pageId, params), router.go(hash), slug(s)
  Import them from '../ui.js', '../store.js', '../router.js'. Data comes from ctx.data. Views never
  import each other. The header/footer (cart count, search box) belong to builder:shell.

Rules
- Styles use var(--…) from tokens.css, never raw hex. Scope CSS under your pages' sections
  ([data-view="<page id>"], one selector per page of a shared module).
- Every data-testid named in your features' steps must exist exactly as named.
- Responsive at 1440 / 768 / 375 with no horizontal overflow. Images have alt text, width/height
  or aspect-ratio (media-and-asset-pipeline.md).
- No lorem ipsum, no default browser controls left unstyled.
- Need a change in a file you don't own? Don't make it and don't compensate for it; put it in your
  summary.

Self-check (the checker serves the replica itself; start no server). At most 3 checker runs in
total, then return whatever the state:
  node <skill>/scripts/check_replica.js --dir <replica> --owner <owner> --only feature
  node <skill>/scripts/check_replica.js --dir <replica> --owner <owner> --only visual --target <replica>/target
Run the visual pass once, after your features pass. Read the failures it prints (report.json is
shared, other agents overwrite it). For each visual failure Read report/side-<page>-<vp>.png
(target left, replica right) and fix the biggest differences. Don't write crop or compare scripts.
Ignore failures that belong to other owners.

Return at most 10 lines: files written, features passing/failing (ids), fidelity per page/viewport
from your visual run, anything you needed from a shared file or from another owner.
```
