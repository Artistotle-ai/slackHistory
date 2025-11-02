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
    possibleArtifactDirs.push(path.join(PROJECT_ROOT, 'LayerBuildArtifact'));
    
    // Fallback to project root (local builds)
    const sharedModulesZip = path.join(PROJECT_ROOT, 'shared-node-modules.zip');
    const sharedModulesTar = path.join(PROJECT_ROOT, 'shared-node-modules.tar.gz');
    
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
      
      // Also check for any zip or tar.gz files (CodePipeline uses short IDs like o4nKsyj.zip)
      // Recursively search for archives - CodePipeline may rename them to short identifiers
      function findArchives(dir, depth = 0) {
        const archives = { zip: [], tar: [] };
        if (depth > 2) return archives; // Limit recursion depth
        
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              // Recursively search subdirectories
              const subArchives = findArchives(fullPath, depth + 1);
              archives.zip.push(...subArchives.zip);
              archives.tar.push(...subArchives.tar);
            } else if (entry.isFile()) {
              if (entry.name.endsWith('.zip')) {
                archives.zip.push(fullPath);
              } else if (entry.name.endsWith('.tar.gz') || entry.name.endsWith('.tgz')) {
                archives.tar.push(fullPath);
              }
            }
          }
        } catch (e) {
          // Ignore errors
        }
        return archives;
      }
      
      const archives = findArchives(artifactDir);
      console.log(`  Found ${archives.zip.length} zip files, ${archives.tar.length} tar files (searched recursively)`);
      
      // Prefer zip files (smaller, faster)
      if (archives.zip.length > 0) {
        // Prefer expected name if found, otherwise use first
        const expectedZip = archives.zip.find(f => f.includes('shared-node-modules.zip') || f.endsWith('shared-node-modules.zip'));
        const zipToUse = expectedZip || archives.zip[0];
        foundArchive = { type: 'zip', path: zipToUse };
        console.log(`Found zip archive: ${path.basename(zipToUse)} at: ${zipToUse}`);
        break;
      } else if (archives.tar.length > 0) {
        const expectedTar = archives.tar.find(f => f.includes('shared-node-modules.tar.gz') || f.endsWith('shared-node-modules.tar.gz'));
        const tarToUse = expectedTar || archives.tar[0];
        foundArchive = { type: 'tar', path: tarToUse };
        console.log(`Found tar archive: ${path.basename(tarToUse)} at: ${tarToUse}`);
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
      // Debug: List all files in common directories to help diagnose
      console.error('ERROR: Shared node_modules archive not found!');
      console.error('Debugging - listing directories:');
      console.error(`CODEBUILD_SRC_DIR: ${process.env.CODEBUILD_SRC_DIR || 'not set'}`);
      console.error(`PROJECT_ROOT: ${PROJECT_ROOT}`);
      
      // Try to list what's in CODEBUILD_SRC_DIR and check environment variables
      console.error(`\nEnvironment variables:`);
      Object.keys(process.env)
        .filter(key => key.startsWith('CODEBUILD_SRC_DIR'))
        .forEach(key => {
          console.error(`  ${key}=${process.env[key]}`);
        });
      
      try {
        const codebuildSrcDir = process.env.CODEBUILD_SRC_DIR || PROJECT_ROOT;
        console.error(`\nContents of ${codebuildSrcDir}:`);
        const srcContents = fs.readdirSync(codebuildSrcDir, { withFileTypes: true });
        srcContents.forEach(entry => {
          console.error(`  ${entry.isDirectory() ? 'DIR' : 'FILE'}: ${entry.name}`);
        });
      } catch (e) {
        console.error(`Could not list ${codebuildSrcDir}: ${e.message}`);
      }
      
      // Check if CODEBUILD_SRC_DIR_LayerBuildArtifact exists
      const layerArtifactEnv = process.env.CODEBUILD_SRC_DIR_LayerBuildArtifact;
      if (layerArtifactEnv) {
        try {
          console.error(`\nContents of CODEBUILD_SRC_DIR_LayerBuildArtifact (${layerArtifactEnv}):`);
          const artifactContents = fs.readdirSync(layerArtifactEnv, { withFileTypes: true });
          artifactContents.forEach(entry => {
            console.error(`  ${entry.isDirectory() ? 'DIR' : 'FILE'}: ${entry.name}`);
          });
        } catch (e) {
          console.error(`Could not list ${layerArtifactEnv}: ${e.message}`);
        }
      }
      
      // Check parent directories
      try {
        const parentDir = path.dirname(PROJECT_ROOT);
        console.error(`\nContents of parent directory (${parentDir}):`);
        const parentContents = fs.readdirSync(parentDir, { withFileTypes: true });
        parentContents.forEach(entry => {
          console.error(`  ${entry.isDirectory() ? 'DIR' : 'FILE'}: ${entry.name}`);
        });
      } catch (e) {
        console.error(`Could not list parent: ${e.message}`);
      }
      
      console.error('\nChecked locations:');
      possibleArtifactDirs.forEach(dir => {
        console.error(`  - ${path.join(dir, 'shared-node-modules.zip')}`);
        console.error(`  - ${path.join(dir, 'shared-node-modules.tar.gz')}`);
      });
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

