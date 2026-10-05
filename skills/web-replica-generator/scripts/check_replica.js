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
 *   --only   one kind (smoke, layout, visual, a11y, interact, feature, data), or one failure id from report.json,
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
 *   interact at desktop: every in-app link matches a route, ≥4 differently-labelled links don't share one
 *           destination, no link opens a blank/empty view; each prev/next/arrow button changes the screen;
 *           each filter option (2 per group) returns results, changes them, and claims no more than the data has
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
    // Last: it clicks and navigates, so the page is no longer the one the other checks saw.
    if (wants('interact') && vp === 'desktop') (await checkInteractions(page, pg)).forEach(fail);
  } catch (err) {
    fail({ id: `smoke:${where}`, kind: 'smoke', owner: pg.owner, message: `page did not load: ${err.message.split('\n')[0]}` });
  } finally {
    await ctx.close();
  }
  return out;
}

// ---------- interact: links lead somewhere, arrows move something, filters filter (desktop) ----------
// Feature steps prove what the spec names; this catches what it doesn't: a nav where every link opens the same
// page, a carousel whose "next" only flips a class, a filter whose counts were copied from the target.
const shellOwner = spec.files?.['js/shell.js'] || 'builder:shell';
const CONTROL = '\\b(prev|previous|next|scroll|arrow|slide|carousel|chevron)\\b|^[‹›❮❯«»]';
const CONTROL_BOX = '[aria-roledescription=carousel], [class*=carousel], [class*=slider], [class*=hero], section';
const CARDS = '[data-view]:not([hidden]) [data-testid$="card"]';
let recordCount;
async function dataRecordCount() {
  if (recordCount === undefined) {
    const d = spec.data || {};
    const mod = await import(pathToFileURL(path.join(dir, d.module ?? 'js/data.js')).href).catch(() => ({}));
    const r = mod[d.export ?? 'records'];
    recordCount = Array.isArray(r) ? r.length : null;
  }
  return recordCount;
}

