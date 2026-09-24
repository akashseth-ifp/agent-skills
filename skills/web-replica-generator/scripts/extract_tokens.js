#!/usr/bin/env node

/**
 * extract_tokens.js
 * Scans CSS files in a target directory and extracts color tokens, font stacks,
 * spacing variables, and elevation shadows to jumpstart design system synthesis.
 *
 * Usage:
 *   node extract_tokens.js ./path/to/css
 */

const fs = require('fs');
const path = require('path');

const targetPath = process.argv[2] || process.cwd();

function collectCssFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const stat = fs.statSync(dir);
  if (stat.isFile() && dir.endsWith('.css')) return [dir];
  if (!stat.isDirectory()) return results;

  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git') {
        results = results.concat(collectCssFiles(fullPath));
      }
    } else if (file.endsWith('.css')) {
      results.push(fullPath);
    }
  }
  return results;
}

const cssFiles = collectCssFiles(targetPath);
const tokenData = {
  cssVariables: {},
  hexColors: new Set(),
  rgbColors: new Set(),
  fontFamilies: new Set()
};

for (const file of cssFiles) {
  const content = fs.readFileSync(file, 'utf-8');

  // Custom properties
  const varMatches = content.matchAll(/(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g);
  for (const match of varMatches) {
    tokenData.cssVariables[match[1]] = match[2].trim();
  }

  // Hex colors
  const hexMatches = content.matchAll(/#([0-9a-fA-F]{3,8})\b/g);
  for (const match of hexMatches) {
    tokenData.hexColors.add(match[0].toLowerCase());
  }

  // RGB colors
  const rgbMatches = content.matchAll(/rgba?\([^)]+\)/g);
  for (const match of rgbMatches) {
    tokenData.rgbColors.add(match[0]);
  }

  // Font families
  const fontMatches = content.matchAll(/font-family\s*:\s*([^;]+);/g);
  for (const match of fontMatches) {
    tokenData.fontFamilies.add(match[1].trim());
  }
}

const output = {
  scannedFiles: cssFiles.length,
  customPropertiesCount: Object.keys(tokenData.cssVariables).length,
  customProperties: tokenData.cssVariables,
  detectedHexColors: Array.from(tokenData.hexColors).slice(0, 30),
  detectedFontFamilies: Array.from(tokenData.fontFamilies)
};

console.log(JSON.stringify(output, null, 2));
