export const meta = {
  name: 'build-replica',
  description: 'Build a website replica end to end: capture, spec, scaffold, parallel builders + data, check, bounded heal',
  whenToUse: 'Run by the web-replica-generator skill (see SKILL.md and references/spec-schema.md). Args: { url, journey?, replica, skill, focus?, maxBuilders?, healRounds?, agentType? }',
  phases: [
    { title: 'Capture', detail: 'measure the target with capture_target.js, draft the mechanical spec with draft_spec.js' },
    { title: 'Spec', detail: 'the Analyst writes spec.parts.json and merges it into spec.json' },
    { title: 'Scaffold', detail: 'generate the foundation and smoke-check it' },
    { title: 'Build', detail: 'shell + view builders (build, then fix) and the Data agent, concurrently' },
    { title: 'Check', detail: 'one full check_replica.js run' },
    { title: 'Heal', detail: 'one Fixer per failing owner, re-check, stop on no gain' },
    { title: 'Report', detail: 'return the numbers to the orchestrator' },
  ],
}

// build-replica.js — the whole fast build (see SKILL.md and references/spec-schema.md) as one deterministic run.
//
// Run from Claude Code with the Workflow tool:
//   Workflow({ scriptPath: '<skill>/workflows/build-replica.js', args: {
//     url: 'https://books.toscrape.com/',
//     journey: ['<listing-url>', '<detail-url>'],     // optional: extra pages after url, in order
//     replica: '/abs/path/books-replica', skill: '/abs/path/web-replica-generator',
//     focus: 'optional user focus', maxBuilders: 3, healRounds: 2,
//     agentType: 'replica-worker' } })                 // optional: pin the agent type (skips the probe below)
//
// Returns { final, rounds, history, agents, owners, reconstructed, served, notes }. The orchestrator
// writes the user-facing report and computes minutes from <replica>/.start (written in Capture).
// This is a Workflow script, not a module: the runtime wraps the body in an async function,
// which is why it ends with a top-level return.

const A = args || {}
const missing = ['url', 'replica', 'skill'].filter(k => typeof A[k] !== 'string' || !A[k].trim())
if (missing.length) throw new Error(`build-replica: missing required args: ${missing.join(', ')}. Pass { url, replica: "<abs path>", skill: "<abs path>" }.`)
for (const k of ['replica', 'skill']) if (!A[k].startsWith('/')) throw new Error(`build-replica: args.${k} must be an absolute path, got "${A[k]}"`)

let agents = 0
const notes = []
const warn = msg => { log(`warning: ${msg}`); notes.push(`warning: ${msg}`) }
// Everything returned lands in the orchestrator's context for the rest of its session: keep each note short.
const short = (t, n = 300) => (t && t.length > n ? t.slice(0, n - 1) + '…' : t || '')

