import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock dependencies
vi.mock('@/lib/supabase/server', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            data: [],
            error: null,
          })),
          single: vi.fn(),
          limit: vi.fn(() => ({
            maybeSingle: vi.fn(),
          })),
        })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(),
            })),
          })),
        })),
      })),
    })),
  },
}));

vi.mock('@/lib/server-auth', () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock('@/lib/workflow-hash', () => ({
  computeHash: vi.fn(() => 'mock-hash'),
}));

describe('Workflow History API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/workflow-history', () => {
    it('should return 401 if not authenticated', async () => {
      const { getCurrentUser } = await import('@/lib/server-auth');
      vi.mocked(getCurrentUser).mockResolvedValue(null);

      const { GET } = await import('@/app/api/workflow-history/route');
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toContain('未登录');
    });

    it('should return workflows for authenticated user', async () => {
      const { getCurrentUser } = await import('@/lib/server-auth');
      const { supabase } = await import('@/lib/supabase/server');

      vi.mocked(getCurrentUser).mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        role: 'admin',
      });

      const mockWorkflows = [
        { id: 'wf-1', title: 'Test Workflow', saved: true },
        { id: 'wf-2', title: 'Another Workflow', saved: true },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: mockWorkflows, error: null }),
            })),
          })),
        })),
      } as ReturnType<typeof supabase.from>);

      const { GET } = await import('@/app/api/workflow-history/route');
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveLength(2);
      expect(data[0].title).toBe('Test Workflow');
    });

    it('should return 500 on database error', async () => {
      const { getCurrentUser } = await import('@/lib/server-auth');
      const { supabase } = await import('@/lib/supabase/server');

      vi.mocked(getCurrentUser).mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        role: 'admin',
      });

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: null, error: new Error('Database error') }),
            })),
          })),
        })),
      } as ReturnType<typeof supabase.from>);

      const { GET } = await import('@/app/api/workflow-history/route');
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Database error');
    });
  });

  describe('POST /api/workflow-history', () => {
    it('should return 401 if not authenticated', async () => {
      const { getCurrentUser } = await import('@/lib/server-auth');
      vi.mocked(getCurrentUser).mockResolvedValue(null);

      const { POST } = await import('@/app/api/workflow-history/route');
      const request = new NextRequest('http://localhost:5000/api/workflow-history', {
        method: 'POST',
        body: JSON.stringify({ data: { nodes: [] } }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toContain('未登录');
    });

    it('should return 400 if data is missing', async () => {
      const { getCurrentUser } = await import('@/lib/server-auth');
      vi.mocked(getCurrentUser).mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        role: 'admin',
      });

      const { POST } = await import('@/app/api/workflow-history/route');
      const request = new NextRequest('http://localhost:5000/api/workflow-history', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain('data 不能为空');
    });

    it('should create new workflow when no id provided', async () => {
      const { getCurrentUser } = await import('@/lib/server-auth');
      const { supabase } = await import('@/lib/supabase/server');

      vi.mocked(getCurrentUser).mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        role: 'admin',
      });

      const mockInserted = {
        id: 'new-wf-1',
        title: 'New Workflow',
        description: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        published: false,
        share_token: null,
      };

      let callCount = 0;
      vi.mocked(supabase.from).mockImplementation((() => {
        callCount++;
        if (callCount === 1) {
          // First call: insert workflow
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: mockInserted, error: null }),
              })),
            })),
          } as ReturnType<typeof supabase.from>;
        } else if (callCount === 2) {
          // Second call: get max version
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                  })),
                })),
              })),
            })),
          } as ReturnType<typeof supabase.from>;
        } else {
          // Third call: insert version
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          } as ReturnType<typeof supabase.from>;
        }
      }) as typeof supabase.from);

      const { POST } = await import('@/app/api/workflow-history/route');
      const request = new NextRequest('http://localhost:5000/api/workflow-history', {
        method: 'POST',
        body: JSON.stringify({ data: { nodes: [{ id: 'n1', type: 'startNode' }] } }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.id).toBe('new-wf-1');
      expect(data.title).toBe('New Workflow');
      expect(data.version).toBe(1);
    });

    it('should update existing workflow when id provided', async () => {
      const { getCurrentUser } = await import('@/lib/server-auth');
      const { supabase } = await import('@/lib/supabase/server');

      vi.mocked(getCurrentUser).mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        role: 'admin',
      });

      const mockExisting = {
        id: 'existing-wf-1',
        user_id: 'user-1',
        title: 'Existing Workflow',
        description: 'Old description',
      };

      const mockUpdated = {
        id: 'existing-wf-1',
        title: 'Updated Workflow',
        description: 'New description',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        published: false,
        share_token: null,
      };

      let callCount = 0;
      vi.mocked(supabase.from).mockImplementation((() => {
        callCount++;
        if (callCount === 1) {
          // First call: get existing workflow
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: mockExisting, error: null }),
              })),
            })),
          } as ReturnType<typeof supabase.from>;
        } else if (callCount === 2) {
          // Second call: update workflow
          return {
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({ data: mockUpdated, error: null }),
                })),
              })),
            })),
          } as ReturnType<typeof supabase.from>;
        } else if (callCount === 3) {
          // Third call: get max version
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({ data: { version: 1 }, error: null }),
                  })),
                })),
              })),
            })),
          } as ReturnType<typeof supabase.from>;
        } else {
          // Fourth call: insert version
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          } as ReturnType<typeof supabase.from>;
        }
      }) as typeof supabase.from);

      const { POST } = await import('@/app/api/workflow-history/route');
      const request = new NextRequest('http://localhost:5000/api/workflow-history', {
        method: 'POST',
        body: JSON.stringify({
          id: 'existing-wf-1',
          data: { nodes: [{ id: 'n1', type: 'llmNode' }] },
          title: 'Updated Workflow',
          description: 'New description',
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.id).toBe('existing-wf-1');
      expect(data.title).toBe('Updated Workflow');
      expect(data.version).toBe(2);
    });

    it('should return 404 if workflow not found', async () => {
      const { getCurrentUser } = await import('@/lib/server-auth');
      const { supabase } = await import('@/lib/supabase/server');

      vi.mocked(getCurrentUser).mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        role: 'admin',
      });

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null, error: new Error('not found') }),
          })),
        })),
      } as ReturnType<typeof supabase.from>);

      const { POST } = await import('@/app/api/workflow-history/route');
      const request = new NextRequest('http://localhost:5000/api/workflow-history', {
        method: 'POST',
        body: JSON.stringify({
          id: 'nonexistent-wf',
          data: { nodes: [] },
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toContain('工作流不存在');
    });

    it('should return 403 if user does not own workflow', async () => {
      const { getCurrentUser } = await import('@/lib/server-auth');
      const { supabase } = await import('@/lib/supabase/server');

      vi.mocked(getCurrentUser).mockResolvedValue({
        id: 'user-1',
        username: 'admin',
        role: 'admin',
      });

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'other-wf',
                user_id: 'user-2',
                title: 'Other User Workflow',
              },
              error: null,
            }),
          })),
        })),
      } as ReturnType<typeof supabase.from>);

      const { POST } = await import('@/app/api/workflow-history/route');
      const request = new NextRequest('http://localhost:5000/api/workflow-history', {
        method: 'POST',
        body: JSON.stringify({
          id: 'other-wf',
          data: { nodes: [] },
        }),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toContain('无权操作');
    });
  });
});
