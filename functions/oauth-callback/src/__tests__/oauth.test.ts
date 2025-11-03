import { exchangeCodeForTokens, createOAuthTokenItem } from '../oauth';

// Mock fetch
global.fetch = jest.fn() as jest.Mock;

describe('oauth', () => {
  const mockFetch = global.fetch as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1609459200000); // 2021-01-01 00:00:00 UTC
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('exchangeCodeForTokens', () => {
    it('should exchange code for tokens successfully', async () => {
      const oauthResponse = {
        ok: true,
        access_token: 'xoxb-token-123',
        token_type: 'bot',
        scope: 'channels:read,chat:write',
        bot_user_id: 'U123456',
        team: {
          id: 'T123',
          name: 'Test Team',
        },
        authed_user: {
          id: 'U789',
        },
        expires_in: 3600,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => oauthResponse,
      });

      const result = await exchangeCodeForTokens(
        'test-code-123',
        'client-id',
        'client-secret',
        'https://example.com/oauth/callback'
      );

      expect(result).toEqual(oauthResponse);
      expect(mockFetch).toHaveBeenCalledWith('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: expect.any(URLSearchParams),
      });

      const body = mockFetch.mock.calls[0][1].body as URLSearchParams;
      expect(body.get('code')).toBe('test-code-123');
      expect(body.get('client_id')).toBe('client-id');
      expect(body.get('client_secret')).toBe('client-secret');
      expect(body.get('redirect_uri')).toBe('https://example.com/oauth/callback');
    });

    it('should throw error if response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(
        exchangeCodeForTokens('test-code', 'client-id', 'client-secret', 'redirect-uri')
      ).rejects.toThrow('Slack OAuth API returned status 500');
    });

    it('should throw error if OAuth response is not ok', async () => {
      const oauthResponse = {
        ok: false,
        error: 'invalid_code',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => oauthResponse,
      });

      await expect(
        exchangeCodeForTokens('test-code', 'client-id', 'client-secret', 'redirect-uri')
      ).rejects.toThrow('Slack OAuth error: invalid_code');
    });

    it('should handle unknown OAuth errors', async () => {
      const oauthResponse = {
        ok: false,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => oauthResponse,
      });

      await expect(
        exchangeCodeForTokens('test-code', 'client-id', 'client-secret', 'redirect-uri')
      ).rejects.toThrow('Slack OAuth error: Unknown error');
    });

    it('should handle fetch errors', async () => {
      const fetchError = new Error('Network error');
      mockFetch.mockRejectedValue(fetchError);

      await expect(
        exchangeCodeForTokens('test-code', 'client-id', 'client-secret', 'redirect-uri')
      ).rejects.toThrow('Network error');
    });
  });

  describe('createOAuthTokenItem', () => {
    it('should create OAuth token item successfully', () => {
      const oauthResponse = {
        ok: true,
        access_token: 'xoxb-token-123',
        refresh_token: 'xoxe-token-456',
        scope: 'channels:read',
        bot_user_id: 'U123456',
        expires_in: 3600,
        team: {
          id: 'T123',
          name: 'Test Team',
        },
      };

      const tokenItem = createOAuthTokenItem(oauthResponse);

      expect(tokenItem.itemId).toBe('oauth#T123');
      expect(tokenItem.timestamp).toBe('1');
      expect(tokenItem.bot_token).toBe('xoxb-token-123');
      expect(tokenItem.refresh_token).toBe('xoxe-token-456');
      expect(tokenItem.scope).toBe('channels:read');
      expect(tokenItem.bot_user_id).toBe('U123456');
      expect(tokenItem.team_id).toBe('T123');
      expect(tokenItem.team_name).toBe('Test Team');
      expect(tokenItem.expires_at).toBe(Math.floor(Date.now() / 1000) + 3600);
      expect(tokenItem.ttlSeconds).toBe(3600);
      expect(tokenItem.isCachable).toBe(true);
      expect(tokenItem.getTtlSeconds()).toBe(3600);
    });

    it('should handle missing expires_in', () => {
      const oauthResponse = {
        ok: true,
        access_token: 'xoxb-token-123',
        team: {
          id: 'T123',
          name: 'Test Team',
        },
      };

      const tokenItem = createOAuthTokenItem(oauthResponse);

      expect(tokenItem.expires_at).toBe(Infinity);
      expect(tokenItem.ttlSeconds).toBe(Infinity);
      expect(tokenItem.getTtlSeconds()).toBe(Infinity);
    });

    it('should throw error if access_token is missing', () => {
      const oauthResponse = {
        ok: true,
        team: {
          id: 'T123',
          name: 'Test Team',
        },
      };

      expect(() => createOAuthTokenItem(oauthResponse)).toThrow(
        'Missing access_token in OAuth response'
      );
    });

    it('should throw error if team.id is missing', () => {
      const oauthResponse = {
        ok: true,
        access_token: 'xoxb-token-123',
        team: {
          id: '',
          name: 'Test Team',
        },
      };

      expect(() => createOAuthTokenItem(oauthResponse)).toThrow(
        'Missing team.id in OAuth response'
      );
    });

    it('should throw error if team is missing', () => {
      const oauthResponse = {
        ok: true,
        access_token: 'xoxb-token-123',
      };

      expect(() => createOAuthTokenItem(oauthResponse)).toThrow(
        'Missing team.id in OAuth response'
      );
    });

    it('should handle refresh_token being undefined', () => {
      const oauthResponse = {
        ok: true,
        access_token: 'xoxb-token-123',
        expires_in: 3600,
        team: {
          id: 'T123',
          name: 'Test Team',
        },
      };

      const tokenItem = createOAuthTokenItem(oauthResponse);

      expect(tokenItem.refresh_token).toBeUndefined();
    });
  });
});

