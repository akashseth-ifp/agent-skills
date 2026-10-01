#!/usr/bin/env node
/**
 * draft_spec.js — the mechanical half of spec.json, so the Analyst writes only the judgement parts.
 *
 * Usage:
 *   node scripts/draft_spec.js --dir <replica>            write <replica>/spec.draft.json from target/summary.json
 *                                                         (target/capture.json without one); never touches spec.json
 *   node scripts/draft_spec.js --dir <replica> --merge    spec.draft.json + spec.parts.json (the Analyst's) -> spec.json,
 *                                                         then validate spec.json and print every problem
 *   node scripts/draft_spec.js --selftest
 *
 * Draft: target, brand, locale/currency/currencyDigits, measured, stack, thresholds, tokens (every value copied from the
 * capture), one page per captured page (id/route/pattern/module/owner guesses, source = capture page name), files and
 * owners, and empty state/data/features for the Analyst to fill.
 * Merge: parts' top-level keys replace the draft's; tokens merge per key (null drops one); data merges per key; pages
 * merge by id ({ "id": "x", "remove": true } drops one; when parts.pages names every kept page, its order wins); files =
 * the draft's non-view files + css/<module>.css and the module of every merged page (owner = the page's owner) + parts.files
 * (null drops an entry).
 * Exit code: 0 written (merge: and valid), 1 merge found problems (spec.json is still written), 2 bad usage.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { generate } from './scaffold_replica.js';

const USAGE = 'Usage: node scripts/draft_spec.js --dir <replica> [--merge]  |  --selftest';
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const usage = msg => { throw Object.assign(new Error(msg), { usage: true }); };
const readJson = f => {
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch (err) {
    throw new Error(`${path.basename(f)} is not valid JSON: ${err.message}`);
  }
};

// ---------- colours (computed styles, so always rgb()/rgba()) ----------
const rgba = s => {
  const m = String(s).match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
  return m && { r: m[1] / 255, g: m[2] / 255, b: m[3] / 255, a: m[4] == null ? 1 : +m[4] };
};
const opaque = s => (rgba(s)?.a ?? 0) >= 0.5;
const light = s => { const c = rgba(s); return (Math.max(c.r, c.g, c.b) + Math.min(c.r, c.g, c.b)) / 2; };
const chroma = s => { const c = rgba(s); return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b); };
const saturated = s => opaque(s) && chroma(s) > 0.25 && light(s) > 0.15 && light(s) < 0.85;
const neutral = s => opaque(s) && chroma(s) <= 0.08;

const BASE_FILES = {
  'css/tokens.css': 'scaffold', 'js/store.js': 'scaffold', 'js/router.js': 'scaffold', 'js/app.js': 'scaffold', 'js/ui.js': 'scaffold',
  'index.html': 'builder:shell', 'css/base.css': 'builder:shell', 'js/shell.js': 'builder:shell',
  'js/data.js': 'data', 'assets/img/': 'data', 'assets/images.manifest.json': 'data'
};
const cssOf = m => `css/${path.posix.basename(m, '.js')}.css`;
const viewFiles = pages => Object.fromEntries(pages.filter(p => isObject(p) && typeof p.module === 'string' && p.owner)
  .flatMap(p => [[cssOf(p.module), p.owner], [p.module, p.owner]]));

// Page guesses from the URL. ponytail: a last path segment carrying an id (≥ 3 digits, or a 6+ char token with 2+ digits
// and a letter: _1000, B0HDP855VQ, itm6ac64…) means a detail page; listings get the last plain word. The Analyst renames.
const ID_TOKEN = /\b(?=[a-z\d]*\d[a-z\d]*\d)(?=[a-z\d]*[a-z])[a-z\d]{6,}\b|\d{3,}/i;
function guessPages(pages) {
  const used = new Set();
  const unique = base => { let id = base; for (let n = 2; used.has(id); n++) id = base + n; used.add(id); return id; };
  return pages.map((p, i) => {
    let segs = [];
    try { segs = new URL(p.url).pathname.split('/').filter(s => s && !/^index\.\w+$/i.test(s)).map(s => s.replace(/\.\w+$/, '')); } catch { /* no url */ }
    const value = i ? segs.at(-1)?.match(ID_TOKEN)?.[0] : null;
    const id = unique(i === 0 ? 'home' : value ? 'detail' : [...segs].reverse().find(s => /^[a-z][a-z-]{1,19}$/i.test(s))?.toLowerCase() || `page${i + 1}`);
    const [route, pattern] = i === 0 ? ['/', '#/'] : value ? [`/#/${id}/${value}`, `#/${id}/:id`] : [`/#/${id}`, `#/${id}`];
    return { id, route, pattern, module: `js/views/${id}.js`, source: p.name ?? null, owner: `builder:${id}` };
  });
}