// shell-quote only when needed, so plain paths stay readable in prompts (URL queries have ? and &, paths may have spaces)
const q = s => (/^[\w@%+=:,./-]+$/.test(String(s)) ? String(s) : "'" + String(s).replace(/'/g, "'\\''") + "'")
const int = (v, d) => (Number.isFinite(Number(v ?? d)) ? Math.floor(Number(v ?? d)) : d)
const R = A.replica.replace(/\/+$/, '')
const S = A.skill.replace(/\/+$/, '')
const qR = q(R), qT = q(`${R}/target`)
const journey = [].concat(A.journey || [])
const maxBuilders = Math.max(1, int(A.maxBuilders, 3))
const healRounds = Math.min(3, Math.max(0, int(A.healRounds, 2))) // SKILL.md: never more than 3
if (healRounds !== A.healRounds && A.healRounds !== undefined) warn(`healRounds ${JSON.stringify(A.healRounds)} clamped to ${healRounds}`)
const CHECK = `node ${q(`${S}/scripts/check_replica.js`)} --dir ${qR}`
const SCAFFOLD_FILES = ['css/tokens.css', 'js/store.js', 'js/router.js', 'js/app.js', 'js/ui.js'] // the scaffold-owned files (spec-schema.md), if the spec omits them
const SHARED_REPORT = "Other agents run the checker at the same time and share report.json, so trust your own run's console output."
// replica-worker (agents/replica-worker.md) has only the file, shell and web tools: about 12k fewer tokens per turn than
// general-purpose. It exists only once symlinked into .claude/agents (SKILL.md), so unless args.agentType pins a type,
// the first call decides it: replica-worker, or general-purpose when the runtime can't resolve or use replica-worker.
// ponytail: the probe isn't shared, so concurrent first calls would each probe; the first call (Capture) runs alone.
if (A.agentType !== undefined && (typeof A.agentType !== 'string' || !A.agentType.trim())) throw new Error(`build-replica: args.agentType must be an agent type name, got ${JSON.stringify(A.agentType)}`)
let agentType = A.agentType || null
if (agentType) log(`agent type: ${agentType} (pinned by args.agentType)`)
// The runtime's agentType errors all start "agent({agentType}):" (not found, denied by a permission rule, tool pool denied).
const TYPE_ERROR = /^agent\(\{agentType\}\):|agent type\b.*\bnot found/i
// A resumed run reuses cached calls only while they match, and the probe makes the calls depend on the agent type.
const resume = () => `re-run with resumeFromRunId and args.agentType: '${agentType}' (Capture is kept when the agent type matches this run's)`
async function run(label, phaseTitle, prompt, schema, effort) {
  agents++
  const call = type => agent(prompt, { label, phase: phaseTitle, schema, agentType: type, ...(effort ? { effort } : {}) })
  if (agentType) return call(agentType)
  try {
    const r = await call('replica-worker')
    agentType = 'replica-worker'
    log('agent type: replica-worker')
    return r
  } catch (e) {
    const msg = String(e?.message ?? e)
    if (!TYPE_ERROR.test(msg)) throw e
    agentType = 'general-purpose'
    const why = `agent type: general-purpose (replica-worker unavailable: ${short(msg.split('\n')[0], 160)}; see the setup line in SKILL.md)`
    log(why)
    notes.push(why)
    return call(agentType)
  }
}

const str = { type: 'string' }, num = { type: 'number' }, bool = { type: 'boolean' }, numOrNull = { type: ['number', 'null'] }
const arr = items => ({ type: 'array', items })
const strs = arr(str)
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required })
const scores = { type: 'object', additionalProperties: num }

const CAPTURE_SCHEMA = obj({ pages: arr(obj({ name: str, url: str, blocked: bool })), blocked: bool, served: str })
const SPEC_SCHEMA = obj({
  pages: arr(obj({ id: str, source: { type: ['string', 'null'] } })),
  owners: arr(obj({ owner: str, pages: strs, files: strs, features: strs })),
  featureCount: num, mustCount: num, reconstructed: strs, notes: str, merged: bool, specExists: bool,
})
const SCAFFOLD_SCHEMA = obj({ ok: bool, written: strs, smokeErrors: strs })
const BUILD_SCHEMA = obj({ owner: str, files: strs, featuresPassing: strs, featuresFailing: strs, visual: scores, notes: str })
const FIX_SCHEMA = obj({ owner: str, fixed: strs, notFixed: arr(obj({ id: str, reason: str })), notes: str })
const DATA_SCHEMA = obj({ records: num, images: obj({ downloaded: num, missing: strs }), notes: str })
const CHECK_SCHEMA = obj({
  passed: bool, errors: num, warnings: num, featureCoverage: numOrNull, fidelity: scores, fidelityAvg: numOrNull,
  failures: arr(obj({ id: str, kind: str, severity: str, owner: str, message: str, side: str, screenshot: str, files: strs }, ['id', 'kind', 'severity', 'owner', 'message'])),
})

