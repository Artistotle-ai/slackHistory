#!/usr/bin/env node
/**
 * Build and package Lambda Layer
 * - Builds slack-shared
 * - Merges dependencies
 * - Installs merged dependencies
 * - Packages layer zip
 * - Deploys layer
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');

function run(cmd, options = {}) {
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: PROJECT_ROOT, ...options });
  } catch (error) {
    console.error(`ERROR: Command failed: ${cmd}`);
    process.exit(1);
  }
}

async function buildLayer() {
  console.log('=== Building Lambda Layer ===');
  
  // Step 1: Build slack-shared
  console.log('\nStep 1: Building slack-shared...');
  run('cd functions/slack-shared && npm run build');
  
  // Step 2: Merge package.jsons
  console.log('\nStep 2: Merging package.jsons...');
  run('npm run build:merge-deps');
  
  // Step 3: Install merged dependencies
  console.log('\nStep 3: Installing merged dependencies...');
  run('cd merged-deps && npm ci --production || npm install --production');
  
  // Step 4: Zip node_modules for sharing
  console.log('\nStep 4: Zipping merged node_modules...');
  run('cd merged-deps && zip -rq ../shared-node-modules.zip node_modules || tar -czf ../shared-node-modules.tar.gz node_modules', {
    stdio: 'pipe'
  });
  console.log('✓ Shared node_modules packaged');
  
  // Step 5: Package Lambda Layer
  console.log('\nStep 5: Packaging Lambda Layer...');
  const buildLayerDir = path.join(PROJECT_ROOT, 'build-layer/nodejs/node_modules/mnemosyne-slack-shared');
  if (!fs.existsSync(buildLayerDir)) {
    fs.mkdirSync(buildLayerDir, { recursive: true });
  }
  
  // Copy dist and package.json
  run(`cp -r functions/slack-shared/dist ${buildLayerDir}/`);
  run(`cp functions/slack-shared/package.json ${buildLayerDir}/`);
  
  // Create layer zip
  run('cd build-layer && zip -rq ../slack-shared-layer.zip nodejs');
  console.log('✓ Layer packaged');
  
  // Step 6: Deploy Layer
  console.log('\nStep 6: Deploying Lambda Layer...');
  run('npm run deploy:layer');
  
  console.log('\n✓ Layer build and deployment complete');
}

buildLayer().catch(error => {
  console.error('ERROR:', error);
  process.exit(1);
});

