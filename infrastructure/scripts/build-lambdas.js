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
    
    // CodePipeline extraInputs are extracted to CODEBUILD_SRC_DIR_<ArtifactName>
    // Try multiple possible locations
    const codebuildSrcDir = process.env.CODEBUILD_SRC_DIR || PROJECT_ROOT;
    const possibleArtifactDirs = [
      path.join(codebuildSrcDir, 'LayerBuildArtifact'), // Direct artifact name
      path.join(codebuildSrcDir, '../LayerBuildArtifact'), // One level up
      path.join(PROJECT_ROOT, 'LayerBuildArtifact'), // Project root
      codebuildSrcDir, // Root source directory
    ];
    
    // Fallback to project root (local builds)
    const sharedModulesZip = path.join(PROJECT_ROOT, 'shared-node-modules.zip');
    const sharedModulesTar = path.join(PROJECT_ROOT, 'shared-node-modules.tar.gz');
    
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
    
    // Check project root fallback
    if (!foundArchive) {
      if (fs.existsSync(sharedModulesZip)) {
        foundArchive = { type: 'zip', path: sharedModulesZip };
        console.log(`Found archive at: ${sharedModulesZip}`);
      } else if (fs.existsSync(sharedModulesTar)) {
        foundArchive = { type: 'tar', path: sharedModulesTar };
        console.log(`Found archive at: ${sharedModulesTar}`);
      }
    }
    
    if (foundArchive) {
      console.log(`Extracting from ${foundArchive.path}...`);
      if (foundArchive.type === 'zip') {
        run(`mkdir -p ${tmpDir} && unzip -q ${foundArchive.path} -d ${tmpDir}`);
      } else {
        run(`mkdir -p ${tmpDir} && tar -xzf ${foundArchive.path} -C ${tmpDir}`);
      }
    } else {
    
      console.error('ERROR: Shared node_modules archive not found!');
      console.error('Checked locations:');
      possibleArtifactDirs.forEach(dir => {
        console.error(`  - ${path.join(dir, 'shared-node-modules.zip')}`);
        console.error(`  - ${path.join(dir, 'shared-node-modules.tar.gz')}`);
      });
      console.error(`  - ${sharedModulesZip}`);
      console.error(`  - ${sharedModulesTar}`);
      console.error(`CODEBUILD_SRC_DIR: ${process.env.CODEBUILD_SRC_DIR || 'not set'}`);
      console.error(`PROJECT_ROOT: ${PROJECT_ROOT}`);
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

