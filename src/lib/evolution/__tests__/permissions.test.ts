import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const getCurrentUser = vi.fn();
  const from = vi.fn();
  return { getCurrentUser, from };
});

vi.mock('@/lib/server-auth', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/supabase/server', () => ({
  supabase: { from: mocks.from },
}));

import { checkEvolutionAccess } from '../permissions';

function makeChain(result: { data?: { user_id: string } | null }) {
  const obj: Record<string, unknown> = {};
  ['select', 'eq', 'maybeSingle'].forEach((k) => {
    obj[k] = vi.fn(() => obj);
  });
  obj.then = (resolve: (v: unknown) => void) => {
    resolve({ data: result.data ?? null, error: null });
  };
  return obj;
}

beforeEach(() => {
  mocks.getCurrentUser.mockClear();
  mocks.from.mockClear();
});

describe('checkEvolutionAccess', () => {
  it('returns 401 when not logged in', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    const result = await checkEvolutionAccess('wf1', 'rules:read');
    expect(result.allowed).toBe(false);
    expect(result.error).toContain('未登录');
  });

  it('admin gets full access on any workflow', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'admin1', username: 'admin', role: 'admin', status: 'active' });
    const result = await checkEvolutionAccess('wf1', 'rules:write');
    expect(result.allowed).toBe(true);
    expect(result.role).toBe('admin');
    // No DB query needed for admin
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('owner gets full access on own workflow', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'u1', username: 'user1', role: 'user', status: 'active' });
    mocks.from.mockReturnValue(makeChain({ data: { user_id: 'u1' } }));
    const result = await checkEvolutionAccess('wf1', 'rules:write');
    expect(result.allowed).toBe(true);
    expect(result.role).toBe('owner');
  });

  it('non-owner gets read access (member)', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'u2', username: 'user2', role: 'user', status: 'active' });
    mocks.from.mockReturnValue(makeChain({ data: { user_id: 'u1' } }));
    const result = await checkEvolutionAccess('wf1', 'events:read');
    expect(result.allowed).toBe(true);
    expect(result.role).toBe('member');
  });

  it('non-owner denied write access', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'u2', username: 'user2', role: 'user', status: 'active' });
    mocks.from.mockReturnValue(makeChain({ data: { user_id: 'u1' } }));
    const result = await checkEvolutionAccess('wf1', 'rules:write');
    expect(result.allowed).toBe(false);
    expect(result.role).toBe('member');
    expect(result.error).toContain('无权');
  });

  it('non-owner can read proposals', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'u2', username: 'user2', role: 'user', status: 'active' });
    mocks.from.mockReturnValue(makeChain({ data: { user_id: 'u1' } }));
    const result = await checkEvolutionAccess('wf1', 'proposals:read');
    expect(result.allowed).toBe(true);
    expect(result.role).toBe('member');
  });

  it('non-owner cannot apply proposals', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'u2', username: 'user2', role: 'user', status: 'active' });
    mocks.from.mockReturnValue(makeChain({ data: { user_id: 'u1' } }));
    const result = await checkEvolutionAccess('wf1', 'proposals:write');
    expect(result.allowed).toBe(false);
    expect(result.role).toBe('member');
  });

  it('returns error when workflow not found', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'u1', username: 'user1', role: 'user', status: 'active' });
    mocks.from.mockReturnValue(makeChain({ data: null }));
    const result = await checkEvolutionAccess('wf1', 'rules:read');
    expect(result.allowed).toBe(false);
    expect(result.error).toContain('不存在');
  });

  it('owner can do all actions', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'u1', username: 'user1', role: 'user', status: 'active' });
    mocks.from.mockReturnValue(makeChain({ data: { user_id: 'u1' } }));

    const actions = ['rules:read', 'rules:write', 'events:read', 'proposals:read', 'proposals:write'] as const;
    for (const action of actions) {
      const result = await checkEvolutionAccess('wf1', action);
      expect(result.allowed).toBe(true);
    }
  });

  it('member can only read', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'u2', username: 'user2', role: 'user', status: 'active' });
    mocks.from.mockReturnValue(makeChain({ data: { user_id: 'u1' } }));

    // Read actions allowed
    for (const action of ['rules:read', 'events:read', 'proposals:read'] as const) {
      const result = await checkEvolutionAccess('wf1', action);
      expect(result.allowed).toBe(true);
    }

    // Write actions denied
    for (const action of ['rules:write', 'proposals:write'] as const) {
      const result = await checkEvolutionAccess('wf1', action);
      expect(result.allowed).toBe(false);
    }
  });
});
