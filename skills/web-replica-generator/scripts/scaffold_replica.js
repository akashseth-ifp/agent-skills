#!/usr/bin/env node
/**
 * scaffold_replica.js — generate the generic foundation of a replica from its spec.json in about a second.
 *
 * Usage:
 *   node scripts/scaffold_replica.js --dir replica [--force] [--force-data]
 *   node scripts/scaffold_replica.js --selftest
 *
 * Writes (templates/ holds the generic code; spec.json fills in pages, state, tokens, locale and seed data):
 *   scaffold      css/tokens.css, js/store.js, js/router.js, js/app.js, js/ui.js
 *   builder:shell index.html, css/base.css, js/shell.js      (starters)
 *   builders      js/views/<x>.js + css/<x>.css per distinct pages[].module   (stubs)
 *   data          js/data.js from data.seed + data.extras     (seed; the Data agent swaps in the full set)
 * An existing file is never overwritten, unless --force (every file) or --force-data (only js/data.js).
 * --selftest scaffolds a sample spec into a temp dir and asserts router/store/ui/app behaviour in Node.
 * Exit code: 0 ok, 1 selftest failure, 2 bad usage or spec.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const TEMPLATES = new URL('../templates/', import.meta.url);
const IDENT = /^[A-Za-z_$][\w$]*$/;
// Names an `export const` can't take in module (strict) code.
const RESERVED = new Set(('arguments await break case catch class const continue debugger default delete do else enum eval export ' +
  'extends false finally for function if implements import in instanceof interface let new null package private protected ' +
  'public return static super switch this throw true try typeof var void while with yield').split(' '));

const template = (name, vars) =>
  fs.readFileSync(new URL(name, TEMPLATES), 'utf-8').replace(/__([A-Z]+(?:_[A-Z]+)*)__/g, (m, k) => {
    if (!(k in vars)) throw new Error(`templates/${name}: no value for ${m}`);
    return vars[k];
  });
const json = v => JSON.stringify(v ?? null);
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const htmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// Import path from a file in fromDir to target, both relative to the replica root: ('js', 'js/views/a.js') -> './views/a.js'
const importPath = (fromDir, target) => {
  const p = path.posix.relative(fromDir, target);
  return p.startsWith('.') ? p : './' + p;
};

function fail(msg) {
  throw Object.assign(new Error(msg), { usage: true });
}

// A spec-supplied module path, normalised (so two spellings of one file compare equal) and kept inside the replica:
// the spec is written from untrusted site content.
function jsPath(label, p) {
  const n = typeof p === 'string' ? path.posix.normalize(p) : '';
  if (!/^[\w./-]+\.js$/.test(n) || n.startsWith('/') || n.startsWith('../')) fail(`${label} ${json(p)} must be a relative .js path inside the replica`);
  return n;
}

// spec.json -> { files: { '<relative path>': content }, dataModule }
export function generate(spec) {
  if (!isObject(spec)) fail('spec.json must be an object');
  const pages = spec.pages;
  if (!Array.isArray(pages) || !pages.length) fail('spec.pages must be a non-empty array');
  const moduleOf = new Map(); // page id -> module path
  for (const p of pages) {
    if (!isObject(p)) fail(`spec.pages entries must be objects, got ${json(p)}`);
    if (typeof p.id !== 'string' || !/^[\w-]+$/.test(p.id)) fail(`page id ${json(p.id)} must be letters, digits, - or _`);
    if (moduleOf.has(p.id)) fail(`duplicate page id "${p.id}"`);
    if (p.pattern != null && ![].concat(p.pattern).every(s => typeof s === 'string')) fail(`page "${p.id}": pattern must be a string or a list of strings`);
    moduleOf.set(p.id, p.module == null ? `js/views/${p.id}.js` : jsPath(`page "${p.id}": module`, p.module));
  }
  const host = URL.canParse(spec.target) ? new URL(spec.target).hostname.replace(/^www\./, '') : '';
  const brand = String(spec.brand || host || 'the original site');
  // Intl accepts non-strings ({} falls back to the default locale), which would reach index.html as lang="[object Object]".
  if (spec.locale != null && typeof spec.locale !== 'string') fail(`spec.locale ${json(spec.locale)} must be a BCP 47 string such as "en-IN"`);
  if (spec.currency != null && typeof spec.currency !== 'string') fail(`spec.currency ${json(spec.currency)} must be an ISO 4217 code such as "INR"`);
  const locale = spec.locale || 'en-US';
  const currency = spec.currency || 'USD';
  if (spec.currencyDigits != null && !(Number.isInteger(spec.currencyDigits) && spec.currencyDigits >= 0 && spec.currencyDigits <= 3))
    fail(`spec.currencyDigits ${json(spec.currencyDigits)} must be an integer 0-3 (0 for sites that show whole units, e.g. ₹11,999)`);
  const money = moneyOptions(spec);
  // store.js formats money at import time, so a bad locale or currency would stop the whole app loading.
  try {
    new Intl.NumberFormat(locale, money);
  } catch (err) {
    fail(`spec.locale ${json(locale)} / spec.currency ${json(currency)}: ${err.message}`);
  }
  const initial = spec.state?.initial ?? {};
  const persist = spec.state?.persist ?? [];
  if (!isObject(initial)) fail('state.initial must be an object');
  if (!Array.isArray(persist) || !persist.every(k => typeof k === 'string')) fail('state.persist must be a list of state keys');
  const d = isObject(spec.data) ? spec.data : {};
  const dataModule = d.module == null ? 'js/data.js' : jsPath('data.module', d.module);
  const exportName = d.export ?? 'records';
  const extras = d.extras ?? {};
  if (d.seed != null && !Array.isArray(d.seed)) fail('data.seed must be a list of records');
  if (!isObject(extras)) fail('data.extras must be an object of named exports');
  for (const name of [exportName, ...Object.keys(extras)]) {
    if (!IDENT.test(name) || RESERVED.has(name)) fail(`data export name ${json(name)} is not a usable JS identifier`);
  }
  if (Object.hasOwn(extras, exportName)) fail(`data.extras.${exportName} clashes with data.export`);
  const tokens = isObject(spec.tokens) ? spec.tokens : {};

  // Scaffold's own files go in first, so a clash always names the spec path that caused it.
  const files = {};
  const claimedBy = {};
  const add = (rel, content, by = 'scaffold') => {
    if (Object.hasOwn(files, rel)) fail(`${by} would generate ${rel}, which ${claimedBy[rel]} already generates; pick another path`);
    files[rel] = content;
    claimedBy[rel] = by;
  };

  // tokens.css: every spec.tokens.<group>.<name> as --<group>-<name>
  const vars = [];
  const walk = (name, v) => {
    if (v == null || v === '') return; // unmeasured: leave it to the var() fallbacks
    if (typeof v === 'object') return Object.entries(v).forEach(([k, x]) => walk(`${name}-${k}`, x));
    if (/[{}]|\/\*/.test(String(v))) fail(`token ${name} ${json(v)} must be a plain CSS value (no { } or /*)`);
    vars.push(`  --${name.replace(/[^\w-]/g, '-')}: ${v};`);
  };
  Object.entries(tokens).forEach(([group, v]) => walk(group, v));
  add('css/tokens.css', `/* Generated by scaffold_replica.js from spec.tokens (owner: scaffold). Edit spec.tokens, not this file. */\n:root {\n${vars.join('\n')}\n}\n`);

  add('js/store.js', template('store.js', {
    LOCALE: json(locale),
    CURRENCY: json(currency),
    MONEY_OPTIONS: json(money),
    INITIAL: JSON.stringify(initial, null, 2),
    PERSIST: json(persist),
    KEY: json(`replica_state:${brand.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`)
  }));
  add('js/router.js', template('router.js', {
    PAGES: JSON.stringify(pages.map(p => ({ id: p.id, pattern: p.pattern || (p === pages[0] ? '#/' : `#/${p.id}`) })), null, 2)
  }));
  add('js/ui.js', template('ui.js', {}));
  add('js/shell.js', template('shell.js', {}));

  // One import per distinct module; several pages may share one.
  const modules = new Map(); // module path -> { ident, pages: [ids], owner }
  for (const p of pages) {
    const m = moduleOf.get(p.id);
    if (!modules.has(m)) {
      let ident = path.posix.basename(m, '.js').replace(/[^\w$]+(.)?/g, (_, c = '') => c.toUpperCase()) + 'View';
      if (!IDENT.test(ident) || [...modules.values()].some(v => v.ident === ident)) ident = `view${modules.size}`;
      modules.set(m, { ident, pages: [], owner: String(p.owner || spec.files?.[m] || 'builder').replace(/[^\w:.-]+/g, '-') }); // lands in comments
    }
    modules.get(m).pages.push(p.id);
  }
  const cssOf = m => `css/${path.posix.basename(m, '.js')}.css`;
  add('js/app.js', template('app.js', {
    DATA: importPath('js', dataModule),
    IMPORTS: [...modules].map(([m, v]) => `import * as ${v.ident} from '${importPath('js', m)}';`).join('\n'),
    VIEWS: `{\n${pages.map(p => `  ${json(p.id)}: ${modules.get(moduleOf.get(p.id)).ident}`).join(',\n')}\n}`
  }));

  // Body font: --font-sans, else the first font token that isn't a size.
  const font = isObject(tokens.font) ? tokens.font : {};
  const family = 'sans' in font ? 'sans' : Object.keys(font).find(k => !/^[\d.]+(px|r?em|%)?$/.test(String(font[k]).trim()));
  const body = [family && `  font-family: var(--font-${family});`, font.base && '  font-size: var(--font-base);', font.line && '  line-height: var(--font-line);'];
  add('css/base.css', template('base.css', { BODY: body.filter(Boolean).join('\n') }));

  add('index.html', template('index.html', {
    LANG: htmlEsc(spec.locale || 'en'),
    TITLE: htmlEsc(`${brand} (replica)`),
    BRAND: htmlEsc(brand),
    STYLES: ['css/tokens.css', 'css/base.css', ...[...modules.keys()].map(cssOf)].map(s => `  <link rel="stylesheet" href="${s}">`).join('\n'),
    SECTIONS: pages.map((p, i) => `    <section data-view="${p.id}"${i ? ' hidden' : ''}></section>`).join('\n')
  }));

  add(dataModule, [
    '// Seed data generated by scaffold_replica.js from spec.data.seed / spec.data.extras (owner: data).',
    '// The Data agent replaces this file with the full set. No window/document access at import time.',
    `export const ${exportName} = ${JSON.stringify(d.seed || [], null, 2)};`,
    ...Object.entries(extras).map(([k, v]) => `\nexport const ${k} = ${JSON.stringify(v ?? null, null, 2)};`),
    ''
  ].join('\n'), `data.module ${json(dataModule)}`);

  for (const [m, v] of modules) {
    const by = `page module ${json(m)}`;
    add(m, template('view.js', { PAGES: v.pages.join(', '), OWNER: v.owner, UI: importPath(path.posix.dirname(m), 'js/ui.js') }), by);
    add(cssOf(m), `/* Styles for ${m} (pages: ${v.pages.join(', ')}; owner: ${v.owner}). */\n`, by);
  }
  return { files, dataModule };
}