// ---------------------------------------------------------------- Capture
phase('Capture')
const capCmd = `node ${q(`${S}/scripts/capture_target.js`)} ${[A.url, ...journey].map(q).join(' ')} --out ${qT}`
const capture = await run('capture', 'Capture', `Goal: measure the website ${A.url} so a replica can be built from evidence in ${R}. Write nothing outside ${R}.

1. mkdir -p ${qR} && date +%s > ${q(`${R}/.start`)}
2. Capture (if playwright is missing, run npm install in ${q(S)} first):
${journey.length ? `   ${capCmd}` : `   ${capCmd} --pages 3
   If this is an e-commerce site (cardGroups with prices in ${R}/target/capture.json) and the auto-picked pages are not the
   main shopping journey (home, listing or search results, product detail): find a listing URL, capture it if needed, take a
   real product URL from its pages[].cardGroups[].samples[].links, and re-run with the explicit journey:
   node ${q(`${S}/scripts/capture_target.js`)} ${q(A.url)} '<listing-url>' '<detail-url>' --out ${qT}`}
3. If the output says BLOCKED, follow "Blocked targets" in ${S}/references/reconnaissance-playbook.md.
   Never try to defeat CAPTCHAs or bot protection.
4. Use the Read tool to look at ${R}/target/screens/<page>-desktop.png for each page and the first page's -mobile.png.
   Note what the site served this machine that a normal visitor wouldn't see: localization (country, language,
   currency), hidden prices or buy buttons, cookie or sign-in walls, empty sections.
5. After the last capture: node ${q(`${S}/scripts/draft_spec.js`)} --dir ${qR}   (writes ${R}/spec.draft.json)

Return pages (name and url from capture.json, and its blocked flag), blocked (the whole target), and served
(one short paragraph from step 4, or "normal" if nothing was unusual).`, CAPTURE_SCHEMA, 'low')

if (!capture) warn('the Capture agent returned nothing; continuing with whatever is in target/')
const blocked = !!capture?.blocked
if (blocked) warn('the target looks blocked, so the spec is reconstructed (measured: false)')
const served = capture?.served || 'unknown (capture returned nothing)'

// ---------------------------------------------------------------- Spec
phase('Spec')
const spec = await run('analyst', 'Spec', `Goal: get ${R}/spec.json written for a replica of ${A.url}. You write only
${R}/spec.parts.json; draft_spec.js --merge combines it with ${R}/spec.draft.json (from Capture) into spec.json.
If spec.draft.json is missing, first run: node ${q(`${S}/scripts/draft_spec.js`)} --dir ${qR}

Read ${S}/references/agents/analyst.md and follow its prompt template exactly, filled with these values:
- replica: ${R}
- skill: ${S}
- user's focus: ${A.focus || '(none)'}
- max view builders (builder:shell is extra): ${maxBuilders}
- measured: ${!blocked}
- what the site served (anything the capture couldn't see goes into spec.reconstructed): ${served}

When the merge has exited 0 (or you have given up on it), return:
- pages: spec.pages in order, each as {id, source}
- owners: every distinct owner in spec.files (scaffold, data, builder:shell and each view builder), each with its page ids
  (spec.pages[].owner), its file paths (spec.files keys) and its feature ids (spec.features[].owner)
- featureCount, mustCount (features with priority "must"), reconstructed (spec.reconstructed)
- notes: at most 5 lines: archetype, data entity and count, anything in the screenshots you couldn't express.
- merged: true when your last draft_spec.js --merge exited 0; specExists: true when ${R}/spec.json exists.`, SPEC_SCHEMA)

