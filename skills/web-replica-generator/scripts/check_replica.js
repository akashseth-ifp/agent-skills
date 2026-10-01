#!/usr/bin/env node
/**
 * check_replica.js — run every check spec.json defines against the replica, write report.json.
 *
 * Usage:
 *   node scripts/check_replica.js --dir replica [--target replica/target] [--owner builder:home]
 *                                 [--only <kind>[:<id>]] [--url http://localhost:5210] [--concurrency 6]
 *
 *   Without --url it serves --dir itself on a free port (no `npx serve`, no port clashes).
 *   --owner  only that owner's pages (page checks) and features; data runs only for --owner data.
 *   --only   one kind (smoke, layout, visual, a11y, feature, data), or one failure id from report.json,
 *            e.g. feature:add-to-basket or visual:detail/mobile (only that page × viewport is loaded).
 *   Page × viewport checks and features run concurrently, one browser context each (--concurrency).
 *
 * Checks (each failure lists owner + files so a Fixer agent knows exactly where to look):
 *   smoke   console errors, uncaught exceptions, failed requests, broken images   (per page × viewport)
 *   layout  horizontal overflow, with the widest offending elements              (per page × viewport)
 *   feature spec.features[].steps executed in a fresh browser context
 *   data    spec.data: record count, field types/ranges/enums, rules
 *   visual  layout similarity vs target screenshots (needs --target)             severity warn
 *           each failure also gets report/side-<page>-<vp>.png: target left, replica right, top 1600px
 *   a11y    axe-core serious/critical violations at desktop                       severity warn
 * Console: every failure with its full message, then a summary line, every page/viewport fidelity score and the
 *          failing feature ids (report.json is shared by parallel runs; the console is yours).
 * Exit code: 0 when there are no `error` failures, 1 otherwise, 2 on bad usage (incl. an --owner/--only
 *            that checks nothing, e.g. --only visual for pages without a target screenshot, or a busy --url
 *            that isn't serving --dir).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { VIEWPORTS, parseArgs, launchBrowser, gotoSettled, scrollThrough, serveDir, pool } from './lib.js';
import { layoutSimilarity, sideBySide } from './visual_diff.js';

const args = parseArgs();
const usage = msg => {
  console.error(msg);
  process.exit(2);
};
for (const k of ['dir', 'target', 'only', 'owner', 'url', 'concurrency']) if (args[k] === true) usage(`--${k} needs a value`);
const dir = path.resolve(args.dir || '.');
const targetDir = args.target && path.resolve(args.target);
const only = args.only; // e.g. "feature:add-to-basket" or "smoke" — re-check just what a Fixer touched
const owner = args.owner;
const concurrency = Math.max(1, parseInt(args.concurrency, 10) || 6);
let baseUrl = args.url && args.url.replace(/\/$/, ''); // set to our own server below when --url is absent
const specPath = path.join(dir, 'spec.json');
if (!fs.existsSync(specPath)) usage(`No spec.json in ${dir}`);
const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
const reportDir = path.join(dir, 'report');
fs.mkdirSync(reportDir, { recursive: true });

const filesOf = owner => Object.entries(spec.files || {}).filter(([, o]) => o === owner).map(([f]) => f);
// Each check collects into its own list so the report keeps task order, not completion order.
// Our server's port is random, so strip the base URL: the same failure reads the same on every run.
const failure = f => ({ severity: 'error', files: filesOf(f.owner), ...f, message: baseUrl ? f.message.replaceAll(baseUrl, '') : f.message });
const wants = kind => !only || only === kind || only.startsWith(kind + ':');
const url = route => baseUrl + (route.startsWith('/') ? route : '/' + route);
const targetShotOf = (pg, vp) => targetDir && pg.source && path.join(targetDir, 'screens', `${pg.source}-${vp}.png`);

// ---------- smoke + layout + visual, per page × viewport ----------
async function checkPage(browser, { pg, vp }) {
  const out = { failures: [], score: undefined };
  const fail = f => out.failures.push(failure(f));
  const [width, height] = VIEWPORTS[vp];
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', m => m.type() === 'error' && problems.push(`console: ${m.text().slice(0, 200)}`));
  page.on('pageerror', e => problems.push(`uncaught: ${e.message.slice(0, 200)}`));
  page.on('requestfailed', r => problems.push(`request failed: ${r.url().slice(0, 150)} (${r.failure()?.errorText})`));
  page.on('response', r => r.status() >= 400 && problems.push(`HTTP ${r.status()}: ${r.url().slice(0, 150)}`));
  const where = `${pg.id}/${vp}`;
  try {
    await gotoSettled(page, url(pg.route));
    await scrollThrough(page);
    const broken = await page.evaluate(() => [...document.images]
      .filter(i => i.getAttribute('loading') !== 'lazy' || i.complete)
      .filter(i => !i.getAttribute('src') || (i.complete && i.naturalWidth === 0))
      .map(i => i.getAttribute('src') || '(empty src)').slice(0, 10));
    broken.forEach(b => problems.push(`broken image: ${b}`));
    const shot = path.join(reportDir, `page-${pg.id}-${vp}.png`);
    await page.screenshot({ path: shot, fullPage: true });

    if (wants('smoke') && problems.length) {
      fail({ id: `smoke:${where}`, kind: 'smoke', owner: pg.owner, message: [...new Set(problems)].slice(0, 12).join('\n'), screenshot: rel(shot) });
    }
    if (wants('layout')) {
      const o = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth <= vw) return null;
        const culprits = [...document.querySelectorAll('body *')]
          .map(el => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.right > vw + 1 && r.width > 0)
          .sort((a, b) => b.r.right - a.r.right).slice(0, 5)
          .map(({ el, r }) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''} right=${Math.round(r.right)}`);
        return { scrollWidth: document.documentElement.scrollWidth, vw, culprits };
      });
      if (o) fail({ id: `layout:${where}`, kind: 'layout', owner: pg.owner, message: `horizontal overflow ${o.scrollWidth}px > ${o.vw}px\n${o.culprits.join('\n')}`, screenshot: rel(shot) });
    }
    const targetShot = targetShotOf(pg, vp);
    if (wants('visual') && targetShot && fs.existsSync(targetShot)) {
      const diff = path.join(reportDir, `diff-${pg.id}-${vp}.png`);
      const vmh = pg.visualMaxHeight; // number, or { desktop, tablet, mobile }
      const maxHeight = (vmh && typeof vmh === 'object' ? vmh[vp] : vmh) ?? undefined;
      const { score } = layoutSimilarity(targetShot, shot, diff, { maxHeight });
      out.score = score;
      const min = spec.thresholds?.visual ?? 0.8;
      if (score < min) {
        const side = sideBySide(targetShot, shot, path.join(reportDir, `side-${pg.id}-${vp}.png`));
        fail({ id: `visual:${where}`, kind: 'visual', severity: 'warn', owner: pg.owner, message: `layout similarity ${score} < ${min}. Side by side (target left, replica right): ${rel(side)}; full target ${rel(targetShot)}, replica ${rel(shot)}, diff ${rel(diff)} (red = mismatch).`, screenshot: rel(shot), side: rel(side) });
      }
    }
    if (wants('a11y') && vp === 'desktop') {
      const { violations } = await new AxeBuilder({ page }).analyze();
      const bad = violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
      if (bad.length) fail({ id: `a11y:${pg.id}`, kind: 'a11y', severity: 'warn', owner: pg.owner, message: bad.map(v => `${v.id} (${v.nodes.length}): ${v.help}`).join('\n') });
    }
  } catch (err) {
    fail({ id: `smoke:${where}`, kind: 'smoke', owner: pg.owner, message: `page did not load: ${err.message.split('\n')[0]}` });
  } finally {
    await ctx.close();
  }
  return out;
}

// ---------- features: spec.features[].steps ----------
const loc = (page, t) => (t.startsWith('css=') ? page.locator(t.slice(4)) : page.getByTestId(t));

async function runStep(page, s) {
  const T = 5000;
  if (s.goto !== undefined) return gotoSettled(page, url(s.goto));
  if (s.viewport) return page.setViewportSize({ width: VIEWPORTS[s.viewport][0], height: VIEWPORTS[s.viewport][1] });
  if (s.click) return loc(page, s.click).first().click({ timeout: T });
  if (s.hover) return loc(page, s.hover).first().hover({ timeout: T });
  if (s.fill) return loc(page, s.fill).first().fill(String(s.value), { timeout: T });
  if (s.select) return loc(page, s.select).first().selectOption(String(s.value), { timeout: T });
  if (s.press) return page.keyboard.press(s.press);
  if (s.reload) return page.reload({ waitUntil: 'domcontentloaded' });
  if (s.wait) return page.waitForTimeout(s.wait);
  // Assertions poll until true or timeout, so animations and debounces don't cause flaky failures.
  const poll = async (fn, describe) => {
    const end = Date.now() + T;
    let last;
    while (Date.now() < end) {
      last = await fn();
      if (last.ok) return;
      await page.waitForTimeout(100);
    }
    throw new Error(describe(last.got));
  };
  if (s.expectVisible) return poll(async () => ({ ok: await loc(page, s.expectVisible).first().isVisible(), got: 'hidden or missing' }), g => `${s.expectVisible} is ${g}`);
  if (s.expectHidden) return poll(async () => ({ ok: !(await loc(page, s.expectHidden).first().isVisible()), got: 'visible' }), g => `${s.expectHidden} is ${g}`);
  if (s.expectText) return poll(async () => {
    const l = loc(page, s.expectText).first();
    // Match against the full text; truncate only for the error message.
    const text = (await l.count()) ? (await l.innerText()).trim() : '(missing)';
    return { ok: text.includes(String(s.contains)), got: text.slice(0, 120) };
  }, g => `${s.expectText}: got "${g}", wanted it to contain "${s.contains}"`);
  if (s.expectCount) return poll(async () => {
    const n = await loc(page, s.expectCount).count();
    const ok = (s.eq === undefined || n === s.eq) && (s.min === undefined || n >= s.min) && (s.max === undefined || n <= s.max);
    return { ok, got: n };
  }, g => `${s.expectCount}: count ${g}, wanted ${JSON.stringify({ eq: s.eq, min: s.min, max: s.max })}`);
  if (s.expectUrl) return poll(async () => ({ ok: page.url().includes(s.expectUrl), got: page.url() }), g => `url is ${g}, wanted it to contain ${s.expectUrl}`);
  throw new Error(`unknown step ${JSON.stringify(s)}`);
}

async function checkFeature(browser, f) {
  const out = { failures: [], result: { id: f.id, passed: true } };
  const ctx = await browser.newContext({ viewport: { width: VIEWPORTS.desktop[0], height: VIEWPORTS.desktop[1] } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  for (const [i, s] of (f.steps || []).entries()) {
    try {
      await runStep(page, s);
    } catch (err) {
      out.result.passed = false;
      const shot = path.join(reportDir, `feature-${f.id}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      out.failures.push(failure({
        id: `feature:${f.id}`, kind: 'feature', severity: f.priority === 'should' ? 'warn' : 'error', owner: f.owner,
        message: `step ${i + 1} ${JSON.stringify(s)} failed: ${err.message.split('\n')[0]}${errors.length ? `\nuncaught: ${errors[0]}` : ''}`,
        screenshot: rel(shot)
      }));
      break;
    }
  }
  await ctx.close();
  return out;
}

// ---------- data ----------
async function checkData() {
  const d = spec.data;
  if (!d) return [];
  // Same defaults as scaffold_replica.js.
  const module = d.module ?? 'js/data.js', exportName = d.export ?? 'records';
  const problems = [];
  let records;
  try {
    const mod = await import(pathToFileURL(path.join(dir, module)).href + `?t=${Date.now()}`);
    records = mod[exportName];
    if (records === undefined) problems.push(`${module} has no export "${exportName}"`);
  } catch (err) {
    problems.push(`cannot import ${module}: ${err.message.split('\n')[0]} (data module must not touch window/document at import time)`);
  }
  if (records !== undefined && !Array.isArray(records)) problems.push(`${module} export "${exportName}" is not an array`);
  if (Array.isArray(records)) {
    if (d.count && records.length < d.count) problems.push(`${records.length} records, spec wants ≥ ${d.count}`);
    const ids = new Set();
    // Rules are written by our own Analyst agent into our own spec file, so evaluating them is safe.
    const rules = (d.rules || []).map(expr => ({ expr, fn: new Function('r', `return (${expr});`) }));
    records.forEach((r, i) => {
      const at = `record ${i} (${r.id ?? '?'})`;
      if (r.id !== undefined) {
        if (ids.has(r.id)) problems.push(`${at}: duplicate id`);
        ids.add(r.id);
      }
      for (const [k, f] of Object.entries(d.fields || {})) {
        const v = r[k];
        if (v === undefined || v === null || v === '') {
          if (f.required) problems.push(`${at}: missing ${k}`);
          continue;
        }
        if (f.type === 'array' ? !Array.isArray(v) : typeof v !== f.type) problems.push(`${at}: ${k} should be ${f.type}, got ${typeof v}`);
        if (f.min !== undefined && v < f.min) problems.push(`${at}: ${k}=${v} < min ${f.min}`);
        if (f.max !== undefined && v > f.max) problems.push(`${at}: ${k}=${v} > max ${f.max}`);
        if (f.enum && !f.enum.includes(v)) problems.push(`${at}: ${k}="${v}" not in ${JSON.stringify(f.enum)}`);
      }
      for (const { expr, fn } of rules) {
        let ok = false;
        try { ok = fn(r); } catch { /* treat a throwing rule as broken */ }
        if (!ok) problems.push(`${at}: rule failed: ${expr}`);
      }
    });
  }
  return problems.length ? [failure({ id: 'data', kind: 'data', owner: 'data', message: `${problems.length} problem(s):\n${problems.slice(0, 20).join('\n')}` })] : [];
}