async function checkInteractions(page, pg) {
  const id = `interact:${pg.id}/desktop`;
  const byOwner = {};
  const problem = (owner, severity, msg) => (byOwner[`${owner}|${severity}`] ??= []).push(msg);
  const isHome = pg.id === spec.pages[0].id; // header/footer links are the same on every page: audit them once
  // A hash-only goto keeps the document (and in-memory filters), so leave the page first for a real reload.
  const fresh = async () => { await page.goto('about:blank'); await gotoSettled(page, url(pg.route)); };

  // 1. Links: each resolves to a route, distinct labels don't share one destination, the destination isn't blank.
  const pages = spec.pages.map(p => ({ id: p.id, pattern: p.pattern }));
  const links = await page.evaluate(async ({ pages, isHome }) => {
    let matchRoute;
    try { ({ matchRoute } = await import('/js/router.js')); } catch { return null; }
    if (typeof matchRoute !== 'function') return null; // older or hand-written router: nothing to match against
    const MISS = { id: '__miss__', pattern: '#/__miss__' }; // first, so an unmatched hash falls back to it, not pages[0]
    const view = document.querySelector('[data-view]:not([hidden])');
    const list = [...document.querySelectorAll('a[href^="#/"], a[href="#"]:not([data-action])')]
      .map(a => ({ href: a.getAttribute('href'), text: (a.textContent || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40), shell: !view?.contains(a) }))
      .filter(l => isHome || !l.shell);
    for (const l of list) l.unrouted = l.href === '#' || (matchRoute([MISS, ...pages], l.href).page === MISS.id);
    // Visit each distinct routed href once and look at what it renders.
    const blank = [];
    for (const href of [...new Set(list.filter(l => !l.unrouted).map(l => l.href))].slice(0, 30)) {
      location.hash = href;
      await new Promise(r => setTimeout(r, 250));
      const v = document.querySelector('[data-view]:not([hidden])');
      const empty = v?.querySelector('[data-testid=empty-state]');
      if (!v || v.innerText.trim().length < 30 || (empty && empty.getClientRects().length)) blank.push(href);
    }
    return { list, blank };
  }, { pages, isHome });
  if (links) {
    const ownerOf = l => (l.shell ? shellOwner : pg.owner);
    for (const l of links.list.filter(l => l.unrouted)) problem(ownerOf(l), 'error', `link "${l.text}" → ${l.href} matches no route (it silently opens ${spec.pages[0].id})`);
    const groups = {};
    for (const l of links.list) if (l.text && !l.unrouted) ((groups[l.href] ??= { owners: new Set(), texts: new Set() }).texts.add(l.text), groups[l.href].owners.add(ownerOf(l)));
    for (const [href, g] of Object.entries(groups)) {
      // Many links to home is usually footer filler (warn); many links to one real page is a broken nav (error).
      if (g.texts.size >= 4) problem([...g.owners][0], href === '#/' ? 'warn' : 'error', `${g.texts.size} different links all open ${href}: ${[...g.texts].slice(0, 6).map(t => `"${t}"`).join(', ')}. Give each the params that make its destination differ (e.g. ${href.split('?')[0]}?cat=<slug>) and make that view honour them`);
    }
    for (const href of links.blank) problem(pg.owner, 'error', `link ${href} opens a blank page or the empty state`);
    await fresh();
  }

  // 2. Carousel / slider controls: clicking one must change what is on screen, not just a class.
  const n = await page.evaluate(({ RE, BOX }) => {
    const re = new RegExp(RE, 'i');
    let k = 0;
    // Forward controls first, without resets between clicks, so a "prev" at the start has somewhere to go back to.
    const back = e => /prev|‹|❮|«/i.test(`${e.dataset.testid} ${e.getAttribute('aria-label')} ${e.className} ${e.textContent.trim().slice(0, 2)}`);
    const all = [...document.querySelectorAll('button, [role=button]')];
    for (const e of [...all.filter(e => !back(e)), ...all.filter(back)]) {
      if (k >= 8) break;
      if (e.disabled || !e.getClientRects().length || e.closest('[hidden], header, footer')) continue;
      const sig = [e.dataset.testid, e.getAttribute('aria-label'), typeof e.className === 'string' ? e.className : '', e.textContent.trim().slice(0, 2)].join(' ');
      if (!re.test(sig) && !re.test(e.textContent.trim())) continue;
      const box = e.closest(BOX) || e.parentElement;
      e.dataset.ckCtl = k;
      box.dataset.ckBox = `${box.dataset.ckBox || ''} ${k}`;
      k++;
    }
    return k;
  }, { RE: CONTROL, BOX: CONTROL_BOX });
  for (let k = 0; k < n; k++) {
    const btn = page.locator(`[data-ck-ctl="${k}"]`), box = page.locator(`[data-ck-box~="${k}"]`);
    if (!(await btn.count()) || !(await btn.isVisible())) continue;
    const name = await btn.evaluate(e => e.dataset.testid || e.getAttribute('aria-label') || e.textContent.trim().slice(0, 20) || e.className);
    const before = await box.screenshot().catch(() => null);
    const clicked = await btn.click({ timeout: 2000 }).then(() => true, () => false);
    if (!before || !clicked) continue;
    await page.waitForTimeout(700); // let slide transitions finish
    if (!(await box.count())) continue; // re-rendered or navigated: something happened
    const after = await box.screenshot().catch(() => null);
    if (after && before.equals(after)) problem(pg.owner, 'error', `clicking "${name}" changed nothing on screen. A carousel must move or swap the visible slide (at every viewport where the button shows)`);
  }

  // 3. Filters: each option returns results, changes the list, and its "(N)" count is possible for this data.
  const filters = await page.evaluate(CARDS => {
    if (!document.querySelector(CARDS)) return [];
    const seen = {};
    return [...document.querySelectorAll('[data-testid^="filter-"]')]
      .filter(e => e.getClientRects().length && e.dataset.testid.split('-').length >= 3)
      .map(e => e.dataset.testid)
      .filter(t => ((seen[t.split('-')[1]] = (seen[t.split('-')[1]] || 0) + 1) <= 2))
      .slice(0, 8);
  }, CARDS);
  const total = filters.length ? await dataRecordCount() : null;
  const state = () => page.evaluate(CARDS => ({ n: document.querySelectorAll(CARDS).length, text: [...document.querySelectorAll(CARDS)].map(c => c.textContent.trim()).join('|'), hash: location.hash }), CARDS);
  for (const t of filters) {
    await fresh();
    const f = page.getByTestId(t).first();
    if (!(await f.isVisible().catch(() => false))) continue;
    const claimed = +((await f.innerText()).match(/\((\d[\d,]*)\)/)?.[1] || '').replace(/,/g, '') || null;
    const before = await state();
    if (!(await f.click({ timeout: 2000 }).then(() => true, () => false))) continue;
    await page.waitForTimeout(400);
    const after = await state();
    if (!after.n) problem(pg.owner, 'error', `filter ${t} leaves no results: offer only options that match at least one record`);
    else if (after.n === before.n && after.text === before.text && after.hash === before.hash) problem(pg.owner, 'warn', `filter ${t} had no visible effect on the results`);
    if (claimed && total && claimed > total) problem(pg.owner, 'error', `filter ${t} says (${claimed.toLocaleString('en')}) but the data has ${total} records: compute option counts from the data`);
  }

  return Object.entries(byOwner).map(([k, msgs]) => {
    const [owner, severity] = k.split('|');
    return { id, kind: 'interact', severity, owner, message: `${msgs.length} interaction problem(s) on ${pg.id}:\n${[...new Set(msgs)].slice(0, 15).join('\n')}` };
  });
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
const pageKinds = ['smoke', 'layout', 'visual', 'a11y', 'interact'];
const onlyKind = only?.split(':')[0];
const onlyId = only?.includes(':') ? only.slice(only.indexOf(':') + 1) : null;
// A page failure id ("smoke:detail/mobile", "a11y:detail") names the page and viewport to reload.
const [onlyPage, onlyVp] = onlyId && pageKinds.includes(onlyKind) ? onlyId.split('/') : [];
const pageTasks = !only || pageKinds.some(wants)
  ? (spec.pages || []).filter(pg => (!owner || pg.owner === owner) && (!onlyPage || pg.id === onlyPage))
    .flatMap(pg => Object.keys(VIEWPORTS)
      .filter(vp => (!onlyVp || vp === onlyVp) && !(['a11y', 'interact'].includes(onlyKind) && vp !== 'desktop'))
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
