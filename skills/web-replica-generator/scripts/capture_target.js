#!/usr/bin/env node
/**
 * capture_target.js — measure the real target site so the replica is built from evidence, not memory.
 *
 * Usage:
 *   node scripts/capture_target.js https://www.example.com --out target [--pages 3] [--concurrency 4]
 *   node scripts/capture_target.js <home> <listing-url> <detail-url> --out target   (explicit journey)
 *   node scripts/capture_target.js --summarize target     (rebuild summary.json from an existing capture.json)
 *
 * Viewports of a page run concurrently, each in its own browser context; after the first page, the other
 * journey pages run concurrently too. --concurrency caps the contexts in flight (default 4).
 *
 * Writes:
 *   target/capture.json          one entry per page: status, blocked flag, tokens, key element styles,
 *                                repeated-card text samples, aria outline, interactive inventory, assets
 *   target/summary.json          the compact digest to read first (~20 KB): top tokens, key styles, 3 card samples,
 *                                controls and links by region, headings, currency/number format, "served" hints
 *   target/screens/<page>-<vp>.png   full-page screenshots at desktop/tablet/mobile
 *   target/states/<page>-<n>.png     viewport screenshots after opening menus/popups (hover/click states)
 */
import fs from 'node:fs';
import path from 'node:path';
import { VIEWPORTS, parseArgs, launchBrowser, gotoSettled, scrollThrough, slug } from './lib.js';

const args = parseArgs();
if (typeof args.summarize === 'string') {
  const dir = path.resolve(args.summarize);
  writeSummary(dir, JSON.parse(fs.readFileSync(path.join(dir, 'capture.json'), 'utf8')));
  process.exit(0);
}
const startUrl = args._[0];
if (!startUrl) {
  console.error('Usage: node scripts/capture_target.js <url> [<journey-url> …] --out <dir> [--pages 3] [--concurrency 4]\n' +
    '       node scripts/capture_target.js --summarize <dir>');
  process.exit(2);
}
const outDir = path.resolve(args.out || 'target');
const maxPages = Number(args.pages || 3);
const concurrency = Math.max(1, Number(args.concurrency) || 4); // browser contexts in flight, across pages and viewports
fs.mkdirSync(path.join(outDir, 'screens'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'states'), { recursive: true });

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const BLOCK_RE = /captcha|robot check|access denied|are you a human|verify you are human|attention required/i;

