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
  
  // CodePipeline extraInputs are extracted to CODEBUILD_SRC_DIR_<ArtifactName>
  // For artifact named "LayerBuildArtifact", check CODEBUILD_SRC_DIR_LayerBuildArtifact
  const codebuildSrcDir = process.env.CODEBUILD_SRC_DIR || PROJECT_ROOT;
  const layerArtifactDir = process.env.CODEBUILD_SRC_DIR_LayerBuildArtifact || 
                            path.join(codebuildSrcDir, 'LayerBuildArtifact');
  
  const possibleArtifactDirs = [
    layerArtifactDir, // CODEBUILD_SRC_DIR_LayerBuildArtifact (official location)
    path.join(codebuildSrcDir, 'LayerBuildArtifact'), // Direct artifact name
    path.join(codebuildSrcDir, '../LayerBuildArtifact'), // One level up
    ARTIFACT_DIR, // Original path
    codebuildSrcDir, // Root source directory
  ];
  
  let foundArchive = null;
  
  // Check all possible artifact directories
  for (const artifactDir of possibleArtifactDirs) {
    const zipPath = path.join(artifactDir, 'shared-node-modules.zip');
    const tarPath = path.join(artifactDir, 'shared-node-modules.tar.gz');
    
    if (fs.existsSync(zipPath)) {
      foundArchive = { type: 'zip', path: zipPath };
      console.log(`Found archive at: ${zipPath}`);
      break;
    } else if (fs.existsSync(tarPath)) {
      foundArchive = { type: 'tar', path: tarPath };
      console.log(`Found archive at: ${tarPath}`);
      break;
    }
  }
  
  if (foundArchive) {
    if (foundArchive.type === 'zip') {
      console.log('Extracting shared-node-modules.zip...');
      run(`mkdir -p ${TMP_DIR} && unzip -q ${foundArchive.path} -d ${TMP_DIR}`);
    } else {
      console.log('Extracting shared-node-modules.tar.gz...');
      run(`mkdir -p ${TMP_DIR} && tar -xzf ${foundArchive.path} -C ${TMP_DIR}`);
    }
  } else {
    console.error('ERROR: Shared node_modules archive not found!');
    console.error('Checked locations:');
    possibleArtifactDirs.forEach(dir => {
      console.error(`  - ${path.join(dir, 'shared-node-modules.zip')}`);
      console.error(`  - ${path.join(dir, 'shared-node-modules.tar.gz')}`);
    });
    console.error(`CODEBUILD_SRC_DIR: ${process.env.CODEBUILD_SRC_DIR || 'not set'}`);
    console.error(`PROJECT_ROOT: ${PROJECT_ROOT}`);
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

