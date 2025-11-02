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

    // Add Lambda update permissions to CodeBuild role for all Lambda functions and layer
    const lambdaFunctions = [
      `${appPrefix}MessageListener`,
      `${appPrefix}FileProcessor`,
      `${appPrefix}OAuthCallback`,
    ];
    const layerName = `${appPrefix}SlackSharedLayer`;

    codeBuildRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:UpdateFunctionCode',
        'lambda:GetFunction',
        'lambda:UpdateFunctionConfiguration',
        'lambda:PublishLayerVersion',
        'lambda:GetLayerVersion',
        'lambda:ListLayerVersions',
        'lambda:DeleteLayerVersion', // For cleanup of old layer versions
      ],
      resources: [
        ...lambdaFunctions.map(name => 
          `arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:${name}`
        ),
        // Layer ARN pattern - allow publishing, listing, and deleting versions
        `arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:layer:${layerName}:*`,
      ],
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

    // DynamoDB permissions for build hash change detection
    codeBuildRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
      ],
      resources: [
        `arn:aws:dynamodb:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table:${appPrefix}BuildHashes`,
      ],
    }));

    // Infrastructure build project - builds CDK infrastructure
    const infraBuildProject = new codebuild.PipelineProject(this, 'InfrastructureBuildProject', {
      projectName: `${appPrefix}InfrastructureBuild`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: false,
      },
      source: codebuild.Source.gitHub({
        owner: 'Artistotle-ai',
        repo: 'slackHistory',
        webhook: true,
        webhookFilters: [
          codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH).andFilePathIs('infrastructure/**'),
        ],
      }),
      cache: codebuild.Cache.bucket(artifactBucket, {
        prefix: 'codebuild-cache-infra-build',
      }),
      buildSpec: codebuild.BuildSpec.fromSourceFilename('infrastructure/buildspecs/infrastructure-buildspec.yml'),
      role: codeBuildRole,
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, 'InfrastructureBuildLogs', {
            logGroupName: `/aws/codebuild/${appPrefix}InfrastructureBuild`,
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          }),
        },
      },
      environmentVariables: {
        APP_PREFIX: {
          value: appPrefix,
        },
      },
    });

    // Build projects - run in parallel
    // 1. Layer build project
    const layerBuildProject = new codebuild.PipelineProject(this, 'LayerBuildProject', {
      projectName: `${appPrefix}LayerBuild`,
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: false,
      },
      cache: codebuild.Cache.bucket(artifactBucket, {
        prefix: 'codebuild-cache-layer-build',
      }),
      source: codebuild.Source.gitHub({
        owner: 'Artistotle-ai',
        repo: 'slackHistory',
        webhook: true,
        webhookFilters: [
          codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH).andFilePathIs('functions/slack-shared/**'),
        ],
      }),
      buildSpec: codebuild.BuildSpec.fromSourceFilename('infrastructure/buildspecs/layer-buildspec.yml'),
      role: codeBuildRole,
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, 'LayerBuildLogs', {
            logGroupName: `/aws/codebuild/${appPrefix}LayerBuild`,
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

    // 2. Lambdas build project (builds all 3 functions)
    const lambdasBuildProject = new codebuild.PipelineProject(this, 'LambdasBuildProject', {
      projectName: `${appPrefix}LambdasBuild`,
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0,
        computeType: codebuild.ComputeType.SMALL,
        privileged: false,
      },
      cache: codebuild.Cache.bucket(artifactBucket, {
        prefix: 'codebuild-cache-lambdas-build',
      }),
      source: codebuild.Source.gitHub({
        owner: 'Artistotle-ai',
        repo: 'slackHistory',
        webhook: true,
        webhookFilters: [
          codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH).andFilePathIs('functions/message-listener/**'),
          codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH).andFilePathIs('functions/file-processor/**'),
          codebuild.FilterGroup.inEventOf(codebuild.EventAction.PUSH).andFilePathIs('functions/oauth-callback/**'),
        ],
      }),
      buildSpec: codebuild.BuildSpec.fromSourceFilename('infrastructure/buildspecs/lambdas-buildspec.yml'),
      role: codeBuildRole,
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, 'LambdasBuildLogs', {
            logGroupName: `/aws/codebuild/${appPrefix}LambdasBuild`,
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

    // No separate deploy projects needed - deployments happen in the build step

    // CodePipeline for all Lambda deployments
    const pipeline = new codepipeline.Pipeline(this, 'LambdasPipeline', {
      pipelineName: `${appPrefix}LambdasPipeline`,
      artifactBucket: artifactBucket,
      pipelineType: codepipeline.PipelineType.V2,
    });

    // Build stage 1 - Infrastructure and Layer build+deploy in parallel
    // Layer build also deploys the layer (outputs node_modules zip + layer ARN)
    const infraBuildOutput = new codepipeline.Artifact('InfrastructureArtifact');
    const infraBuildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'Infrastructure_Build',
      project: infraBuildProject,
      outputs: [infraBuildOutput],
    });

    const layerBuildOutput = new codepipeline.Artifact('LayerBuildArtifact');
    const layerBuildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'Layer_Build_Deploy',
      project: layerBuildProject,
      outputs: [layerBuildOutput],
    });

    pipeline.addStage({
      stageName: 'Build',
      actions: [infraBuildAction, layerBuildAction],
    });

    // Build and Deploy stage - Lambdas build and deploy in same CodeBuild (just API calls)
    const lambdasBuildOutput = new codepipeline.Artifact('LambdasBuildArtifacts');
    const lambdasBuildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'Lambdas_Build_Deploy',
      project: lambdasBuildProject,
      extraInputs: [layerBuildOutput], // Carry over merged node_modules zip and layer-arn.env
      outputs: [lambdasBuildOutput],
    });

    pipeline.addStage({
      stageName: 'Build_Deploy_Lambdas',
      actions: [lambdasBuildAction],
    });

    // Output pipeline information
    new cdk.CfnOutput(this, 'LambdasPipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline for all Lambda function deployments',
    });
  }
}

