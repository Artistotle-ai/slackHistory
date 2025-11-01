#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { BaseRolesStack } from '../lib/base-roles-stack';
import { MainInfraStack } from '../lib/main-infra-stack';
import { PipelineInfraStack } from '../lib/pipeline-infra-stack';
import { PipelineListenerStack } from '../lib/pipeline-listener-stack';
import { PipelineDdbStreamStack } from '../lib/pipeline-ddb-stream-stack';

const app = new cdk.App();

// Environment configuration
const env = {
  region: 'eu-west-1',
  account: process.env.CDK_DEFAULT_ACCOUNT,
};

// TODO: Define specific resource names and configurations
const appPrefix = 'Mnemosyne';

// Base roles stack (deploy first)
new BaseRolesStack(app, `${appPrefix}BaseRolesStack`, {
  env,
  appPrefix,
});

// Main infrastructure stack
new MainInfraStack(app, `${appPrefix}MainInfraStack`, {
  env,
  appPrefix,
});

// Pipeline stacks
new PipelineInfraStack(app, `${appPrefix}PipelineInfraStack`, {
  env,
  appPrefix,
});

new PipelineListenerStack(app, `${appPrefix}PipelineListenerStack`, {
  env,
  appPrefix,
});

new PipelineDdbStreamStack(app, `${appPrefix}PipelineDdbStreamStack`, {
  env,
  appPrefix,
});