// summary.json (capture.json if there's none) -> spec.draft.json. capture.json's keyElements are a superset of the
// summary's (they add lineHeight and border), so they're used when present.
export function draft(sum, cap) {
  const src = sum || cap;
  const pages = src.pages || [];
  const kePages = cap?.pages || pages;
  const ranked = (key, alt) => {
    const w = new Map();
    for (const p of pages) {
      const t = p.tokens?.[key] ?? p.tokens?.[alt];
      for (const [v, n] of Array.isArray(t) ? t.map(x => [x.value, x.weight]) : Object.entries(t || {})) w.set(v, (w.get(v) || 0) + n);
    }
    return [...w].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  };
  const els = k => kePages.flatMap(p => p.keyElements?.[k] || []);
  const first = (k, prop, ok = () => true) => els(k).map(e => e[prop]).find(v => v && ok(v));

  const bgs = ranked('backgrounds'), texts = ranked('textColors'), buttons = els('button');
  const brand = bgs.find(saturated) || buttons.map(b => b.backgroundColor).find(saturated);
  const canvas = bgs.find(neutral) || bgs[0];
  const page = first('body', 'backgroundColor', opaque);
  const text = first('body', 'color', opaque) || texts.find(neutral);
  const between = c => neutral(c) && text && canvas && opaque(text) && opaque(canvas) &&
    Math.min(Math.abs(light(c) - light(text)), Math.abs(light(c) - light(canvas))) >= 0.1 && (light(c) - light(text)) * (light(canvas) - light(c)) > 0;
  const shadow = ranked('shadows').find(s => !/inset/.test(s));
  const tokens = {
    color: {
      brand, canvas,
      surface: bgs.find(c => neutral(c) && c !== canvas),
      page: page !== canvas ? page : undefined,
      text,
      'text-muted': texts.find(between),
      link: first('link', 'color', opaque),
      'on-brand': brand && buttons.find(b => b.backgroundColor === brand)?.color,
      border: ['input', 'select', 'header', 'nav', 'footer'].flatMap(els).map(e => String(e.border || '').match(/^[1-9][\d.]*px \w+ (rgba?\([^)]*\))/)?.[1]).find(opaque)
    },
    font: {
      sans: first('body', 'fontFamily') || ranked('fonts', 'fontFamilies')[0],
      base: ranked('fontSizes')[0]?.split('/')[0],
      line: first('body', 'lineHeight', v => v !== 'normal'),
      h1: first('h1', 'fontSize')
    },
    radius: { control: [...buttons, ...els('input')].map(e => e.borderRadius).find(v => v && v !== '0px') || ranked('radii')[0] },
    shadow: shadow ? { raised: shadow } : {}
  };

  // Brand: the title segment most pages share that matches the host ("All products | Books to Scrape - Sandbox").
  const host = URL.canParse(src.url) ? new URL(src.url).hostname.replace(/^www\./, '') : '';
  const key = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const labels = host.split('.').slice(0, -1).map(key).filter(l => l.length > 2);
  const titles = pages.map(p => [...new Set(String(p.title || '').split(/\s+[|·•–—-]\s+|:\s+/).map(s => s.trim()).filter(Boolean))]);
  const share = s => titles.filter(t => t.includes(s)).length;
  const brandName = [...new Set(titles.flat())].sort((a, b) => share(b) - share(a) || b.length - a.length)
    .find(s => key(s).length > 2 && (labels.join('').includes(key(s)) || labels.some(l => key(s).includes(l)))) || host || undefined;

  // ponytail: a currency's first two letters are its country (GBP -> GB), so the locale gets that region; EUR and X..
  // codes keep the page's lang. capture.json has no money digest, so without summary.json currency is left to the Analyst.
  const money = sum?.currency;
  let locale;
  try {
    const l = new Intl.Locale(pages.map(p => p.lang).find(Boolean) || 'en');
    const region = money?.currency && money.currency !== 'EUR' && !money.currency.startsWith('X') ? money.currency.slice(0, 2) : l.region;
    locale = new Intl.Locale(l.language, region ? { region } : {}).toString();
  } catch { /* unparsable lang: scaffold falls back to en-US */ }

  const drafted = guessPages(pages);
  // JSON round trip drops every undefined (unmeasured) value.
  return JSON.parse(JSON.stringify({
    target: src.url, stack: 'vanilla', measured: !src.blocked, reconstructed: [],
    brand: brandName, locale, currency: money?.currency, currencyDigits: money?.decimals,
    tokens, pages: drafted,
    state: { initial: {}, persist: [] },
    files: { ...BASE_FILES, ...viewFiles(drafted) },
    features: [],
    data: { module: 'js/data.js', export: 'records', count: 40, fields: {}, rules: [], seed: [], extras: {} },
    thresholds: { visual: 0.8 }
  }));
}

