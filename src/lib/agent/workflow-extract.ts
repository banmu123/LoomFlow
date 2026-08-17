// 从 AI 回复中提取工作流 JSON：
// 提取 ```json 代码块并判断是否为工作流结构（{ nodes, edges }）
// 独立成纯函数便于单元测试（对话页 ChatPanel 引用）
export interface ExtractedWorkflow {
  nodes: unknown[];
  edges: unknown[];
  [key: string]: unknown;
}

export function extractWorkflowJson(content: string): ExtractedWorkflow | null {
  if (!content) return null;
  // 提取 ```json 或 ``` 代码块（取第一个）
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[1].trim()) as {
      nodes?: unknown;
      edges?: unknown;
    };
    if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      return parsed as ExtractedWorkflow;
    }
    return null;
  } catch {
    return null;
  }
}