if (!spec) throw new Error(`build-replica: the Analyst returned nothing, so there is no owner list to build from. Check ${R}/spec.json and ${resume()}.`)
if (!spec.specExists) throw new Error(`build-replica: the Analyst finished without ${R}/spec.json (merge ${spec.merged ? 'exited 0' : 'never succeeded'}). Fix ${R}/spec.parts.json, re-run draft_spec.js --merge, then ${resume()}.`)
if (!spec.merged) warn('draft_spec.js --merge never exited 0, so spec.json was not merged and validated by it; check it against the spec checklist')
const owners = spec.owners || []
for (const o of owners) if (!o.files?.length) warn(`owner ${o.owner} has no files in spec.files`)
const pages = spec.pages || []
const shell = owners.find(o => o.owner === 'builder:shell')
const views = owners.filter(o => o.owner.startsWith('builder:') && o !== shell)
const builders = shell ? [shell, ...views] : views
if (!shell) warn('spec has no builder:shell owner, so the header and footer stay scaffold placeholders')
if (views.length > maxBuilders) warn(`the spec has ${views.length} view builders for maxBuilders ${maxBuilders}; at most ${maxBuilders} run at once, the rest queue`)
const ownerFiles = owners.find(o => o.owner === 'scaffold')?.files
const scaffoldFiles = ownerFiles?.length ? ownerFiles : SCAFFOLD_FILES
log(`spec: ${spec.featureCount} features (${spec.mustCount} must), builders ${builders.map(b => b.owner).join(', ')}`)

// ---------------------------------------------------------------- Scaffold
phase('Scaffold')
let scaffold = await run('scaffold', 'Scaffold', `Goal: generate the foundation of the replica in ${R} and smoke-check it. Don't edit any file yourself.

1. node ${q(`${S}/scripts/scaffold_replica.js`)} --dir ${qR}
2. ${CHECK} --only smoke
   (it serves the replica itself; exit code 1 only means there are failures)

Return ok (scaffold exited 0 AND the smoke check has no error failure), written (the files scaffold reported writing),
smokeErrors (the message of each smoke error in ${R}/report.json, [] if none).`, SCAFFOLD_SCHEMA, 'low')

if (!scaffold?.ok) {
  log(`scaffold not ok (${scaffold ? `${scaffold.smokeErrors.length} smoke errors` : 'agent returned nothing'}), one retry`)
  scaffold = await run('scaffold:fix', 'Scaffold', `Goal: the generated foundation of the replica in ${R} fails its smoke check. Make it pass.

Previous attempt (null = that agent died): ${JSON.stringify(scaffold)}

1. If ${R}/index.html or ${R}/js/app.js is missing, run: node ${q(`${S}/scripts/scaffold_replica.js`)} --dir ${qR}
2. Run ${CHECK} --only smoke (it serves itself) and fix the root cause of each error.
   You may edit ONLY files scaffold generated in ${R}: ${scaffoldFiles.join(', ')}, index.html, css/base.css,
   js/shell.js, js/data.js and the js/views/*.js and css/*.css stubs. Not spec.json, not ${S}/scripts. If the cause is in
   spec.json or in the scaffold script, leave it and name it in smokeErrors.
3. Re-run the smoke check. At most 3 rounds.

Return ok (smoke check has no error failure), written (the files you changed), smokeErrors (those still failing).`, SCAFFOLD_SCHEMA)
  if (!scaffold?.ok) warn(`scaffold still fails its smoke check: ${JSON.stringify(scaffold?.smokeErrors ?? 'no result')}`)
}

// ---------------------------------------------------------------- Build
phase('Build')
const list = xs => (xs?.length ? xs.join(', ') : '(none)')

const pageList = ids => list(ids.map(id => `${id} (source: ${pages.find(p => p.id === id)?.source ?? 'none'})`))

const buildOne = async o => {
  const build = await run(o.owner, 'Build', `You are ${o.owner}, building part of a website replica in ${R}.

Read ${S}/references/agents/${o === shell ? 'shell.md' : 'builder.md'} and follow its prompt template, filled with these values:
- owner: ${o.owner}
- replica: ${R}
- skill: ${S}
- files: ${list(o.files)}
- pages: ${o === shell ? (pages.length ? pageList(pages.map(p => p.id)) : 'every page in spec.pages') : pageList(o.pages || [])}
- features: ${list(o.features)}
Self-check with the template's own commands (the checker serves the replica itself; no server or port).

Return owner, files (written), featuresPassing and featuresFailing (feature ids from your last feature check), visual
({"<page>/<vp>": score} from your visual pass, {} if it didn't run), notes (at most 5 lines, including anything you need
from a shared file or another owner).`, BUILD_SCHEMA)

  const fix = build?.featuresFailing?.length ? await run(`fix:${o.owner}`, 'Build', `You are fixing ${o.owner}'s failing features in the website replica at ${R}.

Read ${S}/references/agents/fixer.md and follow its prompt template, filled with these values:
- owner: ${o.owner}
- replica: ${R}
- skill: ${S}
- files you may edit: ${list(o.files)}
- failures: features ${build.featuresFailing.join(', ')}. Get their failure objects by running
    ${CHECK} --owner ${o.owner} --only feature
Use that command to re-check (--only feature:<id> for one feature). At most 3 re-check runs. ${SHARED_REPORT}

Return owner, fixed (feature ids), notFixed ([{id, reason}]; name the file that needs the change when it isn't yours), notes.`, FIX_SCHEMA) : null
  return { build, fix }
}

