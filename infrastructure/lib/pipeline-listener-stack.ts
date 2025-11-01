import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { BaseRolesStack } from './base-roles-stack';

export interface PipelineListenerStackProps extends cdk.StackProps {
  appPrefix: string;
}

/**
 * PipelineListenerStack - CI/CD for message-listener Lambda
 * 
 * Automated deployment pipeline for Slack message listener:
 * - Triggers on changes to message-listener/ folder in main branch
 * - Uses CodeStar connection for GitHub integration
 * - Single CodeBuild step: npm ci, build, test, deploy Lambda
 * - Updates Lambda function code directly via AWS CLI
 * - No manual approval required for continuous deployment
 */
export class PipelineListenerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineListenerStackProps) {
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

    // Single CodeBuild project for Lambda build and deploy
    // Uses buildspec YAML file from infrastructure/buildspecs/ folder (relative to repo root)
    const lambdaBuildDeployProject = new codebuild.PipelineProject(this, 'LambdaBuildDeployProject', {
      projectName: `${appPrefix}MessageListenerBuildDeploy`,
      buildSpec: codebuild.BuildSpec.fromSourceFilename('infrastructure/buildspecs/message-listener-buildspec.yml'),
      environment: {
        buildImage: codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_1_0,
        computeType: codebuild.ComputeType.SMALL,
        environmentVariables: {
          ARTIFACT_BUCKET: {
            value: artifactBucket.bucketName,
          },
          FUNCTION_NAME: {
            value: `${appPrefix}MessageListener`,
          },
        },
      },
    });

    // Grant permissions
    artifactBucket.grantReadWrite(lambdaBuildDeployProject);

    // Add Lambda update permissions to CodeBuild role
    // Pipeline is the ONLY way to deploy Lambda code
    lambdaBuildDeployProject.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:UpdateFunctionCode',
        'lambda:GetFunction',
        'lambda:UpdateFunctionConfiguration',
      ],
      resources: [`arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:${appPrefix}MessageListener`],
    }));

    // CodePipeline for message-listener deployment
    const pipeline = new codepipeline.Pipeline(this, 'ListenerPipeline', {
      pipelineName: `${appPrefix}MessageListenerPipeline`,
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
      project: lambdaBuildDeployProject,
      input: sourceOutput,
    });

    pipeline.addStage({
      stageName: 'Build_Deploy',
      actions: [buildDeployAction],
    });

    // Output pipeline information
    new cdk.CfnOutput(this, 'ListenerPipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline for message-listener Lambda deployment',
    });
  }
}