const deepMerge = (a, b) => {
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) o[k] = isObject(v) && isObject(a[k]) ? deepMerge(a[k], v) : v;
  return o;
};

export function merge(draftSpec, parts) {
  if (!isObject(parts)) throw new Error('spec.parts.json must be a JSON object');
  if (parts.pages != null && !(Array.isArray(parts.pages) && parts.pages.every(p => isObject(p) && typeof p.id === 'string')))
    throw new Error('spec.parts.json: pages must be a list of objects with a string id');
  const out = { ...draftSpec, ...parts };
  out.tokens = deepMerge(draftSpec.tokens || {}, isObject(parts.tokens) ? parts.tokens : {});
  if (isObject(parts.data)) out.data = { ...draftSpec.data, ...parts.data };
  const pages = (draftSpec.pages || []).map(p => ({ ...p }));
  for (const { remove, ...pp } of parts.pages || []) {
    const i = pages.findIndex(p => p.id === pp.id);
    if (remove) { if (i >= 0) pages.splice(i, 1); }
    else if (i >= 0) Object.assign(pages[i], pp);
    else pages.push(pp);
  }
  const order = (parts.pages || []).filter(p => !p.remove).map(p => p.id);
  if (pages.every(p => order.includes(p.id))) pages.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  out.pages = pages;
  const draftViews = viewFiles(draftSpec.pages || []);
  const files = Object.fromEntries(Object.entries(draftSpec.files || {}).filter(([f]) => !(f in draftViews)));
  Object.assign(files, viewFiles(pages), isObject(parts.files) ? parts.files : {});
  for (const [f, o] of Object.entries(files)) if (o == null) delete files[f];
  out.files = files;
  return out;
}

