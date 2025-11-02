#!/usr/bin/env node
/**
 * Setup Lambda functions environment:
 * - Extract merged node_modules from layer artifact
 * - Copy to each Lambda function
 * - Load layer ARN
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FUNCTIONS = ['message-listener', 'file-processor', 'oauth-callback'];
const ARTIFACT_DIR = path.join(PROJECT_ROOT, 'LayerBuildArtifact');
const TMP_DIR = '/tmp/shared-node-modules';

function run(cmd, options = {}) {
  try {
    execSync(cmd, { 
      stdio: 'pipe',
      cwd: PROJECT_ROOT,
      ...options 
    });
  } catch (error) {
    console.error(`ERROR: Command failed: ${cmd}`);
    process.exit(1);
  }
}

function setupLambdasEnv() {
  console.log('=== Setting up Lambda functions environment ===');
  
  // Extract merged node_modules
  const zipPath = path.join(ARTIFACT_DIR, 'shared-node-modules.zip');
  const tarPath = path.join(ARTIFACT_DIR, 'shared-node-modules.tar.gz');
  
  if (fs.existsSync(zipPath)) {
    console.log('Extracting shared-node-modules.zip...');
    run(`unzip -q ${zipPath} -d ${TMP_DIR}`);
  } else if (fs.existsSync(tarPath)) {
    console.log('Extracting shared-node-modules.tar.gz...');
    run(`mkdir -p ${TMP_DIR} && tar -xzf ${tarPath} -C ${TMP_DIR}`);
  } else {
    console.error('ERROR: Shared node_modules archive not found!');
    process.exit(1);
  }
  
  if (!fs.existsSync(`${TMP_DIR}/node_modules`)) {
    console.error('ERROR: Extracted node_modules not found!');
    process.exit(1);
  }
  
  console.log('✓ Merged node_modules extracted');
  
  // Copy to each Lambda function
  console.log('Copying merged node_modules to each Lambda function...');
  for (const func of FUNCTIONS) {
    const funcDir = path.join(PROJECT_ROOT, `functions/${func}`);
    if (fs.existsSync(funcDir)) {
      const funcNodeModules = path.join(funcDir, 'node_modules');
      if (fs.existsSync(funcNodeModules)) {
        run(`rm -rf ${funcNodeModules}`);
      }
      run(`cp -r ${TMP_DIR}/node_modules ${funcNodeModules}`);
      console.log(`✓ ${func}: All dependencies ready`);
    }
  }
  
  // Load layer ARN from artifact
  const layerArnFile = path.join(ARTIFACT_DIR, 'layer-arn.env');
  if (fs.existsSync(layerArnFile)) {
    const content = fs.readFileSync(layerArnFile, 'utf8');
    const match = content.match(/LAYER_ARN=(.+)/);
    if (match) {
      process.env.LAYER_ARN = match[1].trim();
      console.log(`✓ Layer ARN loaded: ${process.env.LAYER_ARN}`);
    }
  } else {
    console.error('WARNING: layer-arn.env not found!');
  }
}

setupLambdasEnv();

