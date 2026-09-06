#!/usr/bin/env node
// tools/validate-sw-assets.js
// Script to validate that all assets listed in frontend/sw.js SHELL_ASSETS exist
// Usage: node tools/validate-sw-assets.js

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const swPath = path.join(repoRoot, 'frontend', 'sw.js');

if (!fs.existsSync(swPath)){
  console.error('Error: frontend/sw.js not found');
  process.exit(2);
}

const swContent = fs.readFileSync(swPath, 'utf8');

const match = swContent.match(/const\s+SHELL_ASSETS\s*=\s*\[(.*?)\];/s);
if (!match){
  console.error('Could not find SHELL_ASSETS in sw.js');
  process.exit(2);
}

const arrayContent = match[1];

// Extract strings
const assetMatches = Array.from(arrayContent.matchAll(/\"(.*?)\"/g)).map(m => m[1]);

console.log('SHELL_ASSETS found with', assetMatches.length, 'entries');

let missing = [];
for (const asset of assetMatches){
  // normalize path relative to frontend
  let assetPath = asset;
  if (!assetPath.startsWith('/')) assetPath = path.join('frontend', assetPath);
  else assetPath = path.join('frontend', assetPath.replace(/^\//, ''));
  if (!fs.existsSync(path.resolve(repoRoot, assetPath))){
    missing.push(asset);
  }
}

if (missing.length === 0){
  console.log('All assets referenced in SW exist.');
  process.exit(0);
} else {
  console.error('Missing assets referenced in SW:');
  missing.forEach(m => console.error(' -', m));
  process.exit(3);
}
