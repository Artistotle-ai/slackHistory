import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as codeconnections from 'aws-cdk-lib/aws-codeconnections';

export interface BaseRolesStackProps extends cdk.StackProps {
  appPrefix: string;
}

/**
 * BaseRolesStack - Shared infrastructure resources
 * 
 * Creates foundational resources used by all pipelines and application stacks:
 * - S3 artifact bucket for CodePipeline
 * - Secrets Manager placeholders for Slack credentials
 * - CodeStar connection for GitHub integration
 */
export class BaseRolesStack extends cdk.Stack {
  public readonly artifactBucket: s3.Bucket;
  public readonly slackSigningSecretSecret: secretsmanager.Secret;
  public readonly githubConnection: codeconnections.CfnConnection;

  constructor(scope: Construct, id: string, props: BaseRolesStackProps) {
    super(scope, id, props);

    const { appPrefix } = props;

    // S3 artifact bucket for CodePipeline artifacts
    this.artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      bucketName: `${appPrefix.toLowerCase()}-artifacts-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false, // Disabled to reduce costs - artifacts don't need versioning
      lifecycleRules: [
        {
          id: 'DeleteOldArtifacts',
          enabled: true,
          expiration: cdk.Duration.days(7), // Delete old artifacts after 7 days
        },
      ],
    });

    // Secrets Manager placeholders for Slack credentials
    this.slackSigningSecretSecret = new secretsmanager.Secret(this, 'SlackSigningSecretSecret', {
      secretName: `${appPrefix}/slack/signing-secret`,
      description: 'Slack signing secret for request verification',
      // TODO: Populate this secret after stack deployment
    });

    // Slack OAuth credentials for app installation
    const slackClientIdSecret = new secretsmanager.Secret(this, 'SlackClientIdSecret', {
      secretName: `${appPrefix}/slack/client-id`,
      description: 'Slack OAuth client ID',
      // TODO: Populate this secret after stack deployment
    });

    const slackClientSecretSecret = new secretsmanager.Secret(this, 'SlackClientSecretSecret', {
      secretName: `${appPrefix}/slack/client-secret`,
      description: 'Slack OAuth client secret',
      // TODO: Populate this secret after stack deployment
    });

    // GitHub CodeStar Connection
    this.githubConnection = new codeconnections.CfnConnection(this, 'GitHubConnection', {
      connectionName: `${appPrefix}-github`,
      providerType: 'GitHub',
    });

    // Output important resources
    new cdk.CfnOutput(this, 'ArtifactBucketName', {
      value: this.artifactBucket.bucketName,
      description: 'S3 bucket for CodePipeline artifacts',
    });

    new cdk.CfnOutput(this, 'SlackSigningSecretArn', {
      value: this.slackSigningSecretSecret.secretArn,
      description: 'Secrets Manager ARN for Slack signing secret',
      exportName: `${appPrefix}SlackSigningSecretArn`,
    });

    // Export connection ARN for use in pipeline stacks
    new cdk.CfnOutput(this, 'GitHubConnectionArn', {
      value: this.githubConnection.attrConnectionArn,
      description: 'CodeStar GitHub connection ARN (requires manual authorization in AWS Console)',
      exportName: `${appPrefix}GitHubConnectionArn`,
    });

    new cdk.CfnOutput(this, 'SlackClientIdSecretArn', {
      value: slackClientIdSecret.secretArn,
      description: 'Secrets Manager ARN for Slack OAuth client ID',
      exportName: `${appPrefix}SlackClientIdSecretArn`,
    });

    new cdk.CfnOutput(this, 'SlackClientSecretArn', {
      value: slackClientSecretSecret.secretArn,
      description: 'Secrets Manager ARN for Slack OAuth client secret',
      exportName: `${appPrefix}SlackClientSecretArn`,
    });

    // Export CDK bootstrap role ARNs for use in pipeline stacks
    // These roles are created by CDK bootstrap and have a standard naming pattern
    const cdkBootstrapQualifier = 'hnb659fds'; // Standard CDK bootstrap qualifier
    const cdkFilePublishingRoleArn = `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/cdk-${cdkBootstrapQualifier}-file-publishing-role-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`;
    const cdkDeployRoleArn = `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/cdk-${cdkBootstrapQualifier}-deploy-role-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`;
    const cdkLookupRoleArn = `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/cdk-${cdkBootstrapQualifier}-lookup-role-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`;

    new cdk.CfnOutput(this, 'CdkFilePublishingRoleArn', {
      value: cdkFilePublishingRoleArn,
      description: 'CDK bootstrap file publishing role ARN',
      exportName: `${appPrefix}CdkFilePublishingRoleArn`,
    });

    new cdk.CfnOutput(this, 'CdkDeployRoleArn', {
      value: cdkDeployRoleArn,
      description: 'CDK bootstrap deploy role ARN',
      exportName: `${appPrefix}CdkDeployRoleArn`,
    });

    new cdk.CfnOutput(this, 'CdkLookupRoleArn', {
      value: cdkLookupRoleArn,
      description: 'CDK bootstrap lookup role ARN',
      exportName: `${appPrefix}CdkLookupRoleArn`,
    });
  }
}
