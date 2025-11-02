const TOKEN_CACHE_PREFIX = "oauth_token:";
const REFRESH_CACHE_PREFIX = "token_refresh:";
const TOKEN_DEFAULT_TTL = 600; //5 minutes
const TOKEN_REFRESHINTERVALL = 43200; //the slack token refresh interval is  every 12 hours
const TOKEN_REFRESH_BUFFER = TOKEN_REFRESHINTERVALL/3; //refresh 1/3 of the interval before expiry only used if ttl is not set
/**
 * DynamoDB sort key maximum size is 1024 bytes
 */
const DYNAMU_MAX_KEY_LENGTH_BYTES = 1024;
/**
 * Cache key prefix for secrets
 */
const SECRET_CACHE_PREFIX = "secret:";
/**
 * Cache TTL for secrets (1 hour in seconds)
 * Secrets rarely change, so we cache them for a longer period
 */
const SECRET_CACHE_TTL = 3600; // 1 hour

export {
  SECRET_CACHE_PREFIX,
  SECRET_CACHE_TTL,
  TOKEN_CACHE_PREFIX,
  REFRESH_CACHE_PREFIX,
  TOKEN_DEFAULT_TTL,
  TOKEN_REFRESHINTERVALL,
  TOKEN_REFRESH_BUFFER,
  DYNAMU_MAX_KEY_LENGTH_BYTES,
};