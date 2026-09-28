#!/usr/bin/env node
/**
 * visual_diff.js — layout-similarity score between a target screenshot and a replica screenshot.
 *
 * Raw pixel diff punishes a replica for having different product names and photos, which it
 * should have. So both images are box-downscaled to a thumbnail (160px wide) first. At that size
 * text becomes grey bars and photos become colour blobs, and what's left to compare is layout,
 * colour blocks and spacing — what "looks like the site" means.
 *
 * Usage:  node scripts/visual_diff.js target.png replica.png [--diff diff.png]
 * Import: import { layoutSimilarity, sideBySide } from './visual_diff.js'
 *   sideBySide(target, replica, out) writes target | gap | replica (top 1600px, ≤ 2000px wide) for a Fixer to Read.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const THUMB_W = 160;

// Average every block of source pixels into one thumbnail pixel.
function downscale(png, width) {
  const f = png.width / width;
  const height = Math.max(1, Math.floor(png.height / f));
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let sy = Math.floor(y * f); sy < Math.floor((y + 1) * f); sy++) {
        for (let sx = Math.floor(x * f); sx < Math.floor((x + 1) * f); sx++) {
          const i = (sy * png.width + sx) * 4;
          for (let c = 0; c < 4; c++) acc[c] += png.data[i + c];
          n++;
        }
      }
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) out.data[o + c] = n ? acc[c] / n : 0;
    }
  }
  return out;
}

function crop(png, height) {
  const out = new PNG({ width: png.width, height });
  png.data.copy(out.data, 0, 0, png.width * height * 4);
  return out;
}

const GAP = 20;

// Target on the left, replica on the right, both cropped to the top maxHeight px, the whole strip
// box-downscaled to ≤ maxWidth. Grey fills the gap and whatever is below the shorter image.
export function sideBySide(targetPath, replicaPath, outPath, { maxHeight = 1600, maxWidth = 2000 } = {}) {
  const [a, b] = [targetPath, replicaPath].map(p => {
    const png = PNG.sync.read(fs.readFileSync(p));
    return crop(png, Math.min(png.height, maxHeight));
  });
  let out = new PNG({ width: a.width + GAP + b.width, height: Math.max(a.height, b.height) });
  out.data.fill(0x99);
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  PNG.bitblt(a, out, 0, 0, a.width, a.height, 0, 0);
  PNG.bitblt(b, out, 0, 0, b.width, b.height, a.width + GAP, 0);
  if (out.width > maxWidth) out = downscale(out, maxWidth);
  fs.writeFileSync(outPath, PNG.sync.write(out));
  return outPath;
}

/**
 * Returns { score 0..1, heightRatio, diffPath? }. Height mismatch is part of the score: a replica
 * half as long as the target can't score above ~0.5 however well the top half matches.
 */
export function layoutSimilarity(targetPath, replicaPath, diffPath, { maxHeight } = {}) {
  // maxHeight: compare only the top N px of both, e.g. to skip a brand's marketing images at the bottom of a product page.
  const read = p => {
    const png = PNG.sync.read(fs.readFileSync(p));
    return maxHeight && png.height > maxHeight ? crop(png, maxHeight) : png;
  };
  const a = downscale(read(targetPath), THUMB_W);
  const b = downscale(read(replicaPath), THUMB_W);
  const h = Math.min(a.height, b.height);
  const diff = new PNG({ width: THUMB_W, height: h });
  const mismatched = pixelmatch(crop(a, h).data, crop(b, h).data, diff.data, THUMB_W, h, { threshold: 0.15 });
  const heightRatio = h / Math.max(a.height, b.height);
  if (diffPath) fs.writeFileSync(diffPath, PNG.sync.write(diff));
  return { score: +((1 - mismatched / (THUMB_W * h)) * heightRatio).toFixed(3), heightRatio: +heightRatio.toFixed(3), diffPath };
}

// realpath: import.meta.url has symlinks resolved but argv[1] doesn't, so running via .claude/skills/<skill>
// (a symlink to skills/<skill>) would otherwise skip the CLI and exit 0 having done nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [a, b, flag, d] = process.argv.slice(2);
  if (!a || !b) {
    console.error('Usage: node scripts/visual_diff.js target.png replica.png [--diff diff.png]');
    process.exit(2);
  }
  console.log(JSON.stringify(layoutSimilarity(a, b, flag === '--diff' ? d : undefined)));
}
