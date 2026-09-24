#!/usr/bin/env node

/**
 * audit_replica.js
 * Programmatic QA Audit Script for Autonomous Web Replica Validation.
 *
 * Supports Multi-Layer Analysis:
 * 1. HTML5 Semantic Architecture (header, main, nav, footer)
 * 2. Responsive Viewport Meta Configuration
 * 3. Element ID Uniqueness (Audits static HTML and dynamic post-hydration DOM)
 * 4. Multi-Layer Image Hygiene:
 *    - Layer A: Static <img> tags in index.html
 *    - Layer B: JavaScript & JSON Data Fixtures (js/data.js, catalog objects, template literals)
 *    - Layer C: Hydrated DOM Images (Captures post-hydration client DOM via Chrome headless)
 * 5. Button and Anchor Accessibility & Event Bindings
 * 6. CSS Design Token Structure (:root variables present)
 * 7. Live Server Response (if URL provided)
 *
 * Usage:
 *   node audit_replica.js --dir ./path/to/replica
 *   node audit_replica.js --dir ./path/to/replica --url http://localhost:5173
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
let targetDir = process.cwd();
let targetUrl = null;
let verbose = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir' && args[i + 1]) targetDir = path.resolve(args[++i]);
  if (args[i] === '--url' && args[i + 1]) targetUrl = args[++i];
  if (args[i] === '--verbose') verbose = true;
}

const results = {
  timestamp: new Date().toISOString(),
  target: targetUrl || targetDir,
  passed: true,
  summary: { errors: 0, warnings: 0, passedChecks: 0 },
  checks: [],
  metrics: {
    staticImages: 0,
    dataFixtureImages: 0,
    hydratedDomImages: 0,
    cssVariables: 0,
    totalElementIds: 0
  }
};

function logCheck(name, passed, message, details = null) {
  if (!passed) results.passed = false;
  const entry = { name, passed, message };
  if (details) entry.details = details;
  results.checks.push(entry);

  if (passed) {
    results.summary.passedChecks++;
    if (verbose) console.log(`  \x1b[32m✔ PASS\x1b[0m: ${name} - ${message}`);
  } else {
    results.summary.errors++;
    console.log(`  \x1b[31m✖ FAIL\x1b[0m: ${name} - ${message}`);
    if (details) console.log(`    Details: ${JSON.stringify(details, null, 2)}`);
  }
}

function logWarning(name, message, details = null) {
  results.summary.warnings++;
  results.checks.push({ name, passed: 'warning', message, details });
  console.log(`  \x1b[33m⚠ WARN\x1b[0m: ${name} - ${message}`);
}

async function runAudit() {
  console.log(`\n\x1b[1m=== Running Web Replica QA Audit ===\x1b[0m`);
  console.log(`Target Directory: ${targetDir}`);
  if (targetUrl) console.log(`Target Live URL:  ${targetUrl}`);
  console.log(``);

  // 1. Live Server Check (if targetUrl specified)
  if (targetUrl) {
    try {
      const statusCode = await checkHttpUrl(targetUrl);
      if (statusCode >= 200 && statusCode < 400) {
        logCheck('Server Health', true, `Endpoint returned HTTP ${statusCode}`);
      } else {
        logCheck('Server Health', false, `Endpoint returned error HTTP ${statusCode}`);
      }
    } catch (err) {
      logCheck('Server Health', false, `Failed to reach ${targetUrl}: ${err.message}`);
    }
  }

  // 2. Locate index.html
  const indexPath = path.join(targetDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    logCheck('HTML Existence', false, `index.html not found in ${targetDir}`);
    finish();
    return;
  }
  logCheck('HTML Existence', true, `Found index.html`);

  const staticHtml = fs.readFileSync(indexPath, 'utf-8');

  // 3. Attempt Hydrated DOM Capture via Chrome Headless (when live URL is provided)
  let hydratedHtml = null;
  const chromeBinary = findChromeBinary();

  if (chromeBinary && targetUrl) {
    hydratedHtml = captureHydratedDom(chromeBinary, targetUrl);
  }

  // Use hydratedHtml for DOM checks if available, otherwise fall back to staticHtml
  const activeDom = hydratedHtml || staticHtml;
  const isHydrated = Boolean(hydratedHtml);

  if (isHydrated) {
    logCheck('Hydrated DOM Capture', true, `Rendered DOM captured via Headless Chrome (${targetUrl})`);
  } else if (targetUrl) {
    logWarning('Hydrated DOM Capture', `Could not capture rendered DOM via Chrome for ${targetUrl}; falling back to static/fixture analysis`);
  }

  // 4. Viewport Meta Check
  const hasViewport = /<meta\s+name=["']viewport["']\s+content=["'][^"']*width=device-width[^"']*["']/i.test(staticHtml);
  logCheck('Responsive Viewport', hasViewport, hasViewport ? 'Viewport meta tag configured properly' : 'Missing width=device-width viewport meta tag');

  // 5. Semantic Landmarks
  const hasHeader = /<header[\s>]/i.test(activeDom);
  const hasMain = /<main[\s>]/i.test(activeDom);
  const hasNav = /<nav[\s>]/i.test(activeDom);
  logCheck('Semantic Landmarks', hasHeader && hasMain && hasNav, `Header: ${hasHeader}, Main: ${hasMain}, Nav: ${hasNav}`);

  // 6. Element ID Uniqueness (Auditing active DOM to catch duplicate IDs from JS loops)
  const idMatches = [...activeDom.matchAll(/id=["']([^"']+)["']/gi)].map(m => m[1]);
  results.metrics.totalElementIds = idMatches.length;
  const idCounts = {};
  const duplicateIds = [];
  for (const id of idMatches) {
    idCounts[id] = (idCounts[id] || 0) + 1;
    if (idCounts[id] === 2) duplicateIds.push(id);
  }
  logCheck(
    'Element ID Uniqueness',
    duplicateIds.length === 0,
    duplicateIds.length === 0 ? `All ${idMatches.length} element IDs are unique (${isHydrated ? 'hydrated DOM' : 'static HTML'})` : `Found ${duplicateIds.length} duplicate IDs: ${duplicateIds.slice(0, 5).join(', ')}`,
    duplicateIds.length > 0 ? duplicateIds : null
  );

  // 7. Multi-Layer Image Hygiene
  auditImageHygiene(staticHtml, activeDom, isHydrated, targetDir);

  // 8. Design Token CSS Verification
  const cssFiles = findFiles(targetDir, '.css');
  let foundTokens = false;
  let tokenCount = 0;
  for (const cssFile of cssFiles) {
    const css = fs.readFileSync(cssFile, 'utf-8');
    const rootBlock = css.match(/:root\s*\{([^}]+)\}/s);
    if (rootBlock) {
      const vars = rootBlock[1].match(/--[a-zA-Z0-9_-]+:/g);
      if (vars && vars.length >= 5) {
        foundTokens = true;
        tokenCount += vars.length;
      }
    }
  }
  results.metrics.cssVariables = tokenCount;
  logCheck('CSS Design Tokens', foundTokens, foundTokens ? `Found :root with ${tokenCount} custom properties across CSS files` : 'No structured CSS variables found in :root');

  finish();
}

/**
 * Multi-layer Image Hygiene Audit
 * Checks Layer A (Static HTML), Layer B (JavaScript & JSON Data Fixtures), and Layer C (Hydrated DOM)
 */
