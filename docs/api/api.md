# 智谱 API 精简接入文档

官方文档：https://docs.bigmodel.cn/cn/api/introduction

## 环境变量

- `ZHIPU_API_KEY`：智谱 API Key，必须存放在 `.env.local` 或部署平台的环境变量中，不要写入文档、前端代码或提交到仓库。
- `ZHIPU_BASE_URL`：智谱 API Base URL。

## 当前本地配置

- `ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4`
- `.env.local` 已被 `.gitignore` 忽略，不应提交。
- 前端代码不要直接读取 `ZHIPU_API_KEY`，模型调用应通过服务端 Route Handler 或 Server Action 转发。

## 已验证端点

### 获取模型列表

```http
GET https://open.bigmodel.cn/api/paas/v4/models
Authorization: Bearer $ZHIPU_API_KEY
```

本地测试结果：可用。

当前接口返回的模型包括：

- `glm-4.5`
- `glm-4.5-air`
- `glm-4.6`
- `glm-4.7`
- `glm-5`
- `glm-5-turbo`
- `glm-5.1`
- `glm-5.2`

### 对话补全

```http
POST https://open.bigmodel.cn/api/paas/v4/chat/completions
Authorization: Bearer $ZHIPU_API_KEY
Content-Type: application/json
```

请求示例：

```json
{
  "model": "glm-4-flash",
  "messages": [
    {
      "role": "user",
      "content": "请只回复：ok"
    }
  ],
  "stream": false
}
```

本地测试结果：可用，模型返回 `ok`。

## 备用端点观察

- `https://open.bigmodel.cn/api/coding/paas/v4/models`：模型列表接口本地测试可用。
- `https://open.bigmodel.cn/api/anthropic/models`：本地测试返回业务层 404，不作为当前首选接入端点。

## 首期产品使用建议

- 模型选择列表首期可以使用固定列表，优先从已验证模型中选择。
- Agent 对话窗口首期应真正调用模型 API。
- 后续可以增加服务端模型探测接口，用于刷新可用模型列表。
