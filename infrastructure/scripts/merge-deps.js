#!/usr/bin/env node
/**
 * Merge package.json dependencies from slack-shared and all Lambda functions
 * Outputs merged package.json to merged-deps/package.json
 */

const fs = require('fs');
const path = require('path');

const FUNCTIONS = ['message-listener', 'file-processor', 'oauth-callback'];
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function mergeDependencies() {
  console.log('=== Merging all package.jsons ===');
  
  const mergedDeps = new Map();
  
  // Start with slack-shared
  const slackSharedPkgPath = path.join(PROJECT_ROOT, 'functions/slack-shared/package.json');
  if (fs.existsSync(slackSharedPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(slackSharedPkgPath, 'utf8'));
    console.log('Merging dependencies from slack-shared...');
    Object.entries(pkg.dependencies || {}).forEach(([name, version]) => {
      mergedDeps.set(name, version);
    });
  } else {
    console.error('ERROR: functions/slack-shared/package.json not found!');
    process.exit(1);
  }
  
  // Merge from each Lambda function
  for (const func of FUNCTIONS) {
    const funcPkgPath = path.join(PROJECT_ROOT, `functions/${func}/package.json`);
    if (fs.existsSync(funcPkgPath)) {
      console.log(`Merging dependencies from ${func}...`);
      const pkg = JSON.parse(fs.readFileSync(funcPkgPath, 'utf8'));
      Object.entries(pkg.dependencies || {}).forEach(([name, version]) => {
        // Keep latest version if conflict
        if (!mergedDeps.has(name) || mergedDeps.get(name) < version) {
          mergedDeps.set(name, version);
        }
      });
    }
  }
  
  // Create merged-deps directory
  const mergedDepsDir = path.join(PROJECT_ROOT, 'merged-deps');
  if (!fs.existsSync(mergedDepsDir)) {
    fs.mkdirSync(mergedDepsDir, { recursive: true });
  }
  
  // Write merged package.json
  const mergedPkg = {
    name: 'mnemosyne-merged-dependencies',
    version: '1.0.0',
    dependencies: Object.fromEntries(mergedDeps),
  };
  
  fs.writeFileSync(
    path.join(mergedDepsDir, 'package.json'),
    JSON.stringify(mergedPkg, null, 2) + '\n'
  );
  
  console.log(`✓ Merged ${mergedDeps.size} dependencies into merged-deps/package.json`);
}

mergeDependencies();

