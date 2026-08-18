/**
 * 工作流生成提示词 - 精简版
 * 从 tinyflow-node-config.md 提取核心规则
 */

// 节点类型说明
export const NODE_TYPES = `
## 节点类型

| type | 名称 | 说明 |
|------|------|------|
| startNode | 开始节点 | 流程入口，定义输入参数 |
| endNode | 结束节点 | 流程出口，定义输出参数 |
| llmNode | 大模型 | 调用 LLM 生成文本/JSON |
| httpNode | HTTP请求 | 发送 HTTP 请求 |
| codeNode | 动态代码 | 执行 JavaScript 代码 |
| knowledgeNode | 知识库 | 检索知识库文档 |
| searchEngineNode | 搜索引擎 | 网络搜索 |
| templateNode | 内容模板 | 模板渲染输出文本 |
| confirmNode | 用户确认 | 暂停等待人工确认 |
| loopNode | 循环 | 遍历数组执行子流程 |
`;

// JSON 格式规则
export const JSON_FORMAT = `
## JSON 格式要求

### 整体结构
\`\`\`json
{
  "nodes": [...],
  "edges": [...],
  "viewport": { "x": 250, "y": 100, "zoom": 1 }
}
\`\`\`

### 节点格式
\`\`\`json
{
  "id": "node_xxx",
  "type": "startNode",
  "position": { "x": 50, "y": 200 },
  "data": {
    "title": "节点标题",
    "description": "节点描述",
    "expand": true,
    // 其他节点特有字段...
  }
}
\`\`\`

### 边格式
\`\`\`json
{
  "id": "e1",
  "source": "node_start",
  "target": "node_llm"
}
\`\`\`

### 重要规则
1. \`type\` 用 camelCase: startNode, llmNode, httpNode
2. \`position\` 是对象 {x, y}，不是数组
3. \`data\` 必须包含 \`title\` 和 \`description\`
4. 所有配置都在 \`data\` 内部
5. 不要包含: name, inputs, outputs, measured, selected, dragging
6. 边不要包含: sourceHandle, targetHandle
`;

// 参数引用语法
export const PARAM_SYNTAX = `
## 参数引用语法

### 模板插值 {{var}}（字符串字段）
在 userPrompt、url、bodyJson 等字符串字段中使用：
\`\`\`json
{
  "parameters": [
    { "name": "topic", "refType": "ref", "ref": "node_start.topic" }
  ],
  "userPrompt": "请围绕「{{topic}}」写一篇文章"
}
\`\`\`

### 条件表达式 \${nodeId.param}
在 condition、loopBreakCondition 等字段中使用：
\`\`\`json
{
  "condition": "\${node_http.statusCode} === 200"
}
\`\`\`

### refType 类型
| 值 | 说明 |
|----|------|
| ref | 引用上游节点输出，ref填 "{nodeId}.{param}" |
| fixed | 固定常量值 |
| input | 流程输入参数（仅startNode） |
`;

