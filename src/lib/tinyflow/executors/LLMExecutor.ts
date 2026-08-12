import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import type { ModelMessage } from 'ai';

// 创建 OpenAI 兼容 provider（与 /api/chat-ai 同款实现：优先 Ark，回退 DeepSeek 官方）
function getProvider() {
  const arkKey = process.env.ARK_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const apiKey = arkKey || deepseekKey || '';

  const baseURL = arkKey
    ? process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3'
    : process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

  return createOpenAICompatible({
    baseURL,
    apiKey,
    name: 'ai-provider',
  });
}

export class LLMExecutor extends BaseExecutor {
  constructor(paramResolver: ParameterResolver, exprEvaluator: ExpressionEvaluator) {
    super(paramResolver, exprEvaluator);
  }

  validate(node: FlowNode): string | null {
    const data = node.data as Record<string, unknown>;
    if (!data.llmId) return 'LLM 节点缺少 llmId（模型配置）';
    return null;
  }

  async execute(node: FlowNode, context: FlowContext): Promise<Record<string, unknown>> {
    const data = node.data;
    const rawModelId = String(
      data.llmId || process.env.DEEPSEEK_MODEL_ID || 'deepseek-v4-flash',
    );
    // 兜底：仅支持 deepseek-v4-flash / deepseek-v4-pro，其他一律回退 flash
    const SUPPORTED_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'];
    const modelId = SUPPORTED_MODELS.includes(rawModelId)
      ? rawModelId
      : 'deepseek-v4-flash';
    const temperature = data.temperature ?? 0.7;
    const outType = data.outType || 'text';

    // 插值 system prompt
    const systemPrompt = data.systemPrompt
      ? this.paramResolver.interpolateTemplate(data.systemPrompt, context)
      : '';

    // 插值 user prompt
    const userPrompt = data.userPrompt
      ? this.paramResolver.interpolateTemplate(data.userPrompt, context)
      : '';

    // 解析图片参数
    const images = data.images || [];
    const imageUrls: string[] = [];
    for (const img of images) {
      const resolved = this.paramResolver.resolve(img, context);
      if (typeof resolved === 'string' && resolved) {
        imageUrls.push(resolved);
      }
    }

    // 构造消息（system prompt 走 system 选项，AI SDK v7 不允许放 messages 里）
    const messages: ModelMessage[] = [];

    if (imageUrls.length > 0) {
      // 多模态：部分模型支持图片 URL（AI SDK v7 格式）
      const parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [
        { type: 'text', text: userPrompt },
      ];
      for (const url of imageUrls) {
        parts.push({ type: 'image', image: url });
      }
      messages.push({ role: 'user', content: parts });
    } else {
      messages.push({ role: 'user', content: userPrompt });
    }

    // JSON 输出模式: 在 prompt 中追加 JSON 指令
    if (outType === 'json' && data.jsonSchema) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && typeof lastMsg.content === 'string') {
        messages[messages.length - 1] = {
          role: 'user',
          content: `${lastMsg.content}\n\n请以 JSON 格式输出，遵循以下 schema:\n${data.jsonSchema}`,
        };
      }
    }

    const provider = getProvider();
    const { text } = await generateText({
      model: provider(modelId),
      messages,
      system: systemPrompt || undefined,
      temperature,
    });

    if (outType === 'json') {
      let jsonResult: unknown = {};
      try {
        jsonResult = JSON.parse(text);
      } catch {
        jsonResult = text;
      }
      return { root: jsonResult, output: text };
    }

    return { output: text };
  }
}
