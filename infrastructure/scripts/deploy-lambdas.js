#!/usr/bin/env node
/**
 * Package and deploy all Lambda functions
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FUNCTIONS = ['message-listener', 'file-processor', 'oauth-callback'];
const APP_PREFIX = process.env.APP_PREFIX || 'Mnemosyne';

function run(cmd, options = {}) {
  console.log(`> ${cmd}`);
  try {
    execSync(cmd, { 
      stdio: 'inherit',
      cwd: PROJECT_ROOT,
      ...options 
    });
  } catch (error) {
    console.error(`ERROR: Command failed: ${cmd}`);
    process.exit(1);
  }
}

function runSilent(cmd, options = {}) {
  try {
    execSync(cmd, { 
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: PROJECT_ROOT,
      ...options 
    });
  } catch (error) {
    return null;
  }
}

function toPascalCase(str) {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function deployLambdas() {
  console.log('=== Packaging and deploying all Lambda functions ===');
  
  // Get layer ARN
  let layerArn = process.env.LAYER_ARN;
  if (!layerArn) {
    const layerArnFile = path.join(PROJECT_ROOT, 'layer-arn.env');
    if (fs.existsSync(layerArnFile)) {
      const content = fs.readFileSync(layerArnFile, 'utf8');
      const match = content.match(/LAYER_ARN=(.+)/);
      if (match) {
        layerArn = match[1].trim();
      }
    }
  }
  
  if (!layerArn) {
    console.error('ERROR: Layer ARN not found! Set LAYER_ARN env var or layer-arn.env file');
    process.exit(1);
  }
  
  console.log(`Using layer ARN: ${layerArn}\n`);
  
  // Package and deploy each Lambda
  for (const func of FUNCTIONS) {
    const funcDir = path.join(PROJECT_ROOT, `functions/${func}`);
    if (!fs.existsSync(funcDir)) {
      console.log(`Skipping ${func} (directory not found)`);
      continue;
    }
    
    const functionZip = `${func}-function.zip`;
    const functionName = `${APP_PREFIX}${toPascalCase(func)}`;
    
    console.log(`\nPackaging ${func}...`);
    
    // Package function
    run(`cd ${funcDir} && npm prune --production || true`, { stdio: 'pipe' });
    
    const zipPath = path.join(PROJECT_ROOT, functionZip);
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
    
    const distDir = path.join(funcDir, 'dist');
    const nodeModulesDir = path.join(funcDir, 'node_modules');
    
    if (fs.existsSync(distDir)) {
      run(`cd ${distDir} && zip -rq ../../../${functionZip} * 2>&1 | head -20 || true`, { stdio: 'pipe' });
    }
    
    if (fs.existsSync(nodeModulesDir)) {
      run(`cd ${funcDir} && zip -rq ../../${functionZip} node_modules 2>&1 | head -20 || true`, { stdio: 'pipe' });
    }
    
    console.log(`✓ ${func} packaged: ${functionZip}`);
    
    // Deploy function
    console.log(`Deploying ${functionName}...`);
    run(`aws lambda update-function-code \
      --function-name "${functionName}" \
      --zip-file fileb://${functionZip}`);
    
    run(`aws lambda update-function-configuration \
      --function-name "${functionName}" \
      --layers "${layerArn}"`);
    
    console.log(`✓ ${functionName} deployed with layer`);
  }
  
  console.log('\n✓ All Lambda functions deployed successfully');
}

deployLambdas().catch(error => {
  console.error('ERROR:', error);
  process.exit(1);
});

