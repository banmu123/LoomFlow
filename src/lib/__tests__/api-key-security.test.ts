import { describe, it, expect, vi } from 'vitest';
import { hashApiKey } from '../api-key';

// Mock supabase
vi.mock('@/lib/supabase/server', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(),
        })),
      })),
      insert: vi.fn(),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(),
          })),
        })),
      })),
    })),
  },
}));

describe('API Key Security', () => {
  describe('hashApiKey', () => {
    it('should generate consistent hash for same input', () => {
      const key = 'ffk_test_api_key_12345';
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);

      expect(hash1).toBe(hash2);
    });

    it('should generate different hash for different inputs', () => {
      const hash1 = hashApiKey('key1');
      const hash2 = hashApiKey('key2');

      expect(hash1).not.toBe(hash2);
    });

    it('should produce hex string of correct length', () => {
      const hash = hashApiKey('test');
      // SHA-256 produces 32 bytes = 64 hex characters
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should handle empty string', () => {
      const hash = hashApiKey('');
      expect(hash).toHaveLength(64);
    });

    it('should handle special characters', () => {
      const hash = hashApiKey('ffk_!@#$%^&*()_+{}|:<>?');
      expect(hash).toHaveLength(64);
    });
  });
});
