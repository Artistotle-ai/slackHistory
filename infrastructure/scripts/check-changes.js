#!/usr/bin/env node
/**
 * Check if files have changed by comparing hashes
 * - Calculates hash of relevant files
 * - Compares with previous hash (stored in DynamoDB)
 * - Sets HAS_CHANGES env variable: "true" or "false"
 * - Always exits 0 (never fails, just sets variable)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const BUILD_TYPE = process.env.BUILD_TYPE; // 'infrastructure' or 'layer'
const APP_PREFIX = process.env.APP_PREFIX || 'Mnemosyne';
const TABLE_NAME = `${APP_PREFIX}BuildHashes`; // Simple DynamoDB table name

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
  const key = `${APP_PREFIX}-${buildType}`;
  
  try {
    const output = execSync(
      `aws dynamodb get-item --table-name ${TABLE_NAME} --key '{"buildKey":{"S":"${key}"}}' --query 'Item.hash.S' --output text 2>/dev/null || echo ""`,
      { encoding: 'utf8', cwd: PROJECT_ROOT, stdio: 'pipe' }
    ).trim();
    return output || null;
  } catch (e) {
    return null;
  }
}

function saveHash(buildType, hash) {
  const key = `${APP_PREFIX}-${buildType}`;
  const ttl = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days TTL
  
  try {
    execSync(
      `aws dynamodb put-item --table-name ${TABLE_NAME} --item '{"buildKey":{"S":"${key}"},"hash":{"S":"${hash}"},"ttl":{"N":"${ttl}"}}'`,
      { encoding: 'utf8', cwd: PROJECT_ROOT, stdio: 'pipe' }
    );
  } catch (e) {
    // Fail silently - hash storage is optional
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
  } else if (BUILD_TYPE === 'lambdas') {
    // Hash all lambda function directories
    const lambdaDirs = ['message-listener', 'file-processor', 'oauth-callback'];
    const hash = crypto.createHash('sha256');
    
    console.log(`=== Checking lambdas changes ===`);
    for (const lambdaDir of lambdaDirs) {
      const fullPath = path.join(PROJECT_ROOT, `functions/${lambdaDir}`);
      if (fs.existsSync(fullPath)) {
        const dirHash = hashDirectory(fullPath, ['node_modules', 'dist']);
        hash.update(dirHash);
        console.log(`  - ${lambdaDir}: ${dirHash.substring(0, 8)}...`);
      }
    }
    currentHash = hash.digest('hex');
  } else {
    console.error(`ERROR: Unknown BUILD_TYPE: ${BUILD_TYPE}`);
    process.exit(1);
  }
  
  console.log(`Current hash: ${currentHash.substring(0, 8)}...`);
  
  const previousHash = getPreviousHash(BUILD_TYPE);
  let hasChanges = true;
  
  if (previousHash) {
    console.log(`Previous hash: ${previousHash.substring(0, 8)}...`);
    hasChanges = currentHash !== previousHash;
  } else {
    console.log(`No previous hash found - first build`);
    hasChanges = true;
  }
  
  // Save hash (always update)
  saveHash(BUILD_TYPE, currentHash);
  
  // Set environment variable for buildspec
  const hasChangesValue = hasChanges ? 'true' : 'false';
  console.log(`HAS_CHANGES=${hasChangesValue}`);
  console.log(`::set-output name=HAS_CHANGES::${hasChangesValue}`); // GitHub Actions style (doesn't hurt)
  
  // Write to file for buildspec to source
  const envFile = path.join(PROJECT_ROOT, 'build-changes.env');
  try {
    fs.writeFileSync(envFile, `HAS_CHANGES=${hasChangesValue}\n`);
    console.log(`✓ Hash check complete - HAS_CHANGES=${hasChangesValue}`);
    console.log(`✓ Environment file written to: ${envFile}`);
  } catch (error) {
    console.error(`ERROR: Failed to write ${envFile}:`, error.message);
    // Don't fail the script - just output the value so it can be captured
    process.stdout.write(`HAS_CHANGES=${hasChangesValue}\n`);
  }
  
  // Always exit 0 - never fail, just set variable
  process.exit(0);
}

main();

