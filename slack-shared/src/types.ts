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

// Strict event type discriminated unions
export type StrictSlackEvent =
  | UrlVerificationEvent
  | MessageEvent
  | MessageChangedEvent
  | MessageDeletedEvent
  | ChannelCreatedEvent
  | ChannelRenameEvent
  | ChannelDeletedEvent
  | ChannelArchiveEvent
  | ChannelUnarchiveEvent
  | ChannelIdChangedEvent
  | ChannelPurposeEvent
  | ChannelTopicEvent
  | ChannelConvertToPrivateEvent
  | ChannelConvertToPublicEvent
  | UnknownEvent;

export interface UrlVerificationEvent {
  type: "url_verification";
  challenge: string;
  token?: string;
}

export interface BaseEvent {
  type: string;
  team_id: string;
  event_ts?: string;
}

export interface MessageEvent extends BaseEvent {
  type: "message";
  subtype?: string;
  channel: string;
  channel_id?: string;
  ts: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  files?: SlackFile[];
}

export interface MessageChangedEvent extends BaseEvent {
  type: "message";
  subtype: "message_changed";
  channel: string;
  channel_id?: string;
  message: SlackMessage;
  previous_message?: SlackMessage;
  edited?: {
    user: string;
    ts: string;
  };
}

export interface MessageDeletedEvent extends BaseEvent {
  type: "message";
  subtype: "message_deleted";
  channel: string;
  channel_id?: string;
  deleted_ts: string;
  ts?: string;
}

export interface ChannelCreatedEvent extends BaseEvent {
  type: "channel_created";
  channel: {
    id: string;
    name: string;
    is_private?: boolean;
  };
}

export interface ChannelRenameEvent extends BaseEvent {
  type: "channel_rename";
  channel: {
    id: string;
    name: string;
  };
}

export interface ChannelDeletedEvent extends BaseEvent {
  type: "channel_deleted";
  channel: string;
}

export interface ChannelArchiveEvent extends BaseEvent {
  type: "channel_archive";
  channel: string;
  user: string;
}

export interface ChannelUnarchiveEvent extends BaseEvent {
  type: "channel_unarchive";
  channel: string;
  user: string;
}

export interface ChannelIdChangedEvent extends BaseEvent {
  type: "channel_id_changed";
  channel: string;
  previous_channel?: string;
}

export interface ChannelPurposeEvent extends BaseEvent {
  type: "channel_purpose";
  channel: string;
  purpose?: string;
}

export interface ChannelTopicEvent extends BaseEvent {
  type: "channel_topic";
  channel: string;
  topic?: string;
}

export interface ChannelConvertToPrivateEvent extends BaseEvent {
  type: "channel_convert_to_private";
  channel: string;
}

export interface ChannelConvertToPublicEvent extends BaseEvent {
  type: "channel_convert_to_public";
  channel: string;
}

export interface UnknownEvent {
  type: string;
  [key: string]: unknown;
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