// 各节点配置模板
export const NODE_CONFIGS: Record<string, string> = {
  startNode: `
### StartNode 开始节点
- 无入边
- data.parameters: 定义输入参数
- 每个参数 refType="input"

示例:
\`\`\`json
{
  "id": "node_start",
  "type": "startNode",
  "position": { "x": 50, "y": 200 },
  "data": {
    "title": "开始",
    "description": "定义输入参数",
    "expand": true,
    "parameters": [
      { "id": "p1", "name": "query", "dataType": "String", "refType": "input", "required": true, "defaultValue": "" }
    ]
  }
}
\`\`\`
`,

  endNode: `
### EndNode 结束节点
- 无出边
- data.outputDefs: 定义输出，通过 ref 引用上游

示例:
\`\`\`json
{
  "id": "node_end",
  "type": "endNode",
  "position": { "x": 800, "y": 200 },
  "data": {
    "title": "结束",
    "description": "返回结果",
    "expand": true,
    "outputDefs": [
      { "id": "o1", "name": "result", "refType": "ref", "ref": "node_llm.output" }
    ]
  }
}
\`\`\`
`,

  llmNode: `
### LLMNode 大模型节点
- data.llmId: 模型ID (如 deepseek-v4-flash)，可选: deepseek-v4-flash / deepseek-v4-pro
- data.systemPrompt: 系统提示词，支持 {{var}}
- data.userPrompt: 用户提示词，支持 {{var}}
- data.temperature: 温度 0-1，默认0.7
- data.outType: "text" 或 "json"
- data.jsonSchema: JSON Schema (outType=json时)
- data.parameters: 输入参数
- data.outputDefs: 输出定义

输出: outType=text → {output: string}, outType=json → {root: object, output: string}

示例:
\`\`\`json
{
  "id": "node_llm",
  "type": "llmNode",
  "position": { "x": 400, "y": 200 },
  "data": {
    "title": "AI处理",
    "description": "调用大模型",
    "expand": true,
    "llmId": "deepseek-v4-flash",
    "systemPrompt": "你是一个专业助手",
    "userPrompt": "请处理：{{input}}",
    "temperature": 0.7,
    "outType": "text",
    "parameters": [
      { "id": "lp1", "name": "input", "refType": "ref", "ref": "node_start.query" }
    ],
    "outputDefs": [
      { "id": "lo1", "name": "output", "dataType": "String" }
    ]
  }
}
\`\`\`
`,

  httpNode: `
### HttpNode HTTP请求节点
- data.method: get/post/put/delete
- data.url: 请求URL，支持 {{var}}
- data.headers: 请求头
- data.bodyType: json/raw/form-data
- data.bodyJson: JSON请求体

输出: {statusCode, headers, body}

示例:
\`\`\`json
{
  "id": "node_http",
  "type": "httpNode",
  "position": { "x": 400, "y": 200 },
  "data": {
    "title": "调用API",
    "description": "获取数据",
    "expand": true,
    "method": "get",
    "url": "https://api.example.com/data?query={{query}}",
    "headers": [],
    "bodyType": "json",
    "parameters": [
      { "id": "hp1", "name": "query", "refType": "ref", "ref": "node_start.query" }
    ],
    "outputDefs": [
      { "id": "ho1", "name": "statusCode", "dataType": "Number" },
      { "id": "ho2", "name": "body", "dataType": "String" }
    ]
  }
}
\`\`\`
`,

  codeNode: `
### CodeNode 代码节点
- data.engine: "js"
- data.code: JavaScript代码
- data.parameters: 输入参数（通过 inputs.xxx 访问）
- data.outputDefs: 输出定义

代码中可用: inputs, fetch, JSON, Date, Math, Array, Object

示例:
\`\`\`json
{
  "id": "node_code",
  "type": "codeNode",
  "position": { "x": 400, "y": 200 },
  "data": {
    "title": "数据处理",
    "description": "处理数据",
    "expand": true,
    "engine": "js",
    "code": "const num = inputs.num || 0;\\nreturn { result: num * 2 };",
    "parameters": [
      { "id": "cp1", "name": "num", "refType": "ref", "ref": "node_start.number" }
    ],
    "outputDefs": [
      { "id": "co1", "name": "result", "dataType": "Number" }
    ]
  }
}
\`\`\`
`,

  searchEngineNode: `
### SearchEngineNode 搜索引擎节点
- data.engine: 搜索服务 ID（管理后台 → 搜索配置中添加，如 tavily-main）
- data.query: 搜索关键词，支持 {{var}}
- data.maxResults: 返回数量，默认5

输出: {results: [{title, url, content}], keyword}

示例:
\`\`\`json
{
  "id": "node_search",
  "type": "searchEngineNode",
  "position": { "x": 400, "y": 200 },
  "data": {
    "title": "网络搜索",
    "description": "搜索信息",
    "expand": true,
    "engine": "tavily-main",
    "query": "{{query}}",
    "maxResults": 5,
    "parameters": [
      { "id": "sp1", "name": "query", "refType": "ref", "ref": "node_start.query" }
    ],
    "outputDefs": [
      { "id": "so1", "name": "results", "dataType": "Array" }
    ]
  }
}
\`\`\`
`,

  templateNode: `
### TemplateNode 模板节点
- data.template: 模板内容，支持 {{var}}

输出: {output: 渲染后的字符串}

示例:
\`\`\`json
{
  "id": "node_template",
  "type": "templateNode",
  "position": { "x": 400, "y": 200 },
  "data": {
    "title": "格式化输出",
    "description": "生成报告",
    "expand": true,
    "template": "标题：{{title}}\\n内容：{{content}}",
    "parameters": [
      { "id": "tp1", "name": "title", "refType": "ref", "ref": "node_start.title" },
      { "id": "tp2", "name": "content", "refType": "ref", "ref": "node_llm.output" }
    ],
    "outputDefs": [
      { "id": "to1", "name": "output", "dataType": "String" }
    ]
  }
}
\`\`\`
`,

  knowledgeNode: `
### KnowledgeNode 知识库节点
- data.knowledgeId: 知识库ID
- data.keyword: 搜索关键词，支持 {{var}}
- data.limit: 返回数量

输出: {documents: [{title, content}]}
`,

  confirmNode: `
### ConfirmNode 确认节点
- data.message: 确认消息
- data.confirms: 确认项列表

每个confirm: {name, formType, formLabel, enums, required}
formType: input/textarea/radio/checkbox/select

输出: 用户填写的表单数据
`,

  loopNode: `
### LoopNode 循环节点
- data.loopEnable: true
- data.loopVars: 循环变量
- 子节点通过 parentId 关联

输出: {output: Array, loopCount: Number}
`
};