function rel(p) { return path.relative(dir, p); }

// ---------- run ----------
const pageKinds = ['smoke', 'layout', 'visual', 'a11y'];
const onlyKind = only?.split(':')[0];
const onlyId = only?.includes(':') ? only.slice(only.indexOf(':') + 1) : null;
// A page failure id ("smoke:detail/mobile", "a11y:detail") names the page and viewport to reload.
const [onlyPage, onlyVp] = onlyId && pageKinds.includes(onlyKind) ? onlyId.split('/') : [];
const pageTasks = !only || pageKinds.some(wants)
  ? (spec.pages || []).filter(pg => (!owner || pg.owner === owner) && (!onlyPage || pg.id === onlyPage))
    .flatMap(pg => Object.keys(VIEWPORTS)
      .filter(vp => (!onlyVp || vp === onlyVp) && (onlyKind !== 'a11y' || vp === 'desktop'))
      // --only visual: skip page × viewports with no target screenshot, they would load and score nothing.
      .filter(vp => onlyKind !== 'visual' || fs.existsSync(targetShotOf(pg, vp) || ''))
      .map(vp => ({ pg, vp })))
  : [];
const featureTasks = wants('feature')
  ? (spec.features || []).filter(f => (!owner || f.owner === owner) && (!onlyId || onlyKind !== 'feature' || f.id === onlyId))
  : [];
