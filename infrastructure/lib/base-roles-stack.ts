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
 * - Shared IAM roles for CI/CD operations
 */
export class BaseRolesStack extends cdk.Stack {
  public readonly artifactBucket: s3.Bucket;
  public readonly slackBotTokenSecret: secretsmanager.Secret;
  public readonly slackSigningSecretSecret: secretsmanager.Secret;
  public readonly ciRole: iam.Role;
  public readonly githubConnection: codeconnections.CfnConnection;

  constructor(scope: Construct, id: string, props: BaseRolesStackProps) {
    super(scope, id, props);

    const { appPrefix } = props;

    // S3 artifact bucket for CodePipeline artifacts
    this.artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      bucketName: `${appPrefix.toLowerCase()}-artifacts-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
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
    this.slackBotTokenSecret = new secretsmanager.Secret(this, 'SlackBotTokenSecret', {
      secretName: `${appPrefix}/slack/bot-token`,
      description: 'Slack bot token for Mnemosyne application',
      // TODO: Populate this secret after stack deployment
    });

    this.slackSigningSecretSecret = new secretsmanager.Secret(this, 'SlackSigningSecretSecret', {
      secretName: `${appPrefix}/slack/signing-secret`,
      description: 'Slack signing secret for request verification',
      // TODO: Populate this secret after stack deployment
    });

    // CI Role for CodePipeline deployments
    this.ciRole = new iam.Role(this, 'CiRole', {
      roleName: `${appPrefix}CiRole`,
      assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
      description: 'Role for CodePipeline to execute deployments',
    });

    // TODO: Define specific permissions for CI role (CDK deploy, CloudFormation, etc.)
    // Add managed policies or inline policies as needed
    this.ciRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSCodePipeline_FullAccess')
    );

    // Add CDK deployment permissions
    this.ciRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudformation:*',
        's3:*',
        'iam:*',
        'lambda:*',
        'dynamodb:*',
        'secretsmanager:*',
        'kms:*',
      ],
      resources: ['*'], // TODO: Restrict to specific resources for security
    }));

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

    new cdk.CfnOutput(this, 'SlackBotTokenSecretArn', {
      value: this.slackBotTokenSecret.secretArn,
      description: 'Secrets Manager ARN for Slack bot token',
      exportName: `${appPrefix}SlackBotTokenSecretArn`,
    });

    new cdk.CfnOutput(this, 'SlackSigningSecretArn', {
      value: this.slackSigningSecretSecret.secretArn,
      description: 'Secrets Manager ARN for Slack signing secret',
      exportName: `${appPrefix}SlackSigningSecretArn`,
    });

    new cdk.CfnOutput(this, 'CiRoleArn', {
      value: this.ciRole.roleArn,
      description: 'IAM role ARN for CI/CD operations',
    });

    // Export connection ARN for use in pipeline stacks
    new cdk.CfnOutput(this, 'GitHubConnectionArn', {
      value: this.githubConnection.attrConnectionArn,
      description: 'CodeStar GitHub connection ARN (requires manual authorization in AWS Console)',
      exportName: `${appPrefix}GitHubConnectionArn`,
    });
  }
}