// At most maxBuilders view builders at once; shell and Data run beside them.
// ponytail: fixed round-robin lanes, not a work queue, so a slow builder delays the ones queued behind it in its lane.
const lanes = Array.from({ length: Math.min(maxBuilders, views.length) }, (_, i) => views.filter((_, j) => j % maxBuilders === i))
const built = {}
const lane = os => async () => { for (const o of os) built[o.owner] = await buildOne(o) }

const [data] = await parallel([
  () => run('data', 'Build', `You are the Data agent for the website replica in ${R}.

Read ${S}/references/agents/data.md and follow its prompt template, filled with these values:
- replica: ${R}
- skill: ${S}
Builders are already working against the seed js/data.js. Replace it in one atomic swap (write js/data.next.js, then mv).

Return records (the count in the final js/data.js), images ({downloaded, missing: [keys]} from find_images.js),
notes (at most 5 lines).`, DATA_SCHEMA),
  ...(shell ? [lane([shell])] : []),
  ...lanes.map(lane),
])

for (const o of builders) {
  const r = built[o.owner]
  if (!r?.build) { warn(`${o.owner}: the builder returned nothing`); continue }
  const failing = r.fix ? (r.fix.notFixed || []).map(n => n.id) : r.build.featuresFailing || []
  notes.push(`${o.owner}: failing [${failing.join(', ')}]. ${short(r.build.notes)}${r.fix ? ` Fixer: ${short(r.fix.notes, 200)}` : ''}`)
}
if (data) notes.push(`data: ${data.records} records, ${data.images?.downloaded ?? 0} images, missing [${(data.images?.missing || []).join(', ')}]. ${short(data.notes)}`)
else warn('the Data agent returned nothing; js/data.js may still be the seed')

// ---------------------------------------------------------------- Check
const check = (label, phaseTitle) => run(label, phaseTitle, `Run: ${CHECK} --target ${qT}
(it serves the replica itself; exit code 1 only means there are failures). Edit nothing.
Then read ${R}/report.json and return its summary (passed, errors, warnings, featureCoverage, fidelity, fidelityAvg) and
every failure as {id, kind, severity, owner, message (first line only), and side, screenshot, files when present}.`, CHECK_SCHEMA, 'low')

phase('Check')
let last = await check('check', 'Check')
const history = []
const record = c => { history.push({ errors: c.errors, fidelityAvg: c.fidelityAvg }); log(`check: ${c.errors} errors, ${c.warnings} warnings, features ${c.featureCoverage}, fidelity ${c.fidelityAvg}`) }
if (last) record(last)
else warn('the check agent returned nothing, so healing is skipped')

