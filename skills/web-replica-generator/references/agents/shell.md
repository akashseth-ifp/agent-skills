# Shell agent (builder:shell)

**Job:** build the parts every page shares: header, nav, drawers, popovers, modals and footer. It runs in parallel with the view Builders ([builder.md](builder.md)) and Data ([data.md](data.md)), so it edits only its own regions and files.

## Prompt template

Placeholders: `<replica>`, `<skill>` (absolute paths), `<owner>` (`builder:shell`), `<files>`, `<pages>` (ids with their `source`), `<features>` (ids).

```text
You are <owner> building the shared shell of a website replica in <replica>/.

Yours
- Files (write ONLY these): <files>
- Features: <features>
- Pages (the shell appears on all of them): <pages>
Details are in <replica>/spec.json (features[] with owner "<owner>", brand, state, data.extras).

Read first
- Target screenshots at ALL 3 viewports: <replica>/target/screens/<source>-desktop.png, -tablet.png,
  -mobile.png, and target/states/*.png (opened menus and popups). Use the Read tool to look at them.
  Measure the header and footer at each viewport: height of each header row, logo size and position,
  gutters, search box width, icon sizes, footer columns. Mobile is where guessed values show up most
  in the visual score. Exact styles: target/capture.json pages[].keyElements (header, nav, inputs,
  buttons) and pages[0].logo.
- The generated foundation (read it, use it, DO NOT edit it): js/app.js, js/store.js, js/router.js,
  js/ui.js, css/tokens.css. js/data.js holds the seed data and extras (nav links, categories) now;
  the Data agent swaps in the full set later, same shape.
- <skill>/references/design-token-system.md and media-and-asset-pipeline.md.

What to write
1. index.html: rewrite ONLY the two regions between the <!-- shell:header … --> and
   <!-- /shell:header --> comments and between <!-- shell:footer … --> and <!-- /shell:footer -->.
   Keep everything else exactly: the <main id="content"> sections, the stylesheet links,
   <link rel="icon">, the <script type="module"> tag. Keep the
   <p data-replica-note> line in the footer. Put static markup (logo, nav, footer link columns) here;
   put markup that depends on data or state in shell.js.
2. css/base.css: keep the starter rules and extend them: container widths, header, nav, drawers,
   popovers, modals, footer, and the shared atoms every view uses (buttons, badges, breadcrumb,
   alerts, form controls, price and star styling for ui.js markup). Breakpoints for 1440 / 768 / 375
   as the screenshots show them (hamburger, collapsed search). var(--…) from tokens.css, never raw hex.
3. js/shell.js: export function mount(ctx) and export function update(ctx),
   ctx = { route, store, data, router }.
   - mount runs once: bind the header search (submit -> router.go(href('<search page id>', { k })) ),
     menus, drawers, popovers, modals (Escape and outside-click close them). Bind by assignment
     (el.onclick = …) on the header/footer roots, delegated via [data-action].
   - update runs after every route/store change: cart count (countItems from js/store.js), active
     nav item, search box value from ctx.route.params (not while it has focus), location label.
   - Shared state lives in store (spec.state); change it with store.set, never localStorage directly.
   - Helpers: js/ui.js esc, uid, priceHtml, starsHtml; js/store.js store, countItems, money;
     js/router.js href, slug. Import from './ui.js', './store.js', './router.js'.
Every data-testid named in your features' steps must exist exactly as named. Menus and drawers
render hidden (the [hidden] attribute) until opened. No working login or payment: forms look real
and write to the store only.

Self-check (the checker serves the replica itself; start no server). At most 3 checker runs in
total, then return whatever the state:
  node <skill>/scripts/check_replica.js --dir <replica> --owner <owner> --only feature
  node <skill>/scripts/check_replica.js --dir <replica> --only visual:<first page id> --target <replica>/target
<first page id> is spec.pages[0].id. The visual pass (once, after your features pass) loads that
page at all 3 viewports; you own no page, so --owner would skip it. Read the failures it prints (report.json is shared, other agents
overwrite it). Compare only the header and footer: Read report/side-<page>-<vp>.png when a visual
failure names one (target left, replica right), else report/page-<page>-<vp>.png next to the
target screenshot. Don't write crop or compare scripts. The view area may still be a stub; ignore it.

Return at most 10 lines: files written, features passing/failing (ids), the header height you
measured per viewport, anything you needed from a file you don't own.
```
