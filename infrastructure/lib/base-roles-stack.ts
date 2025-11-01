import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface BaseRolesStackProps extends cdk.StackProps {
  appPrefix: string;
}

export class BaseRolesStack extends cdk.Stack {
  public readonly artifactBucket: s3.Bucket;
  public readonly slackBotTokenSecret: secretsmanager.Secret;
  public readonly slackSigningSecretSecret: secretsmanager.Secret;
  public readonly ciRole: iam.Role;

  constructor(scope: Construct, id: string, props: BaseRolesStackProps) {
    super(scope, id, props);

    const { appPrefix } = props;

    // S3 artifact bucket for CodePipeline artifacts
    this.artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      bucketName: `${appPrefix.toLowerCase()}-artifacts-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
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

    // Output important resources
    new cdk.CfnOutput(this, 'ArtifactBucketName', {
      value: this.artifactBucket.bucketName,
      description: 'S3 bucket for CodePipeline artifacts',
    });

    new cdk.CfnOutput(this, 'SlackBotTokenSecretArn', {
      value: this.slackBotTokenSecret.secretArn,
      description: 'Secrets Manager ARN for Slack bot token',
    });

    new cdk.CfnOutput(this, 'SlackSigningSecretArn', {
      value: this.slackSigningSecretSecret.secretArn,
      description: 'Secrets Manager ARN for Slack signing secret',
    });

    new cdk.CfnOutput(this, 'CiRoleArn', {
      value: this.ciRole.roleArn,
      description: 'IAM role ARN for CI/CD operations',
    });
  }
}
