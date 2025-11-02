import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface PipelineLambdasStackProps extends cdk.StackProps {
  appPrefix: string;
}

/**
 * PipelineLambdasStack - Unified CI/CD for all Lambda functions
 * 
 * Automated deployment pipeline for all Lambdas:
 * - Triggers on changes to functions/ folder in main branch
 * - Uses CodeStar connection for GitHub integration
 * - Single CodeBuild step that builds slack-shared first, then all lambdas sequentially
 * - Builds all lambdas in the same folder to share node_modules and dependencies
 * - Updates Lambda function code directly via AWS CLI
 * - All lambdas: message-listener, file-processor, oauth-callback
 */
export class PipelineLambdasStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineLambdasStackProps) {
    super(scope, id, props);

    const { appPrefix } = props;

    // Use static references to avoid cyclic dependencies
    // Resources are referenced by predictable naming patterns
    const artifactBucketName = `${appPrefix.toLowerCase()}-artifacts-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`;

    // Create references using static names
    const artifactBucket = s3.Bucket.fromBucketName(this, 'ArtifactBucket', artifactBucketName);

    // Create pipeline
    this.createPipeline(appPrefix, artifactBucket);
  }

  private createPipeline(appPrefix: string, artifactBucket: s3.IBucket) {
    // Import GitHub connection ARN from BaseRolesStack export
    const githubConnectionArn = cdk.Fn.importValue(`${appPrefix}GitHubConnectionArn`);

    // Create IAM role for CodeBuild with all necessary permissions
    const codeBuildRole = new iam.Role(this, 'LambdasBuildDeployRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    });

    // Grant S3 permissions
    artifactBucket.grantReadWrite(codeBuildRole);

    // Add Lambda update permissions to CodeBuild role for all Lambda functions
    const lambdaFunctions = [
      `${appPrefix}MessageListener`,
      `${appPrefix}FileProcessor`,
      `${appPrefix}OAuthCallback`,
    ];

    codeBuildRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:UpdateFunctionCode',
        'lambda:GetFunction',
        'lambda:UpdateFunctionConfiguration',
      ],
      resources: lambdaFunctions.map(name => 
        `arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:${name}`
      ),
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

    // Single CodeBuild project for all Lambda builds and deploys
    // Use standard Amazon Linux 2023 ARM image with SMALL compute type
    // Node.js 22 will be installed manually in buildspec (Lambda standard images require LARGE)
    const project = new codebuild.PipelineProject(this, 'LambdasBuildDeployProject', {
      projectName: `${appPrefix}LambdasBuildDeploy`,
      environment: {
        // Use standard Amazon Linux 2023 ARM image (supports SMALL compute)
        // Node.js 22 will be installed in buildspec using nvm
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: false,
      },
      cache: codebuild.Cache.bucket(artifactBucket, {
        prefix: 'codebuild-cache-lambdas',
      }),
      buildSpec: codebuild.BuildSpec.fromSourceFilename('infrastructure/buildspecs/lambdas-buildspec.yml'),
      role: codeBuildRole,
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, 'LambdasBuildLogs', {
            logGroupName: `/aws/codebuild/${appPrefix}LambdasBuildDeploy`,
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          }),
        },
      },
      environmentVariables: {
        ARTIFACT_BUCKET: {
          value: artifactBucket.bucketName,
        },
        APP_PREFIX: {
          value: appPrefix,
        },
      },
    });

    // CodePipeline for all Lambda deployments
    const pipeline = new codepipeline.Pipeline(this, 'LambdasPipeline', {
      pipelineName: `${appPrefix}LambdasPipeline`,
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
      connectionArn: githubConnectionArn,
      output: sourceOutput,
      triggerOnPush: true,
    });

    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    });

    // Build and Deploy stage (combined)
    const buildDeployAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'Lambdas_Build_Deploy',
      project: project,
      input: sourceOutput,
    });

    pipeline.addStage({
      stageName: 'Build_Deploy',
      actions: [buildDeployAction],
    });

    // Output pipeline information
    new cdk.CfnOutput(this, 'LambdasPipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline for all Lambda function deployments',
    });
  }
}