// A selection that checks nothing (a typo in --owner or --only) must not come out as PASSED.
const owners = [...new Set([...(spec.pages || []), ...(spec.features || [])].map(x => x.owner).concat(Object.values(spec.files || {}), 'data'))];
if (owner && !owners.includes(owner)) usage(`--owner ${owner} matches nothing in spec.json. Owners: ${owners.join(', ')}`);
if (only && ![...pageKinds, 'feature', 'data'].includes(onlyKind)) usage(`--only ${only}: kind must be one of ${[...pageKinds, 'feature', 'data'].join(', ')}`);
if (onlyKind === 'visual' && !targetDir) usage('--only visual needs --target <replica>/target');
const dataTask = wants('data') && (!owner || owner === 'data') && !!spec.data;
if ((owner || only) && !pageTasks.length && !featureTasks.length && !dataTask) {
  usage(`nothing to check for${owner ? ` --owner ${owner}` : ''}${only ? ` --only ${only}` : ''}` +
    (onlyKind === 'visual' ? ' (no matching page has a target screenshot)' : ' (no matching page, feature or data)'));
}

const t0 = Date.now();
let server;
if (pageTasks.length || featureTasks.length) {
  if (baseUrl) {
    // Preflight: a busy port makes `serve` silently pick another one, and every check then fails against
    // whatever else is listening. Refuse to run unless the URL is serving this replica's index.html.
    const res = await fetch(baseUrl + '/').catch(err => ({ ok: false, status: err.cause?.code || err.message }));
    const html = res.ok ? await res.text() : '';
    const title = fs.readFileSync(path.join(dir, 'index.html'), 'utf-8').match(/<title>([^<]*)/)?.[1];
    if (!res.ok || (title && !html.includes(title))) {
      console.error(`${baseUrl}/ is not serving ${dir}/index.html (got ${res.status}). Is the port taken by another process?\n` +
        `Drop --url and check_replica.js serves ${dir} itself on a free port.`);
      process.exit(2);
    }
  } else {
    server = await serveDir(dir);
    baseUrl = server.url;
  }
}

