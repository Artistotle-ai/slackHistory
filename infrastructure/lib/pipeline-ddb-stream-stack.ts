import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambda_event_sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import { BaseRolesStack } from './base-roles-stack';

export interface PipelineDdbStreamStackProps extends cdk.StackProps {
  appPrefix: string;
}

/**
 * PipelineDdbStreamStack - CI/CD for file-processor Lambda
 * 
 * Automated deployment pipeline for DynamoDB stream file processor:
 * - Triggers on changes to functions/file-processor/ folder in main branch
 * - Uses CodeStar connection for GitHub integration
 * - Single CodeBuild step: npm ci, build, test, deploy Lambda
 * - Updates Lambda function code directly via AWS CLI
 * - Processes DynamoDB streams to download and store Slack files in S3
 */
export class PipelineDdbStreamStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineDdbStreamStackProps) {
    super(scope, id, props);

    const { appPrefix } = props;

    // Use static references to avoid cyclic dependencies
    // Resources are referenced by predictable naming patterns
    const artifactBucketName = `${appPrefix.toLowerCase()}-artifacts-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`;

    // Create references using static names
    const artifactBucket = s3.Bucket.fromBucketName(this, 'ArtifactBucket', artifactBucketName);

    // Create pipeline - let CodePipeline create its own service roles
    this.createPipeline(appPrefix, artifactBucket);
  }

  private createPipeline(appPrefix: string, artifactBucket: s3.IBucket) {
    // Import GitHub connection ARN from BaseRolesStack export
    const githubConnectionArn = cdk.Fn.importValue(`${appPrefix}GitHubConnectionArn`);

    // Create IAM role for CodeBuild with all necessary permissions
    const codeBuildRole = new iam.Role(this, 'FileProcessorBuildDeployRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    });

    // Grant S3 permissions
    artifactBucket.grantReadWrite(codeBuildRole);

    // Add Lambda update permissions to CodeBuild role
    codeBuildRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:UpdateFunctionCode'],
      resources: [`arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:MnemosyneFileProcessor`],
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

    // Single CodeBuild project for Lambda build and deploy
    const project = new codebuild.PipelineProject(this, 'FileProcessorBuildDeployProject', {
      projectName: `${appPrefix}FileProcessorBuildDeploy`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: false,
      },
      cache: codebuild.Cache.bucket(artifactBucket, {
        prefix: 'codebuild-cache-file-processor',
      }),
      buildSpec: codebuild.BuildSpec.fromSourceFilename('infrastructure/buildspecs/file-processor-buildspec.yml'),
      role: codeBuildRole,
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, 'FileProcessorBuildLogs', {
            logGroupName: `/aws/codebuild/${appPrefix}FileProcessorBuildDeploy`,
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          }),
        },
      },
      environmentVariables: {
        ARTIFACT_BUCKET: {
          value: artifactBucket.bucketName,
        },
      },
    });

    // CodePipeline for file-processor deployment
    const pipeline = new codepipeline.Pipeline(this, 'DdbStreamPipeline', {
      pipelineName: `${appPrefix}FileProcessorPipeline`,
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
      actionName: 'Lambda_Build_Deploy',
      project: project,
      input: sourceOutput,
    });

    pipeline.addStage({
      stageName: 'Build_Deploy',
      actions: [buildDeployAction],
    });

    // Output pipeline information
    new cdk.CfnOutput(this, 'DdbStreamPipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline for file-processor Lambda deployment with DynamoDB stream',
    });
  }
}
