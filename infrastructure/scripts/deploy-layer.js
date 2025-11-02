#!/usr/bin/env node
/**
 * Deploy Lambda Layer to AWS
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const APP_PREFIX = process.env.APP_PREFIX || 'Mnemosyne';
const LAYER_NAME = `${APP_PREFIX}SlackSharedLayer`;

function run(cmd, options = {}) {
  console.log(`> ${cmd}`);
  try {
    const output = execSync(cmd, { 
      encoding: 'utf8',
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      ...options 
    });
    return output.trim();
  } catch (error) {
    console.error(`ERROR: Command failed: ${cmd}`);
    console.error(error.stdout || error.message);
    process.exit(1);
  }
}

function deployLayer() {
  console.log(`=== Deploying Lambda Layer: ${LAYER_NAME} ===`);
  
  // Cleanup old versions (keep last 5)
  console.log('Cleaning up old layer versions...');
  try {
    const listOutput = run(`aws lambda list-layer-versions --layer-name "${LAYER_NAME}" --query 'LayerVersions[].Version' --output text 2>&1 || echo ""`);
    if (listOutput) {
      const oldVersions = run(`aws lambda list-layer-versions --layer-name "${LAYER_NAME}" --query 'LayerVersions[5:].Version' --output text 2>/dev/null || echo ""`);
      if (oldVersions) {
        console.log(`Deleting old versions: ${oldVersions}`);
        oldVersions.split(/\s+/).forEach(version => {
          if (version) {
            try {
              run(`aws lambda delete-layer-version --layer-name "${LAYER_NAME}" --version-number "${version}"`, { stdio: 'pipe' });
              console.log(`  Deleted version ${version}`);
            } catch (e) {
              // Ignore errors for cleanup
            }
          }
        });
      }
    }
  } catch (e) {
    console.log('No old versions to clean up');
  }
  
  // Publish layer
  console.log('Publishing new layer version...');
  const publishOutput = run(`aws lambda publish-layer-version \
    --layer-name "${LAYER_NAME}" \
    --description "Shared utilities and types for Mnemosyne Slack functions" \
    --zip-file fileb://slack-shared-layer.zip \
    --compatible-runtimes nodejs20.x \
    --compatible-architectures arm64 \
    --output json`);
  
  // Extract version
  const versionMatch = publishOutput.match(/"Version"\s*:\s*(\d+)/);
  if (!versionMatch) {
    console.error('ERROR: Failed to extract layer version from publish output');
    console.error(publishOutput);
    process.exit(1);
  }
  const layerVersion = versionMatch[1];
  
  // Get layer ARN
  const layerArn = run(`aws lambda get-layer-version \
    --layer-name "${LAYER_NAME}" \
    --version-number "${layerVersion}" \
    --query 'LayerVersionArn' --output text`);
  
  if (!layerArn || !layerArn.startsWith('arn:aws:')) {
    console.error('ERROR: Failed to get layer ARN');
    process.exit(1);
  }
  
  // Save layer ARN to file
  const layerArnEnv = `LAYER_ARN=${layerArn}\n`;
  fs.writeFileSync(path.join(PROJECT_ROOT, 'layer-arn.env'), layerArnEnv);
  
  console.log(`✓ Layer version ${layerVersion} deployed: ${layerArn}`);
}

deployLayer();

