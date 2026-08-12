# 工作流外部调用 API 文档

> 把 ForgeFlow 里配置的工作流发布成 HTTP API，供外部系统调用。

## 一、发布工作流

1. 登录后进入「Workflows 工作流」列表页
2. 点击工作流操作列的「发布」按钮
3. 弹出对话框显示 **API Key** 和调用示例（⚠️ Key 只显示一次，妥善保存）
4. 发布后可随时「取消发布」（Key 立即失效）或重新发布（轮换新 Key）

## 二、接口总览

所有接口都需要请求头：`Authorization: Bearer <API Key>`

| 接口 | 方法 | 用途 |
|------|------|------|
| `/api/publish/{workflowId}` | GET | 查看工作流输入参数定义 |
| `/api/publish/{workflowId}/execute` | POST | 执行工作流 |
| `/api/publish/{workflowId}/status/{flowId}` | GET | 查询执行状态/结果 |
| `/api/publish/{workflowId}/confirm/{flowId}` | POST | 提交人工确认，继续执行 |

## 三、执行工作流（同步）

短流程（无人工确认节点）直接返回最终结果：

```bash
curl -X POST https://你的域名/api/publish/{workflowId}/execute \
  -H "Authorization: Bearer ffk_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"query": "帮我写一段产品介绍"}}'
```

**成功响应：**

```json
{
  "flowId": "xxx",
  "status": "completed",
  "outputs": { "result": "..." }
}
```

**失败响应（HTTP 500）：**

```json
{ "status": "failed", "error": "节点执行错误信息" }
```

## 四、执行工作流（异步/含人工确认）

工作流包含 **Confirm 确认节点** 时，首次调用返回暂停状态：

```json
{
  "flowId": "xxx",
  "status": "paused",
  "confirmRequest": {
    "message": "请确认以下信息",
    "confirms": [ { "name": "approved", "formType": "radio", "enums": ["同意", "拒绝"] } ]
  }
}
```

外部系统随后：

```bash
# 1. 查询状态（轮询，直到 completed/failed）
curl -H "Authorization: Bearer ffk_xxxxx" \
  https://你的域名/api/publish/{workflowId}/status/{flowId}

# 2. 提交确认，流程继续执行
curl -X POST https://你的域名/api/publish/{workflowId}/confirm/{flowId} \
  -H "Authorization: Bearer ffk_xxxxx" \
  -H "Content-Type: application/json" \
  -d '{"confirmData": {"approved": "同意"}}'

# 若流程还有多个确认节点，会再次返回 paused，继续按上面步骤处理
```

## 五、查看输入参数

```bash
curl -H "Authorization: Bearer ffk_xxxxx" \
  https://你的域名/api/publish/{workflowId}
```

**响应：** 开始节点的参数定义（name / dataType / required / defaultValue / enums）

```json
{
  "id": "xxx",
  "title": "文案生成流程",
  "input_parameters": [
    { "id": "p1", "name": "query", "dataType": "String", "required": true }
  ]
}
```

## 六、错误码

| HTTP | 含义 |
|------|------|
| 401 | API Key 缺失 / 无效 / 工作流已取消发布 |
| 403 | API Key 与工作流不匹配 |
| 404 | 工作流 / 执行记录不存在 |
| 400 | 请求参数错误（如流程未处于暂停态） |
| 500 | 工作流执行失败（`error` 字段含原因） |

## 七、注意事项

1. **API Key 是工作流专属**：每个发布的工作流有独立 Key，可分别授权给不同外部系统
2. **Key 泄露**：重新发布即可轮换新 Key，旧 Key 立即失效
3. **执行资源**：外部调用与内部试运行共用 DeepSeek 模型额度
4. **输入参数**：调用前先查参数文档，`inputs` 的 key 对应开始节点的参数名
