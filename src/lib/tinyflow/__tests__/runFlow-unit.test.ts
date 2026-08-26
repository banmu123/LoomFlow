import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractFinalOutputs, traceToTokenUsage } from '../runFlow';
import type { TinyflowData } from '../types';
import type { FlowEngine } from '../engine/FlowEngine';

// Mock supabase
vi.mock('@/lib/supabase/server', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(),
          single: vi.fn(),
        })),
      })),
      insert: vi.fn(),
      update: vi.fn(() => ({
        eq: vi.fn(),
      })),
    })),
  },
}));

describe('runFlow utilities', () => {
  describe('extractFinalOutputs', () => {
    it('should extract outputs from endNode when available', () => {
      const flowData: TinyflowData = {
        nodes: [
          { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: {} },
          { id: 'llm', type: 'llmNode', position: { x: 100, y: 0 }, data: {} },
          { id: 'end', type: 'endNode', position: { x: 200, y: 0 }, data: {} },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const mockEngine = {
        getContext: () => ({
          nodeOutputs: new Map([
            ['start', {}],
            ['llm', { output: 'test' }],
            ['end', { finalResult: 'done' }],
          ]),
        }),
      } as unknown as FlowEngine;

      const result = extractFinalOutputs(flowData, mockEngine);
      expect(result).toEqual({ finalResult: 'done' });
    });

    it('should fallback to summary when endNode has no outputs', () => {
      const flowData: TinyflowData = {
        nodes: [
          { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: {} },
          { id: 'llm', type: 'llmNode', position: { x: 100, y: 0 }, data: {} },
          { id: 'end', type: 'endNode', position: { x: 200, y: 0 }, data: {} },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const mockEngine = {
        getContext: () => ({
          nodeOutputs: new Map([
            ['start', {}],
            ['llm', { output: 'test result' }],
            ['end', {}],
          ]),
        }),
      } as unknown as FlowEngine;

      const result = extractFinalOutputs(flowData, mockEngine);
      expect(result).toEqual({ llm: { output: 'test result' } });
    });

    it('should skip start and end nodes in fallback summary', () => {
      const flowData: TinyflowData = {
        nodes: [
          { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: {} },
          { id: 'http', type: 'httpNode', position: { x: 100, y: 0 }, data: {} },
          { id: 'end', type: 'endNode', position: { x: 200, y: 0 }, data: {} },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const mockEngine = {
        getContext: () => ({
          nodeOutputs: new Map([
            ['start', { input: 'test' }],
            ['http', { status: 200, data: 'response' }],
            ['end', {}],
          ]),
        }),
      } as unknown as FlowEngine;

      const result = extractFinalOutputs(flowData, mockEngine);
      expect(result).toEqual({ http: { status: 200, data: 'response' } });
      expect(result).not.toHaveProperty('start');
      expect(result).not.toHaveProperty('end');
    });

    it('should return empty object when no outputs available', () => {
      const flowData: TinyflowData = {
        nodes: [
          { id: 'start', type: 'startNode', position: { x: 0, y: 0 }, data: {} },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      const mockEngine = {
        getContext: () => ({
          nodeOutputs: new Map(),
        }),
      } as unknown as FlowEngine;

      const result = extractFinalOutputs(flowData, mockEngine);
      expect(result).toEqual({});
    });
  });

  describe('traceToTokenUsage', () => {
    it('should extract token usage from trace', () => {
      const trace = {
        tokenUsage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        },
      };

      const result = traceToTokenUsage(trace);
      expect(result).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
    });

    it('should return zeros for missing token usage', () => {
      const result = traceToTokenUsage(null);
      expect(result).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    });

    it('should handle partial token usage', () => {
      const trace = {
        tokenUsage: {
          promptTokens: 100,
        },
      };

      const result = traceToTokenUsage(trace);
      expect(result).toEqual({
        promptTokens: 100,
        completionTokens: 0,
        totalTokens: 0,
      });
    });

    it('should handle undefined trace', () => {
      const result = traceToTokenUsage(undefined);
      expect(result).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
    });

    it('should handle non-numeric values', () => {
      const trace = {
        tokenUsage: {
          promptTokens: 'invalid',
          completionTokens: null,
          totalTokens: undefined,
        },
      };

      const result = traceToTokenUsage(trace);
      // Number() converts invalid strings to NaN, null to 0, undefined to 0
      expect(result.promptTokens).toBeNaN();
      expect(result.completionTokens).toBe(0);
      expect(result.totalTokens).toBe(0);
    });
  });
});
