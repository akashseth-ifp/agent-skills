# QA & Self-Healing Protocol

A replica isn't done because its code was written. It's done when `check_replica.js` reports **zero errors**, or when the fix loop has run out and the remaining gaps are reported honestly.

```
check_replica.js ─► report.json ─┬─ 0 errors ───────────────► report to user
   ▲                             └─ errors ─► Fixers (by owner, parallel) ─┐
   └──── re-check (≤ healRounds, stop when errors and fidelity both stall) ◄┘
```

## What gets checked

```bash
node <skill>/scripts/check_replica.js --dir <replica> --target <replica>/target                     # full check
node <skill>/scripts/check_replica.js --dir <replica> --owner <owner> --only feature                # one owner's features
node <skill>/scripts/check_replica.js --dir <replica> --owner <owner> --only visual --target <replica>/target
node <skill>/scripts/check_replica.js --dir <replica> --only visual:detail/mobile --target <replica>/target   # one failure id
node <skill>/scripts/check_replica.js --dir <replica> --only data                                   # no browser
```

- **It serves itself.** Without `--url` the checker starts its own static server for `--dir` on a free port and stops it when done. Don't start `npx serve` for checks. Pass `--url` only to check a replica that's already hosted elsewhere.
- **It runs in parallel.** Page × viewport checks and features run concurrently in separate browser contexts (`--concurrency`, default 6). A full check takes about 1 minute.
- **`--owner <o>`** runs only that owner's pages (the page checks) and that owner's features. The data check runs only without `--owner` or with `--owner data`. builder:shell owns no page, so its visual pass uses `--only visual:<page id>`.
- **`--only <kind>[:<id>]`** runs one kind (`smoke`, `layout`, `visual`, `a11y`, `interact`, `feature`, `data`) or one failure id from `report.json`. A page failure id loads just that page × viewport.
- Every run rewrites `report.json`. Agents checking in parallel read the failures printed by their own run.

| Kind | Checked on | Fails when | Severity |
|---|---|---|---|
| `smoke` | every page × 1440/768/375 | console error, uncaught exception, request failed or ≥400, image with empty src or `naturalWidth 0` | error |
| `layout` | every page × 1440/768/375 | `scrollWidth > clientWidth`. The message lists the 5 elements that stick out furthest. | error |
| `feature` | each `spec.features[]`, in a fresh browser | any step fails. The message gives the step number and what it got vs. wanted. | error (`must`) / warn (`should`) |
| `data` | `spec.data.module` imported in Node | fewer than `count` records (the scaffold seed fails only this until the Data agent's swap), a duplicate id, a type/range/enum violation, or a rule is false | error |
| `visual` | every page × viewport, with `--target` | layout similarity is below `spec.thresholds.visual` | warn |
| `a11y` | every page at desktop | axe-core serious or critical violations | warn |
| `interact` | every page at desktop (header/footer links on the first page only) | a link matches no route, 4+ differently-labelled links share one destination (warn when it is `#/`), a link opens a blank view or `empty-state`; a prev/next/arrow/slide button leaves the screen unchanged; a filter option (2 per group) gives no results, changes nothing (warn) or shows a "(N)" larger than the data set | error |

**Visual score.** Both screenshots are shrunk to 160 px wide, compared with pixelmatch, and the result is multiplied by the ratio of their heights. At that size text turns into bars and photos into colour blocks, so the score measures layout, colour and spacing rather than the exact words. As a rough guide: ≥ 0.9 is very close, 0.8–0.9 is recognisably the same page, and < 0.6 is a different layout.

**What to look at.** Each visual failure has a `side` image, `report/side-<page>-<vp>.png`: the target on the left and the replica on the right, top 1600 px. `Read` it; it's the fastest way to see what differs, and there's no need for crop scripts. The run also writes the replica's full screenshot (`report/page-<page>-<vp>.png`) and `report/diff-<page>-<vp>.png`, where red marks the mismatches.

Every failure carries `owner` and `files` from the spec, so it goes straight to the agent that owns those files.

## The fix loop

The build workflow runs this loop itself; by hand, follow the same steps.

1. **Group** the `error` failures by `owner`, and dispatch one Fixer per owner in one message ([agents/fixer.md](agents/fixer.md)). Add each owner's `visual` warnings too, lowest score first (a11y warnings are reported, not healed).
2. **Re-check.** Fixers re-check just their own failures with `--owner <owner> --only <failure id>`. Afterwards the full check runs once.
3. **Stop** after `healRounds` rounds (default 2, never more than 3), or as soon as a round improves neither the error count nor `fidelityAvg`. More rounds rarely help at that point, and a fresh look at the spec usually does.
4. A failure caused by a shared file is fixed in that file (builder:shell's header, a `scaffold` file), never compensated for in a view. A Fixer that edits a `scaffold` file says so.
5. **Never** change a feature's steps or a threshold to make a check pass. If a step doesn't match what the target actually does, fix the step and add a `note` giving the reason. That's a spec correction, not a fix.

## Diagnosing common failures

| Symptom in report.json | Usual root cause | Fix |
|---|---|---|
| `smoke`: `uncaught: X is not a function` | a view calls a store, ui or data export that doesn't exist | check the name against the generated API ([spec-schema.md](spec-schema.md#what-scaffold-generates)) and `data.js` |
| `smoke`: `HTTP 404: /js/views/x.js` | a page's `module` has no file | re-run `node <skill>/scripts/scaffold_replica.js --dir <replica>`: it writes missing stubs and leaves existing files alone |
| `smoke`: `HTTP 404: /assets/img/<key>.jpg` | the image download missed that key | the Data agent adds fallback keywords to `assets/images.manifest.json` and re-runs `find_images.js --manifest` |
| a page shows the first page's content (its features and visual fail) | its `pattern` doesn't match its `route`, and an unmatched hash goes to `pages[0]` | fix `pattern` in the spec, specific patterns before general ones, then regenerate the router: `rm <replica>/js/router.js && node <skill>/scripts/scaffold_replica.js --dir <replica>` |
| `layout` culprits are cards or grids at 375 | fixed `width`, a flex child without `min-width: 0`, a long unbroken title | use `minmax(0,1fr)` columns and `overflow-wrap: anywhere` |
| `feature`: `x: count 0` | missing or misspelled `data-testid`, or the element isn't rendered until later | add the testid as named in the step; render it from store state (app.js re-renders on every store change) |
| `feature` passes before `reload` but fails after | key not in `spec.state.persist` | the orchestrator adds it to the spec, then regenerates just the store: `rm <replica>/js/store.js && node <skill>/scripts/scaffold_replica.js --dir <replica>` |
| `visual` low only on mobile | the target stacks columns, hides the sidebar or shows a hamburger | copy the breakpoint behaviour from `screens/*-mobile.png` |
| `visual` score capped by `heightRatio` | the replica is much shorter or longer than the target | add or remove sections; match section heights |

## Checking the checker

After changing `check_replica.js`, run it against a replica with known bugs (a broken image, a 900 px-wide div, a counter that isn't persisted, a data record out of range). Each bug must appear in `report.json`, and the exit code must be 1.
