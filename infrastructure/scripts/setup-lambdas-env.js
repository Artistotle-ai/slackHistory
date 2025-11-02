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
  
  // CodePipeline extraInputs are extracted to CODEBUILD_SRC_DIR_<SourceIdentifier>
  // Find all CODEBUILD_SRC_DIR_* environment variables
  const codebuildSrcDir = process.env.CODEBUILD_SRC_DIR || PROJECT_ROOT;
  const artifactEnvVars = Object.keys(process.env)
    .filter(key => key.startsWith('CODEBUILD_SRC_DIR_') && key !== 'CODEBUILD_SRC_DIR')
    .map(key => ({ name: key, path: process.env[key] }));
  
  console.log(`\nFound ${artifactEnvVars.length} artifact environment variables:`);
  artifactEnvVars.forEach(({ name, path: envPath }) => {
    console.log(`  ${name}=${envPath}`);
  });
  
  // Build list of possible artifact directories
  const possibleArtifactDirs = [];
  
  // 1. Check all CODEBUILD_SRC_DIR_* environment variables
  artifactEnvVars.forEach(({ name, path: envPath }) => {
    if (envPath && fs.existsSync(envPath)) {
      possibleArtifactDirs.push(envPath);
    }
    // Also check subdirectory with artifact name
    if (envPath) {
      const subDir = path.join(envPath, 'LayerBuildArtifact');
      if (fs.existsSync(subDir)) {
        possibleArtifactDirs.push(subDir);
      }
    }
  });
  
  // 2. Check CODEBUILD_SRC_DIR/LayerBuildArtifact (standard pattern)
  possibleArtifactDirs.push(path.join(codebuildSrcDir, 'LayerBuildArtifact'));
  
  // 3. Check parent directory (CodePipeline might extract to sibling dirs)
  const parentDir = path.dirname(codebuildSrcDir);
  possibleArtifactDirs.push(path.join(parentDir, 'LayerBuildArtifact'));
  
  // 4. Fallbacks
  possibleArtifactDirs.push(codebuildSrcDir);
  possibleArtifactDirs.push(ARTIFACT_DIR);
  
  let foundArchive = null;
  
  // Check all possible artifact directories
  for (const artifactDir of possibleArtifactDirs) {
    if (!fs.existsSync(artifactDir)) {
      continue;
    }
    
    // Debug: List all files in this directory
    try {
      const entries = fs.readdirSync(artifactDir, { withFileTypes: true });
      console.log(`\nChecking ${artifactDir}:`);
      entries.forEach(entry => {
        const fullPath = path.join(artifactDir, entry.name);
        const stat = fs.statSync(fullPath);
        console.log(`  ${entry.isDirectory() ? 'DIR' : 'FILE'}: ${entry.name} (${stat.size} bytes)`);
      });
    } catch (e) {
      // Directory might not exist, continue
      continue;
    }
    
    // Check for expected names first
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
    
    // Also check for any zip or tar.gz files (CodePipeline may rename them)
    // Look for files that match patterns like: build-123.zip, artifact.zip, etc.
    const allFiles = fs.readdirSync(artifactDir);
    const zipFiles = allFiles.filter(f => f.endsWith('.zip'));
    const tarFiles = allFiles.filter(f => f.endsWith('.tar.gz') || f.endsWith('.tgz'));
    
    console.log(`  Found ${zipFiles.length} zip files, ${tarFiles.length} tar files`);
    
    // Prefer zip files (smaller, faster)
    if (zipFiles.length > 0) {
      const firstZip = path.join(artifactDir, zipFiles[0]);
      foundArchive = { type: 'zip', path: firstZip };
      console.log(`Found zip archive (renamed) at: ${firstZip}`);
      break;
    } else if (tarFiles.length > 0) {
      const firstTar = path.join(artifactDir, tarFiles[0]);
      foundArchive = { type: 'tar', path: firstTar };
      console.log(`Found tar archive (renamed) at: ${firstTar}`);
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

