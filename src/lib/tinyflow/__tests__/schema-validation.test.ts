import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateWorkflow,
  serializeWorkflow,
  migrateWorkflow,
  workflowErrorSummary,
  WORKFLOW_SCHEMA_VERSION,
} from '../schema';
import type { TinyflowData, NodeData } from '../types';
// Import builtin nodes to register them
import '../nodes/builtin';

function createNodeData(title: string, extra: Partial<NodeData> = {}): NodeData {
  return {
    title,
    description: '',
    condition: '',
    loopEnable: false,
    loopIntervalMs: '',
    maxLoopCount: '',
    loopBreakCondition: '',
    retryEnable: false,
    retryIntervalMs: '',
    maxRetryCount: '',
    resetRetryCountAfterNormal: false,
    ...extra,
  };
}

describe('Workflow Schema Validation', () => {
  const validWorkflow: TinyflowData = {
    nodes: [
      { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: createNodeData('开始') },
      { id: 'llm', type: 'llmNode', position: { x: 100, y: 0 }, data: createNodeData('LLM') },
      { id: 'end', type: 'endNode', position: { x: 200, y: 0 }, data: createNodeData('结束') },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'llm' },
      { id: 'e2', source: 'llm', target: 'end' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  describe('validateWorkflow', () => {
    it('should validate a correct workflow', () => {
      const result = validateWorkflow(validWorkflow);
      // Debug: log errors if validation fails
      if (!result.valid) {
        console.log('Validation errors:', JSON.stringify(result.errors, null, 2));
      }
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject null/undefined data', () => {
      const result = validateWorkflow(null);
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('invalid_flow');
    });

    it('should reject non-object data', () => {
      const result = validateWorkflow('string');
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('invalid_flow');
    });

    it('should require nodes array', () => {
      const invalid = { ...validWorkflow, edges: [] };
      delete (invalid as Record<string, unknown>).nodes;

      const result = validateWorkflow(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'missing_field')).toBe(true);
    });

    it('should require edges array', () => {
      const invalid = { ...validWorkflow, nodes: validWorkflow.nodes };
      delete (invalid as Record<string, unknown>).edges;

      const result = validateWorkflow(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'missing_field')).toBe(true);
    });

    it('should detect duplicate node IDs', () => {
      const invalid: TinyflowData = {
        ...validWorkflow,
        nodes: [
          { id: 'same-id', type: 'startNode', position: { x: 0, y: 0 }, data: createNodeData('Start') },
          { id: 'same-id', type: 'llmNode', position: { x: 100, y: 0 }, data: createNodeData('LLM') },
        ],
      };

      const result = validateWorkflow(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'duplicate_id')).toBe(true);
    });

    it('should require startNode', () => {
      const invalid: TinyflowData = {
        ...validWorkflow,
        nodes: validWorkflow.nodes.filter(n => n.type !== 'startNode'),
      };

      const result = validateWorkflow(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'missing_start')).toBe(true);
    });

    it('should require endNode', () => {
      const invalid: TinyflowData = {
        ...validWorkflow,
        nodes: validWorkflow.nodes.filter(n => n.type !== 'endNode'),
      };

      const result = validateWorkflow(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'missing_end')).toBe(true);
    });

    it('should enforce single startNode', () => {
      const invalid: TinyflowData = {
        ...validWorkflow,
        nodes: [
          ...validWorkflow.nodes,
          { id: 'start2', type: 'startNode', position: { x: 0, y: 100 }, data: createNodeData('Start2') },
        ],
      };

      const result = validateWorkflow(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'duplicate_start')).toBe(true);
    });

    it('should enforce single endNode', () => {
      const invalid: TinyflowData = {
        ...validWorkflow,
        nodes: [
          ...validWorkflow.nodes,
          { id: 'end2', type: 'endNode', position: { x: 200, y: 100 }, data: createNodeData('End2') },
        ],
      };

      const result = validateWorkflow(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'duplicate_end')).toBe(true);
    });

    it('should detect dangling edges', () => {
      const invalid: TinyflowData = {
        ...validWorkflow,
        edges: [
          { id: 'bad', source: 'nonexistent', target: 'llm' },
        ],
      };

      const result = validateWorkflow(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'dangling_edge')).toBe(true);
    });

    it('should detect self-loops', () => {
      const invalid: TinyflowData = {
        ...validWorkflow,
        edges: [
          { id: 'self', source: 'llm', target: 'llm' },
        ],
      };

      const result = validateWorkflow(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'self_loop')).toBe(true);
    });
  });

  describe('serializeWorkflow', () => {
    it('should add metadata to workflow', () => {
      const result = serializeWorkflow(validWorkflow, {
        title: 'Test Workflow',
        createdAt: '2024-01-01',
      });

      expect(result.metadata).toBeDefined();
      expect(result.metadata.schemaVersion).toBe(WORKFLOW_SCHEMA_VERSION);
      expect(result.metadata.title).toBe('Test Workflow');
      expect(result.metadata.createdAt).toBe('2024-01-01');
    });

    it('should preserve original data', () => {
      const result = serializeWorkflow(validWorkflow);

      expect(result.nodes).toEqual(validWorkflow.nodes);
      expect(result.edges).toEqual(validWorkflow.edges);
      expect(result.viewport).toEqual(validWorkflow.viewport);
    });

    it('should work without meta', () => {
      const result = serializeWorkflow(validWorkflow);

      expect(result.metadata.schemaVersion).toBe(WORKFLOW_SCHEMA_VERSION);
      expect(result.metadata.title).toBeUndefined();
    });
  });

  describe('migrateWorkflow', () => {
    it('should add viewport if missing', () => {
      const oldWorkflow = {
        nodes: validWorkflow.nodes,
        edges: validWorkflow.edges,
      };

      const result = migrateWorkflow(oldWorkflow);
      expect(result.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    });

    it('should preserve existing viewport', () => {
      const result = migrateWorkflow(validWorkflow);
      expect(result.viewport).toEqual(validWorkflow.viewport);
    });

    it('should handle null/undefined input', () => {
      const result = migrateWorkflow(null);
      expect(result.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    });
  });

  describe('workflowErrorSummary', () => {
    it('should return empty string for valid result', () => {
      const result = { valid: true, errors: [] };
      expect(workflowErrorSummary(result)).toBe('');
    });

    it('should join error messages', () => {
      const result = {
        valid: false,
        errors: [
          { code: 'error1', message: 'Error 1' },
          { code: 'error2', message: 'Error 2' },
        ],
      };

      expect(workflowErrorSummary(result)).toBe('Error 1；Error 2');
    });

    it('should handle single error', () => {
      const result = {
        valid: false,
        errors: [{ code: 'error', message: 'Single error' }],
      };

      expect(workflowErrorSummary(result)).toBe('Single error');
    });
  });
});
