import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { BaseRolesStack } from './base-roles-stack';

export interface PipelineOAuthCallbackStackProps extends cdk.StackProps {
  appPrefix: string;
}

/**
 * PipelineOAuthCallbackStack - CI/CD for oauth-callback Lambda
 * 
 * Automated deployment pipeline for Slack OAuth callback:
 * - Triggers on changes to functions/oauth-callback/ folder in main branch
 * - Uses CodeStar connection for GitHub integration
 * - Single CodeBuild step: npm ci, build, test, deploy Lambda
 * - Updates Lambda function code directly via AWS CLI
 * - No manual approval required for continuous deployment
 */
export class PipelineOAuthCallbackStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineOAuthCallbackStackProps) {
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
    const codeBuildRole = new iam.Role(this, 'OAuthCallbackBuildDeployRole', {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
    });

    // Grant S3 permissions
    artifactBucket.grantReadWrite(codeBuildRole);

    // Add Lambda update permissions to CodeBuild role
    // Pipeline is the ONLY way to deploy Lambda code
    codeBuildRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:UpdateFunctionCode',
        'lambda:GetFunction',
        'lambda:UpdateFunctionConfiguration',
      ],
      resources: [`arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:${appPrefix}OAuthCallback`],
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
    // Using CfnProject directly to specify Lambda compute with ARM image
    // Changed logical ID to force replacement of old PipelineProject-based resource
    // Proactive log group with 7-day retention
    const oauthCallbackBuildLogGroup = new logs.LogGroup(this, 'OAuthCallbackBuildLogs', {
      logGroupName: `/aws/codebuild/${appPrefix}OAuthCallbackBuildDeploy`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const lambdaBuildDeployProject = new codebuild.CfnProject(this, 'LambdaBuildDeployProject', {
      name: `${appPrefix}OAuthCallbackBuildDeploy`,
      artifacts: {
        type: 'CODEPIPELINE',
      },
      environment: {
        type: 'ARM_LAMBDA_CONTAINER',
        computeType: 'BUILD_LAMBDA_1GB',
        image: 'aws/codebuild/amazonlinux-aarch64-lambda-standard:nodejs22',
        imagePullCredentialsType: 'CODEBUILD',
        environmentVariables: [
          {
            name: 'ARTIFACT_BUCKET',
            value: artifactBucket.bucketName,
          },
          {
            name: 'FUNCTION_NAME',
            value: `${appPrefix}OAuthCallback`,
          },
        ],
      },
      logsConfig: {
        cloudWatchLogs: {
          status: 'ENABLED',
          groupName: oauthCallbackBuildLogGroup.logGroupName,
        },
      },
      source: {
        type: 'CODEPIPELINE',
        buildSpec: (() => {
          const buildSpec = codebuild.BuildSpec.fromSourceFilename('infrastructure/buildspecs/oauth-callback-buildspec.yml');
          return buildSpec.toBuildSpec();
        })(),
      },
      serviceRole: codeBuildRole.roleArn,
    });

    // Create a Project wrapper for use in CodePipeline
    const project = codebuild.Project.fromProjectName(this, 'LambdaBuildDeployProjectWrapper', lambdaBuildDeployProject.ref);

    // CodePipeline for oauth-callback deployment
    const pipeline = new codepipeline.Pipeline(this, 'OAuthCallbackPipeline', {
      pipelineName: `${appPrefix}OAuthCallbackPipeline`,
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
    new cdk.CfnOutput(this, 'OAuthCallbackPipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline for oauth-callback Lambda deployment',
    });
  }
}

