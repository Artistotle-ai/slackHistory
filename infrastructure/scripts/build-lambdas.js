#!/usr/bin/env node
/**
 * Build all Lambda functions using merged node_modules
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FUNCTIONS = ['message-listener', 'file-processor', 'oauth-callback'];

function run(cmd, options = {}) {
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', cwd: PROJECT_ROOT, ...options });
  } catch (error) {
    console.error(`ERROR: Command failed: ${cmd}`);
    process.exit(1);
  }
}

function buildLambdas() {
  console.log('=== Building all Lambda functions ===');
  
  // Extract merged node_modules
  console.log('\nExtracting merged node_modules...');
  const sharedModulesZip = path.join(PROJECT_ROOT, 'shared-node-modules.zip');
  const sharedModulesTar = path.join(PROJECT_ROOT, 'shared-node-modules.tar.gz');
  const tmpDir = '/tmp/shared-node-modules';
  
  if (fs.existsSync(sharedModulesZip)) {
    run(`unzip -q ${sharedModulesZip} -d /tmp/shared-node-modules`);
  } else if (fs.existsSync(sharedModulesTar)) {
    run(`mkdir -p ${tmpDir} && tar -xzf ${sharedModulesTar} -C ${tmpDir}`);
  } else {
    console.error('ERROR: Shared node_modules archive not found!');
    process.exit(1);
  }
  
  if (!fs.existsSync(`${tmpDir}/node_modules`)) {
    console.error('ERROR: Extracted node_modules not found!');
    process.exit(1);
  }
  
  console.log('✓ Merged node_modules extracted');
  
  // Copy to each Lambda function
  console.log('\nCopying merged node_modules to each Lambda...');
  for (const func of FUNCTIONS) {
    const funcDir = path.join(PROJECT_ROOT, `functions/${func}`);
    if (fs.existsSync(funcDir)) {
      console.log(`Copying to ${func}...`);
      run(`cp -r ${tmpDir}/node_modules ${funcDir}/node_modules`);
      console.log(`✓ ${func}: All dependencies ready`);
    }
  }
  
  // Build all Lambda functions
  console.log('\nBuilding all Lambda functions...');
  for (const func of FUNCTIONS) {
    const funcDir = path.join(PROJECT_ROOT, `functions/${func}`);
    if (fs.existsSync(funcDir)) {
      console.log(`\nBuilding ${func}...`);
      // Remove slack-shared from node_modules (comes from layer)
      run(`rm -rf ${funcDir}/node_modules/mnemosyne-slack-shared || true`, { stdio: 'pipe' });
      run(`cd ${funcDir} && npm run build`);
      console.log(`✓ ${func} built successfully`);
    }
  }
  
  console.log('\n✓ All Lambda functions built successfully');
}

buildLambdas().catch(error => {
  console.error('ERROR:', error);
  process.exit(1);
});