const failures = [];
let featureResults = [];
const fidelity = {};
let browser;
try {
  if (pageTasks.length || featureTasks.length) {
    browser = await launchBrowser();
    const tasks = [...pageTasks.map(t => () => checkPage(browser, t)), ...featureTasks.map(f => () => checkFeature(browser, f))];
    const results = await pool(tasks, concurrency, run => run());
    results.forEach(r => failures.push(...r.failures));
    pageTasks.forEach((t, i) => { if (results[i].score !== undefined) fidelity[`${t.pg.id}/${t.vp}`] = results[i].score; });
    featureResults = results.slice(pageTasks.length).map(r => r.result);
  }
  if (dataTask) failures.push(...await checkData());
} finally {
  await browser?.close();
  await server?.close();
}

const errors = failures.filter(f => f.severity === 'error').length;
const scores = Object.values(fidelity);
const report = {
  passed: errors === 0,
  checkedAt: new Date().toISOString(),
  only: only || null,
  summary: {
    errors,
    warnings: failures.length - errors,
    featureCoverage: featureResults.length ? +(featureResults.filter(f => f.passed).length / featureResults.length).toFixed(2) : null,
    fidelity,
    fidelityAvg: scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3) : null,
    seconds: Math.round((Date.now() - t0) / 1000)
  },
  failures,
  features: featureResults
};
// Write-then-rename so a concurrent run (or reader) never sees half a report.json.
const reportPath = path.join(dir, 'report.json');
fs.writeFileSync(`${reportPath}.${process.pid}`, JSON.stringify(report, null, 2));
fs.renameSync(`${reportPath}.${process.pid}`, reportPath);

// The full message goes to the console: parallel agents share report.json, so their own output is what they can trust.
for (const f of failures) {
  const [head, ...rest] = f.message.split('\n');
  console.log(`${f.severity === 'error' ? '✖' : '⚠'} ${f.id} [${f.owner}] ${head}`);
  for (const line of rest) console.log(`    ${line}`);
  if (f.screenshot && !f.message.includes(f.screenshot)) console.log(`    screenshot: ${f.screenshot}`);
}
console.log(`\n${report.passed ? 'PASSED' : 'FAILED'}  errors:${errors} warnings:${report.summary.warnings}  features:${featureResults.length ? `${featureResults.filter(f => f.passed).length}/${featureResults.length}` : '-'}  fidelity:${report.summary.fidelityAvg ?? '-'}  (${report.summary.seconds}s)`);
// Per-page scores and failing ids here, so nobody digs them out of the shared report.json.
if (scores.length) console.log(`fidelity: ${Object.entries(fidelity).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
const failing = featureResults.filter(f => !f.passed).map(f => f.id);
if (failing.length) console.log(`failing features: ${failing.join(', ')}`);
console.log(`Report: ${path.join(dir, 'report.json')}`);
process.exit(report.passed ? 0 : 1);
