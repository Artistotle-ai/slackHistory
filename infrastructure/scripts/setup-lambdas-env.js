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
    // Check if the directory exists and list its contents
    if (envPath && fs.existsSync(envPath)) {
      try {
        const entries = fs.readdirSync(envPath, { withFileTypes: true });
        console.log(`    Contents of ${envPath}:`);
        entries.forEach(entry => {
          console.log(`      ${entry.isDirectory() ? 'DIR' : 'FILE'}: ${entry.name}`);
        });
      } catch (e) {
        console.log(`    Could not list ${envPath}: ${e.message}`);
      }
    }
  });
  
  // Also check CODEBUILD_SRC_DIR itself for subdirectories
  console.log(`\nChecking CODEBUILD_SRC_DIR (${codebuildSrcDir}) for artifact subdirectories:`);
  try {
    const srcEntries = fs.readdirSync(codebuildSrcDir, { withFileTypes: true });
    srcEntries.forEach(entry => {
      const fullPath = path.join(codebuildSrcDir, entry.name);
      console.log(`  ${entry.isDirectory() ? 'DIR' : 'FILE'}: ${entry.name}`);
      // If it's a directory that might contain artifacts, check it
      if (entry.isDirectory() && (entry.name.includes('Layer') || entry.name.includes('Artifact'))) {
        try {
          const subEntries = fs.readdirSync(fullPath, { withFileTypes: true });
          console.log(`    Contents:`);
          subEntries.forEach(subEntry => {
            console.log(`      ${subEntry.isDirectory() ? 'DIR' : 'FILE'}: ${subEntry.name}`);
          });
        } catch (e) {
          // Ignore
        }
      }
    });
  } catch (e) {
    console.log(`  Could not list ${codebuildSrcDir}: ${e.message}`);
  }
  
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
  
  // 4. Check sibling directories in parent (CodePipeline might extract extraInputs here)
  try {
    const siblings = fs.readdirSync(parentDir, { withFileTypes: true });
    siblings.forEach(entry => {
      if (entry.isDirectory()) {
        const siblingPath = path.join(parentDir, entry.name);
        // Check if it looks like an artifact directory
        if (entry.name.includes('Layer') || entry.name.includes('Artifact') || entry.name !== 'src') {
          possibleArtifactDirs.push(siblingPath);
        }
      }
    });
  } catch (e) {
    // Ignore errors
  }
  
  // 5. Check if parent directory itself contains artifacts (some CodePipeline versions do this)
  possibleArtifactDirs.push(parentDir);
  
  // 6. Fallbacks
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
    
    // CodePipeline uses short IDs like o4nKsyj with NO file extension
    // Recursively search for archives - detect type by magic bytes
    function detectArchiveType(filePath) {
      try {
        const buffer = fs.readFileSync(filePath, { start: 0, length: 4 });
        // ZIP files start with PK (0x50 0x4B) or 0x50 0x4B 0x03 0x04
        if (buffer[0] === 0x50 && buffer[1] === 0x4B) {
          return 'zip';
        }
        // GZIP files start with 0x1F 0x8B (tar.gz is gzip-compressed tar)
        if (buffer[0] === 0x1F && buffer[1] === 0x8B) {
          return 'tar';
        }
        // TAR files (uncompressed) start with various headers, but common is ustar (0x75 0x73 0x74 0x61 0x72)
        // Check first 263 bytes for tar header (tar header starts at offset 257)
        if (fs.statSync(filePath).size > 263) {
          const tarBuffer = fs.readFileSync(filePath, { start: 257, length: 6 });
          if (tarBuffer.toString('ascii', 0, 5) === 'ustar') {
            return 'tar';
          }
        }
      } catch (e) {
        // Ignore errors
      }
      return null;
    }
    
    function findArchives(dir, depth = 0) {
      const archives = { zip: [], tar: [], unknown: [] };
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
            archives.unknown.push(...subArchives.unknown);
          } else if (entry.isFile()) {
            // Check file extension first
            if (entry.name.endsWith('.zip')) {
              archives.zip.push(fullPath);
            } else if (entry.name.endsWith('.tar.gz') || entry.name.endsWith('.tgz')) {
              archives.tar.push(fullPath);
            } else {
              // No extension - detect by magic bytes (CodePipeline uses short IDs like o4nKsyj)
              const fileType = detectArchiveType(fullPath);
              if (fileType === 'zip') {
                archives.zip.push(fullPath);
              } else if (fileType === 'tar') {
                archives.tar.push(fullPath);
              } else {
                // Unknown type - might be archive, add to unknown list
                archives.unknown.push(fullPath);
              }
            }
          }
        }
      } catch (e) {
        // Ignore errors
      }
      return archives;
    }
    
    const archives = findArchives(artifactDir);
    console.log(`  Found ${archives.zip.length} zip files, ${archives.tar.length} tar files, ${archives.unknown.length} unknown files (searched recursively)`);
    
    // Prefer zip files (smaller, faster)
    if (archives.zip.length > 0) {
      // Prefer expected name if found, otherwise use first
      const expectedZip = archives.zip.find(f => f.includes('shared-node-modules') || path.basename(f).includes('shared-node-modules'));
      const zipToUse = expectedZip || archives.zip[0];
      foundArchive = { type: 'zip', path: zipToUse };
      console.log(`Found zip archive: ${path.basename(zipToUse)} at: ${zipToUse}`);
      break;
    } else if (archives.tar.length > 0) {
      const expectedTar = archives.tar.find(f => f.includes('shared-node-modules') || path.basename(f).includes('shared-node-modules'));
      const tarToUse = expectedTar || archives.tar[0];
      foundArchive = { type: 'tar', path: tarToUse };
      console.log(`Found tar archive: ${path.basename(tarToUse)} at: ${tarToUse}`);
      break;
    } else if (archives.unknown.length > 0) {
      // Try unknown files as zip first (most common)
      const unknownFile = archives.unknown[0];
      console.log(`Trying unknown file as zip: ${path.basename(unknownFile)}`);
      foundArchive = { type: 'zip', path: unknownFile };
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

