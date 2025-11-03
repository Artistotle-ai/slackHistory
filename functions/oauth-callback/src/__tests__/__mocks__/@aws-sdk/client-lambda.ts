// Type declarations for @aws-sdk/client-lambda to avoid TypeScript errors in tests
export class LambdaClient {
  constructor(config?: any) {}
  send = jest.fn().mockResolvedValue({ FunctionUrl: 'https://test.lambda-url.us-east-1.on.aws' });
}

export class GetFunctionUrlConfigCommand {
  constructor(params?: any) {}
}

