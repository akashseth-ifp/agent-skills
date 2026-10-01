# Fixer agent

**Job:** make one owner's failing checks pass by fixing the root cause in that owner's files. Dispatch one Fixer per owner that has failures, all in one message.

## Prompt template

Placeholders: `<replica>`, `<skill>` (absolute paths), `<owner>`, `<failures>` (the failure objects from report.json: id, kind, message, screenshot, side, files), `<files>` (the union of their `files`).

```text
You are fixing failing checks in a website replica at <replica>/.

Your failures (from report.json, all owned by <owner>):
<failures>

You may edit ONLY: <files>.
Do NOT edit spec.json, the scripts, or another owner's files. Never change a test step or
threshold to make it pass. If the cause is in a shared file (the header in index.html/base.css/
shell.js, the store) or in another owner's file, don't compensate in your own files (for example
with an offset that cancels out a header that's too tall). Report it, so it gets fixed where every
page benefits. Files owned by "scaffold" (store.js, router.js, app.js, ui.js, tokens.css) change
only when a failure is traced to them; if you change one, say so in your summary.

Token budget: every tool call re-reads your whole context. At most 12 tool calls and 3 image
Reads. For the spec details of your owner, run node <skill>/scripts/brief.js --dir <replica> --owner
<owner> instead of reading spec.json; never cat a whole large file.

How to work
1. Look before you edit (Read tool). For visual failures, Read the failure's `side` image
   (report/side-<page>-<vp>.png: target left, replica right, top 1600px); fix the largest
   differences first. For the rest, Read its `screenshot`. Don't write crop or compare scripts.
2. Find the root cause before editing. Common ones by kind:
   - smoke: a JS exception (check the message's stack/line), a wrong asset path, a 404 import.
   - layout: the elements listed as culprits have fixed widths, missing min-width:0 in
     flex/grid children, long unbroken strings, or tables/images without max-width.
   - feature: a missing or misspelled data-testid, a handler not bound after re-render, state not
     persisted (a key missing from spec.state.persist is a spec problem: report it), or an element
     hidden with CSS at that moment.
   - visual: a section's height, spacing or background differs from the target.
   - data: a record that breaks a field constraint or rule. Fix the generator, not just one record.
3. Re-check just your failures. The checker serves the replica itself; start no server:
     node <skill>/scripts/check_replica.js --dir <replica> --owner <owner> --only <failure id> --target <replica>/target
   (for example --only feature:add-to-basket or --only visual:detail/mobile). Read the failures it
   prints; report.json is shared with the other Fixers. At most 3 re-checks per failure, then stop
   and report.

Return at most 8 lines: for each failure id, fixed / not fixed, the root cause in one line, and, if
not fixed, the file that would need the change.
```
