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

export class PipelineDdbStreamStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineDdbStreamStackProps) {
    super(scope, id, props);

    const { appPrefix } = props;

    // Use static references to avoid cyclic dependencies
    // Resources are referenced by predictable naming patterns
    const artifactBucketName = `${appPrefix.toLowerCase()}-artifacts-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`;

    // Create references using static names
    const artifactBucket = s3.Bucket.fromBucketName(this, 'ArtifactBucket', artifactBucketName);

    // Create dedicated CI role for this pipeline stack
    const ciRole = new iam.Role(this, 'PipelineCiRole', {
      roleName: `${appPrefix}FileProcessorPipelineCiRole`,
      assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
      description: 'CI role for file processor pipeline',
    });

    // Add necessary permissions for Lambda deployment
    ciRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'lambda:*',
        'iam:*',
        's3:*',
        'cloudformation:*',
        'dynamodb:*',
        'codeconnections:UseConnection',
      ],
      resources: ['*'], // TODO: Restrict to specific resources for security
    }));

    // Create pipeline with references
    this.createPipeline(appPrefix, artifactBucket, ciRole);
  }

  private createPipeline(appPrefix: string, artifactBucket: s3.IBucket, ciRole: iam.IRole) {
    // Reference GitHub connection created in BaseRolesStack
    const githubConnectionArn = `arn:aws:codeconnections:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:connection/*`;

    // CodeBuild project for Lambda build
    const lambdaBuildProject = new codebuild.PipelineProject(this, 'LambdaBuildProject', {
      projectName: `${appPrefix}FileProcessorBuild`,
      buildSpec: codebuild.BuildSpec.fromSourceFilename('infrastructure/buildspecs/file-processor-buildspec.yml'), // TODO: Create buildspec file
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        environmentVariables: {
          ARTIFACT_BUCKET: {
            value: artifactBucket.bucketName,
          },
        },
      },
    });

    // Grant permissions
    artifactBucket.grantReadWrite(lambdaBuildProject);

    // TODO: Add Lambda update permissions to CodeBuild role

    // CodePipeline for file-processor deployment
    const pipeline = new codepipeline.Pipeline(this, 'DdbStreamPipeline', {
      pipelineName: `${appPrefix}FileProcessorPipeline`,
      artifactBucket: artifactBucket,
      role: ciRole,
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
    });

    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    });

    // Build stage
    const buildOutput = new codepipeline.Artifact('BuildOutput');
    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'Lambda_Build',
      project: lambdaBuildProject,
      input: sourceOutput,
      outputs: [buildOutput],
    });

    pipeline.addStage({
      stageName: 'Build',
      actions: [buildAction],
    });

    // Deploy stage - Lambda deployment with stream event source
    const fileProcessorFunction = lambda.Function.fromFunctionName(
      this,
      'FileProcessorFunction',
      `${appPrefix}FileProcessor` // TODO: Reference actual Lambda function
    );

    // TODO: Add DynamoDB stream event source mapping to the Lambda function
    // This should be done after Lambda deployment, or as part of the buildspec
    // const streamEventSource = new lambda_event_sources.DynamoEventSource(table, {
    //   startingPosition: lambda.StartingPosition.LATEST,
    //   filters: [/* filter for INSERT/MODIFY with files */],
    // });
    // fileProcessorFunction.addEventSource(streamEventSource);

    // TODO: Deploy stage - Lambda deployment
    // Note: LambdaDeployAction may not be available in CDK v2.221.1
    // Consider using CloudFormation or manual Lambda update in buildspec
    // const deployAction = new codepipeline_actions.LambdaDeployAction({
    //   actionName: 'Lambda_Deploy',
    //   lambda: fileProcessorFunction,
    //   input: buildOutput,
    // });

    // Temporary placeholder - remove this stage for now
    const deployAction = new codepipeline_actions.ManualApprovalAction({
      actionName: 'Manual_Approval',
    });

    pipeline.addStage({
      stageName: 'Deploy',
      actions: [deployAction],
    });

    // Output pipeline information
    new cdk.CfnOutput(this, 'DdbStreamPipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline for file-processor Lambda deployment with DynamoDB stream',
    });
  }
}
