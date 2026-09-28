// Shared helpers for capture_target.js, check_replica.js and visual_diff.js.
//   import { serveDir, pool } from './lib.js'
//   const { url, close } = await serveDir('replica')   // static server on a free 127.0.0.1 port
//   const results = await pool(items, 6, fn)           // at most 6 fn(item, i) at once, results in input order
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

export const VIEWPORTS = { desktop: [1440, 900], tablet: [768, 1024], mobile: [375, 812] };

// `--out dir --pages 3 positional` -> { out: 'dir', pages: '3', _: ['positional'] }
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      args[key] = next === undefined || next.startsWith('--') ? true : argv[++i];
    } else args._.push(argv[i]);
  }
  return args;
}

// Bundled Chromium first; system Chrome if the bundled build isn't downloaded.
export async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ channel: 'chrome' });
  }
}

export async function gotoSettled(page, url) {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  return res;
}

// Scroll to the bottom so lazy-loaded images/sections render, then back to top. Keeps going while the
// page grows (feeds that append sections on scroll, e.g. Amazon's mobile home), up to ~20000px / ~25s.
export async function scrollThrough(page) {
  const deadline = Date.now() + 25000;
  let y = 0;
  for (let rounds = 0; rounds < 6 && Date.now() < deadline; rounds++) {
    const before = await page.evaluate(() => document.documentElement.scrollHeight);
    y = await page.evaluate(async start => {
      let pos = start;
      for (; pos < document.documentElement.scrollHeight && pos < 20000; pos += window.innerHeight * 0.8) {
        window.scrollTo(0, pos);
        await new Promise(r => setTimeout(r, 250));
      }
      return pos;
    }, y);
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => document.documentElement.scrollHeight);
    if (after <= before || after >= 20000) break;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
}

export function slug(url) {
  const { pathname } = new URL(url);
  return pathname.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'home';
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2'
};

// Static server for a replica folder on an OS-assigned port, so a busy port can never make the checker
// test some other process. Directory -> its index.html; anything resolving outside `dir` -> 404.
// Containment is checked on real paths, so neither `..` nor a symlink pointing out of `dir` escapes it.
export async function serveDir(dir) {
  const root = await fs.realpath(path.resolve(dir));
  const inRoot = f => f.startsWith(root + path.sep); // a file, never root itself (that's a directory)
  const server = http.createServer(async (req, res) => {
    let file;
    try {
      file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
    } catch {
      return res.writeHead(400).end('bad request');
    }
    try {
      file = await fs.realpath(file); // missing -> 404 below
      if ((await fs.stat(file)).isDirectory()) file = await fs.realpath(path.join(file, 'index.html'));
      if (!inRoot(file)) throw new Error('outside root');
      const body = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => { server.closeAllConnections(); server.close(() => resolve()); })
  };
}

// Run fn(item, i) over items with at most `limit` in flight; results come back in input order.
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
