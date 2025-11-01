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

// Check for stack selection via environment variable
const deployStack = process.env.DEPLOY_STACK;

// Base roles stack - Shared resources for all pipelines
if (!deployStack || deployStack === 'BaseRolesStack') {
  new BaseRolesStack(app, `${appPrefix}BaseRolesStack`, {
    env,
    appPrefix,
    description: 'Mnemosyne: Shared resources (S3 artifacts, Secrets Manager, CodeStar connection, IAM roles)',
  });
}

// Main infrastructure stack - Core application resources
if (!deployStack || deployStack === 'MainInfraStack') {
  new MainInfraStack(app, `${appPrefix}MainInfraStack`, {
    env,
    appPrefix,
    description: 'Mnemosyne: Core application (DynamoDB, S3, Lambda functions for Slack message archiving)',
  });
}

// Pipeline stacks - CI/CD automation
if (!deployStack || deployStack === 'PipelineInfraStack') {
  new PipelineInfraStack(app, `${appPrefix}PipelineInfraStack`, {
    env,
    appPrefix,
    description: 'Mnemosyne: CI/CD pipeline for CDK infrastructure deployments',
  });
}


if (!deployStack || deployStack === 'PipelineListenerStack') {
  new PipelineListenerStack(app, `${appPrefix}PipelineListenerStack`, {
    env,
    appPrefix,
    description: 'Mnemosyne: CI/CD pipeline for message-listener Lambda function',
  });
}

if (!deployStack || deployStack === 'PipelineDdbStreamStack') {
  new PipelineDdbStreamStack(app, `${appPrefix}PipelineDdbStreamStack`, {
    env,
    appPrefix,
    description: 'Mnemosyne: CI/CD pipeline for file-processor Lambda function',
  });
}
