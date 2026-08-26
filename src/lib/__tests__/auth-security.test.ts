import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signJWT, verifyJWT, authCookie, clearAuthCookie, COOKIE_NAME, TOKEN_TTL } from '../auth';

// Mock环境变量
const originalEnv = process.env;

describe('Auth Security', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.AUTH_SECRET = 'test-secret-key-for-jwt-signing';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('JWT Signing', () => {
    it('should sign JWT with correct format', () => {
      const token = signJWT({
        uid: 'user-1',
        username: 'admin',
        role: 'admin',
      });

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      // JWT format: header.payload.signature
      const parts = token.split('.');
      expect(parts).toHaveLength(3);
    });

    it('should throw error when AUTH_SECRET is missing', async () => {
      vi.resetModules();
      process.env = { ...originalEnv };
      delete process.env.AUTH_SECRET;

      // Re-import to get fresh module
      const { signJWT: freshSignJWT } = await import('../auth');

      expect(() => freshSignJWT({
        uid: 'user-1',
        username: 'admin',
        role: 'admin',
      })).toThrow('AUTH_SECRET 未配置');
    });

    it('should include payload data in token', () => {
      const payload = {
        uid: 'user-123',
        username: 'testuser',
        role: 'user',
      };

      const token = signJWT(payload);
      const parts = token.split('.');
      const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));

      expect(body.uid).toBe('user-123');
      expect(body.username).toBe('testuser');
      expect(body.role).toBe('user');
      expect(body.exp).toBeDefined();
    });

    it('should set expiration time', () => {
      const token = signJWT({
        uid: 'user-1',
        username: 'admin',
        role: 'admin',
      });

      const parts = token.split('.');
      const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const now = Math.floor(Date.now() / 1000);

      // Default TTL is 7 days
      expect(body.exp).toBeGreaterThan(now);
      expect(body.exp).toBeLessThanOrEqual(now + TOKEN_TTL + 1);
    });
  });

  describe('JWT Verification', () => {
    it('should verify valid token', () => {
      const payload = {
        uid: 'user-1',
        username: 'admin',
        role: 'admin',
      };

      const token = signJWT(payload);
      const verified = verifyJWT(token);

      expect(verified).not.toBeNull();
      expect(verified?.uid).toBe('user-1');
      expect(verified?.username).toBe('admin');
      expect(verified?.role).toBe('admin');
    });

    it('should return null for invalid token', () => {
      expect(verifyJWT('invalid-token')).toBeNull();
      expect(verifyJWT('')).toBeNull();
      expect(verifyJWT('a.b')).toBeNull();
      expect(verifyJWT('a.b.c.d')).toBeNull();
    });

    it('should return null for tampered token', () => {
      const token = signJWT({
        uid: 'user-1',
        username: 'admin',
        role: 'admin',
      });

      // Tamper with the token
      const parts = token.split('.');
      const tamperedBody = Buffer.from(JSON.stringify({
        uid: 'hacked',
        username: 'hacker',
        role: 'admin',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url');

      const tamperedToken = `${parts[0]}.${tamperedBody}.${parts[2]}`;
      expect(verifyJWT(tamperedToken)).toBeNull();
    });

    it('should return null for expired token', () => {
      // Create token with 0 TTL (immediately expired)
      const token = signJWT(
        { uid: 'user-1', username: 'admin', role: 'admin' },
        -1, // Negative TTL = already expired
      );

      expect(verifyJWT(token)).toBeNull();
    });

    it('should return null when AUTH_SECRET is missing', async () => {
      vi.resetModules();
      process.env = { ...originalEnv };
      delete process.env.AUTH_SECRET;

      const { verifyJWT: freshVerifyJWT } = await import('../auth');

      // Even valid-looking token should fail without secret
      expect(freshVerifyJWT('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJ1c2VyLTEifQ.signature')).toBeNull();
    });
  });

  describe('Auth Cookie', () => {
    it('should generate correct cookie string', () => {
      const token = 'test-token';
      const cookie = authCookie(token);

      expect(cookie).toContain(`${COOKIE_NAME}=${token}`);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('SameSite=Lax');
    });

    it('should include Secure flag for HTTPS requests', () => {
      const token = 'test-token';
      const mockRequest = {
        headers: {
          get: (name: string) => name === 'x-forwarded-proto' ? 'https' : null,
        },
      } as unknown as Request;

      const cookie = authCookie(token, undefined, mockRequest);
      expect(cookie).toContain('Secure');
    });

    it('should not include Secure flag for HTTP requests', () => {
      const token = 'test-token';
      const mockRequest = {
        headers: {
          get: (name: string) => name === 'x-forwarded-proto' ? 'http' : null,
        },
      } as unknown as Request;

      const cookie = authCookie(token, undefined, mockRequest);
      expect(cookie).not.toContain('Secure');
    });

    it('should use custom max age', () => {
      const token = 'test-token';
      const customMaxAge = 3600; // 1 hour
      const cookie = authCookie(token, customMaxAge);

      expect(cookie).toContain(`Max-Age=${customMaxAge}`);
    });
  });

  describe('Clear Auth Cookie', () => {
    it('should return array of cookie clearing strings', () => {
      const cookies = clearAuthCookie();

      expect(Array.isArray(cookies)).toBe(true);
      expect(cookies.length).toBeGreaterThan(0);
    });

    it('should clear cookie with Max-Age=0', () => {
      const cookies = clearAuthCookie();

      cookies.forEach(cookie => {
        expect(cookie).toContain(`${COOKIE_NAME}=`);
        expect(cookie).toContain('Max-Age=0');
      });
    });

    it('should include both Secure and non-Secure variants', () => {
      const mockRequest = {
        headers: {
          get: (name: string) => name === 'x-forwarded-proto' ? 'https' : null,
        },
      } as unknown as Request;

      const cookies = clearAuthCookie(mockRequest);
      const hasSecure = cookies.some(c => c.includes('Secure'));
      const hasNonSecure = cookies.some(c => !c.includes('Secure'));

      expect(hasSecure).toBe(true);
      expect(hasNonSecure).toBe(true);
    });
  });

  describe('Constants', () => {
    it('should define COOKIE_NAME', () => {
      expect(COOKIE_NAME).toBeDefined();
      expect(typeof COOKIE_NAME).toBe('string');
    });

    it('should define TOKEN_TTL as 7 days', () => {
      expect(TOKEN_TTL).toBe(7 * 24 * 3600);
    });
  });
});
