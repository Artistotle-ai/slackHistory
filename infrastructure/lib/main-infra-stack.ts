import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambda_event_sources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { BaseRolesStack } from './base-roles-stack';

export interface MainInfraStackProps extends cdk.StackProps {
  appPrefix: string;
}

/**
 * MainInfraStack - Core application infrastructure
 * 
 * Deploys the primary Slack archiving resources:
 * - DynamoDB single-table for messages, channels, and metadata
 * - Global Secondary Index for efficient thread retrieval
 * - S3 bucket for Slack file storage
 * - Lambda function (message-listener) with Function URL for Slack Events API
 * - Lambda function (file-processor) for DynamoDB stream processing
 * - IAM roles and permissions for Lambda execution
 */
export class MainInfraStack extends cdk.Stack {
  public readonly slackArchiveTable: dynamodb.Table;
  public readonly slackFilesBucket: s3.Bucket;
  public readonly messageListenerFunction: lambda.Function;
  public readonly fileProcessorFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: MainInfraStackProps) {
    super(scope, id, props);

    const { appPrefix } = props;

    // DynamoDB single table for Slack Archive
    this.slackArchiveTable = new dynamodb.Table(this, 'SlackArchiveTable', {
      tableName: `${appPrefix}SlackArchive`,
      partitionKey: {
        name: 'itemId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // TODO: Change to RETAIN for production
      // Enable DynamoDB stream for file-processor Lambda (NEW_AND_OLD_IMAGES for ChannelIndex updates)
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      //  point-in-time recovery is disabled to avoid costs, it is not needed for this project)
    });

    // GSI for thread retrieval (sparse index)
    this.slackArchiveTable.addGlobalSecondaryIndex({
      indexName: 'ThreadIndex',
      partitionKey: {
        name: 'parent',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // S3 bucket for Slack files
    this.slackFilesBucket = new s3.Bucket(this, 'SlackFilesBucket', {
      bucketName: `${appPrefix.toLowerCase()}-slack-files-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false, // Disabled to reduce costs - archived files don't need versioning
      lifecycleRules: [
        {
          id: 'TransitionToIA',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90), // Files > 90 days old
            },
          ],
        },
      ],
    });

    // Lambda execution role with necessary permissions
    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      roleName: `${appPrefix}LambdaExecutionRole`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    // Add basic Lambda execution permissions
    lambdaExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // Add DynamoDB permissions
    this.slackArchiveTable.grantReadWriteData(lambdaExecutionRole);

    // Add S3 permissions
    this.slackFilesBucket.grantReadWrite(lambdaExecutionRole);

    // Add Secrets Manager read permissions for Slack secrets
    lambdaExecutionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:${appPrefix}/slack/*`,
        ],
      })
    );

    // OAuth callback Lambda execution role (separate, needs DynamoDB write)
    const oauthLambdaRole = new iam.Role(this, 'OAuthLambdaExecutionRole', {
      roleName: `${appPrefix}OAuthLambdaExecutionRole`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    oauthLambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // DynamoDB write for OAuth tokens
    this.slackArchiveTable.grantWriteData(oauthLambdaRole);

    // Secrets Manager read for OAuth credentials
    oauthLambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:${appPrefix}/slack/*`,
        ],
      })
    );

    // Explicit LogGroups for Lambda functions with 7-day retention
    const messageListenerLogGroup = new logs.LogGroup(this, 'MessageListenerLogGroup', {
      logGroupName: `/aws/lambda/${appPrefix}MessageListener`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const fileProcessorLogGroup = new logs.LogGroup(this, 'FileProcessorLogGroup', {
      logGroupName: `/aws/lambda/${appPrefix}FileProcessor`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const oauthCallbackLogGroup = new logs.LogGroup(this, 'OAuthCallbackLogGroup', {
      logGroupName: `/aws/lambda/${appPrefix}OAuthCallback`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Dead Letter Queue for message-listener Lambda (DynamoDB write errors)
    const messageListenerDlq = new sqs.Queue(this, 'MessageListenerDLQ', {
      queueName: `${appPrefix}MessageListenerDLQ`,
      retentionPeriod: cdk.Duration.days(14), // Retain failed messages for 14 days
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Message listener Lambda function
    // Code is deployed ONLY via pipeline - using placeholder inline code for initial creation
    this.messageListenerFunction = new lambda.Function(this, 'MessageListenerFunction', {
      functionName: `${appPrefix}MessageListener`,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      // Placeholder code - actual code deployed via pipeline only
      code: lambda.Code.fromInline('exports.handler = async () => ({ statusCode: 503, body: "Lambda not deployed via pipeline" });'),
      handler: 'index.handler',
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      deadLetterQueue: messageListenerDlq, // DLQ for DynamoDB write errors
      environment: {
        SLACK_ARCHIVE_TABLE: this.slackArchiveTable.tableName,
        // Import secret ARN from BaseRolesStack exports (deployed first)
        SLACK_SIGNING_SECRET_ARN: cdk.Fn.importValue(`${appPrefix}SlackSigningSecretArn`),
        // AWS_REGION is automatically provided by Lambda runtime - do not set manually
      },
      description: 'Deployed via CodePipeline only - do not update manually',
    });

    // Function URL for Slack Events API
    const messageListenerUrl = this.messageListenerFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // Public endpoint
      cors: {
        allowedOrigins: ['*'], // TODO: Restrict to Slack domains for security
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['*'],
      },
    });

    // File processor Lambda function (triggered by DynamoDB stream)
    // TODO: File processor is not yet implemented - using placeholder inline code for initial creation
    // Actual code will be deployed via pipeline when file-processor is implemented
    this.fileProcessorFunction = new lambda.Function(this, 'FileProcessorFunction', {
      functionName: `${appPrefix}FileProcessor`,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      // Placeholder code - actual code deployed via pipeline only
      code: lambda.Code.fromInline('exports.handler = async () => ({ statusCode: 503, body: "Lambda not deployed via pipeline" });'),
      handler: 'index.handler',
      role: lambdaExecutionRole,
      timeout: cdk.Duration.minutes(5), // Longer timeout for file processing
      memorySize: 512,
      maxEventAge: cdk.Duration.minutes(6), // Max age of event before discarding
      retryAttempts: 2, // Retry failed invocations
      environment: {
        SLACK_ARCHIVE_TABLE: this.slackArchiveTable.tableName,
        SLACK_FILES_BUCKET: this.slackFilesBucket.bucketName,
        // Import secret ARNs from BaseRolesStack exports (deployed first)
        SLACK_CLIENT_ID_ARN: cdk.Fn.importValue(`${appPrefix}SlackClientIdSecretArn`),
        SLACK_CLIENT_SECRET_ARN: cdk.Fn.importValue(`${appPrefix}SlackClientSecretArn`),
        // Bot token retrieved from DynamoDB (stored via OAuth callback)
        // AWS_REGION is automatically provided by Lambda runtime - do not set manually
      },
      description: 'Deployed via CodePipeline only - do not update manually',
    });

    // DynamoDB stream event source mapping for file processor
    this.fileProcessorFunction.addEventSource(
      new lambda_event_sources.DynamoEventSource(this.slackArchiveTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10, // Process up to 10 records per invocation
        bisectBatchOnError: true, // Split batch on error for retry
        maxBatchingWindow: cdk.Duration.seconds(5), // Wait up to 5s to batch records
        reportBatchItemFailures: true, // Report individual failures
      })
    );

    // OAuth callback Lambda function
    const oauthCallbackFunction = new lambda.Function(this, 'OAuthCallbackFunction', {
      functionName: `${appPrefix}OAuthCallback`,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      code: lambda.Code.fromInline('exports.handler = async () => ({ statusCode: 503, body: "Lambda not deployed via pipeline" });'),
      handler: 'index.handler',
      role: oauthLambdaRole,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        SLACK_ARCHIVE_TABLE: this.slackArchiveTable.tableName,
        SLACK_CLIENT_ID_ARN: cdk.Fn.importValue(`${appPrefix}SlackClientIdSecretArn`),
        SLACK_CLIENT_SECRET_ARN: cdk.Fn.importValue(`${appPrefix}SlackClientSecretArn`),
        // REDIRECT_URI will be the function's own URL - Lambda can construct it from AWS_LAMBDA_FUNCTION_NAME
        // Or it can be provided via Secrets Manager if needed
      },
      description: 'Deployed via CodePipeline only - do not update manually',
    });

    // Function URL for OAuth callback
    const oauthCallbackUrl = oauthCallbackFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // Output important resources
    new cdk.CfnOutput(this, 'SlackArchiveTableName', {
      value: this.slackArchiveTable.tableName,
      description: 'DynamoDB table for Slack archive data',
    });

    new cdk.CfnOutput(this, 'SlackFilesBucketName', {
      value: this.slackFilesBucket.bucketName,
      description: 'S3 bucket for Slack files',
    });

    new cdk.CfnOutput(this, 'MessageListenerFunctionUrl', {
      value: messageListenerUrl.url,
      description: 'Function URL for Slack Events API webhook',
    });

    new cdk.CfnOutput(this, 'FileProcessorFunctionName', {
      value: this.fileProcessorFunction.functionName,
      description: 'Lambda function for processing file attachments',
    });

    new cdk.CfnOutput(this, 'OAuthCallbackFunctionUrl', {
      value: oauthCallbackUrl.url,
      description: 'Function URL for Slack OAuth callback',
    });
  }
}
