import { verifySlackSignature, whitelistFileMetadata } from '../slack-utils';
import { SlackFile, SlackFileMetadata } from '../../config/types';

describe('slack-utils', () => {
  describe('verifySlackSignature', () => {
    const signingSecret = 'test_secret_key';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ type: 'event_callback', event: { type: 'message' } });

    // Helper to generate valid signature
    const generateSignature = (secret: string, ts: string, body: string): string => {
      const crypto = require('crypto');
      const sigBaseString = `v0:${ts}:${body}`;
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(sigBaseString);
      return `v0=${hmac.digest('hex')}`;
    };

    it('should verify valid signature', () => {
      const signature = generateSignature(signingSecret, timestamp, body);
      const isValid = verifySlackSignature(signingSecret, signature, timestamp, body);
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const invalidSignature = 'v0=' + 'a'.repeat(64); // Valid format but wrong signature
      const isValid = verifySlackSignature(signingSecret, invalidSignature, timestamp, body);
      expect(isValid).toBe(false);
    });

    it('should reject signature with wrong secret', () => {
      const signature = generateSignature(signingSecret, timestamp, body);
      const wrongSecret = 'wrong_secret';
      const isValid = verifySlackSignature(wrongSecret, signature, timestamp, body);
      expect(isValid).toBe(false);
    });

    it('should reject old requests (replay attack)', () => {
      const oldTimestamp = (Math.floor(Date.now() / 1000) - 700).toString(); // 11+ minutes ago
      const signature = generateSignature(signingSecret, oldTimestamp, body);
      const isValid = verifySlackSignature(signingSecret, signature, oldTimestamp, body);
      expect(isValid).toBe(false);
    });

    it('should accept recent requests (within 10 minutes)', () => {
      const recentTimestamp = (Math.floor(Date.now() / 1000) - 300).toString(); // 5 minutes ago
      const signature = generateSignature(signingSecret, recentTimestamp, body);
      const isValid = verifySlackSignature(signingSecret, signature, recentTimestamp, body);
      expect(isValid).toBe(true);
    });

    it('should reject future timestamps', () => {
      const futureTimestamp = (Math.floor(Date.now() / 1000) + 601).toString(); // 601 seconds (>10 minutes) in future
      const signature = generateSignature(signingSecret, futureTimestamp, body);
      // Future timestamps are rejected because they're more than 10 minutes different from current time
      const isValid = verifySlackSignature(signingSecret, signature, futureTimestamp, body);
      expect(isValid).toBe(false); // Should be false because future timestamp is > 10 minutes away
    });
  });

  describe('whitelistFileMetadata', () => {
    it('should include all whitelisted fields', () => {
      const file: SlackFile = {
        id: 'F123456',
        name: 'test.pdf',
        title: 'Test Document',
        mimetype: 'application/pdf',
        filetype: 'pdf',
        size: 1024,
        url_private: 'https://files.slack.com/files/test.pdf',
        mode: 'hosted',
        is_external: false,
        created: 1234567890,
        user: 'U123456',
      };

      const result = whitelistFileMetadata(file);
      expect(result).toEqual({
        id: 'F123456',
        name: 'test.pdf',
        title: 'Test Document',
        mimetype: 'application/pdf',
        filetype: 'pdf',
        size: 1024,
        url_private: 'https://files.slack.com/files/test.pdf',
        mode: 'hosted',
        is_external: false,
        created: 1234567890,
        user: 'U123456',
      });
    });

    it('should exclude undefined fields', () => {
      const file: SlackFile = {
        id: 'F123456',
        // name is undefined
        title: 'Test Document',
        // mimetype is undefined
      };

      const result = whitelistFileMetadata(file);
      expect(result).toEqual({
        id: 'F123456',
        title: 'Test Document',
      });
      expect(result).not.toHaveProperty('name');
      expect(result).not.toHaveProperty('mimetype');
    });

    it('should handle minimal file object', () => {
      const file: SlackFile = {
        id: 'F123456',
      };

      const result = whitelistFileMetadata(file);
      expect(result).toEqual({
        id: 'F123456',
      });
    });
  });
});

