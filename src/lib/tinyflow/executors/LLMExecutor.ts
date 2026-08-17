import type { FlowNode, FlowContext } from '../types';
import { BaseExecutor } from './BaseExecutor';
import type { ParameterResolver } from '../engine/ParameterResolver';
import type { ExpressionEvaluator } from '../engine/ExpressionEvaluator';
import { generateText } from 'ai';
import type { ModelMessage } from 'ai';

// 模型动态注册：从注册表（内置 + 用户配置合并）解析模型与 provider
import { getProviderClientForModel, hasCapability } from '@/lib/ai';
import { getAllModels } from '@/lib/ai/db-models';

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
    // llmId 由 validate() 保证非空；必须来自「模型配置」，不做默认值兜底
    const rawModelId = String(data.llmId);

    // 模型合法性完全交给 Model Registry（动态注册），不做硬编码白名单/静默回退
    // 节点 llmId 必须来自「模型配置」，未配置则明确报错（由前端下拉 / AI 生成注入保证一致性）
    const models = await getAllModels();
    const model = models.find((m) => m.id === rawModelId);
    if (!model) {
      throw new Error(
        `未知模型: ${rawModelId}，请在「模型配置」中添加该模型或修改 LLM 节点配置`,
      );
    }
    const modelId = model.id;
    const supportsVision = hasCapability(model, 'vision');

    // provider 从模型定义解析（模型级 baseURL/apiKey 优先）
    const provider = getProviderClientForModel(model);
    if (!provider) {
      throw new Error(`未知 provider: ${model.provider}（模型 ${modelId}）`);
    }

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

    if (imageUrls.length > 0 && supportsVision) {
      // 视觉模型：附带图片（AI SDK v7 格式）
      const parts: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }> = [
        { type: 'text', text: userPrompt },
      ];
      for (const url of imageUrls) {
        parts.push({ type: 'image', image: url });
      }
      messages.push({ role: 'user', content: parts });
    } else {
      // 非视觉模型或纯文本：忽略图片，仅发送文本
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

        const { text } = await generateText({
      model: provider(modelId),
      messages,
      system: systemPrompt || undefined,
      temperature,
      maxOutputTokens: Number(data.maxTokens) || 8192,
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
