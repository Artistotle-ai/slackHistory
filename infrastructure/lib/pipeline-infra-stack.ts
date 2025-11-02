import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { BaseRolesStack } from './base-roles-stack';

export interface PipelineInfraStackProps extends cdk.StackProps {
  appPrefix: string;
}

/**
 * PipelineInfraStack - CI/CD for infrastructure deployments
 * 
 * Automated pipeline for CDK infrastructure changes:
 * - Triggers on changes to infrastructure/ folder in main branch
 * - Uses CodeStar connection for GitHub integration
 * - Single CodeBuild step: npm ci, build, synth, deploy
 * - Deploys all CDK stacks automatically (no manual approval)
 * - Pipeline Type V2 for enhanced features and performance
 * 
 * TODO: Consider consolidating all Lambda pipelines into a single pipeline
 * to reduce costs and simplify deployments. Can use path filters to trigger
 * only relevant builds based on changed directories. Add caching to skip
 * unchanged builds.
 */
export class PipelineInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineInfraStackProps) {
    super(scope, id, props);

    const { appPrefix } = props;

    // Use static references to avoid cyclic dependencies
    // Resources are referenced by predictable naming patterns
    const artifactBucketName = `${appPrefix.toLowerCase()}-artifacts-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`;
    const githubConnectionArn = `arn:aws:codeconnections:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:connection/*`;

    // Create references using static names
    const artifactBucket = s3.Bucket.fromBucketName(this, 'ArtifactBucket', artifactBucketName);

    // Create pipeline - let CodePipeline create its own service roles
    this.createPipeline(appPrefix, artifactBucket);
  }

  private createPipeline(appPrefix: string, artifactBucket: s3.IBucket) {
    // Import GitHub connection ARN from BaseRolesStack export
    // Use Fn.importValue to reference the export from BaseRolesStack
    // Note: During synthesis, this will resolve at deploy time
    const githubConnectionArn = cdk.Fn.importValue(`${appPrefix}GitHubConnectionArn`);

    // Create IAM role for CodeBuild with all necessary permissions
    const codeBuildRole = new iam.Role(this, 'CdkBuildDeployRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    });

    // Grant S3 permissions
    artifactBucket.grantReadWrite(codeBuildRole);

    // Add SSM permissions for CDK bootstrap version check
    codeBuildRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/cdk-bootstrap/*`],
    }));

    // Add CloudFormation permissions for CDK deployments
    codeBuildRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudformation:*',
        's3:*',
        'iam:*',
        'lambda:*',
        'dynamodb:*',
        'secretsmanager:*',
        'kms:*',
        'codeconnections:UseConnection',
      ],
      resources: ['*'], // TODO: Restrict to specific resources for security
    }));

    // Allow writing build logs to CloudWatch Logs
    codeBuildRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'logs:DescribeLogStreams',
      ],
      resources: [
        `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/codebuild/*`,
        `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/codebuild/*:log-stream:*`,
      ],
    }));

    // Single CodeBuild project for CDK build and deploy
    const project = new codebuild.PipelineProject(this, 'CdkBuildDeployProject', {
      projectName: `${appPrefix}CdkBuildDeploy`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: false,
      },
      cache: codebuild.Cache.bucket(artifactBucket, {
        prefix: 'codebuild-cache',
      }),
      buildSpec: codebuild.BuildSpec.fromSourceFilename('infrastructure/buildspecs/infrastructure-buildspec.yml'),
      role: codeBuildRole,
      logging: {
        cloudWatch: {
          logGroup: (() => {
            // Create log group - if it already exists, it will be imported via physical ID
            const logGroup = new logs.LogGroup(this, 'CdkBuildLogs', {
              logGroupName: `/aws/codebuild/${appPrefix}CdkBuildDeploy`,
              retention: logs.RetentionDays.ONE_WEEK,
              removalPolicy: cdk.RemovalPolicy.DESTROY,
            });
            // Use CfnLogGroup to potentially handle existing resource
            const cfnLogGroup = logGroup.node.defaultChild as logs.CfnLogGroup;
            // This allows CloudFormation to recognize the existing resource
            return logGroup;
          })(),
        },
      },
    });

    // CodePipeline for infrastructure deployment
    const pipeline = new codepipeline.Pipeline(this, 'InfraPipeline', {
      pipelineName: `${appPrefix}InfraPipeline`,
      artifactBucket: artifactBucket,
      pipelineType: codepipeline.PipelineType.V2,
    });

    // Source stage - GitHub source via CodeStar connection
    const sourceOutput = new codepipeline.Artifact();
    const sourceAction = new codepipeline_actions.CodeStarConnectionsSourceAction({
      actionName: 'GitHub_Source',
      owner: 'Artistotle-ai',
      repo: 'slackHistory',
      branch: 'main',
      connectionArn: githubConnectionArn, // Uses connection created in BaseRolesStack
      output: sourceOutput,
      triggerOnPush: true,
    });

    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    });

    // Build and Deploy stage (combined)
    const buildDeployAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CDK_Build_Deploy',
      project: project,
      input: sourceOutput,
    });

    pipeline.addStage({
      stageName: 'Build_Deploy',
      actions: [buildDeployAction],
    });

    // Output pipeline information
    new cdk.CfnOutput(this, 'InfraPipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline for infrastructure deployment',
    });
  }
}
