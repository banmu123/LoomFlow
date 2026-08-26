import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock dependencies
vi.mock('@/lib/supabase/server', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(),
      })),
    })),
  },
}));

vi.mock('bcryptjs', () => ({
  compare: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  signJWT: vi.fn(() => 'mock-token'),
  authCookie: vi.fn(() => 'auth=mock-token'),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

describe('Login API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if username is missing', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    const request = new NextRequest('http://localhost:5000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: 'test123' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('不能为空');
  });

  it('should return 400 if password is missing', async () => {
    const { POST } = await import('@/app/api/auth/login/route');
    const request = new NextRequest('http://localhost:5000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('不能为空');
  });

  it('should return 401 if user not found', async () => {
    const { supabase } = await import('@/lib/supabase/server');
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: new Error('not found') }),
        })),
      })),
    } as ReturnType<typeof supabase.from>);

    const { POST } = await import('@/app/api/auth/login/route');
    const request = new NextRequest('http://localhost:5000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'nonexistent', password: 'test123' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toContain('用户名或密码错误');
  });

  it('should return 423 if account is locked', async () => {
    const futureTime = new Date(Date.now() + 60000).toISOString();
    const { supabase } = await import('@/lib/supabase/server');
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'user-1',
              username: 'admin',
              locked_until: futureTime,
              failed_attempts: 5,
            },
            error: null,
          }),
        })),
      })),
    } as ReturnType<typeof supabase.from>);

    const { POST } = await import('@/app/api/auth/login/route');
    const request = new NextRequest('http://localhost:5000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'test123' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(423);
    expect(data.error).toContain('锁定');
  });

  it('should return 401 if password is incorrect', async () => {
    const { supabase } = await import('@/lib/supabase/server');
    const { compare } = await import('bcryptjs');

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'user-1',
              username: 'admin',
              password_hash: 'hashed-password',
              failed_attempts: 0,
              locked_until: null,
            },
            error: null,
          }),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(),
      })),
    } as ReturnType<typeof supabase.from>);

    vi.mocked(compare).mockResolvedValue(false as never);

    const { POST } = await import('@/app/api/auth/login/route');
    const request = new NextRequest('http://localhost:5000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toContain('用户名或密码错误');
  });

  it('should return 200 with user data on successful login', async () => {
    const { supabase } = await import('@/lib/supabase/server');
    const { compare } = await import('bcryptjs');

    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'user-1',
              username: 'admin',
              display_name: 'Administrator',
              role: 'admin',
              password_hash: 'hashed-password',
              failed_attempts: 0,
              locked_until: null,
            },
            error: null,
          }),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(),
      })),
    } as ReturnType<typeof supabase.from>);

    vi.mocked(compare).mockResolvedValue(true as never);

    const { POST } = await import('@/app/api/auth/login/route');
    const request = new NextRequest('http://localhost:5000/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'correct-password' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.user).toBeDefined();
    expect(data.user.username).toBe('admin');
    expect(data.user.role).toBe('admin');
  });
});