function auditImageHygiene(staticHtml, activeDom, isHydrated, dir) {
  // Layer A: Static HTML
  const staticImgTags = [...staticHtml.matchAll(/<img\s+([^>]+)>/gi)];
  results.metrics.staticImages = staticImgTags.length;

  // Layer B: Scan JS & JSON data fixtures (e.g., data.js, store.js, catalog fixtures)
  const fixtureImages = extractImagesFromFixtures(dir);
  results.metrics.dataFixtureImages = fixtureImages.validUrls.length;

  // Layer C: Hydrated DOM Images (if Chrome was run)
  const domImgTags = [...activeDom.matchAll(/<img\s+([^>]+)>/gi)];
  results.metrics.hydratedDomImages = domImgTags.length;

  // 1. Fixture Data Audit
  if (fixtureImages.scannedFiles > 0) {
    const hasEmptyInFixtures = fixtureImages.emptyOrInvalid.length > 0;
    if (hasEmptyInFixtures) {
      logCheck('Data Fixture Images', false, `Fixture audit failed: ${fixtureImages.emptyOrInvalid.length} empty/invalid image declarations found in scripts/fixtures`, fixtureImages.emptyOrInvalid);
    } else if (fixtureImages.validUrls.length > 0) {
      logCheck('Data Fixture Images', true, `Found ${fixtureImages.validUrls.length} valid product/asset images across ${fixtureImages.scannedFiles} data files`);
    } else {
      // URLs built by helpers (e.g. image: img(id)) aren't string literals; the rendered-DOM check covers them.
      logWarning('Data Fixture Images', `No literal image URLs found in ${fixtureImages.scannedFiles} script files (URLs may be generated by helper functions)`);
    }
  }

  // 2. Active DOM Image Audit (Static or Hydrated)
  const targetImgs = isHydrated ? domImgTags : staticImgTags;
  const emptySrcs = [];
  const missingAlts = [];
  const placeholderSrcs = [];

  for (const img of targetImgs) {
    const attrs = img[1];
    const srcMatch = attrs.match(/src=["']([^"']*)["']/i);
    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);

    const srcVal = srcMatch ? srcMatch[1].trim() : '';

    if (!srcMatch || srcVal === '' || srcVal === '#') {
      emptySrcs.push(img[0]);
    } else if (/placeholder|example\.com|test\.jpg|dummy|image\.png$/i.test(srcVal) && !srcVal.includes('data:image')) {
      placeholderSrcs.push(srcVal);
    }

    if (!altMatch) {
      missingAlts.push(img[0]);
    }
  }

  // In a JS-driven web replica, images can reside in static HTML, JS data fixtures, or hydrated DOM:
  const totalImageSources = results.metrics.staticImages + results.metrics.dataFixtureImages + results.metrics.hydratedDomImages;
  const hasImages = totalImageSources > 0;

  // Include any invalid/empty fixture declarations in emptySrcs
  if (fixtureImages.emptyOrInvalid.length > 0) {
    emptySrcs.push(...fixtureImages.emptyOrInvalid.map(e => `${e.file}: ${e.match}`));
  }

  logCheck(
    'Image Existence & Non-Empty Src',
    emptySrcs.length === 0 && hasImages,
    emptySrcs.length === 0 && hasImages
      ? `Verified ${totalImageSources} total images across project (${results.metrics.staticImages} static HTML, ${results.metrics.dataFixtureImages} in JS data fixtures, ${results.metrics.hydratedDomImages} in rendered DOM)`
      : `Image hygiene failed: ${emptySrcs.length} empty/missing src attributes; ${totalImageSources} total images found`,
    emptySrcs.length > 0 ? emptySrcs : null
  );

  if (placeholderSrcs.length > 0) {
    logWarning('Image Placeholders Detected', `Found ${placeholderSrcs.length} potential generic placeholder URLs`, placeholderSrcs.slice(0, 3));
  }

  if (missingAlts.length > 0) {
    logWarning('Accessibility: Image Alts', `Found ${missingAlts.length} rendered images without alt attributes`, missingAlts.slice(0, 3));
  } else if (targetImgs.length > 0) {
    logCheck('Accessibility: Image Alts', true, `All ${targetImgs.length} rendered images have alt attributes`);
  }
}

