#!/usr/bin/env node
/**
 * find_images.js — freely licensed photos that match each mock record, from Wikimedia Commons.
 * No API key needed. Each result records its source page and licence, so the replica can credit them.
 *
 * Search:
 *   node scripts/find_images.js "wireless headphones" "poetry book cover" [--per 3] [--width 600]
 *   stdout (JSON): { "wireless headphones": [ { "url", "width", "height", "source", "license", "title" }, ... ], ... }
 * Download (one JPEG per key, keys in parallel, resumable):
 *   node scripts/find_images.js --manifest m.json --download assets/img [--width 600] [--concurrency 3] [--force] [--max-time 150] [--no-cache]
 *   m.json: { "<key>": "<keyword>" | ["<keyword>", "<fallback keyword>", ...] }
 *   writes <dir>/<key>.jpg and merges <dir>/index.json: { "<key>": { "file", "keyword", "source", "license", "title" } }
 *   stdout: "downloaded N, cached M, reused R, missing K: <keys> (Ss)" (reused counts within downloaded). Missing keys
 *   are reported, not fatal: exit 0. Bad usage: exit 2. Progress goes to stderr every 10 keys.
 * Time box: after --max-time seconds (default 150) no new request starts. Keys still without a picture then reuse one
 * already downloaded (same keyword first), recorded as "reusedFrom" in index.json, so a rate-limited run never stalls
 * a build or leaves a 404. Re-run later (or rely on the cache next build) to replace them with their own images.
 * Rate limits: requests to each host are spaced out by one shared limiter, and a 429/503 pauses EVERY worker until
 * the cooldown ends (instead of each worker retrying on its own and keeping the ban alive).
 * Cache: search results and downloaded JPEGs are kept in ${XDG_CACHE_HOME:-~/.cache}/web-replica-generator/
 * (searches for 30 days), so a repeat build makes no network requests. --no-cache bypasses it. Delete the folder to
 * reclaim space.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from './lib.js';

const args = parseArgs();
const per = Number(args.per || 3);
const width = Number(args.width || 600);
// Wikimedia asks API clients to identify themselves.
const UA = { 'User-Agent': 'web-replica-generator/2.0 (mock data images)' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function usage(msg) {
  if (msg) console.error(msg);
  console.error('Usage: node scripts/find_images.js "<keyword>" ["<keyword>" ...] [--per 3] [--width 600]\n' +
    '       node scripts/find_images.js --manifest <file.json> --download <dir> [--width 600] [--concurrency 3] [--force] [--max-time 150] [--no-cache]');
  process.exit(2);
}

// One limiter per host, shared by every worker: requests start at least GAP ms apart, and a 429/503 sets a
// cooldown that all workers wait out together. Per-worker backoff kept 3 workers hammering a rate-limited host.
const GAP = { 'commons.wikimedia.org': 250 };
const hosts = new Map();
let deadline = Infinity; // set by --max-time in download mode
async function slot(host) {
  if (!hosts.has(host)) hosts.set(host, { next: 0, until: 0, strikes: 0 });
  const h = hosts.get(host);
  for (;;) {
    const now = Date.now();
    if (Math.max(h.next, h.until, now) >= deadline) throw new Error('time budget used up');
    const wait = Math.max(h.next, h.until) - now;
    if (wait <= 0) {
      h.next = now + (GAP[host] ?? 150);
      return h;
    }
    await sleep(wait);
  }
}

async function get(url) {
  const host = new URL(url).host;
  for (let attempt = 1; ; attempt++) {
    const h = await slot(host);
    let res;
    try {
      res = await fetch(url, { headers: UA });
    } catch (err) {
      if (attempt >= 6) throw err;
    }
    if (res && ![429, 503].includes(res.status)) {
      h.strikes = 0;
      return res;
    }
    if (res && attempt >= 6) return res;
    await res?.body?.cancel();
    h.strikes++;
    const after = Number(res?.headers.get('retry-after'));
    // ponytail: only the seconds form of Retry-After, capped at 60s; a longer ban won't lift within one build.
    const wait = Math.min(after > 0 ? after * 1000 : 5000 * 2 ** (h.strikes - 1), 60000);
    h.until = Math.max(h.until, Date.now() + wait);
    console.error(`${res ? `HTTP ${res.status}` : 'network error'} from ${host}: all workers pause ${(wait / 1000).toFixed(0)}s (try ${attempt})`);
  }
}

// ---------- cache ----------
const CACHE = args['no-cache'] ? null : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'web-replica-generator');
const MONTH = 30 * 24 * 3600 * 1000;
const hash = s => crypto.createHash('sha1').update(s).digest('hex');
const cachePath = (kind, key, ext) => path.join(CACHE, kind, `${hash(key)}${ext}`);
function cacheRead(kind, key, ext, maxAge = Infinity) {
  if (!CACHE) return null;
  try {
    const f = cachePath(kind, key, ext);
    return Date.now() - fs.statSync(f).mtimeMs < maxAge ? fs.readFileSync(f) : null;
  } catch {
    return null;
  }
}
function cacheWrite(kind, key, ext, buf) {
  if (!CACHE) return;
  try {
    const f = cachePath(kind, key, ext);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`; // rename is atomic, so a killed run never leaves a half-written entry
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, f);
  } catch { /* cache is best effort */ }
}