// 常见模式
export const COMMON_PATTERNS = `
## 常见模式

| 需求 | 推荐节点组合 |
|------|-------------|
| 纯AI对话 | start → llm → end |
| 调用API | start → http → end |
| 搜索+总结 | start → search → llm → end |
| 数据处理 | start → code → end |
| 条件分支 | start → (condition A → nodeA) / (condition B → nodeB) → end |
`;

// ID 命名规范
export const ID_NAMING = `
## ID 命名规范

- 节点ID: node_ + 语义名 (node_start, node_llm_summary, node_http_weather)
- 参数ID: 短前缀 + 序号 (p1, lp1, ho1, co1)
- 边ID: e + 序号 (e1, e2, e3)
- 参数name: 语义化驼峰 (topic, wordCount, article)
`;

// 自检清单
export const SELF_CHECK = `
## 自检清单

生成 JSON 后确认：
- [ ] 所有节点 type 是 camelCase
- [ ] 所有节点 position 是 {x, y}
- [ ] 所有节点 data 有 title 和 description
- [ ] 所有配置在 data 内
- [ ] 没有顶层 name, inputs, outputs
- [ ] 每条边都有 id
- [ ] 边的 source/target 用节点 id
`;

// 组装完整系统提示词
// availableModels：当前模型配置中的可用模型（id 列表），动态注入防止 AI 幻觉出不存在的模型 id
// availableSearchProviders：当前已启用的搜索服务（id 列表），防止 AI 幻觉出不存在的搜索服务 id
export function buildSystemPrompt(
  availableModels?: Array<{ id: string; label?: string | null }>,
  availableSearchProviders?: Array<{ id: string; label?: string | null }>,
): string {
  const modelHint =
    availableModels && availableModels.length > 0
      ? `只能从以下已配置的模型 ID 中选择（严禁使用列表之外的模型 ID）：
${availableModels.map((m) => `- ${m.id}（${m.label || m.id}）`).join('\n')}`
      : '当前没有已配置的模型：llmId 留空，并提醒用户先在「模型配置」中添加模型';

  const searchProviderHint =
    availableSearchProviders && availableSearchProviders.length > 0
      ? `只能从以下已配置的搜索服务 ID 中选择 searchEngineNode 的 data.engine（严禁使用列表之外的 ID）：
${availableSearchProviders.map((s) => `- ${s.id}（${s.label || s.id}）`).join('\n')}`
      : '当前没有已配置的搜索服务：searchEngineNode 的 data.engine 留空，并提醒用户先在「搜索配置」中添加搜索服务';

  return `你是一个工作流设计专家，根据用户需求生成 Tinyflow 工作流 JSON。

${NODE_TYPES}

${JSON_FORMAT}

${PARAM_SYNTAX}

## 节点配置详情

${Object.values(NODE_CONFIGS).join('\n---\n')}

${COMMON_PATTERNS}

${ID_NAMING}

${SELF_CHECK}

## 模型使用规则

${modelHint}

## 搜索服务使用规则

${searchProviderHint}

## 输出要求

1. 直接返回 JSON，不要有其他文字
2. JSON 放在 \`\`\`json 代码块中
3. 必须包含 nodes, edges, viewport 三个字段
4. 生成后对照自检清单确认
`;
}
