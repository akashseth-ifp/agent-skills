---
name: web-replica-generator
description: >-
  Build a high-fidelity, interactive replica of a website from its URL (e.g. amazon.com, stripe.com,
  airbnb.com, an admin dashboard). Measures the real site with Playwright (screenshots, computed styles,
  real content samples), turns that into a spec of features and data, builds the views in parallel with
  subagents, then proves the result with generated Playwright tests and a visual fidelity score, and
  fixes failures in a bounded self-healing loop. Use when asked to clone, replicate, recreate or mock up
  a real website or web app.
---

# Web Replica Generator

You are the **orchestrator**. You start the build workflow, which captures the target, gets a spec written, scaffolds the foundation, builds the shell, the views and the data in parallel, then checks and heals. You review what comes back, stamp the cost and report to the user.

**Rule 0: measure, don't recall.** Colours, fonts, sizes, content shapes and features come from `target/capture.json` and the screenshots, not from what you remember about the brand. If the site can't be measured, say so in the spec (`"measured": false`) and in your final report.

## Files and their owners

```
<replica>/                    the output project, an absolute path (default: ./<site>-replica)
├── .start                    touched when the build starts; its mtime gives the minutes in the report
├── target/                   capture_target.js output: capture.json, screens/, states/
├── spec.json                 the contract (the Analyst writes it, then only you edit it)
├── css/tokens.css, js/store.js, js/router.js, js/app.js, js/ui.js     ← scaffold (generated, nobody edits it)
├── index.html, css/base.css, js/shell.js                               ← builder:shell (header, nav, drawers, popovers, footer)
├── js/data.js, assets/img/, assets/images.manifest.json                ← data (seed from scaffold, then the full set)
├── css/<view>.css, js/views/<view>.js                                  ← one builder:<name> per group of views
└── report.json, report/      check_replica.js output, incl. report/side-<page>-<vp>.png per visual failure
```

`<skill>` is this skill's directory, the one holding this file. Run `npm install` in `<skill>` once. If Playwright's Chromium is missing, the scripts fall back to the system Chrome, or you can run `npx playwright install chromium`.

Also once, from the project root, register the lean agent type: `mkdir -p .claude/agents && ln -s ../../skills/web-replica-generator/agents/replica-worker.md .claude/agents/replica-worker.md` (adjust the link if `<skill>` lives elsewhere). It has only the file, shell and web tools, about 12k fewer tokens on every agent turn. Agent types load at session start, so it takes effect after a restart; until then the workflow falls back to `general-purpose` by itself.

The spec and report formats, and the runtime API that scaffold generates (store, router, ui, app, the shell and view contract), are in [references/spec-schema.md](references/spec-schema.md).

## 1. Run the build workflow (primary path)

Invoking this skill is the user's opt-in to this workflow.

```js
Workflow({ scriptPath: '<skill>/workflows/build-replica.js',
           args: { url: '<url>', journey: ['<listing-url>', '<detail-url>'], replica: '<abs replica>',
                   skill: '<abs skill>', focus: '<what the user asked for>', maxBuilders: 3, healRounds: 2 } })
```

- `journey`, `focus`, `maxBuilders` and `healRounds` are optional. Omit `journey` only when you don't know the journey (see the capture tips).
- `maxBuilders` counts view Builders; builder:shell and Data come on top. Raise it above 3 only for more than 6 views.
- `healRounds` defaults to 2. Never pass more than 3.
- `agentType` is optional too: without it the workflow uses `replica-worker` when it is registered, else `general-purpose`, and logs which. When you resume a run with `resumeFromRunId`, pass the type that run used, so its cached calls still match.

It writes `<replica>/.start`, runs every phase and returns `{ final, rounds, history, agents, owners, reconstructed, served, notes }`: `final` is the last check's summary and failures, `history` the errors and fidelity after each check, `served` what the site showed this machine (localization, hidden prices). Time targets: capture 1–3 min, spec 2–5, scaffold under 1, build 6–15, check about 1, heal 3–10.