async function search(q, limit, jpegOnly = false) {
  const ckey = JSON.stringify([q, limit, jpegOnly, width]);
  const hit = cacheRead('search', ckey, '.json', MONTH);
  if (hit) return JSON.parse(hit);
  const results = await searchLive(q, limit, jpegOnly);
  cacheWrite('search', ckey, '.json', JSON.stringify(results));
  return results;
}

async function searchLive(q, limit, jpegOnly) {
  const api = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: String(limit),
    gsrsearch: `${q} ${jpegOnly ? 'filemime:image/jpeg' : 'filetype:bitmap'}`, prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(width), iiextmetadatafilter: 'LicenseShortName'
  }).forEach(([k, v]) => api.searchParams.set(k, v));
  const res = await get(api);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const pages = Object.values((await res.json()).query?.pages || {}).sort((a, b) => a.index - b.index);
  return pages
    .map(p => ({ p, i: p.imageinfo?.[0] }))
    // Skip tiny images and extreme panoramas/strips; they look wrong in a card.
    .filter(({ i }) => i && i.thumburl && i.width >= 400 && i.width / i.height < 2.5 && i.height / i.width < 2.5)
    .filter(({ i }) => !jpegOnly || i.mime === 'image/jpeg')
    .map(({ p, i }) => ({
      url: i.thumburl, width: i.thumbwidth, height: i.thumbheight,
      source: i.descriptionurl, license: i.extmetadata?.LicenseShortName?.value || 'see source',
      title: p.title.replace(/^File:/, '')
    }));
}

if (args.manifest || args.download) await download();
else {
  if (!args._.length) usage();
  const out = {};
  for (const q of args._) {
    try {
      out[q] = (await search(q, per * 3)).slice(0, per);
    } catch (err) {
      out[q] = [];
      console.error(`${q}: ${err.message}`);
    }
  }
  console.log(JSON.stringify(out, null, 2));
}

