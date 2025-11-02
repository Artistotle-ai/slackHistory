#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { BaseRolesStack } from '../lib/base-roles-stack';
import { MainInfraStack } from '../lib/main-infra-stack';
import { PipelineInfraStack } from '../lib/pipeline-infra-stack';
import { PipelineLambdasStack } from '../lib/pipeline-lambdas-stack';

const app = new cdk.App();

// Environment configuration
// Allow region to be configured via environment variable (default: eu-west-1)
// Example: AWS_REGION=us-east-1 npx cdk deploy --all
const region = process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'eu-west-1';
const env = {
  region,
  account: process.env.CDK_DEFAULT_ACCOUNT,
};

// TODO: Define specific resource names and configurations
const appPrefix = 'Mnemosyne';

// Check for stack selection via environment variable
const deployStack = process.env.DEPLOY_STACK;

// Base roles stack - Shared resources for all pipelines
// MUST be deployed first as it exports values used by other stacks
const baseRolesStack = new BaseRolesStack(app, `${appPrefix}BaseRolesStack`, {
  env,
  appPrefix,
  description: 'Mnemosyne: Shared resources (S3 artifacts, Secrets Manager, CodeStar connection, IAM roles)',
});

// Main infrastructure stack - Core application resources
// Depends on BaseRolesStack exports (secret ARNs)
const mainInfraStack = new MainInfraStack(app, `${appPrefix}MainInfraStack`, {
  env,
  appPrefix,
  description: 'Mnemosyne: Core application (DynamoDB, S3, Lambda functions for Slack message archiving)',
});
mainInfraStack.addDependency(baseRolesStack);

// Pipeline stacks - CI/CD automation
// All depend on BaseRolesStack for GitHub connection ARN and artifact bucket

// Infrastructure pipeline - separate from Lambda pipelines
const pipelineInfraStack = new PipelineInfraStack(app, `${appPrefix}PipelineInfraStack`, {
  env,
  appPrefix,
  description: 'Mnemosyne: CI/CD pipeline for CDK infrastructure deployments',
});
pipelineInfraStack.addDependency(baseRolesStack);

// Unified Lambda pipeline - builds all lambdas sequentially (message-listener, file-processor, oauth-callback)
const pipelineLambdasStack = new PipelineLambdasStack(app, `${appPrefix}PipelineLambdasStack`, {
  env,
  appPrefix,
  description: 'Mnemosyne: Unified CI/CD pipeline for all Lambda functions',
});
pipelineLambdasStack.addDependency(baseRolesStack);
pipelineLambdasStack.addDependency(mainInfraStack); // Needs Lambda functions to exist
