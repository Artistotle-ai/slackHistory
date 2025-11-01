import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambda_event_sources from 'aws-cdk-lib/aws-lambda-event-sources';
import { BaseRolesStack } from './base-roles-stack';

export interface PipelineDdbStreamStackProps extends cdk.StackProps {
  appPrefix: string;
}

/**
 * PipelineDdbStreamStack - CI/CD for file-processor Lambda
 * 
 * Automated deployment pipeline for DynamoDB stream file processor:
 * - Triggers on changes to file-processor/ folder in main branch
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

    // Single CodeBuild project for Lambda build and deploy
    const lambdaBuildDeployProject = new codebuild.PipelineProject(this, 'LambdaBuildDeployProject', {
      projectName: `${appPrefix}FileProcessorBuildDeploy`,
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: [
              'cd file-processor',
              'npm ci',
            ],
          },
          build: {
            commands: [
              'cd file-processor',
              'npm run build',
              'npm run test', // TODO: Add tests
              'cd ..',
              'aws lambda update-function-code --function-name MnemosyneFileProcessor --zip-file fileb://file-processor/dist/lambda.zip',
            ],
          },
        },
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_ARM_2,
        environmentVariables: {
          ARTIFACT_BUCKET: {
            value: artifactBucket.bucketName,
          },
        },
      },
    });

    // Grant permissions
    artifactBucket.grantReadWrite(lambdaBuildDeployProject);

    // Add Lambda update permissions to CodeBuild role
    lambdaBuildDeployProject.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['lambda:UpdateFunctionCode'],
      resources: [`arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:MnemosyneFileProcessor`],
    }));

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
      filterGroups: [
        codepipeline_actions.FilterGroup.create('FileProcessorFilter', {
          filters: [
            codepipeline_actions.Filter.pattern('file-processor/**/*'),
            codepipeline_actions.Filter.pattern('slack-shared/**/*'),
          ],
        }),
      ],
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
    new cdk.CfnOutput(this, 'DdbStreamPipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline for file-processor Lambda deployment with DynamoDB stream',
    });
  }
}
