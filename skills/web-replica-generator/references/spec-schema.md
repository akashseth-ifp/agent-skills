# spec.json & report.json — the contract between agents

Agents never pass work to each other in chat. These files carry it:

| File | Written by | Read by |
|---|---|---|
| `replica/target/capture.json` + `replica/target/screens/*.png` | `scripts/capture_target.js` | Analyst |
| `replica/spec.json` | Analyst (then only the orchestrator edits it) | `scaffold_replica.js`, Builders, Data, `check_replica.js`, Fixers |
| `replica/report.json` + `replica/report/` | `scripts/check_replica.js` | Orchestrator, Fixers |

What scaffold generates from this spec is under [What scaffold generates](#what-scaffold-generates) below.

---

## spec.json

```jsonc
{
  "target": "https://books.toscrape.com/",
  "archetype": "ecommerce",            // ecommerce | saas-landing | dashboard | generic  (references/archetypes/)
  "stack": "vanilla",                  // vanilla (default) | react — see SKILL.md "Stack decision"
  "measured": true,                    // false = target was blocked; tokens reconstructed, not measured
  "reconstructed": ["basket page: not on the real site"],  // parts the capture couldn't see, for the final report
  "brand": "Books to Scrape",          // footer line: "Replica for demo purposes only, not affiliated with <brand>."
  "locale": "en-GB", "currency": "GBP",  // BCP 47 locale and ISO 4217 currency of the price samples (defaults: en-US, USD)
  "currencyDigits": 2,                 // optional 0-3: decimals every price shows; 0 for whole-unit sites (₹11,999). Omit to use the currency's default.

  // Values copied from capture.json, not recalled. scaffold writes each one to css/tokens.css as --<group>-<name>.
  "tokens": {
    "color": { "brand": "rgb(66, 139, 202)", "canvas": "rgb(255, 255, 255)", "surface": "rgb(245, 245, 245)", "text": "rgb(51, 51, 51)" },
    "font":  { "sans": "\"Helvetica Neue\", Helvetica, Arial, sans-serif", "base": "14px" },
    "radius": { "control": "4px" },
    "shadow": {}
  },

  // One entry per replica view.
  //   route   the concrete URL the checker opens for this page (smoke, layout, visual).
  //   pattern the hash the router matches: ":name" required, ":name?" optional (last segment only); the
  //           query string (?k=…) is parsed into params. A list of patterns is allowed (["#/", "#/page/:n"]).
  //           Pages are matched in array order, first match wins; an unmatched hash goes to pages[0].
  //   module  the view module that renders it. Several pages may share one (ctx.route.page says which);
  //           its CSS is css/<module basename>.css.
  //   source  the capture.json page name whose screenshots this page is compared against; null = no target
  //           screenshot (no visual check).
  //   visualMaxHeight (optional) score only the top N px, for content the replica deliberately doesn't copy:
  //           a number for every viewport, or { "desktop": 4000, "mobile": 2500 } per viewport (a viewport left
  //           out is scored in full), e.g. an endless feed or a mobile page that scrolls an inner container.
  "pages": [
    { "id": "home",     "route": "/",                  "pattern": ["#/", "#/page/:n"], "module": "js/views/catalog.js", "source": "home", "owner": "builder:catalog" },
    { "id": "category", "route": "/#/category/poetry", "pattern": ["#/category/:slug", "#/category/:slug/page/:n"], "module": "js/views/catalog.js", "source": "catalogue-category-books-poetry-23-index-html", "owner": "builder:catalog" },
    { "id": "detail",   "route": "/#/book/1",          "pattern": "#/book/:id",       "module": "js/views/detail.js",  "source": "catalogue-a-light-in-the-attic-1000-index-html", "owner": "builder:detail" },
    { "id": "basket",   "route": "/#/basket",          "pattern": "#/basket",         "module": "js/views/basket.js",  "source": null, "owner": "builder:detail" }
  ],

  // Shared state, loaded into js/store.js by scaffold. Only the `persist` keys go to localStorage.
  "state": { "initial": { "basket": [] }, "persist": ["basket"] },

  // Every file has exactly one owner, so parallel agents never write the same file.
  //   scaffold       generated; nobody edits it during the build. A Fixer may, only when a failure is
  //                  traced to it, and says so in its summary.
  //   builder:shell  index.html (the shell:header / shell:footer regions), base.css, shell.js.
  "files": {
    "css/tokens.css": "scaffold", "js/store.js": "scaffold", "js/router.js": "scaffold", "js/app.js": "scaffold", "js/ui.js": "scaffold",
    "index.html": "builder:shell", "css/base.css": "builder:shell", "js/shell.js": "builder:shell",
    "js/data.js": "data", "assets/img/": "data", "assets/images.manifest.json": "data",
    "css/catalog.css": "builder:catalog", "js/views/catalog.js": "builder:catalog",
    "css/detail.css": "builder:detail",   "js/views/detail.js": "builder:detail",
    "css/basket.css": "builder:detail",   "js/views/basket.js": "builder:detail"
  },

  // What the replica must do. Every feature seen in the target gets an entry; `steps` makes it a test.
  // Header, nav, drawer, popover and footer features have owner "builder:shell".
  "features": [
    {
      "id": "add-to-basket",
      "title": "Add to basket updates the basket count",
      "page": "home", "owner": "builder:catalog", "priority": "must",   // must | should
      "steps": [
        { "goto": "/" },
        { "click": "product-card-add" },
        { "expectText": "basket-count", "contains": "1" },
        { "reload": true },
        { "expectText": "basket-count", "contains": "1" }
      ]
    },
    {
      "id": "basket-link", "title": "Header basket link opens the basket",
      "page": "home", "owner": "builder:shell", "priority": "should",
      "steps": [{ "goto": "/" }, { "click": "basket-link" }, { "expectUrl": "#/basket" }]
    }
  ],

  // Shape of the mock data, inferred from capture.json cardGroups[].samples.
  "data": {
    "module": "js/data.js", "export": "books", "count": 60,
    "fields": {
      "id":     { "type": "string", "required": true },
      "title":  { "type": "string", "required": true, "example": "A Light in the Attic" },
      "price":  { "type": "number", "required": true, "min": 10, "max": 60 },
      "rating": { "type": "number", "min": 1, "max": 5 },
      "stock":  { "type": "number", "min": 0 },
      "genre":  { "type": "string", "enum": ["Poetry", "Travel", "Mystery", "Historical Fiction", "Science"] },
      "image":  { "type": "string", "required": true }            // "assets/img/<key>.jpg"
    },
    // JS expressions over one record `r`; every record must satisfy every rule.
    "rules": ["r.stock === 0 || r.price > 0", "r.title.length <= 120"],
    // 6–10 records that satisfy fields + rules, including EVERY fixture a feature step relies on
    // (id "1" for /#/book/1, a Poetry book for /#/category/poetry, the record a search term must find).
    // scaffold writes them to js/data.js at once; the Data agent later swaps in the full set.
    "seed": [
      { "id": "1", "title": "A Light in the Attic", "price": 51.77, "rating": 3, "stock": 22, "genre": "Poetry", "image": "assets/img/book-1.jpg" }
      /* … 5–9 more */
    ],
    // Extra named exports of js/data.js, each seeded the same way.
    "extras": { "categories": ["Travel", "Mystery", "Historical Fiction", "Poetry", "Science"] }
  },

  "thresholds": { "visual": 0.8 }      // min layout-similarity score per page × viewport (0..1)
}
```

### Step vocabulary

A step is an object with one action key. A `target` value is a `data-testid`. Prefix it with `css=` to use a CSS selector instead. Builders **must** put the `data-testid`s that the steps reference into their markup.

| Step | Meaning |
|---|---|
| `{ "goto": "/#/search" }` | open a route relative to the replica URL |
| `{ "viewport": "mobile" }` | switch to desktop / tablet / mobile |
| `{ "click": target }`, `{ "hover": target }` | first matching element |
| `{ "fill": target, "value": "poetry" }` | type into an input |
| `{ "select": target, "value": "price-asc" }` | choose a `<select>` option |
| `{ "press": "Escape" }` | keyboard key |
| `{ "reload": true }` | reload the page (to check persistence) |
| `{ "wait": 300 }` | milliseconds, only for animations |
| `{ "expectVisible": target }`, `{ "expectHidden": target }` | visibility |
| `{ "expectText": target, "contains": "£51.77" }` | text content |
| `{ "expectCount": target, "min": 1, "max": 5 }` or `"eq": 3` | number of matches |
| `{ "expectUrl": "#/book/" }` | URL contains |

Put the steps in the order a real user would do them. Keep each feature to 3–10 steps. Put one behaviour in each feature, so that a failure points at one owner.

---

## What scaffold generates

`node <skill>/scripts/scaffold_replica.js --dir <replica>` turns the spec into the foundation in about a second. It never overwrites an existing file unless given `--force` (every file) or `--force-data` (only `js/data.js`), so a re-run only fills in what's missing. To regenerate one file after a spec change, delete it and re-run.

| File (owner) | What it holds |
|---|---|
| `css/tokens.css` (scaffold) | every `tokens.<group>.<name>` as `--<group>-<name>` |
| `js/store.js` (scaffold) | `store` (`get() / set(patch or fn) / subscribe(fn)`) from `state.initial`, persisting only `state.persist` keys with guarded `localStorage`; `createStore(initial, persist)`; list helpers for `[{ id, qty }]`: `addItem(list, id, qty = 1)`, `setItemQty(list, id, qty)` (≤ 0 removes), `removeItem(list, id)`, `countItems(list)`, `sumItems(list, priceOf)`; `money(n)`, `LOCALE`, `CURRENCY`, `MONEY_OPTIONS` (Intl options from `currency` + `currencyDigits`, shared by `money()` and `ui.priceHtml()`) from `locale` / `currency` / `currencyDigits` |
| `js/router.js` (scaffold) | `router` (`current() → { page, view, params }`, `subscribe(fn)`, `go(hash)`), `href(pageId, params)` (fills the page's pattern, the rest goes in the query string), `slug(s)`. Scrolls to top on a page change. |
| `js/ui.js` (scaffold) | `esc(s)`, `uid(prefix)`, `priceHtml(n, { split = true })`, `starsHtml(rating, { max = 5 })` |
| `js/app.js` (scaffold) | on every route or store change: the active page's `render(el, ctx)`, empties and hides every other `[data-view]` section, then `shell.update(ctx)`. `shell.mount(ctx)` once at start. The image-error fallback. `ctx = { route, store, data, router }`, `data` = every export of `js/data.js`. |
| `index.html` (builder:shell) | `shell:header` and `shell:footer` comment regions (the footer keeps `<p data-replica-note>`), `<main id="content">` with one `<section data-view="<page id>">` per page, stylesheet links for tokens, base and each `css/<module basename>.css`, `<script type="module" src="js/app.js">` |
| `css/base.css` (builder:shell) | starter: reset, body font and colour from tokens, `img { max-width: 100% }`, `.sr-only`, `[hidden] { display: none !important }`, `.img-fallback` |
| `js/shell.js` (builder:shell) | stub `mount(ctx)` and `update(ctx)` |
| `js/views/<x>.js`, `css/<x>.css` (the page's owner) | stub `render(el, ctx)` per distinct `pages[].module`; `ctx.route.page` says which page |
| `js/data.js` (data) | `export const <data.export> = <data.seed>` and one export per `data.extras` key |

---

## report.json

`check_replica.js` writes this file and exits non-zero if any `error` is present. With `--owner <o>` only that owner's pages (page checks) and features run (data only for `--owner data`). With `--only <kind>[:<id>]` only that kind, or that one failure id (`visual:home/mobile` loads only that page × viewport). Every run rewrites `report.json`, including the agents' self-checks, so an agent reads its own run's printed failures.

```jsonc
{
  "passed": false,
  "summary": {
    "errors": 2, "warnings": 1,
    "featureCoverage": 0.83,                       // passing features / all features
    "fidelity": { "home/desktop": 0.91, "home/mobile": 0.77 },
    "fidelityAvg": 0.84
  },
  "failures": [
    {
      "id": "feature:add-to-basket", "kind": "feature",   // smoke | layout | feature | data | visual | a11y
      "severity": "error",                                // error blocks completion; warn is reported only
      "owner": "builder:catalog",
      "files": ["css/catalog.css", "js/views/catalog.js"], // from spec.files for that owner
      "message": "step 3 expectText basket-count: got \"0\", wanted \"1\"",
      "screenshot": "report/feature-add-to-basket.png"
    },
    {
      "id": "visual:home/mobile", "kind": "visual", "severity": "warn", "owner": "builder:catalog",
      "files": ["css/catalog.css", "js/views/catalog.js"],
      "message": "layout similarity 0.74 < 0.8. …",
      "screenshot": "report/page-home-mobile.png",
      "side": "report/side-home-mobile.png"            // visual only: target left, replica right, top 1600px
    }
  ],
  "features": [{ "id": "add-to-basket", "passed": false }],
  "cost": { "rounds": 1, "agents": 5, "minutes": 14 }     // stamped by the orchestrator; minutes since <replica>/.start
}
```