// Runs in the page. Everything the Analyst needs to write spec.json, at desktop width.
function measurePage() {
  const visible = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const all = [...document.querySelectorAll('body *')].filter(visible).slice(0, 4000);

  // Token frequencies, weighted by painted area so the dominant colours rise to the top.
  const tally = (map, key, w = 1) => key && map.set(key, (map.get(key) || 0) + w);
  const bg = new Map(), fg = new Map(), fonts = new Map(), sizes = new Map(), radii = new Map(), shadows = new Map();
  for (const el of all) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const area = Math.min(r.width * r.height, 500000);
    if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') tally(bg, s.backgroundColor, area);
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (hasText) {
      const len = el.textContent.trim().length;
      tally(fg, s.color, len);
      tally(fonts, s.fontFamily, len);
      tally(sizes, `${s.fontSize}/${s.fontWeight}`, len);
    }
    if (s.borderRadius !== '0px') tally(radii, s.borderRadius);
    if (s.boxShadow !== 'none') tally(shadows, s.boxShadow);
  }
  const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([value, weight]) => ({ value, weight: Math.round(weight) }));

  // Declared CSS custom properties (same-origin stylesheets only; cross-origin ones throw).
  const cssVars = {};
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText === ':root' || rule.selectorText === 'html') {
          for (const prop of rule.style) if (prop.startsWith('--')) cssVars[prop] = rule.style.getPropertyValue(prop).trim();
        }
      }
    } catch { /* cross-origin sheet */ }
  }

  // Computed styles of the elements a replica must get right.
  const PROPS = ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'padding',
    'borderRadius', 'border', 'boxShadow', 'height', 'gap'];
  const pick = el => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const o = { text: (el.innerText || el.value || '').trim().slice(0, 60), box: [r.x, r.y, r.width, r.height].map(Math.round) };
    for (const p of PROPS) o[p] = s[p];
    return o;
  };
  const firstVisible = sel => [...document.querySelectorAll(sel)].filter(visible);
  const keyElements = {};
  for (const [name, sel] of Object.entries({
    header: 'header, [role=banner]', nav: 'nav, [role=navigation]', footer: 'footer, [role=contentinfo]',
    h1: 'h1', h2: 'h2', h3: 'h3', body: 'body', link: 'main a, a',
    button: 'button, [role=button], input[type=submit]', input: 'input[type=text], input[type=search], input:not([type])',
    select: 'select'
  })) {
    const els = firstVisible(sel).slice(0, name === 'button' ? 4 : 1);
    if (els.length) keyElements[name] = els.map(pick);
  }

  // Repeated sibling groups (product cards, feature tiles, rows) = real data samples + card styling.
  const sig = el => el.tagName + '.' + [...el.classList].sort().slice(0, 3).join('.');
  const groups = [];
  for (const parent of document.querySelectorAll('body *')) {
    const kids = [...parent.children].filter(k => k instanceof HTMLElement && visible(k)); // SVG nodes have no innerText
    if (kids.length < 4) continue;
    const counts = new Map();
    kids.forEach(k => counts.set(sig(k), (counts.get(sig(k)) || 0) + 1));
    const [bestSig, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    const items = kids.filter(k => sig(k) === bestSig);
    const texty = items.filter(k => k.innerText.trim().length > 8);
    if (n < 4 || texty.length < 3 || items[0].getBoundingClientRect().height < 40) continue;
    groups.push({
      container: sig(parent),
      itemSelector: bestSig,
      count: n,
      itemStyle: pick(items[0]),
      samples: items.slice(0, 12).map(k => ({
        text: k.innerText.trim().replace(/\n{2,}/g, '\n').slice(0, 300),
        images: [...k.querySelectorAll('img')].slice(0, 2).map(i => ({ src: i.currentSrc || i.src, alt: i.alt })),
        links: [...k.querySelectorAll('a[href]')].slice(0, 1).map(a => a.href)
      }))
    });
  }
  // Nested groups repeat each other; keep the biggest distinct ones.
  groups.sort((a, b) => b.count - a.count);
  const seen = new Set();
  const cardGroups = groups.filter(g => {
    const key = g.samples[0].text.slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);

  // Every interactive control, so the Analyst can list features.
  const label = el => (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const interactive = [...document.querySelectorAll('button, [role=button], input, select, textarea, [aria-expanded], [aria-haspopup], [role=tab], [role=dialog], details > summary')]
    .filter(visible).slice(0, 150).map(el => ({
      tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute('role') || '', label: label(el),
      expanded: el.getAttribute('aria-expanded'), popup: el.getAttribute('aria-haspopup'),
      region: el.closest('header, nav, main, aside, footer')?.tagName.toLowerCase() || 'body'
    }));

  // Logo + inline SVG icons (small, reusable), and the page's image inventory.
  const header = document.querySelector('header, [role=banner]') || document.body;
  const logoEl = header.querySelector('a[href="/"] img, a[href="/"] svg, [class*=logo] img, [class*=logo] svg, [id*=logo] img, [id*=logo] svg, img, svg');
  // Many big sites draw the logo as a CSS sprite (background-image on an element with "logo" in its id/class).
  const spriteEl = [...header.querySelectorAll('[id*=logo], [class*=logo]')].find(el => getComputedStyle(el).backgroundImage.startsWith('url('));
  const logo = logoEl ? (logoEl.tagName.toLowerCase() === 'svg' ? { svg: logoEl.outerHTML.slice(0, 20000) } : { src: logoEl.currentSrc || logoEl.src, alt: logoEl.alt })
    : spriteEl ? (s => ({ sprite: s.backgroundImage.slice(5, -2), position: s.backgroundPosition, size: s.backgroundSize, box: [spriteEl.offsetWidth, spriteEl.offsetHeight] }))(getComputedStyle(spriteEl))
    : null;
  const images = [...document.images].filter(visible).slice(0, 60).map(i => ({ src: i.currentSrc || i.src, alt: i.alt, w: i.naturalWidth, h: i.naturalHeight }));

  const links = [...document.querySelectorAll('a[href]')].filter(a => a instanceof HTMLAnchorElement && visible(a))
    .map(a => ({ href: a.href.split('#')[0], text: a.innerText.trim().slice(0, 40), region: a.closest('header, nav, main, footer')?.tagName.toLowerCase() || 'body' }))
    .filter(l => l.href.startsWith(location.origin) && l.text);

  return {
    title: document.title,
    lang: document.documentElement.lang,
    pageHeight: document.documentElement.scrollHeight,
    tokens: {
      backgrounds: top(bg, 12), textColors: top(fg, 10), fontFamilies: top(fonts, 5),
      fontSizes: top(sizes, 12), radii: top(radii, 8), shadows: top(shadows, 5), cssVariables: cssVars
    },
    keyElements, cardGroups, interactive, logo, images, links
  };
}

// ---- summary.json: what the Analyst needs to write spec.json, without picking through capture.json.
const STYLE = ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'borderRadius', 'padding', 'height', 'box'];
const style = o => Object.assign(Object.fromEntries(STYLE.map(k => [k, o[k]])), o.boxShadow !== 'none' ? { boxShadow: o.boxShadow } : {});
const topTokens = (list = []) => Object.fromEntries(list.slice(0, 6).map(t => [t.value, t.weight]));
const SYMBOLS = { 'US$': 'USD', 'C$': 'CAD', 'A$': 'AUD', 'R$': 'BRL', '£': 'GBP', '€': 'EUR', '₹': 'INR', '¥': 'JPY', '₩': 'KRW', '$': 'USD' };
const CODES = 'USD|EUR|GBP|INR|JPY|CNY|CAD|AUD|NZD|CHF|SEK|NOK|DKK|PLN|MXN|BRL|KRW|SGD|HKD|ZAR|AED|SAR|TRY';
// "£51.77", "INR 1,745.67", "$25", "12,99 €". ponytail: only symbols may trail the number, a trailing code is too often a false hit.
const MONEY = new RegExp(`(US\\$|C\\$|A\\$|R\\$|[£€₹¥₩$]|\\b(?:${CODES})\\b)\\s?(\\d[\\d.,]*)|(\\d[\\d.,]*)\\s?([£€₹])`, 'g');
// Localization the site applied for this machine: "Deliver to India", "items that ship to", "cannot be shipped".
const SERVED = /deliver(?:ing)? to [^\n"]{2,40}|[^\n":]{0,40}\b(?:cannot|can't|doesn't|does not|won't) (?:be )?ship[^\n"]{0,40}|[^\n":]{0,40}\bships? to\b[^\n"]{0,30}|not available in your (?:country|region|location)|currently unavailable/gi;

// Currency + decimals by frequency, e.g. [{ currency: 'GBP', decimals: 2, example: '£51.77', count: 60 }].
function money(text) {
  const seen = new Map();
  for (const m of text.matchAll(MONEY)) {
    const unit = m[1] || m[4], num = (m[2] || m[3]).replace(/[.,]+$/, '');
    const currency = SYMBOLS[unit] || unit;
    const frac = num.match(/[.,](\d+)$/);
    const decimals = frac && frac[1].length !== 3 ? frac[1].length : 0; // ponytail: "1.234" reads as thousands, never 3 decimals
    const key = currency + decimals;
    if (!seen.has(key)) seen.set(key, { currency, decimals, example: m[0].trim(), count: 0 });
    seen.get(key).count++;
  }
  return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, 4);
}

const distinctHints = texts => [...new Map(texts.map(t => [t.trim().toLowerCase(), t.trim()])).values()].filter(Boolean).slice(0, 4);

function summarizePage(p) {
  const outline = p.ariaOutline || '';
  const interactive = {};
  for (const c of p.interactive || []) {
    const r = (interactive[c.region] ||= { count: 0, labels: [] });
    r.count++;
    const opens = (c.popup && c.popup !== 'false') || c.expanded != null;
    const label = (c.label || `<${c.tag}${c.type ? ' ' + c.type : ''}>`) + (opens ? ' [opens]' : '');
    if (r.labels.length < 40 && !r.labels.includes(label)) r.labels.push(label);
  }
  // Distinct text+href in document order, grouped by region; hrefs are same-origin, so path+query is enough.
  const links = {}, seenLinks = new Set();
  for (const l of p.links || []) {
    const u = new URL(l.href), href = (u.pathname + u.search).slice(0, 100);
    if (seenLinks.has(l.text + href) || seenLinks.size >= 60) continue;
    seenLinks.add(l.text + href);
    (links[l.region] ||= []).push([l.text, href]);
  }
  const samples = (p.cardGroups || []).flatMap(g => g.samples.map(s => s.text)).join('\n');
  return {
    name: p.name, url: p.url, title: p.title, lang: p.lang, status: p.status, blocked: p.blocked, error: p.error,
    pageHeight: p.pageHeight, screens: p.screens, states: p.states,
    tokens: p.tokens && {
      backgrounds: topTokens(p.tokens.backgrounds), textColors: topTokens(p.tokens.textColors), fonts: topTokens(p.tokens.fontFamilies),
      fontSizes: topTokens(p.tokens.fontSizes), radii: topTokens(p.tokens.radii), shadows: topTokens(p.tokens.shadows)
    },
    keyElements: Object.fromEntries(Object.entries(p.keyElements || {}).map(([k, els]) => [k, els.map(style)])),
    cardGroups: (p.cardGroups || []).map(g => ({
      container: g.container, itemSelector: g.itemSelector, count: g.count, itemStyle: style(g.itemStyle),
      samples: g.samples.slice(0, 3).map(s => ({ text: s.text.slice(0, 200), alt: s.images[0]?.alt }))
    })),
    interactive, links,
    headings: [...outline.matchAll(/heading "((?:[^"\\]|\\.)*)" \[level=([1-3])\]/g)].slice(0, 40)
      .map(m => `h${m[2]} ${m[1].replace(/\\"/g, '"').slice(0, 100)}`),
    money: money(outline + '\n' + samples),
    served: distinctHints(outline.match(SERVED) || []).join(' · ')
  };
}