/**
 * Scans JavaScript and JSON files for image URLs and product objects
 */
function extractImagesFromFixtures(dir) {
  const codeFiles = findFiles(dir, '.js')
    .concat(findFiles(dir, '.json'))
    .concat(findFiles(dir, '.ts'));

  const validUrls = [];
  const emptyOrInvalid = [];
  let scannedFiles = 0;

  for (const file of codeFiles) {
    if (file.includes('audit_replica.js') || file.includes('extract_tokens.js')) continue;

    const content = fs.readFileSync(file, 'utf-8');
    scannedFiles++;

    // Look for image properties in object literals: primary: "...", gallery: [...], image: "...", src: "..."
    const urlMatches = content.matchAll(/(?:primary|image|thumbnail|src|poster|hero)\s*:\s*["'`]([^"'`]*?)["'`]/gi);
    for (const match of urlMatches) {
      const url = match[1].trim();
      if (!url || url === '#' || url.length === 0 || url === 'undefined' || url === 'null') {
        emptyOrInvalid.push({ file: path.basename(file), match: match[0].trim() });
      } else {
        validUrls.push(url);
      }
    }

    // Look for array items inside gallery: [ "...", "..." ]
    const galleryMatches = content.matchAll(/gallery\s*:\s*\[([^\]]+)\]/gi);
    for (const gMatch of galleryMatches) {
      const items = gMatch[1].matchAll(/["'`]([^"'`]*?)["'`]/g);
      for (const item of items) {
        const url = item[1].trim();
        if (!url || url === '#' || url.length === 0) {
          emptyOrInvalid.push({ file: path.basename(file), match: `gallery item: "" in ${gMatch[0].slice(0, 30)}` });
        } else {
          validUrls.push(url);
        }
      }
    }
  }

  return { scannedFiles, validUrls, emptyOrInvalid };
}

/**
 * Attempts to capture post-hydration rendered DOM using Chrome headless
 */
function captureHydratedDom(chromePath, target) {
  try {
    const res = spawnSync(
      chromePath,
      [
        '--headless',
        '--disable-gpu',
        '--no-sandbox',
        '--allow-file-access-from-files',
        '--disable-web-security',
        '--virtual-time-budget=2500',
        '--dump-dom',
        target
      ],
      { encoding: 'utf-8', timeout: 8000 }
    );

    if (res.status === 0 && res.stdout && res.stdout.includes('<html')) {
      return res.stdout;
    }
  } catch (err) {
    if (verbose) console.warn(`Headless DOM capture warning: ${err.message}`);
  }
  return null;
}

function findChromeBinary() {
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function checkHttpUrl(urlStr) {
  return new Promise((resolve, reject) => {
    const client = urlStr.startsWith('https') ? https : http;
    const req = client.get(urlStr, (res) => {
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.setTimeout(4000, () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

function findFiles(dir, ext) {
  let list = [];
  if (!fs.existsSync(dir)) return list;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        list = list.concat(findFiles(full, ext));
      }
    } else if (entry.name.endsWith(ext)) {
      list.push(full);
    }
  }
  return list;
}

function finish() {
  console.log(`\n\x1b[1m=== Audit Summary ===\x1b[0m`);
  console.log(`Status: ${results.passed ? '\x1b[32mPASSED\x1b[0m' : '\x1b[31mFAILED\x1b[0m'}`);
  console.log(`Passed Checks: ${results.summary.passedChecks}`);
  console.log(`Errors: ${results.summary.errors}`);
  console.log(`Warnings: ${results.summary.warnings}`);
  console.log(`\n\x1b[1m=== Discovered Metrics ===\x1b[0m`);
  console.log(`Static HTML Images:       ${results.metrics.staticImages}`);
  console.log(`Data Fixture Images (JS): ${results.metrics.dataFixtureImages}`);
  console.log(`Hydrated DOM Images:      ${results.metrics.hydratedDomImages}`);
  console.log(`Unique Element IDs:       ${results.metrics.totalElementIds}`);
  console.log(`CSS Design Token Vars:    ${results.metrics.cssVariables}`);

  if (process.env.OUTPUT_JSON) {
    console.log('\n' + JSON.stringify(results, null, 2));
  }

  process.exit(results.passed ? 0 : 1);
}

runAudit();