// ---------------------------------------------------------------- Heal
phase('Heal')
const filesOf = owner => (owner === 'scaffold' ? scaffoldFiles : owners.find(o => o.owner === owner)?.files || [])
const healPrompt = (owner, failures, round) => {
  const files = filesOf(owner)
  return `You are fixing failing checks in the website replica at ${R} (heal round ${round}).

Read ${S}/references/agents/fixer.md and follow its prompt template, filled with these values:
- owner: ${owner}
- replica: ${R}
- skill: ${S}
- files you may edit: ${files.length ? files.join(', ') : `the spec.files entries in ${R}/spec.json owned by "${owner}"`}
- your failures (from ${R}/report.json):
${JSON.stringify(failures, null, 2)}
${owner === 'scaffold' ? 'These are generated scaffold files that the whole app shares. Change only what a failure traces to, and name every change and its reason in notes.\n' : ''}
"side" and "screenshot" paths are relative to ${R}; "side" is target left, replica right, top 1600px.
Use these commands instead of the template's (the checker serves the replica itself; no --url, no server):
  ${CHECK} --target ${qT} --only <failure id>${owner === 'scaffold' ? '' : `\n  ${CHECK} --target ${qT} --owner ${owner}     (all of your checks)`}
At most 3 re-check runs, then report. ${SHARED_REPORT}

Return owner, fixed (failure ids), notFixed ([{id, reason}]; name the file that needs the change when it isn't yours), notes (at most 5 lines).`
}

// A Fixer may trace a failure to a file another owner holds (e.g. builder:detail -> js/data.js). It must not edit
// that file, so the finding is handed to that owner as a target in the next round instead of being dropped.
const ownerOfPath = reason => [...owners, { owner: 'scaffold', files: scaffoldFiles }]
  .filter(o => (o.files || []).some(f => reason.includes(f.replace(/\/$/, ''))))
  .map(o => o.owner)
let handoffs = []

let rounds = 0
while (last && rounds < healRounds) {
  // ponytail: a11y warnings are reported, never healed; add them here if they start to matter.
  const targets = [...(last.failures || []).filter(f => f.kind !== 'a11y' && (f.severity === 'error' || f.kind === 'visual')), ...handoffs]
  handoffs = []
  if (!targets.length) break
  // errors first, then visual warnings worst score first (SKILL.md step 6)
  targets.sort((a, b) => (a.kind === 'visual') - (b.kind === 'visual') || (last.fidelity?.[a.id.slice(7)] ?? 1) - (last.fidelity?.[b.id.slice(7)] ?? 1))
  rounds++
  const groups = {}
  for (const f of targets) {
    const owner = !f.owner || f.owner === 'orchestrator' ? 'scaffold' : f.owner
    ;(groups[owner] ||= []).push(f)
  }
  const fixes = await parallel(Object.entries(groups).map(([owner, fs]) => () => run(`fix:${owner} r${rounds}`, 'Heal', healPrompt(owner, fs, rounds), FIX_SCHEMA)))
  for (const f of fixes) if (f) notes.push(`heal r${rounds} ${f.owner}: fixed [${(f.fixed || []).join(', ')}], not fixed [${(f.notFixed || []).map(n => `${n.id}: ${short(n.reason, 200)}`).join('; ')}]`)
  for (const f of fixes) for (const n of f?.notFixed || []) for (const to of ownerOfPath(n.reason || '').filter(o => o !== f.owner)) {
    handoffs.push({ id: `handoff:${n.id}`, kind: 'handoff', severity: 'error', owner: to, files: filesOf(to),
      message: `${f.owner} traced ${n.id} to your files and could not fix it there: ${n.reason}` })
    log(`heal r${rounds}: ${f.owner} hands ${n.id} to ${to}`)
  }

  const next = await check(`check r${rounds}`, 'Heal')
  if (!next) { warn(`heal r${rounds}: the check agent returned nothing, stopping`); break }
  log(`heal r${rounds}: errors ${last.errors} -> ${next.errors}, fidelity ${last.fidelityAvg} -> ${next.fidelityAvg}`)
  record(next)
  const noGain = next.errors >= last.errors && (next.fidelityAvg ?? 0) - (last.fidelityAvg ?? 0) < 0.01
  last = next
  if (noGain && !handoffs.length) { log(`heal: no gain in round ${rounds}, stopping`); break }
}
if (last && rounds === healRounds && (last.failures || []).some(f => f.severity === 'error')) log(`heal: stopped at the ${healRounds}-round cap with ${last.errors} errors left`)

// ---------------------------------------------------------------- Report
phase('Report')
return { final: last, rounds, history, agents, owners, reconstructed: spec.reconstructed || [], served, notes }