function writeSummary(dir, capture) {
  const pages = capture.pages.map(summarizePage);
  const money = new Map();
  for (const m of pages.flatMap(p => p.money)) {
    const k = m.currency + m.decimals;
    money.set(k, { ...m, count: (money.get(k)?.count || 0) + m.count });
  }
  const summary = {
    url: capture.url, capturedAt: capture.capturedAt, blocked: capture.blocked,
    currency: [...money.values()].sort((a, b) => b.count - a.count)[0] || null, // best guess across pages; per page in pages[].money
    served: distinctHints(pages.flatMap(p => p.served.split(' · '))).join(' · '),
    pages
  };
  const file = path.join(dir, 'summary.json');
  fs.writeFileSync(file, compactJSON(summary) + '\n');
  return file;
}

// Indented JSON, but any value that fits in 120 chars stays on one line: about half the size of indent-2,
// and no line so long the Read tool cuts it.
function compactJSON(v, pad = '') {
  const flat = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || flat.length <= 120) return flat;
  const inner = pad + '  ';
  const items = Array.isArray(v) ? v.map(x => inner + (compactJSON(x, inner) ?? 'null'))
    : Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${compactJSON(x, inner)}`);
  return (Array.isArray(v) ? '[\n' : '{\n') + items.join(',\n') + '\n' + pad + (Array.isArray(v) ? ']' : '}');
}

// Pick up to `n` more same-origin pages: prefer main-content links (listing/detail), one per path shape.
function pickPages(links, startUrl, n) {
  const start = new URL(startUrl);
  const shape = u => new URL(u).pathname.replace(/\/index\.html?$/, '/')
    .split('/').filter(Boolean).map(p => (/\d/.test(p) ? ':id' : p)).slice(0, 2).join('/');
  const ranked = [...links.filter(l => l.region === 'main'), ...links.filter(l => l.region !== 'main')];
  const picked = [], shapes = new Set([shape(start.href)]);
  for (const l of ranked) {
    const s = shape(l.href);
    if (!shapes.has(s) && l.href !== start.href) {
      shapes.add(s);
      picked.push(l.href);
    }
    if (picked.length >= n) break;
  }
  return picked;
}

// Open menus/popups in header & nav and screenshot each open state.
async function captureStates(page, name) {
  const triggers = page.locator('header [aria-haspopup], header [aria-expanded="false"], nav [aria-haspopup], nav [aria-expanded="false"], header details > summary');
  const count = Math.min(await triggers.count(), 5);
  const states = [];
  for (let i = 0; i < count; i++) {
    const t = triggers.nth(i);
    const label = ((await t.getAttribute('aria-label').catch(() => null)) || (await t.innerText().catch(() => '')) || '').trim().slice(0, 40);
    try {
      await t.hover({ timeout: 2000 });
      await page.waitForTimeout(300);
      if ((await t.getAttribute('aria-expanded')) === 'false') await t.click({ timeout: 2000 });
      await page.waitForTimeout(400);
      const file = `states/${name}-${i}.png`;
      await page.screenshot({ path: path.join(outDir, file) });
      states.push({ trigger: label, screenshot: file });
      await page.keyboard.press('Escape');
      await page.mouse.move(0, 0);
    } catch { /* hidden or detached trigger */ }
  }
  return states;
}

// One viewport in its own browser context. Desktop also measures the page (tokens, cards, aria outline, open states).
async function captureViewport(browser, url, name, vp, [width, height]) {
  // At phone width, present as a phone: many sites (Amazon included) serve their mobile layout by user agent,
  // and a desktop UA at 375px captures a cut-off desktop page instead of the real mobile site.
  const mobile = vp === 'mobile';
  const ctx = await browser.newContext({
    viewport: { width, height }, locale: 'en-US',
    userAgent: mobile ? MOBILE_UA : UA, isMobile: mobile, hasTouch: mobile
  });
  const page = await ctx.newPage();
  const out = { fields: {} };
  try {
    const res = await gotoSettled(page, url);
    out.status = res?.status();
    await scrollThrough(page);
    const file = `screens/${name}-${vp}.png`;
    // ponytail: full page capped at 12000px tall; stitched section captures if very long pages matter
    const h = Math.min(await page.evaluate(() => document.documentElement.scrollHeight), 12000);
    await page.screenshot({ path: path.join(outDir, file), clip: { x: 0, y: 0, width, height: h }, fullPage: true });
    out.screen = file;
    if (vp === 'desktop') {
      Object.assign(out.fields, await page.evaluate(measurePage));
      out.fields.ariaOutline = (await page.locator('body').ariaSnapshot({ timeout: 10000 }).catch(() => '')).slice(0, 120000); // big home pages run past 30k chars before the footer
      out.fields.states = await captureStates(page, name);
    }
  } catch (err) {
    out.error = `${vp}: ${err.message.split('\n')[0]}`;
  } finally {
    await ctx.close();
  }
  return out;
}

// The 3 viewports run concurrently; results merge in viewport order so capture.json reads as before.
async function capturePage(browser, url) {
  const name = slug(url);
  const vps = Object.entries(VIEWPORTS);
  const results = await Promise.all(vps.map(([vp, size]) => inFlight(() => captureViewport(browser, url, name, vp, size))));
  const entry = { url, name, screens: {} };
  results.forEach((r, i) => {
    entry.status ??= r.status;
    if (r.screen) entry.screens[vps[i][0]] = r.screen;
    Object.assign(entry, r.fields);
    if (r.error) entry.error ??= r.error;
  });
  entry.blocked = !entry.title || entry.status >= 400 || BLOCK_RE.test(entry.title) || BLOCK_RE.test((entry.ariaOutline || '').slice(0, 3000));
  return entry;
}

// At most `n` tasks running at once, started in call order.
function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    queue.shift()();
  };
  return task => new Promise((resolve, reject) => {
    queue.push(() => task().then(resolve, reject).finally(() => { active--; next(); }));
    next();
  });
}

const inFlight = limiter(concurrency);
const browser = await launchBrowser();
// The first page alone: its links pick the rest. Then every other journey page at once, bounded by inFlight.
const pages = [await capturePage(browser, startUrl)];
// Extra URLs on the command line are the journey pages, in order; otherwise pick links automatically.
const next = args._.length > 1 ? args._.slice(1) : pickPages(pages[0].links || [], startUrl, maxPages - 1);
pages.push(...await Promise.all(next.map(url => capturePage(browser, url))));
await browser.close();

const capture = { url: startUrl, capturedAt: new Date().toISOString(), blocked: pages[0].blocked, pages };
fs.writeFileSync(path.join(outDir, 'capture.json'), JSON.stringify(capture, null, 2));
const summaryFile = writeSummary(outDir, capture);

for (const p of pages) {
  console.log(`${p.blocked ? 'BLOCKED' : 'ok     '} ${p.status ?? '---'} ${p.url}  cards:${p.cardGroups?.length ?? 0} controls:${p.interactive?.length ?? 0} states:${p.states?.length ?? 0}${p.error ? '  ! ' + p.error : ''}`);
}
console.log(`\nWrote ${path.join(outDir, 'capture.json')} and ${summaryFile} (${(fs.statSync(summaryFile).size / 1024).toFixed(1)} KB, read it first)`);
if (capture.blocked) console.log('Target looks blocked: follow "Blocked targets" in references/reconnaissance-playbook.md.');