// templates/router.js matchRoute semantics (":name", optional ":name?" last, query ignored, first match wins), except
// that no match returns null instead of falling back to pages[0]. A route is "/" or "/#/…" (the checker's goto).
const segments = s => s.replace(/^#?\/?/, '').split('/').filter(Boolean);
const decode = s => { try { return decodeURIComponent(s); } catch { return s; } };
function routeTo(pages, route) {
  const parts = segments(String(route).replace(/^\//, '').replace(/\?.*$/, ''));
  for (const p of pages) {
    for (const pattern of [].concat(p.pattern ?? []).filter(x => typeof x === 'string')) {
      const segs = segments(pattern);
      if (parts.length > segs.length) continue;
      const params = {};
      const ok = segs.every((seg, i) => {
        if (seg[0] !== ':') return parts[i] === seg;
        if (i < parts.length) params[seg.slice(1).replace(/\?$/, '')] = decode(parts[i]);
        return i < parts.length || seg.endsWith('?');
      });
      if (ok) return { page: p.id, params };
    }
  }
  return null;
}

// -> { errors, warnings }: the mechanical checks the Analyst used to do by hand.
export function validate(spec) {
  const errors = [], warnings = [];
  const err = m => errors.push(m);
  try {
    generate(spec); // scaffold's own checks: page ids, module paths, locale/currency, data export names, token values, file clashes
  } catch (e) {
    err(e.message);
  }
  const pages = Array.isArray(spec.pages) ? spec.pages.filter(isObject) : [];
  const files = isObject(spec.files) ? spec.files : {};
  for (const [f, o] of Object.entries(files)) if (typeof o !== 'string' || !/^(scaffold|data|builder:[\w-]+)$/.test(o)) err(`files: ${f} owner ${JSON.stringify(o)} must be scaffold, data or builder:<name>`);
  const owners = new Set(Object.values(files));
  const d = isObject(spec.data) ? spec.data : {};
  const seed = Array.isArray(d.seed) ? d.seed : [];
  const seedIds = new Set(seed.map(r => String(r?.id)));
  const extras = JSON.stringify(d.extras ?? {});
  const checkIds = (where, hit) => {
    for (const [k, v] of Object.entries(hit.params)) {
      if (!/^id$|id$/i.test(k) || seedIds.has(v)) continue;
      const msg = `${where}: ${k} "${v}" is not a data.seed id`;
      if (k === 'id' && !extras.includes(JSON.stringify(v))) err(msg);
      else warnings.push(`${msg} (fine if it isn't a record id)`);
    }
  };

  for (const p of pages) {
    const missing = ['id', 'route', 'pattern', 'module', 'owner'].filter(k => p[k] == null || p[k] === '');
    if (missing.length) { err(`page ${p.id ?? '?'}: missing ${missing.join(', ')}`); continue; }
    const hit = routeTo(pages, p.route);
    if (!hit) err(`page ${p.id}: route ${p.route} matches none of its patterns (${[].concat(p.pattern).join(', ')})`);
    else if (hit.page !== p.id) err(`page ${p.id}: route ${p.route} opens page ${hit.page} first (first match wins): fix the pattern, or list pages in order`);
    else checkIds(`page ${p.id} route ${p.route}`, hit);
    const sharing = pages.filter(x => x.module === p.module), mo = [...new Set(sharing.map(x => x.owner))];
    if (mo.length > 1) { if (sharing[0] === p) err(`${p.module}: pages ${sharing.map(x => x.id).join(', ')} have different owners (${mo.join(', ')}); one builder owns every page of a shared module`); }
    else for (const f of [p.module, cssOf(p.module)]) if (files[f] !== p.owner) err(`page ${p.id}: ${f} is owned by ${files[f] ?? 'nobody'} in files, not ${p.owner}`);
    if (String(p.notes ?? '').length > 300) warnings.push(`page ${p.id}: notes are ${p.notes.length} chars, keep them ≤ 300`);
  }

  const pageIds = new Set(pages.map(p => p.id));
  const orphans = {}; // owner -> feature ids, one problem per owner
  for (const f of Array.isArray(spec.features) ? spec.features : []) {
    const at = `feature ${f?.id ?? '?'}`;
    if (!isObject(f) || typeof f.id !== 'string') { err(`${at}: needs an id`); continue; }
    if (!owners.has(f.owner)) (orphans[f.owner ?? '(none)'] ||= []).push(f.id);
    if (f.page != null && !pageIds.has(f.page)) err(`${at}: page ${f.page} is not in pages`);
    for (const s of Array.isArray(f.steps) ? f.steps : []) {
      if (s?.goto === undefined) continue;
      const hit = routeTo(pages, s.goto);
      if (!hit) err(`${at}: goto ${s.goto} matches no page pattern`);
      else checkIds(`${at} goto ${s.goto}`, hit);
    }
  }
  for (const [o, ids] of Object.entries(orphans)) err(`owner ${o} owns no file in files (features ${ids.join(', ')})`);

  const initial = isObject(spec.state?.initial) ? spec.state.initial : {};
  for (const k of Array.isArray(spec.state?.persist) ? spec.state.persist : []) if (!Object.hasOwn(initial, k)) err(`state.persist: ${k} is not in state.initial`);

  // Same record checks as check_replica.js runs on the full data set.
  const fields = isObject(d.fields) ? d.fields : {};
  for (const [k, f] of Object.entries(fields)) if (!['string', 'number', 'boolean', 'array', 'object'].includes(f?.type)) err(`data.fields.${k}: type ${JSON.stringify(f?.type)} must be string, number, boolean, array or object`);
  const rules = [];
  for (const expr of Array.isArray(d.rules) ? d.rules : []) {
    try { rules.push({ expr, fn: new Function('r', `return (${expr});`) }); } catch (e) { err(`data.rules: ${expr}: ${e.message}`); }
  }
  if (!seed.length) warnings.push('data.seed is empty: Builders start from the seed, so it needs every record the steps rely on');
  const ids = new Set();
  seed.forEach((r, i) => {
    const at = `data.seed[${i}] (${r?.id ?? '?'})`;
    if (!isObject(r)) return err(`${at}: must be an object`);
    if (r.id !== undefined && ids.has(r.id)) err(`${at}: duplicate id`);
    ids.add(r.id);
    for (const [k, f] of Object.entries(fields)) {
      const v = r[k];
      if (v === undefined || v === null || v === '') { if (f?.required) err(`${at}: missing ${k}`); continue; }
      if (f?.type === 'array' ? !Array.isArray(v) : typeof v !== f?.type) err(`${at}: ${k} should be ${f?.type}, got ${typeof v}`);
      if (f?.min !== undefined && v < f.min) err(`${at}: ${k}=${v} < min ${f.min}`);
      if (f?.max !== undefined && v > f.max) err(`${at}: ${k}=${v} > max ${f.max}`);
      if (f?.enum && !f.enum.includes(v)) err(`${at}: ${k}=${JSON.stringify(v)} not in enum`);
    }
    for (const { expr, fn } of rules) {
      let ok = false;
      try { ok = fn(r); } catch { /* a throwing rule fails */ }
      if (!ok) err(`${at}: rule failed: ${expr}`);
    }
  });
  return { errors, warnings };
}

// ---------- selftest: pure functions, no files ----------
function selftest() {
  const sum = {
    url: 'https://www.shop.example.com/', blocked: false, currency: { currency: 'INR', decimals: 0, example: '₹11,999', count: 9 },
    pages: [
      { name: 'home', url: 'https://www.shop.example.com/', title: 'Online Shopping | Example Shop', lang: 'en',
        tokens: { backgrounds: { 'rgb(255, 255, 255)': 90, 'rgb(40, 116, 240)': 50, 'rgb(241, 243, 246)': 30 }, textColors: { 'rgb(33, 33, 33)': 90, 'rgb(135, 135, 135)': 20, 'rgb(255, 255, 255)': 10 },
          fonts: { 'Roboto, Arial': 9 }, fontSizes: { '14px/400': 9, '12px/400': 3 }, radii: { '2px': 3 }, shadows: { 'rgba(0, 0, 0, 0.2) inset 0px 1px 0px': 2, 'rgba(0, 0, 0, 0.2) 0px 1px 2px 0px': 1 } },
        keyElements: { body: [{ color: 'rgb(33, 33, 33)', backgroundColor: 'rgb(241, 243, 246)', fontFamily: 'Roboto, Arial' }], h1: [{ fontSize: '24px' }],
          link: [{ color: 'rgb(40, 116, 240)' }], button: [{ color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(40, 116, 240)', borderRadius: '2px' }] } },
      { name: 'search', url: 'https://www.shop.example.com/search?q=x', title: 'x - Buy online | Example Shop' },
      { name: 'item', url: 'https://www.shop.example.com/phone-x/p/itm6ac6485515ae4', title: 'Phone X | Example Shop' }
    ]
  };
  const d = draft(sum, null);
  assert.deepEqual([d.brand, d.locale, d.currency, d.currencyDigits, d.measured], ['Example Shop', 'en-IN', 'INR', 0, true]);
  assert.deepEqual(d.tokens.color, { brand: 'rgb(40, 116, 240)', canvas: 'rgb(255, 255, 255)', surface: 'rgb(241, 243, 246)', page: 'rgb(241, 243, 246)',
    text: 'rgb(33, 33, 33)', 'text-muted': 'rgb(135, 135, 135)', link: 'rgb(40, 116, 240)', 'on-brand': 'rgb(255, 255, 255)' });
  assert.deepEqual([d.tokens.font.base, d.tokens.font.h1, d.tokens.radius.control, d.tokens.shadow.raised], ['14px', '24px', '2px', 'rgba(0, 0, 0, 0.2) 0px 1px 2px 0px']);
  assert.deepEqual(d.pages.map(p => [p.id, p.route, p.pattern, p.source]), [['home', '/', '#/', 'home'], ['search', '/#/search', '#/search', 'search'], ['detail', '/#/detail/itm6ac6485515ae4', '#/detail/:id', 'item']]);
  assert.equal(d.files['js/views/search.js'], 'builder:search');

  const parts = {
    pages: [{ id: 'search', module: 'js/views/home.js', owner: 'builder:home' }, { id: 'cart', route: '/#/cart', pattern: '#/cart', module: 'js/views/cart.js', source: null, owner: 'builder:detail' }],
    tokens: { color: { page: null }, font: { logo: '20px' } },
    state: { initial: { cart: [] }, persist: ['cart'] },
    features: [{ id: 'buy', owner: 'builder:detail', page: 'detail', steps: [{ goto: '/#/detail/itm6ac6485515ae4' }, { goto: '/#/search?q=phone' }] }],
    data: { export: 'products', fields: { id: { type: 'string', required: true }, price: { type: 'number', min: 1 } }, rules: ['r.price < 1e6'], seed: [{ id: 'itm6ac6485515ae4', price: 11999 }] }
  };
  const spec = merge(d, parts);
  assert.deepEqual(validate(spec), { errors: [], warnings: [] });
  assert.equal(spec.data.module, 'js/data.js', 'data merges per key');
  assert.equal(spec.tokens.color.brand, 'rgb(40, 116, 240)', 'tokens deep-merge');
  assert.equal(spec.files['js/views/home.js'], 'builder:home');
  assert.ok(!('js/views/search.js' in spec.files) && spec.files['css/cart.css'] === 'builder:detail', 'view files follow merged pages');
  assert.deepEqual(merge(d, { pages: [{ id: 'search', remove: true }] }).pages.map(p => p.id), ['home', 'detail']);
  assert.deepEqual(merge(d, { pages: ['detail', 'home', 'search'].map(id => ({ id })) }).pages.map(p => p.id), ['detail', 'home', 'search'], 'full list sets order');

  const broken = merge(d, {
    ...parts,
    pages: [...parts.pages, { id: 'detail', route: '/#/item/1' }],
    files: { 'js/views/cart.js': null },
    features: [{ id: 'f', owner: 'builder:ghost', steps: [{ goto: '/#/nowhere' }] }],
    data: { ...parts.data, seed: [{ id: 'itm6ac6485515ae4', price: 0 }] }
  });
  const { errors } = validate(broken);
  for (const re of [/page detail: route \/#\/item\/1 matches none/, /owner builder:ghost owns no file/, /js\/views\/cart.js is owned by nobody/, /price=0 < min 1/, /goto \/#\/nowhere matches no page pattern/])
    assert.ok(errors.some(e => re.test(e)), `expected ${re} in ${JSON.stringify(errors)}`);
  console.log('draft_spec selftest: ok');
}

// ---------- CLI ----------
const kb = f => `${(fs.statSync(f).size / 1024).toFixed(1)} KB`;
function runDraft(dir) {
  // An empty or truncated summary.json must not hide a good capture.json.
  const sumRaw = readJson(path.join(dir, 'target', 'summary.json'));
  const sum = sumRaw?.pages?.length ? sumRaw : null;
  const cap = readJson(path.join(dir, 'target', 'capture.json'));
  if (!sum && !cap?.pages?.length) usage(`No target/summary.json or target/capture.json in ${dir}; run capture_target.js first`);
  const d = draft(sum, cap);
  const file = path.join(dir, 'spec.draft.json');
  fs.writeFileSync(file, JSON.stringify(d, null, 2) + '\n');
  console.log(`wrote ${file} (${kb(file)}) from target/${sum ? 'summary' : 'capture'}.json: ${d.brand} · ${d.locale ?? '?'} · ${d.currency ?? '?'}` +
    `${d.currencyDigits != null ? ` (${d.currencyDigits} decimals)` : ''} · pages ${d.pages.map(p => `${p.id} ${p.route}`).join(', ')}`);
  return 0;
}

function runMerge(dir) {
  const partsFile = path.join(dir, 'spec.parts.json');
  const draftFile = path.join(dir, 'spec.draft.json');
  if (!fs.existsSync(partsFile)) usage(`No spec.parts.json in ${dir}: the Analyst writes it (features, data, state, page fixes), then runs --merge`);
  if (!fs.existsSync(draftFile)) usage(`No spec.draft.json in ${dir}: run node scripts/draft_spec.js --dir ${dir} first`);
  const spec = merge(readJson(draftFile), readJson(partsFile));
  const file = path.join(dir, 'spec.json');
  fs.writeFileSync(file, JSON.stringify(spec, null, 2) + '\n');
  const { errors, warnings } = validate(spec);
  const features = Array.isArray(spec.features) ? spec.features : [];
  console.log(`wrote ${file} (${kb(file)}): ${spec.pages.length} pages, ${features.length} features (${features.filter(f => f?.priority === 'must').length} must), ` +
    `${Object.keys(spec.files).length} files, seed ${spec.data?.seed?.length ?? 0}`);
  for (const w of warnings) console.log(`warning: ${w}`);
  for (const e of errors) console.log(`problem: ${e}`);
  console.log(errors.length ? `spec.json has ${errors.length} problem(s): fix spec.parts.json and re-run --merge` : 'spec.json valid');
  return errors.length ? 1 : 0;
}

// realpath: import.meta.url has symlinks resolved but argv[1] doesn't (the skill is invoked through .claude/skills).
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  let args;
  try {
    ({ values: args } = parseArgs({ options: { dir: { type: 'string' }, merge: { type: 'boolean' }, selftest: { type: 'boolean' } } }));
  } catch (err) {
    console.error(`${err.message}\n${USAGE}`);
    process.exit(2);
  }
  if (args.selftest) {
    try { selftest(); } catch (err) { console.error(`draft_spec selftest FAILED: ${err.message}`); process.exit(1); }
  } else if (!args.dir || !fs.existsSync(args.dir) || !fs.statSync(args.dir).isDirectory()) {
    console.error(args.dir ? `${args.dir} is not a directory\n${USAGE}` : USAGE);
    process.exit(2);
  } else {
    try {
      process.exitCode = args.merge ? runMerge(path.resolve(args.dir)) : runDraft(path.resolve(args.dir));
    } catch (err) {
      console.error(err.message);
      process.exitCode = err.usage ? 2 : 1;
    }
  }
}
