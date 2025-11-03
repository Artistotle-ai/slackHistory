// Set environment variable before any imports
process.env.SLACK_CLIENT_ID_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:client-id';
process.env.SLACK_CLIENT_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:client-secret';
process.env.AWS_REGION = 'us-east-1';
process.env.SLACK_ARCHIVE_TABLE = 'test-table';

// Mock fetch
global.fetch = jest.fn();

// Mock shared modules
jest.mock('mnemosyne-slack-shared', () => {
  const actual = jest.requireActual('mnemosyne-slack-shared');
  return {
    ...actual,
    getValidBotToken: jest.fn(),
    getSecretValue: jest.fn(),
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    },
  };
});

describe('slack-api', () => {
  let joinAllPublicChannels: any;
  let mockFetch: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockFetch = global.fetch as jest.Mock;

    const slackApi = await import('../slack-api');
    joinAllPublicChannels = slackApi.joinAllPublicChannels;
  });

  describe('joinAllPublicChannels', () => {
    it('should join all public channels successfully', async () => {
      const botToken = 'xoxb-token-123';

      // Mock first page of channels
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'C111', name: 'channel1', is_member: false, is_archived: false },
            { id: 'C222', name: 'channel2', is_member: true, is_archived: false },
            { id: 'C333', name: 'channel3', is_member: false, is_archived: true },
          ],
          response_metadata: { next_cursor: undefined },
        }),
      });

      // Mock joinChannel calls (only for non-member, non-archived channels)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      await joinAllPublicChannels(botToken);

      // Should call conversations.list once
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // First call is conversations.list
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('https://slack.com/api/conversations.list'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: `Bearer ${botToken}`,
          }),
        })
      );
      // Second call is conversations.join for channel1
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://slack.com/api/conversations.join',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${botToken}`,
          }),
        })
      );
    });

    it('should initialize counters correctly', async () => {
      const botToken = 'xoxb-token-123';

      // Mock response with no channels (initial counters should be 0)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [],
          response_metadata: {},
        }),
      });

      await joinAllPublicChannels(botToken);

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should initialize variables at function start', async () => {
      const botToken = 'xoxb-token-123';

      // Test that variables are initialized (line 34: totalJoined = 0, totalSkipped = 0)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [],
          response_metadata: {},
        }),
      });

      await joinAllPublicChannels(botToken);

      // Verify function completes successfully with initialized variables
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle pagination', async () => {
      const botToken = 'xoxb-token-123';

      // Mock first page with cursor
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'C111', name: 'channel1', is_member: false, is_archived: false },
          ],
          response_metadata: { next_cursor: 'cursor123' },
        }),
      });

      // Mock joinChannel for first page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      // Mock second page (no cursor)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'C222', name: 'channel2', is_member: false, is_archived: false },
          ],
          response_metadata: { next_cursor: undefined },
        }),
      });

      // Mock joinChannel for second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      await joinAllPublicChannels(botToken);

      // Should call conversations.list twice (once per page) and conversations.join twice
      expect(mockFetch).toHaveBeenCalledTimes(4);
      // Second conversations.list should include cursor from first page
      const secondListCall = mockFetch.mock.calls.find((call: any[]) => 
        typeof call[0] === 'string' && call[0].includes('conversations.list') && call[0].includes('cursor')
      );
      expect(secondListCall).toBeDefined();
    });

    it('should skip already joined channels', async () => {
      const botToken = 'xoxb-token-123';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'C111', name: 'channel1', is_member: true, is_archived: false },
            { id: 'C222', name: 'channel2', is_member: false, is_archived: false },
          ],
          response_metadata: {},
        }),
      });

      // Only one join call for channel2 (channel1 is already a member)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      await joinAllPublicChannels(botToken);

      // Should only join channel2
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe('https://slack.com/api/conversations.join');
    });

    it('should skip archived channels', async () => {
      const botToken = 'xoxb-token-123';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'C111', name: 'channel1', is_member: false, is_archived: true },
            { id: 'C222', name: 'channel2', is_member: false, is_archived: false },
          ],
          response_metadata: {},
        }),
      });

      // Only one join call for channel2 (channel1 is archived)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      await joinAllPublicChannels(botToken);

      // Should only join channel2
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle join failures gracefully', async () => {
      const botToken = 'xoxb-token-123';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'C111', name: 'channel1', is_member: false, is_archived: false },
            { id: 'C222', name: 'channel2', is_member: false, is_archived: false },
          ],
          response_metadata: {},
        }),
      });

      // First join fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: false, error: 'cant_invite' }),
      });

      // Second join succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      // Should not throw, just log warnings
      await expect(joinAllPublicChannels(botToken)).resolves.not.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should handle HTTP errors from conversations.list', async () => {
      const botToken = 'xoxb-token-123';

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(joinAllPublicChannels(botToken)).rejects.toThrow(
        'Slack API returned status 500'
      );
    });

    it('should handle API errors from conversations.list', async () => {
      const botToken = 'xoxb-token-123';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'invalid_auth',
        }),
      });

      await expect(joinAllPublicChannels(botToken)).rejects.toThrow(
        'Slack API error: invalid_auth'
      );
    });

    it('should handle HTTP errors from conversations.join gracefully', async () => {
      const botToken = 'xoxb-token-123';

      // Mock successful list call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'C111', name: 'channel1', is_member: false, is_archived: false },
          ],
          response_metadata: {},
        }),
      });

      // Mock HTTP error from join call - should be caught and logged, not thrown
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      // Should not throw - errors from joinChannel are caught and logged
      await expect(joinAllPublicChannels(botToken)).resolves.not.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle API errors from conversations.join gracefully', async () => {
      const botToken = 'xoxb-token-123';

      // Mock successful list call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'C111', name: 'channel1', is_member: false, is_archived: false },
          ],
          response_metadata: {},
        }),
      });

      // Mock API error from join call - should be caught and logged, not thrown
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'channel_not_found',
        }),
      });

      // Should not throw - errors from joinChannel are caught and logged
      await expect(joinAllPublicChannels(botToken)).resolves.not.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle unknown API errors from conversations.join gracefully', async () => {
      const botToken = 'xoxb-token-123';

      // Mock successful list call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'C111', name: 'channel1', is_member: false, is_archived: false },
          ],
          response_metadata: {},
        }),
      });

      // Mock unknown error from join call - should be caught and logged, not thrown
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: false,
        }),
      });

      // Should not throw - errors from joinChannel are caught and logged
      await expect(joinAllPublicChannels(botToken)).resolves.not.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should handle pagination when cursor is undefined (line 34 edge case)', async () => {
      const botToken = 'xoxb-token-123';

      // Test when cursor starts as undefined but response_metadata.next_cursor is also undefined
      // This tests line 34 initialization and the do-while loop exit condition
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [
            { id: 'C111', name: 'channel1', is_member: false, is_archived: false },
          ],
          response_metadata: { next_cursor: undefined }, // Explicitly undefined
        }),
      });

      // Mock joinChannel call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });

      await joinAllPublicChannels(botToken);

      // Should only call once since cursor is undefined (loop exits)
      expect(mockFetch).toHaveBeenCalledTimes(2); // 1 list + 1 join
    });

    it('should handle pagination when cursor is empty string (line 34 edge case)', async () => {
      const botToken = 'xoxb-token-123';

      // Test when cursor is empty string (falsy but not undefined)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          channels: [],
          response_metadata: { next_cursor: '' }, // Empty string (falsy, loop exits)
        }),
      });

      await joinAllPublicChannels(botToken);

      // Empty string is falsy, so loop should exit after one iteration
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only list call
    });
  });
});

