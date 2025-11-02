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
  
  // Check if node_modules already set up by setup-lambdas-env.js
  // If not, try to extract from artifact (for backward compatibility)
  const tmpDir = '/tmp/shared-node-modules';
  const hasExtractedModules = fs.existsSync(`${tmpDir}/node_modules`);
  
  if (!hasExtractedModules) {
    console.log('\nNode_modules not found in /tmp - checking for artifacts...');
    
    // Try artifact directory first (CodePipeline extraInputs)
    const artifactDir = path.join(PROJECT_ROOT, 'LayerBuildArtifact');
    const zipPath = path.join(artifactDir, 'shared-node-modules.zip');
    const tarPath = path.join(artifactDir, 'shared-node-modules.tar.gz');
    
    // Fallback to project root (local builds)
    const sharedModulesZip = path.join(PROJECT_ROOT, 'shared-node-modules.zip');
    const sharedModulesTar = path.join(PROJECT_ROOT, 'shared-node-modules.tar.gz');
    
    if (fs.existsSync(zipPath)) {
      console.log('Extracting from LayerBuildArtifact/shared-node-modules.zip...');
      run(`mkdir -p ${tmpDir} && unzip -q ${zipPath} -d ${tmpDir}`);
    } else if (fs.existsSync(tarPath)) {
      console.log('Extracting from LayerBuildArtifact/shared-node-modules.tar.gz...');
      run(`mkdir -p ${tmpDir} && tar -xzf ${tarPath} -C ${tmpDir}`);
    } else if (fs.existsSync(sharedModulesZip)) {
      console.log('Extracting from shared-node-modules.zip...');
      run(`mkdir -p ${tmpDir} && unzip -q ${sharedModulesZip} -d ${tmpDir}`);
    } else if (fs.existsSync(sharedModulesTar)) {
      console.log('Extracting from shared-node-modules.tar.gz...');
      run(`mkdir -p ${tmpDir} && tar -xzf ${sharedModulesTar} -C ${tmpDir}`);
    } else {
      console.error('ERROR: Shared node_modules archive not found!');
      console.error('Expected locations:');
      console.error(`  - ${zipPath}`);
      console.error(`  - ${tarPath}`);
      console.error(`  - ${sharedModulesZip}`);
      console.error(`  - ${sharedModulesTar}`);
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
        const funcNodeModules = path.join(funcDir, 'node_modules');
        if (fs.existsSync(funcNodeModules)) {
          run(`rm -rf ${funcNodeModules}`);
        }
        run(`cp -r ${tmpDir}/node_modules ${funcNodeModules}`);
        console.log(`✓ ${func}: All dependencies ready`);
      }
    }
  } else {
    console.log('\n✓ Using node_modules already set up by setup-lambdas-env.js');
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

