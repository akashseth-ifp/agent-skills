# Shell agent (builder:shell)

**Job:** build the parts every page shares: header, nav, drawers, popovers, modals, footer, the page frame around the views (`#content`) and the shared atoms in `base.css`. It runs in parallel with the view Builders ([builder.md](builder.md)) and Data ([data.md](data.md)), so it edits only its own regions and files.

## Prompt template

Placeholders: `<replica>`, `<skill>` (absolute paths), `<owner>` (`builder:shell`), `<files>`, `<pages>` (ids with their `source`), `<features>` (ids).

```text
You are <owner> building the shared shell of a website replica in <replica>/.

Yours: files <files> · features <features> · the shell appears on every page: <pages>

Start with ONE command. It prints your files, features with steps and data-testids, every page's
route, screenshots and states, the layout contract and the shared atoms you provide, tokens, the
measured header/nav/footer/input/button styles, the data shape with a sample record (extras such as
nav links), the runtime API, the exact markup the ui.js helpers emit, and your check commands:
  node <skill>/scripts/brief.js --dir <replica> --owner <owner>
Then Read the screenshots of the page the brief marks "your visual-check page" (the first captured
page) at all 3 viewports, plus the state screenshots (opened menus and popups). Measure the header, the page frame and the footer at each viewport: height of each
header row, logo size and position, content width and gutters, panel background/border/shadow,
search box width, icon sizes, footer columns. Mobile is where guessed values show up most in the
visual score.

Token budget: every tool call re-reads your whole context, so (number of calls) × (context size) is
what this build costs. Keep both small:
- At most 25 tool calls and 6 image Reads in total. Batch shell commands into one call.
- Read nothing but the brief, the screenshots and your own files (Read each once, right before you
  overwrite it). Not spec.json, target/capture.json, report.json, js/ui.js, js/router.js,
  js/store.js, js/app.js, js/data.js or the skill's references: the brief has the layout contract,
  helper markup, a sample record and all routes. The generated files are yours to use, not to edit.
  If the brief lacks a detail, decide it from the screenshots.
- Plan, then write each of your files with ONE Write. Prefer one more Write over many small Edits.

Layout contract (the view Builders get it in their brief and rely on it, so keep it exactly)
- index.html is <header class="site-header">…</header><main id="content"><section data-view="<page id>">…
  </section>…</main><footer class="site-footer">…</footer>.
- You own the page frame: style the header, the footer AND #content (width, gutters, panel
  background/border/shadow) at all 3 viewports. Views add no page max-width, margins or page
  background of their own, so the frame looks right only if you build it.
- You provide the shared atoms the brief lists, under exactly those class names (.btn, .btn-primary,
  .breadcrumb, .alert + variants, .badge, form controls, .price with .sym/.whole/.frac, .stars).
  Views use them without reading base.css.

What to write
1. index.html: rewrite ONLY the two regions between the <!-- shell:header … --> and
   <!-- /shell:header --> comments and between <!-- shell:footer … --> and <!-- /shell:footer -->.
   Keep everything else exactly: the <main id="content"> sections, the stylesheet links,
   <link rel="icon">, the <script type="module"> tag. Keep the
   <p data-replica-note> line in the footer. Put static markup (logo, nav, footer link columns) here;
   put markup that depends on data or state in shell.js.
2. css/base.css: keep the starter rules (reset, [hidden], .sr-only, .img-fallback) and extend them:
   the page frame (#content), header, nav, drawers, popovers, modals, footer, and the shared atoms
   above, styled from the brief's helper markup. Breakpoints for 1440 / 768 / 375 as the
   screenshots show them (hamburger, collapsed search). var(--…) from tokens.css, never raw hex.
3. js/shell.js: export function mount(ctx) and export function update(ctx),
   ctx = { route, store, data, router }.
   - mount runs once: bind the header search (submit -> router.go(href('<search page id>', { k })) ),
     menus, drawers, popovers, modals (Escape and outside-click close them). Bind by assignment
     (el.onclick = …) on the header/footer roots, delegated via [data-action].
   - update runs after every route/store change: cart count (countItems from js/store.js), active
     nav item, search box value from ctx.route.params (not while it has focus), location label.
   - Shared state lives in store (spec.state); change it with store.set, never localStorage directly.
   - Helpers: see "Runtime API" in the brief. Import from './ui.js', './store.js', './router.js'.
Nav, mega-menu, tile and footer links: each label gets its own destination, href(<listing page>,
{ cat: '<slug>' }) or { q: '<label>' }, never one bare href shared by different labels, and only
values that match at least one record. Footer info/policy links with no page of their own may point
home (the checker only warns about those).
Every data-testid named in your features' steps must exist exactly as named. Menus and drawers
render hidden (the [hidden] attribute) until opened. No working login or payment: forms look real
and write to the store only.

Self-check (the checker serves the replica itself; start no server). Hard cap: at most 4 checker
runs in total. Count them; after the 4th, stop and return whatever the state. Run the commands the
brief prints at its end, as printed:
  node <skill>/scripts/check_replica.js --dir <replica> --owner <owner> --only feature
  node <skill>/scripts/check_replica.js --dir <replica> --only visual:<visual-check page> --target <replica>/target
  node <skill>/scripts/check_replica.js --dir <replica> --only interact:<first page>/desktop   (your header/footer links; ignore the view owners' lines)
The visual pass (once, after your features pass) loads your visual-check page at all 3 viewports.
It takes no --owner: you own no page, so the checker would find nothing and exit 2. Everything you
need is in what it prints: the failures, the "fidelity:" line and the "failing features:" line.
report.json is shared (other agents overwrite it), so don't open it. Compare only the header, the
page frame and the footer: Read report/side-<page>-<vp>.png when a visual failure names one (target
left, replica right), else report/page-<page>-<vp>.png next to the target screenshot. Don't write
crop or compare scripts. The view area may still be a stub; ignore it.

Return at most 10 lines: files written, features passing/failing (ids), the header height and
content width you measured per viewport, checker runs used (n/4), anything you needed from a file
you don't own.
```
