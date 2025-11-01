// Slack Event API types
export interface SlackEvent {
  type: string;
  subtype?: string;
  team_id?: string;
  channel?: string;
  channel_id?: string;
  ts?: string;
  event_ts?: string;
  user?: string;
  text?: string;
  message?: SlackMessage;
  previous_message?: SlackMessage;
  deleted_ts?: string;
  edited?: {
    user: string;
    ts: string;
  };
  thread_ts?: string;
  files?: SlackFile[];
  challenge?: string;
  [key: string]: any;
}

export interface SlackMessage {
  type: string;
  subtype?: string;
  text?: string;
  user?: string;
  ts?: string;
  thread_ts?: string;
  files?: SlackFile[];
  [key: string]: any;
}

export interface SlackFile {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private?: string;
  mode?: string;
  is_external?: boolean;
  created?: number;
  user?: string;
  [key: string]: any;
}

// DynamoDB item types
export interface MessageItem {
  itemId: string;
  timestamp: string;
  type: "message";
  team_id: string;
  channel_id: string;
  ts: string;
  text?: string;
  user?: string;
  thread_ts?: string;
  parent?: string;
  files?: SlackFileMetadata[];
  files_s3?: string[];
  raw_event?: any;
  updated_ts?: string;
  deleted?: boolean;
}

export interface ChannelItem {
  itemId: string;
  timestamp: string;
  type: "channel";
  team_id: string;
  channel_id: string;
  name: string;
  names_history?: string[];
  archived?: boolean;
  deleted?: boolean;
  visibility?: "public" | "private";
  purpose?: string;
  topic?: string;
  prev_channel_id?: string;
  raw_event?: any;
}

// Whitelisted file metadata fields
export interface SlackFileMetadata {
  id: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private?: string;
  mode?: string;
  is_external?: boolean;
  created?: number;
  user?: string;
}

// Lambda event types
export interface LambdaFunctionURLRequest {
  version: string;
  routeKey: string;
  rawPath: string;
  rawQueryString: string;
  headers: { [key: string]: string };
  requestContext: {
    accountId: string;
    apiId: string;
    domainName: string;
    domainPrefix: string;
    http: {
      method: string;
      path: string;
      protocol: string;
      sourceIp: string;
      userAgent: string;
    };
    requestId: string;
    time: string;
    timeEpoch: number;
  };
  body?: string;
  isBase64Encoded: boolean;
}

export interface LambdaFunctionURLResponse {
  statusCode: number;
  headers?: { [key: string]: string };
  body?: string;
  isBase64Encoded?: boolean;
}