async function download() {
  if (typeof args.manifest !== 'string' || typeof args.download !== 'string') usage('--manifest and --download both need a value');
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
  } catch (err) {
    usage(`Cannot read manifest: ${err.message}`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) usage('Manifest must be a JSON object');
  const keywords = key => [manifest[key]].flat();
  for (const key of Object.keys(manifest)) {
    // Keys become file names: no path separators, no hidden files.
    if (!/^[\w-][\w.-]*$/.test(key)) usage(`Bad key "${key}": use letters, digits, _ - .`);
    const kws = keywords(key);
    if (!kws.length || !kws.every(k => typeof k === 'string' && k.trim())) usage(`Key "${key}": keyword must be a string or array of strings`);
  }

  deadline = Date.now() + 1000 * (Number(args['max-time']) || 150);
  const dir = args.download;
  fs.mkdirSync(dir, { recursive: true });
  const indexFile = path.join(dir, 'index.json');
  let index = {};
  try {
    index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  } catch {}
  const isJpeg = buf => buf.length > 2048 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const fileOf = key => path.join(dir, `${key}.jpg`);
  const counts = { downloaded: 0, cached: 0, reused: 0 };
  const missing = new Set();
  const chosen = new Set(); // Commons pages already given to some key

  // Resume: keep a valid file whose index entry still matches one of the key's keywords.
  const todo = Object.keys(manifest).filter(key => {
    let ok = false;
    try {
      ok = !args.force && !index[key]?.reusedFrom && keywords(key).includes(index[key]?.keyword) && isJpeg(fs.readFileSync(fileOf(key))); // a filled-in copy is retried
    } catch {}
    if (ok) counts.cached++, chosen.add(index[key].source);
    return !ok;
  });

  const searches = new Map(); // one API call per distinct keyword, however many keys share it
  const find = kw => {
    if (!searches.has(kw)) searches.set(kw, search(kw, 15, true).catch(err => (console.error(`${kw}: ${err.message}`), [])));
    return searches.get(kw);
  };
  async function fetchTo(c, file) {
    const hit = cacheRead('img', c.url, '.jpg');
    if (hit && isJpeg(hit)) return fs.writeFileSync(file, hit), true;
    try {
      const res = await get(c.url);
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && isJpeg(buf)) return cacheWrite('img', c.url, '.jpg', buf), fs.writeFileSync(file, buf), true; // only valid JPEGs are cached
      console.error(`${c.url}: ${res.ok ? 'not a JPEG' : `HTTP ${res.status}`}`);
    } catch (err) {
      console.error(`${c.url}: ${err.message}`);
    }
    return false;
  }

  async function fetchKey(key) {
    const taken = []; // candidates another key already has: the last resort
    let got;
    for (const kw of keywords(key)) {
      for (const c of await find(kw)) {
        if (chosen.has(c.source)) { taken.push({ c, kw }); continue; }
        chosen.add(c.source); // claim before the await so parallel keys pick something else
        if (await fetchTo(c, fileOf(key))) { got = { c, kw }; break; }
      }
      if (got) break;
    }
    for (const t of got ? [] : taken) {
      if (await fetchTo(t.c, fileOf(key))) { got = t; counts.reused++; break; }
    }
    if (!got) return missing.add(key);
    counts.downloaded++;
    const { source, license, title } = got.c;
    index[key] = { file: `${key}.jpg`, keyword: got.kw, source, license, title };
    // Written per key so an interrupted run resumes from what it already has.
    fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
  }

  const t0 = Date.now();
  const queue = [...todo];
  const workers = Math.max(1, Number(args.concurrency) || 3);
  let done = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    while (queue.length) {
      await fetchKey(queue.shift());
      if (++done % 10 === 0) console.error(`progress ${done}/${todo.length} keys, ${counts.downloaded} downloaded, ${missing.size} missing, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }));
  // Time box ran out (or nothing matched): give each key still missing a picture already downloaded in this run,
  // one from the same keyword when possible, so no record points at a missing file.
  const have = Object.keys(index).filter(k => k !== undefined && !missing.has(k) && index[k]?.file && fs.existsSync(fileOf(k)) && !index[k].reusedFrom);
  let filled = 0;
  for (const key of [...missing]) {
    const kws = keywords(key);
    const donor = have.find(k => kws.includes(index[k].keyword)) || have[filled % have.length];
    if (!donor) break;
    fs.copyFileSync(fileOf(donor), fileOf(key));
    index[key] = { ...index[donor], file: `${key}.jpg`, keyword: kws[0], reusedFrom: donor };
    missing.delete(key);
    filled++;
  }
  if (filled) fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + '\n');
  const miss = Object.keys(manifest).filter(k => missing.has(k));
  console.log(`downloaded ${counts.downloaded}, cached ${counts.cached}, reused ${counts.reused}, filled ${filled}, missing ${miss.length}${miss.length ? ': ' + miss.join(', ') : ''} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
