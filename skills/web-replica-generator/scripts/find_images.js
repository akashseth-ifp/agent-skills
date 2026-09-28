#!/usr/bin/env node
/**
 * find_images.js — freely licensed photos that match each mock record, from Wikimedia Commons.
 * No API key needed. Each result records its source page and licence, so the replica can credit them.
 *
 * Search:
 *   node scripts/find_images.js "wireless headphones" "poetry book cover" [--per 3] [--width 600]
 *   stdout (JSON): { "wireless headphones": [ { "url", "width", "height", "source", "license", "title" }, ... ], ... }
 * Download (one JPEG per key, keys in parallel, resumable):
 *   node scripts/find_images.js --manifest m.json --download assets/img [--width 600] [--concurrency 3] [--force]
 *   m.json: { "<key>": "<keyword>" | ["<keyword>", "<fallback keyword>", ...] }
 *   writes <dir>/<key>.jpg and merges <dir>/index.json: { "<key>": { "file", "keyword", "source", "license", "title" } }
 *   stdout: "downloaded N, cached M, reused R, missing K: <keys>" (reused counts within downloaded). Missing keys
 *   are reported, not fatal: exit 0. Bad usage: exit 2.
 */
import fs from 'node:fs';
import path from 'node:path';
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
    '       node scripts/find_images.js --manifest <file.json> --download <dir> [--width 600] [--concurrency 3] [--force]');
  process.exit(2);
}

// Commons answers bursts with 429/503: back off (honouring Retry-After) instead of losing the key.
async function get(url) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: UA });
    } catch (err) {
      if (attempt >= 5) throw err;
    }
    if (res && (![429, 503].includes(res.status) || attempt >= 5)) return res;
    await res?.body?.cancel();
    const after = Number(res?.headers.get('retry-after'));
    // ponytail: only the seconds form of Retry-After, capped at 30s; a longer ban won't lift within one build.
    const wait = Math.min(after > 0 ? after * 1000 : 1000 * 2 ** attempt + Math.random() * 500, 30000);
    console.error(`${res ? `HTTP ${res.status}` : 'network error'} from ${new URL(url).host}, retry ${attempt} in ${(wait / 1000).toFixed(1)}s`);
    await sleep(wait);
  }
}

async function search(q, limit, jpegOnly = false) {
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
      ok = !args.force && keywords(key).includes(index[key]?.keyword) && isJpeg(fs.readFileSync(fileOf(key)));
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
    try {
      const res = await get(c.url);
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && isJpeg(buf)) return fs.writeFileSync(file, buf), true;
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

  const queue = [...todo];
  const workers = Math.max(1, Number(args.concurrency) || 3);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (queue.length) await fetchKey(queue.shift());
  }));
  const miss = Object.keys(manifest).filter(k => missing.has(k));
  console.log(`downloaded ${counts.downloaded}, cached ${counts.cached}, reused ${counts.reused}, missing ${miss.length}${miss.length ? ': ' + miss.join(', ') : ''}`);
}
