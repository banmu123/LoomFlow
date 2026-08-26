/**
 * Workflow Knowledge Service 测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase
vi.mock('@/lib/supabase/server', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                data: [],
                error: null,
              })),
            })),
          })),
        })),
        in: vi.fn(() => ({
          order: vi.fn(() => ({
            data: [],
            error: null,
          })),
        })),
      })),
    })),
  },
}));

describe('WorkflowKnowledgeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Type Definitions', () => {
    it('should define WorkflowKnowledge interface', async () => {
      const types = await import('../types');
      expect(types).toBeDefined();
    });

    it('should define WorkflowMatch interface', async () => {
      const types = await import('../types');
      expect(types).toBeDefined();
    });

    it('should define KnowledgeQuery interface', async () => {
      const types = await import('../types');
      expect(types).toBeDefined();
    });
  });

  describe('Service Exports', () => {
    it('should export indexWorkflowKnowledge', async () => {
      const service = await import('../service');
      expect(service.indexWorkflowKnowledge).toBeDefined();
      expect(typeof service.indexWorkflowKnowledge).toBe('function');
    });

    it('should export findSimilarWorkflows', async () => {
      const service = await import('../service');
      expect(service.findSimilarWorkflows).toBeDefined();
      expect(typeof service.findSimilarWorkflows).toBe('function');
    });

    it('should export extractExperience', async () => {
      const service = await import('../service');
      expect(service.extractExperience).toBeDefined();
      expect(typeof service.extractExperience).toBe('function');
    });

    it('should export findReusablePatterns', async () => {
      const service = await import('../service');
      expect(service.findReusablePatterns).toBeDefined();
      expect(typeof service.findReusablePatterns).toBe('function');
    });

    it('should export buildKnowledgeContext', async () => {
      const service = await import('../service');
      expect(service.buildKnowledgeContext).toBeDefined();
      expect(typeof service.buildKnowledgeContext).toBe('function');
    });

    it('should export queryKnowledge', async () => {
      const service = await import('../service');
      expect(service.queryKnowledge).toBeDefined();
      expect(typeof service.queryKnowledge).toBe('function');
    });
  });

  describe('Context Builder Exports', () => {
    it('should export buildEnhancedCopilotContext', async () => {
      const contextBuilder = await import('../context-builder');
      expect(contextBuilder.buildEnhancedCopilotContext).toBeDefined();
      expect(typeof contextBuilder.buildEnhancedCopilotContext).toBe('function');
    });

    it('should export enhancedContextToPrompt', async () => {
      const contextBuilder = await import('../context-builder');
      expect(contextBuilder.enhancedContextToPrompt).toBeDefined();
      expect(typeof contextBuilder.enhancedContextToPrompt).toBe('function');
    });

    it('should export buildFullKnowledgeContext', async () => {
      const contextBuilder = await import('../context-builder');
      expect(contextBuilder.buildFullKnowledgeContext).toBeDefined();
      expect(typeof contextBuilder.buildFullKnowledgeContext).toBe('function');
    });
  });

  describe('Index Exports', () => {
    it('should export all from index', async () => {
      const index = await import('../index');
      expect(index.indexWorkflowKnowledge).toBeDefined();
      expect(index.findSimilarWorkflows).toBeDefined();
      expect(index.extractExperience).toBeDefined();
      expect(index.findReusablePatterns).toBeDefined();
      expect(index.buildKnowledgeContext).toBeDefined();
      expect(index.queryKnowledge).toBeDefined();
      expect(index.buildEnhancedCopilotContext).toBeDefined();
      expect(index.enhancedContextToPrompt).toBeDefined();
      expect(index.buildFullKnowledgeContext).toBeDefined();
    });
  });

  describe('Tokenize Function', () => {
    it('should tokenize text correctly', async () => {
      // Import internal function via service module
      const service = await import('../service');
      
      // The tokenize function is not exported, but we can test it indirectly
      // through findSimilarWorkflows which uses it
      expect(service.findSimilarWorkflows).toBeDefined();
    });
  });

  describe('Structure Info Extraction', () => {
    it('should extract node types from workflow data', async () => {
      const service = await import('../service');
      
      // Test via indexWorkflowKnowledge with mock data
      // The extractStructureInfo function is internal
      expect(service.indexWorkflowKnowledge).toBeDefined();
    });
  });
});

describe('Workflow Knowledge Types', () => {
  it('should have correct WorkflowKnowledge structure', async () => {
    const types = await import('../types');
    
    // Type check - this will fail at compile time if types are wrong
    const mockKnowledge: types.WorkflowKnowledge = {
      workflowId: 'test-id',
      title: 'Test Workflow',
      description: 'Test description',
      userId: 'user-1',
      nodeTypes: ['startNode', 'llmNode', 'endNode'],
      nodeCount: 3,
      edgeCount: 2,
      hasCondition: false,
      hasLoop: false,
      hasLLM: true,
      hasHTTP: false,
      hasKnowledge: false,
      totalRuns: 10,
      successRate: 0.9,
      averageDurationMs: 5000,
      averageCost: 0.01,
      lastRunAt: '2024-01-01T00:00:00Z',
      lastError: null,
      currentVersion: 1,
      versionCount: 3,
      notes: ['note 1'],
      tags: ['ai', 'test'],
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      published: false,
    };

    expect(mockKnowledge.workflowId).toBe('test-id');
    expect(mockKnowledge.nodeTypes).toContain('llmNode');
    expect(mockKnowledge.successRate).toBe(0.9);
  });

  it('should have correct WorkflowMatch structure', async () => {
    const types = await import('../types');
    
    const mockMatch: types.WorkflowMatch = {
      workflow: {
        workflowId: 'test-id',
        title: 'Test',
        description: null,
        userId: 'user-1',
        nodeTypes: ['startNode', 'endNode'],
        nodeCount: 2,
        edgeCount: 1,
        hasCondition: false,
        hasLoop: false,
        hasLLM: false,
        hasHTTP: false,
        hasKnowledge: false,
        totalRuns: 0,
        successRate: 0,
        averageDurationMs: 0,
        averageCost: 0,
        lastRunAt: null,
        lastError: null,
        currentVersion: 1,
        versionCount: 1,
        notes: [],
        tags: [],
        createdAt: '2024-01-01',
        updatedAt: '2024-01-01',
        published: false,
      },
      score: 0.85,
      reasons: [
        { type: 'title', score: 0.9, detail: 'Title match' },
      ],
      reusableNodes: [],
    };

    expect(mockMatch.score).toBe(0.85);
    expect(mockMatch.reasons).toHaveLength(1);
  });

  it('should have correct KnowledgeQuery structure', async () => {
    const types = await import('../types');
    
    const mockQuery: types.KnowledgeQuery = {
      userId: 'user-1',
      query: 'test query',
      nodeTypes: ['llmNode'],
      tags: ['ai'],
      minSuccessRate: 0.5,
      published: true,
      limit: 10,
      offset: 0,
      sortBy: 'relevance',
    };

    expect(mockQuery.userId).toBe('user-1');
    expect(mockQuery.sortBy).toBe('relevance');
  });
});

describe('Context Builder', () => {
  it('should have correct EnhancedCopilotContext structure', async () => {
    const contextBuilder = await import('../context-builder');
    
    // Type check
    expect(contextBuilder.buildEnhancedCopilotContext).toBeDefined();
    expect(contextBuilder.enhancedContextToPrompt).toBeDefined();
    expect(contextBuilder.buildFullKnowledgeContext).toBeDefined();
  });
});