No Workflow tool, or a phase failed? Use the [manual path](#3-manual-path-no-workflow-tool). Every phase leaves its output on disk, so start from the phase that failed.

### Capture tips

- **Pass the journey.** Automatic link picking often lands on side pages (Amazon Music). Give the listing and detail URLs in `journey`. To get a real detail URL, capture the listing first and take one from `cardGroups[].samples[].links`.
- **Check what the site served you.** Big sites localize by IP address (Amazon showed "Deliver to India" and hid prices and Add to Cart). Anything the capture couldn't see gets reconstructed in the site's measured visual language. It goes in `spec.reconstructed` and in the final report.
- **Very long pages** (a product page with brand marketing images, an endless feed): set `pages[].visualMaxHeight` so the visual score covers only what the replica is meant to match: a number for every viewport, or `{ "desktop": 4000, "mobile": 2500 }` per viewport (e.g. a mobile page that scrolls an inner container).
- **BLOCKED** in the capture output: follow "Blocked targets" in [reconnaissance-playbook.md](references/reconnaissance-playbook.md).
- Mobile screenshots use a phone user agent, so they show the site's real mobile layout.

## 2. Review, stamp, report

**Review the result.**
- Read `final` and `notes` from the result (or `<replica>/report.json` → `summary`): errors, warnings, `featureCoverage`, `fidelity` per page/viewport, what each owner couldn't fix.
- `Read` the two or three `report/side-*.png` with the lowest fidelity (target left, replica right). Look for what the score misses: wrong imagery, a missing section, a broken header.
- Go through the [spec checklist](#spec-checklist) and the [guardrails](#guardrails) on the finished replica.
- A `must` feature still failing, or a guardrail broken: dispatch one Fixer for that owner ([agents/fixer.md](references/agents/fixer.md)), then run the full check once. That counts as a heal round.

**Stamp the cost** into `report.json`: `rounds` and `agents` from the result (plus any Fixer you added), minutes since `.start`:

```bash
node -e 'const fs=require("fs"),[d,rounds,agents]=process.argv.slice(1),f=d+"/report.json",r=JSON.parse(fs.readFileSync(f));r.cost={rounds:+rounds,agents:+agents,minutes:Math.round((Date.now()-fs.statSync(d+"/.start").mtimeMs)/60000)};fs.writeFileSync(f,JSON.stringify(r,null,2))' <replica> <rounds> <agents>
```

**Report to the user.**
- **Numbers:** errors and warnings, feature coverage, fidelity per page/viewport, heal rounds, agents used and minutes.
- **What's measured vs reconstructed**, and the known gaps.
- **How to run it:** `npx serve <replica>`.

## 3. Manual path (no Workflow tool)

These are the same phases, dispatched with the `Agent` tool (`subagent_type: "replica-worker"` once it is set up, else `general-purpose`). Run `mkdir -p <replica> && touch <replica>/.start` first.

1. **Capture** (1–3 min). It also writes `target/summary.json`, the compact digest the Analyst reads. `Read` `target/screens/*-desktop.png`, `*-mobile.png` and `states/*.png`; they are the ground truth for the rest of the run.
   ```bash
   node <skill>/scripts/capture_target.js <url> [<journey-url> …] --out <replica>/target --pages 3
   node <skill>/scripts/draft_spec.js --dir <replica>      # spec.draft.json: the mechanical half of the spec
   ```
2. **Spec.** Dispatch one Agent with [agents/analyst.md](references/agents/analyst.md). It writes only the judgement parts (`spec.parts.json`) and `draft_spec.js --merge` combines them with the draft into `spec.json`; the merge must exit 0. Review `spec.json` against the [spec checklist](#spec-checklist). From here on only you edit `spec.json`. If you change a feature, write the reason in its `note`.
3. **Scaffold** (~1 s). This generates tokens, store, router, app and ui, a starter `index.html` and `base.css`, stub views, a stub `shell.js`, and the seed `js/data.js` from `spec.data.seed`. It never overwrites an existing file, so a re-run is safe.
   ```bash
   node <skill>/scripts/scaffold_replica.js --dir <replica>
   ```
4. **Build.** In **one message**, dispatch builder:shell ([agents/shell.md](references/agents/shell.md)), one Builder per view owner ([agents/builder.md](references/agents/builder.md)) and the Data agent ([agents/data.md](references/agents/data.md)). They all start at once, because the seed data exists from minute 0. Fill each template's `<…>` placeholders from the spec. Each agent writes only its own files, self-checks with `--owner` (at most 3 checker runs) and returns 10 lines or fewer.
5. **Check** (~1 min). The checker serves the replica itself on a free port, so don't start a server.
   ```bash
   node <skill>/scripts/check_replica.js --dir <replica> --target <replica>/target
   ```
   `report.json` lists each failure's `kind`, `owner`, `files`, `message`, `screenshot` and, for visual failures, `side`. [qa-validation-protocol.md](references/qa-validation-protocol.md) explains each check.
6. **Heal.** Group the `error` failures by owner and dispatch one Fixer per owner in one message ([agents/fixer.md](references/agents/fixer.md)). Include each owner's `visual` warnings too, worst score first. Re-run step 5. Follow the [heal rules](#heal-rules).
7. **Review, stamp, report** as in section 2.

## Token economy

A build's cost is almost all **input**: every tool call re-reads the agent's whole context, and each agent starts at about 31k tokens of system prompt and tool definitions (about 19k as `replica-worker`, see the setup above). So the cost is roughly (number of calls) × (context size); output is under 1%. The templates enforce this, and you should too:

- **Briefs, not dumps.** Agents start with `node <skill>/scripts/brief.js --dir <replica> --owner <owner>` (about 5–10 KB: their files, pages, features with steps, tokens, measured styles, data shape, runtime API, commands). The Analyst reads `target/summary.json` (a digest of `capture.json`, about 15 KB). Nobody `cat`s `spec.json`, `capture.json`, the generated sources or the references.
- **Scripts do the mechanical work.** `draft_spec.js` writes tokens, brand, locale and currency, pages, routes, patterns, sources, file owners and thresholds into `spec.draft.json`, so the Analyst writes only the judgement parts.
- **Budgets:** Builders and shell 25 tool calls / 6 image Reads, Analyst 15 / 8, Data 15, Fixers 12 / 3. Each file gets one Write, and commands are batched.
- **Images are cached and time-boxed:** `find_images.js` keeps downloads in `~/.cache/web-replica-generator/` and never runs past `--max-time` (150 s), so it doesn't hold up the build.
- **You, the orchestrator,** keep your own context small too: read the workflow result and at most two `report/side-*.png`, not the whole report or every screenshot.

## Spec checklist

- Every interactive thing visible in the screenshots is a feature with `steps`. The main user journey is `"priority": "must"`.
- Every file in `files` has exactly one owner. Every page has `pattern`, `module` and `owner`. Header, nav, drawer, popover and footer features belong to `builder:shell`.
- `data.seed` has at most 6 records: every fixture a step relies on plus 1–2 more (the id in a `goto` route, the record a search term must find). Every `data.extras` export has a seed.
- `tokens` are values from `capture.json`. `data.fields` match the real samples; `locale`, `currency` and `currencyDigits` match the price format in the samples. `brand` is set.
- The stack follows the rule below.

**Stack decision.** Use plain HTML + ES modules (`"stack": "vanilla"`) by default: there is no build step, and the fix loop is edit → reload. Use Vite + React (`"stack": "react"`) only when there are more than 5 views, the same widgets are reused across views (for example dashboards), or the user wants code to hand to developers. With React, `files` lists components (`src/components/X.jsx`), and each Builder owns its components. The scaffold and the workflow generate the vanilla stack only. For React, take the manual path and write the foundation yourself in place of step 3.

## Heal rules

- **Stop** after `healRounds` rounds (default 2, never more than 3), or when a round improves neither the error count nor `fidelityAvg` (a rise under 0.01 counts as no gain). Whatever remains is a known gap in your report, not something to hide.
- **Hand-offs:** a Fixer that traces a failure to another owner's file names it in `notFixed`. The workflow hands it to that owner in the next round, and the no-gain stop waits while a hand-off is pending (the round cap still holds).
- **Never** edit a test (`spec.features[].steps`) or a threshold to make a check pass. If a step is genuinely wrong (for example it doesn't match what the target does), fix the step and write the reason in `note`.
- Files owned by `scaffold` are edited only when a failure is traced to them, and the Fixer says so in its summary.

## Guardrails

- The replica is for internal demos and prototyping. Keep the footer's `data-replica-note` "not affiliated" line.
- Use the target's logo only as captured for the demo. Don't add other trademarks or harvested product photos. Mock images come from [media-and-asset-pipeline.md](references/media-and-asset-pipeline.md).
- No working login, payment or data-collection forms. They should look real but submit to the local store only.
- Don't try to defeat CAPTCHAs or bot protection. Take the "Blocked targets" path instead.

## References

| File | Read when |
|---|---|
| [spec-schema.md](references/spec-schema.md) | writing or reviewing spec.json, the generated runtime API, reading report.json |
| [workflows/build-replica.js](workflows/build-replica.js) | what each workflow phase tells its agents |
| [agents/](references/agents/) | dispatching Analyst, builder:shell, Builders, Data, Fixer by hand |
| [archetypes/](references/archetypes/) | the Analyst picks one; you check the spec against it |
| [reconnaissance-playbook.md](references/reconnaissance-playbook.md) | capture fails or is blocked |
| [design-token-system.md](references/design-token-system.md) | tokens.css and the shared atoms in base.css |
| [state-and-synthetic-data.md](references/state-and-synthetic-data.md) | the store API and data generation |
| [media-and-asset-pipeline.md](references/media-and-asset-pipeline.md) | images, icons, fallbacks |
| [qa-validation-protocol.md](references/qa-validation-protocol.md) | interpreting check failures |
| [examples/books-toscrape-walkthrough.md](examples/books-toscrape-walkthrough.md) | a full v2 run, end to end |
