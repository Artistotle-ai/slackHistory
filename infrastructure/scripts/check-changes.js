#!/usr/bin/env node
/**
 * Check if files have changed by comparing hashes
 * - Calculates hash of relevant files
 * - Compares with previous hash (stored in S3 or artifact)
 * - Exits with code 0 if no changes (skip build)
 * - Exits with code 1 if changes detected (proceed with build)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const BUILD_TYPE = process.env.BUILD_TYPE; // 'infrastructure' or 'layer'
const ARTIFACT_BUCKET = process.env.ARTIFACT_BUCKET;
const APP_PREFIX = process.env.APP_PREFIX || 'Mnemosyne';

function hashDirectory(dir, ignorePatterns = []) {
  if (!fs.existsSync(dir)) {
    return '';
  }
  
  const hash = crypto.createHash('sha256');
  const files = [];
  
  function walkDir(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(PROJECT_ROOT, fullPath);
      
      // Skip node_modules, .git, dist, build artifacts
      if (entry.name === 'node_modules' || 
          entry.name === '.git' || 
          entry.name === 'dist' ||
          entry.name === 'build-layer' ||
          entry.name === 'cdk.out' ||
          entry.name === '.DS_Store' ||
          ignorePatterns.some(pattern => relativePath.includes(pattern))) {
        continue;
      }
      
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else {
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath);
        const relative = path.relative(dir, fullPath);
        hash.update(relative);
        hash.update(stat.mtime.toISOString());
        hash.update(content);
        files.push(relative);
      }
    }
  }
  
  walkDir(dir);
  return hash.digest('hex');
}

function getPreviousHash(buildType) {
  const hashKey = `build-hashes/${APP_PREFIX}-${buildType}-hash.txt`;
  
  // Try to get from S3
  if (ARTIFACT_BUCKET) {
    try {
      const output = execSync(
        `aws s3 cp s3://${ARTIFACT_BUCKET}/${hashKey} - 2>/dev/null || echo ""`,
        { encoding: 'utf8', cwd: PROJECT_ROOT, stdio: 'pipe' }
      ).trim();
      return output;
    } catch (e) {
      // File doesn't exist yet, that's okay
      return null;
    }
  }
  
  return null;
}

function saveHash(buildType, hash) {
  const hashKey = `build-hashes/${APP_PREFIX}-${buildType}-hash.txt`;
  
  // Save to S3
  if (ARTIFACT_BUCKET) {
    try {
      execSync(
        `echo "${hash}" | aws s3 cp - s3://${ARTIFACT_BUCKET}/${hashKey}`,
        { encoding: 'utf8', cwd: PROJECT_ROOT, stdio: 'pipe' }
      );
      console.log(`✓ Hash saved to S3: ${hashKey}`);
    } catch (e) {
      console.warn(`WARNING: Failed to save hash to S3: ${e.message}`);
    }
  }
}

function main() {
  if (!BUILD_TYPE) {
    console.error('ERROR: BUILD_TYPE environment variable is required');
    process.exit(1);
  }
  
  let currentHash;
  let directory;
  
  if (BUILD_TYPE === 'infrastructure') {
    directory = path.join(PROJECT_ROOT, 'infrastructure');
    currentHash = hashDirectory(directory, ['node_modules', 'cdk.out']);
    console.log(`=== Checking infrastructure changes ===`);
  } else if (BUILD_TYPE === 'layer') {
    directory = path.join(PROJECT_ROOT, 'functions/slack-shared');
    currentHash = hashDirectory(directory, ['node_modules', 'dist']);
    console.log(`=== Checking layer changes ===`);
  } else {
    console.error(`ERROR: Unknown BUILD_TYPE: ${BUILD_TYPE}`);
    process.exit(1);
  }
  
  console.log(`Current hash: ${currentHash.substring(0, 8)}...`);
  
  const previousHash = getPreviousHash(BUILD_TYPE);
  
  if (previousHash) {
    console.log(`Previous hash: ${previousHash.substring(0, 8)}...`);
    
    if (currentHash === previousHash) {
      console.log(`✓ No changes detected - skipping build`);
      saveHash(BUILD_TYPE, currentHash); // Update timestamp
      process.exit(0); // Exit 0 = skip build
    } else {
      console.log(`✗ Changes detected - proceeding with build`);
      saveHash(BUILD_TYPE, currentHash);
      process.exit(1); // Exit 1 = proceed with build
    }
  } else {
    console.log(`No previous hash found - first build, proceeding...`);
    saveHash(BUILD_TYPE, currentHash);
    process.exit(1); // Exit 1 = proceed with build
  }
}

main();