// Writes the generated files into dir. Returns { written, skipped }.
export function scaffold(dir, { force = false, forceData = false, log = console.log } = {}) {
  const specPath = path.join(dir, 'spec.json');
  if (!fs.existsSync(specPath)) fail(`No spec.json in ${dir}`);
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf-8'));
  } catch (err) {
    fail(`spec.json is not valid JSON: ${err.message}`);
  }
  const { files, dataModule } = generate(spec);
  const root = path.resolve(dir) + path.sep;
  const realRoot = fs.realpathSync(dir) + path.sep;
  for (const rel of Object.keys(files)) {
    const abs = path.resolve(dir, rel);
    if (!abs.startsWith(root)) fail(`refusing to write ${rel} outside ${dir}`);
    // A symlinked directory in the replica (js/ -> elsewhere) would carry writes out of it, so check the real path of
    // the nearest existing ancestor too (lib.js serveDir does the same). A symlinked file is safe: it is skipped, or
    // with --force renameSync replaces the link itself.
    let p = path.dirname(abs);
    while (!fs.lstatSync(p, { throwIfNoEntry: false })) p = path.dirname(p); // lstat: a dangling link stops here and realpath throws
    if (!(fs.realpathSync(p) + path.sep).startsWith(realRoot)) fail(`refusing to write ${rel} through a symlink outside ${dir}`);
  }
  const written = [];
  const skipped = [];
  const skip = rel => {
    skipped.push(rel);
    log(`  skipped ${rel} (exists)`);
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    const overwrite = force || (forceData && rel === dataModule);
    const exists = fs.existsSync(abs);
    if (exists && !overwrite) {
      skip(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // Write a temp file then move it in, so a server or Builder reading the file never sees half of it. link() won't
    // replace a file a Builder created since the existsSync above; the pid keeps concurrent runs' temp files apart.
    const tmp = `${abs}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, content);
    try {
      if (overwrite) fs.renameSync(tmp, abs);
      else fs.linkSync(tmp, abs);
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      skip(rel);
      continue;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    written.push(rel);
    log(`  wrote   ${rel}${exists ? ' (overwritten)' : ''}`);
  }
  return { written, skipped };
}

// Intl options for every price in the replica. currencyDigits fixes the decimals (Flipkart and most INR/JPY sites show
// whole units); without it Intl uses the currency's default (2 for INR, 0 for JPY).
export function moneyOptions(spec) {
  const o = { style: 'currency', currency: spec.currency || 'USD' };
  if (spec.currencyDigits != null) o.minimumFractionDigits = o.maximumFractionDigits = spec.currencyDigits;
  return o;
}

// ---------- selftest: scaffold a sample spec, import the generated modules in Node with stub browser globals ----------
async function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-selftest-'));
  const sample = {
    target: 'https://books.example.com/', brand: 'Example Books', locale: 'en-GB', currency: 'GBP',
    tokens: { color: { text: 'rgb(51, 51, 51)', canvas: '#fff' }, font: { base: '14px', sans: 'Arial, sans-serif' }, radius: {} },
    pages: [
      { id: 'home', pattern: ['#/', '#/page/:n'], module: 'js/views/catalog.js', owner: 'builder:catalog' },
      { id: 'category', pattern: ['#/category/:slug', '#/category/:slug/page/:n'], module: 'js/views/catalog.js', owner: 'builder:catalog' },
      { id: 'search', pattern: '#/s', module: 'js/views/search.js', owner: 'builder:search' },
      { id: 'detail', pattern: '#/dp/:id', module: 'js/views/detail.js', owner: 'builder:detail' },
      { id: 'twin', pattern: '#/dp/:id', module: 'js/views/detail.js', owner: 'builder:detail' },
      { id: 'opt', pattern: '#/o/:a/:b?', module: 'js/views/detail.js', owner: 'builder:detail' },
      { id: 'cart', pattern: '#/cart', module: 'js/views/cart.js', owner: 'builder:cart' }
    ],
    state: { initial: { cart: [], location: { zip: null }, ui: 'x' }, persist: ['cart', 'location'] },
    data: { module: 'js/data.js', export: 'books', seed: [{ id: '1', price: 51.77 }, { id: '2', price: 10 }], extras: { slides: [{ id: 's1' }] } }
  };
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(sample));
  const quiet = () => {};
  try {
    const first = scaffold(dir, { log: quiet });
    assert.deepEqual(first.skipped, []);
    for (const f of ['css/tokens.css', 'css/base.css', 'css/catalog.css', 'css/cart.css', 'index.html', 'js/app.js', 'js/ui.js', 'js/shell.js', 'js/views/search.js'])
      assert.ok(first.written.includes(f), `wrote ${f}`);
    const read = f => fs.readFileSync(path.join(dir, f), 'utf-8');
    assert.match(read('css/tokens.css'), /--color-text: rgb\(51, 51, 51\);[\s\S]*--font-sans: Arial, sans-serif;/);
    assert.match(read('css/base.css'), /font-family: var\(--font-sans\);/);
    const html = read('index.html');
    assert.equal((html.match(/<section data-view=/g) || []).length, 7);
    assert.match(html, /<section data-view="home"><\/section>/);
    assert.equal((html.match(/data-view="\w+" hidden/g) || []).length, 6);
    assert.match(html, /<p data-replica-note>Replica for demo purposes only, not affiliated with Example Books\.<\/p>/);
    assert.match(html, /<!-- shell:header[\s\S]*<!-- \/shell:header -->[\s\S]*<!-- shell:footer[\s\S]*<!-- \/shell:footer -->/);
    assert.equal((html.match(/href="css\/catalog\.css"/g) || []).length, 1, 'shared module css linked once');
    assert.match(read('js/app.js'), /import \* as catalogView from '\.\/views\/catalog\.js';/);

    // Re-run: nothing overwritten; --force-data rewrites only js/data.js.
    fs.writeFileSync(path.join(dir, 'js/views/catalog.js'), fs.readFileSync(path.join(dir, 'js/views/catalog.js'), 'utf-8') + '// builder edit\n');
    const again = scaffold(dir, { log: quiet });
    assert.deepEqual(again.written, []);
    assert.match(read('js/views/catalog.js'), /builder edit/);
    assert.deepEqual(scaffold(dir, { forceData: true, log: quiet }).written, ['js/data.js']);
    assert.ok(!fs.readdirSync(dir, { recursive: true }).some(f => f.endsWith('.tmp')), 'no temp files left');

    // A symlinked subdirectory pointing outside the replica is refused before anything is written.
    const trap = path.join(dir, 'trap');
    fs.mkdirSync(path.join(trap, 'replica'), { recursive: true });
    fs.mkdirSync(path.join(trap, 'outside'));
    fs.symlinkSync('../outside', path.join(trap, 'replica', 'js'));
    fs.writeFileSync(path.join(trap, 'replica', 'spec.json'), JSON.stringify({ pages: [{ id: 'home' }] }));
    assert.throws(() => scaffold(path.join(trap, 'replica'), { log: quiet }), e => e.usage && /through a symlink outside/.test(e.message));
    assert.deepEqual(fs.readdirSync(path.join(trap, 'outside')), []);
    assert.deepEqual(fs.readdirSync(path.join(trap, 'replica')).sort(), ['js', 'spec.json']);

    // Bad specs are usage errors (exit 2), thrown before anything is written.
    const bad = (patch, re) => assert.throws(() => generate(patch && { ...sample, ...patch }), e => e.usage && re.test(e.message), json(patch));
    bad(null, /must be an object/);
    bad({ pages: [null] }, /must be objects/);
    bad({ pages: [{ id: 'home', module: '../../escaped.js' }] }, /inside the replica/);
    bad({ pages: [{ id: 'home', module: 'js/views/../../../x.js' }] }, /inside the replica/);
    bad({ data: { module: '../victim.txt' } }, /inside the replica/);
    bad({ data: { export: 'default' } }, /usable JS identifier/);
    bad({ data: { export: 'items', extras: { items: [] } } }, /clashes with data.export/);
    bad({ pages: [{ id: 'home', module: 'js/app.js' }] }, /"js\/app.js" would generate js\/app.js/);
    bad({ pages: [{ id: 'home', module: 'js/views/tokens.js' }] }, /would generate css\/tokens.css/);
    bad({ pages: [{ id: 'a', module: 'js/a/list.js' }, { id: 'b', module: 'js/b/list.js' }] }, /would generate css\/list.css/);
    bad({ data: { module: 'js/store.js' } }, /data.module/);
    bad({ pages: [{ id: 'home', module: 'js/data.js' }] }, /which data.module "js\/data.js" already generates/);
    bad({ tokens: { color: { b: 'red; } body { display:none' } } }, /plain CSS value/);
    bad({ currency: 'dollars' }, /currency/);
    bad({ locale: {} }, /locale .* BCP 47 string/);
    bad({ currency: {} }, /currency .* ISO 4217/);
    bad({ pages: [{ id: 'home', pattern: 5 }] }, /pattern/);
    const lenient = generate({ ...sample, brand: undefined, target: 'not a url', tokens: { color: { a: null, b: 'red' } } }).files;
    assert.match(lenient['index.html'], /not affiliated with the original site/);
    assert.match(lenient['css/tokens.css'], /^ {2}--color-b: red;$/m);
    assert.doesNotMatch(lenient['css/tokens.css'], /--color-a/, 'null token skipped');
    assert.equal(Object.keys(generate({ ...sample, pages: [{ id: 'home', module: './js//views/x.js' }] }).files).filter(f => f.endsWith('x.js')).join(), 'js/views/x.js');

    // Stub browser globals before importing the generated modules.
    const mem = new Map();
    let storageBroken = false;
    const guard = fn => (...a) => { if (storageBroken) throw new Error('SecurityError'); return fn(...a); };
    globalThis.localStorage = {
      getItem: guard(k => (mem.has(k) ? mem.get(k) : null)),
      setItem: guard((k, v) => mem.set(k, String(v))),
      removeItem: guard(k => mem.delete(k))
    };
    const winListeners = {};
    const docListeners = [];
    globalThis.location = { hash: '#/cart' };
    globalThis.window = { addEventListener: (t, fn) => { winListeners[t] = fn; }, scrollTo: () => { window.scrolled++; }, scrolled: 0 };
    const section = view => ({ dataset: { view }, hidden: false, innerHTML: 'stale', replaceChildren() { this.innerHTML = ''; } });
    const sections = sample.pages.map(p => section(p.id));
    globalThis.document = { querySelectorAll: () => sections, addEventListener: (...a) => docListeners.push(a) };
    const mod = f => import(pathToFileURL(path.join(dir, f)).href);

    // router
    const { matchRoute, href, slug, router } = await mod('js/router.js');
    const P = sample.pages;
    const m = h => matchRoute(P, h);
    assert.deepEqual(m(''), { page: 'home', view: 'home', params: {} });
    assert.deepEqual(m('#/'), { page: 'home', view: 'home', params: {} });
    assert.deepEqual(m('#/page/2').params, { n: '2' });
    assert.equal(m('#/page/2').page, 'home');
    assert.deepEqual(m('#/category/poetry'), { page: 'category', view: 'category', params: { slug: 'poetry' } });
    assert.deepEqual(m('#/category/poetry/page/2').params, { slug: 'poetry', n: '2' });
    assert.deepEqual(m('#/s?k=wireless+headphones&i=Electronics'), { page: 'search', view: 'search', params: { k: 'wireless headphones', i: 'Electronics' } });
    assert.deepEqual(m('#/dp/B0HDP855VQ'), { page: 'detail', view: 'detail', params: { id: 'B0HDP855VQ' } }, 'first match wins over twin');
    assert.deepEqual(m('#/dp/a%20b%2Fc').params, { id: 'a b/c' });
    assert.deepEqual(m('#/dp/%E0%A4%A').params, { id: '%E0%A4%A' }, 'malformed escape kept raw');
    assert.deepEqual(m('#/dp/x?id=y&q=1').params, { id: 'x', q: '1' }, 'path params beat the query');
    assert.deepEqual(m('#/o/x'), { page: 'opt', view: 'opt', params: { a: 'x' } });
    assert.deepEqual(m('#/o/x/y').params, { a: 'x', b: 'y' });
    assert.deepEqual(m('#/dp'), { page: 'home', view: 'home', params: {} }, 'missing required param falls back');
    assert.equal(m('#/o/x/y/z').page, 'home');
    assert.deepEqual(m('#/nope?x=1'), { page: 'home', view: 'home', params: { x: '1' } });
    assert.equal(m('#/cart').page, 'cart');
    assert.equal(href('home'), '#/');
    assert.equal(href('home', { n: 2 }), '#/page/2');
    assert.equal(href('category', { slug: 'poetry' }), '#/category/poetry');
    assert.equal(href('category', { slug: 'poetry', n: 2, sort: 'price' }), '#/category/poetry/page/2?sort=price');
    assert.equal(href('search', { k: 'wireless headphones', i: 'Electronics', empty: '', none: null }), '#/s?k=wireless+headphones&i=Electronics');
    assert.equal(href('detail', { id: 'a b/c' }), '#/dp/a%20b%2Fc');
    assert.equal(href('opt', { a: 'x' }), '#/o/x');
    assert.equal(href('opt', { a: 'x', b: 'y' }), '#/o/x/y');
    assert.throws(() => href('detail'), /needs params/);
    assert.throws(() => href('nope'), /unknown page/);
    for (const [id, params] of [['detail', { id: 'a b' }], ['category', { slug: 'x', n: '3', sort: 'y' }], ['search', { k: 'a&b=c' }]])
      assert.deepEqual(m(href(id, params)), { page: id, view: id, params });
    assert.equal(slug('Historical Fiction & More!'), 'historical-fiction-more');
    assert.equal(router.current().page, 'cart');

    // store
    const S = await mod('js/store.js');
    assert.equal(S.LOCALE, 'en-GB');
    assert.equal(S.CURRENCY, 'GBP');
    assert.equal(S.money(51.77), '£51.77');
    assert.deepEqual(S.MONEY_OPTIONS, { style: 'currency', currency: 'GBP' });
    assert.equal(new Intl.NumberFormat('en-IN', moneyOptions({ currency: 'INR', currencyDigits: 0 })).format(11999), '₹11,999');
    assert.equal(new Intl.NumberFormat('en-IN', moneyOptions({ currency: 'INR' })).format(11999), '₹11,999.00');
    let list = S.addItem([], 'a');
    assert.deepEqual(list, [{ id: 'a', qty: 1 }]);
    const before = list;
    list = S.addItem(list, 'a', 2);
    assert.deepEqual(before, [{ id: 'a', qty: 1 }], 'helpers do not mutate');
    list = S.addItem(list, 'b', 4);
    assert.deepEqual(list, [{ id: 'a', qty: 3 }, { id: 'b', qty: 4 }]);
    assert.equal(S.countItems(list), 7);
    assert.equal(S.sumItems(list, id => ({ a: 1.5, b: 10 })[id]), 44.5);
    assert.equal(S.sumItems([{ id: 'gone', qty: 2 }], () => undefined), 0);
    assert.deepEqual(S.setItemQty(list, 'a', 5), [{ id: 'a', qty: 5 }, { id: 'b', qty: 4 }]);
    assert.deepEqual(S.setItemQty(list, 'a', 0), [{ id: 'b', qty: 4 }]);
    assert.deepEqual(S.removeItem(list, 'b'), [{ id: 'a', qty: 3 }]);
    assert.equal(S.countItems(undefined), 0);
    const init = { cart: [], location: { zip: null }, ui: 'x' };
    mem.set('k1', '{not json');
    assert.deepEqual(S.createStore(init, ['cart'], 'k1').get(), init, 'bad JSON resets');
    assert.equal(mem.has('k1'), false, 'bad JSON removed');
    mem.set('k2', JSON.stringify({ cart: 'oops', location: { zip: 'E1' }, ui: 'y' }));
    assert.deepEqual(S.createStore(init, ['cart', 'location'], 'k2').get(), { cart: [], location: { zip: 'E1' }, ui: 'x' }, 'wrong type reset, unpersisted ignored');
    const st = S.createStore(init, ['cart'], 'k3');
    let seen = 0;
    const off = st.subscribe(() => seen++);
    st.set(s => ({ cart: S.addItem(s.cart, 'a'), ui: 'z' }));
    assert.deepEqual(JSON.parse(mem.get('k3')), { cart: [{ id: 'a', qty: 1 }] }, 'persists only persist keys');
    assert.deepEqual(S.createStore(init, ['cart'], 'k3').get().cart, [{ id: 'a', qty: 1 }], 'survives reload');
    off();
    st.set({ ui: 'w' });
    assert.equal(seen, 1, 'unsubscribe');
    storageBroken = true;
    const blocked = S.createStore(init, ['cart'], 'k4');
    blocked.set({ cart: [{ id: 'x', qty: 1 }] });
    assert.deepEqual(blocked.get().cart, [{ id: 'x', qty: 1 }], 'works in memory when storage throws');
    storageBroken = false;

    // ui
    const U = await mod('js/ui.js');
    assert.equal(U.esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    assert.equal(U.esc(null), '');
    assert.notEqual(U.uid('g'), U.uid('g'));
    const price = U.priceHtml(1234.5);
    assert.match(price, /^<span class="price" style="position: relative"><span class="sr-only">£1,234\.50<\/span>/);
    assert.match(price, /class="sym" aria-hidden="true">£<\/span><span class="whole" aria-hidden="true">1,234<\/span><span class="frac" aria-hidden="true">50<\/span>/);
    assert.equal(U.priceHtml(5, { split: false }), '<span class="price">£5.00</span>');
    const stars = U.starsHtml(3.5) + U.starsHtml(3.5);
    assert.match(stars, /role="img" aria-label="3.5 out of 5 stars"/);
    const gradIds = [...stars.matchAll(/linearGradient id="([^"]+)"/g)].map(x => x[1]);
    assert.equal(gradIds.length, 10);
    assert.equal(new Set(gradIds).size, 10, 'gradient ids unique');
    assert.match(U.starsHtml(3.5), /offset="50%"/);

    // data
    const D = await mod('js/data.js');
    assert.deepEqual(D.books, sample.data.seed);
    assert.deepEqual(D.slides, sample.data.extras.slides);

    // app: active section rendered and shown, others emptied and hidden, mount once, update per draw.
    const calls = [];
    fs.writeFileSync(path.join(dir, 'js/shell.js'), 'export const mount = () => globalThis.calls.push("mount");\nexport const update = ctx => globalThis.calls.push("update:" + ctx.route.page);\n');
    globalThis.calls = calls;
    await mod('js/app.js');
    const shown = () => sections.filter(s => !s.hidden).map(s => s.dataset.view);
    assert.deepEqual(shown(), ['cart']);
    assert.match(sections.find(s => s.dataset.view === 'cart').innerHTML, /<h1>cart<\/h1>/);
    assert.ok(sections.filter(s => s.hidden).every(s => s.innerHTML === ''), 'inactive sections emptied');
    location.hash = '#/category/poetry/page/2';
    winListeners.hashchange();
    assert.deepEqual(shown(), ['category']);
    assert.match(sections.find(s => s.dataset.view === 'category').innerHTML, /&quot;slug&quot;:&quot;poetry&quot;/);
    assert.equal(sections.find(s => s.dataset.view === 'cart').innerHTML, '');
    assert.equal(window.scrolled, 1, 'new path scrolls to top');
    location.hash = '#/category/poetry/page/2?sort=x';
    winListeners.hashchange();
    assert.equal(window.scrolled, 1, 'query-only change keeps scroll');
    S.store.set({ ui: 'y' });
    assert.deepEqual(calls, ['mount', 'update:cart', 'update:category', 'update:category', 'update:category']);
    const [type, onError, capture] = docListeners.find(([t]) => t === 'error');
    assert.equal(type + capture, 'errortrue', 'capture-phase image error listener');
    const img = { tagName: 'IMG', src: 'x.jpg', removeAttribute() {}, classList: { add(c) { img.cls = c; } } };
    onError({ target: img });
    assert.match(img.src, /^data:image\/svg\+xml/);
    assert.equal(img.cls, 'img-fallback');
    console.log('scaffold_replica selftest: ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- CLI ----------
// realpath: import.meta.url has symlinks resolved but argv[1] doesn't, so running via .claude/skills/<skill>
// (a symlink to skills/<skill>) would otherwise skip the CLI and exit 0 having done nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  let args;
  try {
    ({ values: args } = parseArgs({ options: { dir: { type: 'string' }, force: { type: 'boolean' }, 'force-data': { type: 'boolean' }, selftest: { type: 'boolean' } } }));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (args.selftest) {
    selftest().catch(err => {
      console.error(`scaffold_replica selftest FAILED: ${err.message}`);
      process.exitCode = 1;
    });
  } else if (!args.dir) {
    console.error('Usage: node scripts/scaffold_replica.js --dir <replica> [--force] [--force-data]  |  --selftest');
    process.exit(2);
  } else {
    const t0 = Date.now();
    const dir = path.resolve(args.dir);
    try {
      console.log(`scaffold ${dir}`);
      const { written, skipped } = scaffold(dir, { force: args.force, forceData: args['force-data'] });
      console.log(`${written.length} written, ${skipped.length} skipped in ${Date.now() - t0}ms`);
    } catch (err) {
      console.error(err.message);
      process.exit(err.usage ? 2 : 1);
    }
  }
}
