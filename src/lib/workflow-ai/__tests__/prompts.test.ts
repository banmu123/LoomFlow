import { describe, it, expect } from 'vitest';
import {
  NODE_TYPES,
  JSON_FORMAT,
  PARAM_SYNTAX,
  NODE_CONFIGS,
  COMMON_PATTERNS,
  ID_NAMING,
  SELF_CHECK,
  buildSystemPrompt,
} from '../prompts';

describe('Workflow AI Prompts', () => {
  describe('Prompt Constants', () => {
    it('should define NODE_TYPES with all required node types', () => {
      expect(NODE_TYPES).toContain('startNode');
      expect(NODE_TYPES).toContain('endNode');
      expect(NODE_TYPES).toContain('llmNode');
      expect(NODE_TYPES).toContain('httpNode');
      expect(NODE_TYPES).toContain('codeNode');
      expect(NODE_TYPES).toContain('knowledgeNode');
      expect(NODE_TYPES).toContain('searchEngineNode');
      expect(NODE_TYPES).toContain('excelNode');
      expect(NODE_TYPES).toContain('templateNode');
      expect(NODE_TYPES).toContain('confirmNode');
      expect(NODE_TYPES).toContain('loopNode');
    });

    it('should define JSON_FORMAT with structure rules', () => {
      expect(JSON_FORMAT).toContain('nodes');
      expect(JSON_FORMAT).toContain('edges');
      expect(JSON_FORMAT).toContain('viewport');
      expect(JSON_FORMAT).toContain('camelCase');
    });

    it('should define PARAM_SYNTAX with reference types', () => {
      expect(PARAM_SYNTAX).toContain('{{var}}');
      expect(PARAM_SYNTAX).toContain('${nodeId.param}');
      expect(PARAM_SYNTAX).toContain('refType');
      expect(PARAM_SYNTAX).toContain('ref');
      expect(PARAM_SYNTAX).toContain('fixed');
      expect(PARAM_SYNTAX).toContain('input');
    });

    it('should define COMMON_PATTERNS with workflow patterns', () => {
      expect(COMMON_PATTERNS).toContain('start → llm → end');
      expect(COMMON_PATTERNS).toContain('start → http → end');
      expect(COMMON_PATTERNS).toContain('start → search → llm → end');
    });

    it('should define ID_NAMING conventions', () => {
      expect(ID_NAMING).toContain('node_');
      expect(ID_NAMING).toContain('e1, e2, e3');
    });

    it('should define SELF_CHECK checklist', () => {
      expect(SELF_CHECK).toContain('camelCase');
      expect(SELF_CHECK).toContain('position');
      expect(SELF_CHECK).toContain('title');
      expect(SELF_CHECK).toContain('description');
    });
  });

  describe('NODE_CONFIGS', () => {
    it('should have config for all node types', () => {
      const expectedTypes = [
        'startNode',
        'endNode',
        'llmNode',
        'httpNode',
        'codeNode',
        'searchEngineNode',
        'templateNode',
        'knowledgeNode',
        'excelNode',
        'confirmNode',
        'loopNode',
      ];

      expectedTypes.forEach(type => {
        expect(NODE_CONFIGS[type]).toBeDefined();
        expect(NODE_CONFIGS[type].length).toBeGreaterThan(0);
      });
    });

    it('should include examples in most configs', () => {
      // Some configs like knowledgeNode don't have JSON examples
      const configsWithExamples = Object.entries(NODE_CONFIGS).filter(([key]) => 
        key !== 'knowledgeNode' && key !== 'confirmNode' && key !== 'loopNode'
      );
      
      configsWithExamples.forEach(([key, config]) => {
        expect(config, `${key} should contain JSON example`).toContain('```json');
        expect(config, `${key} should contain id`).toContain('"id"');
        expect(config, `${key} should contain type`).toContain('"type"');
        expect(config, `${key} should contain data`).toContain('"data"');
      });
    });

    it('should define startNode with parameters', () => {
      expect(NODE_CONFIGS.startNode).toContain('parameters');
      expect(NODE_CONFIGS.startNode).toContain('refType');
      expect(NODE_CONFIGS.startNode).toContain('"input"');
    });

    it('should define endNode with outputDefs', () => {
      expect(NODE_CONFIGS.endNode).toContain('outputDefs');
      expect(NODE_CONFIGS.endNode).toContain('"ref"');
    });

    it('should define llmNode with model config', () => {
      expect(NODE_CONFIGS.llmNode).toContain('llmId');
      expect(NODE_CONFIGS.llmNode).toContain('systemPrompt');
      expect(NODE_CONFIGS.llmNode).toContain('userPrompt');
      expect(NODE_CONFIGS.llmNode).toContain('temperature');
      expect(NODE_CONFIGS.llmNode).toContain('outType');
    });

    it('should define httpNode with HTTP config', () => {
      expect(NODE_CONFIGS.httpNode).toContain('method');
      expect(NODE_CONFIGS.httpNode).toContain('url');
      expect(NODE_CONFIGS.httpNode).toContain('headers');
      expect(NODE_CONFIGS.httpNode).toContain('bodyType');
    });

    it('should define codeNode with code config', () => {
      expect(NODE_CONFIGS.codeNode).toContain('engine');
      expect(NODE_CONFIGS.codeNode).toContain('code');
    });
  });

  describe('buildSystemPrompt', () => {
    it('should build complete system prompt', () => {
      const prompt = buildSystemPrompt();

      expect(prompt).toContain('工作流设计专家');
      expect(prompt).toContain(NODE_TYPES);
      expect(prompt).toContain(JSON_FORMAT);
      expect(prompt).toContain(PARAM_SYNTAX);
      expect(prompt).toContain(COMMON_PATTERNS);
      expect(prompt).toContain(ID_NAMING);
      expect(prompt).toContain(SELF_CHECK);
    });

    it('should include model hints when models provided', () => {
      const models = [
        { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
        { id: 'gpt-4', label: 'GPT-4' },
      ];

      const prompt = buildSystemPrompt(models);

      expect(prompt).toContain('deepseek-v4-flash');
      expect(prompt).toContain('DeepSeek V4 Flash');
      expect(prompt).toContain('gpt-4');
      expect(prompt).toContain('GPT-4');
      expect(prompt).toContain('严禁使用列表之外的模型 ID');
    });

    it('should include search provider hints when providers provided', () => {
      const providers = [
        { id: 'tavily-main', label: 'Tavily' },
        { id: 'exa-search', label: 'Exa' },
      ];

      const prompt = buildSystemPrompt(undefined, providers);

      expect(prompt).toContain('tavily-main');
      expect(prompt).toContain('Tavily');
      expect(prompt).toContain('exa-search');
      expect(prompt).toContain('Exa');
      // The actual message is slightly different
      expect(prompt).toContain('已配置的搜索服务 ID');
    });

    it('should handle empty models list', () => {
      const prompt = buildSystemPrompt([]);

      expect(prompt).toContain('当前没有已配置的模型');
      expect(prompt).toContain('llmId 留空');
    });

    it('should handle empty providers list', () => {
      const prompt = buildSystemPrompt(undefined, []);

      expect(prompt).toContain('当前没有已配置的搜索服务');
      expect(prompt).toContain('data.engine 留空');
    });

    it('should include all node configs', () => {
      const prompt = buildSystemPrompt();

      Object.values(NODE_CONFIGS).forEach(config => {
        // Each config should be present in the prompt
        expect(prompt).toContain(config.substring(0, 50));
      });
    });

    it('should include output requirements', () => {
      const prompt = buildSystemPrompt();

      expect(prompt).toContain('直接返回 JSON');
      expect(prompt).toContain('```json 代码块');
      expect(prompt).toContain('nodes, edges, viewport');
    });
  });
});
