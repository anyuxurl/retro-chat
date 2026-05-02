# RetroChat

> 一个能在 iPhone 5s 上跑的 AI 聊天客户端。

RetroChat 是面向**老旧设备**的网页 AI 聊天应用。它的核心目标是在 iPhone 5s（iOS 12 / Safari 12）这类 10 年前的设备上仍能流畅使用。默认接入小米 `xiaomi-mimo-v2.5-pro` 模型，并允许用户自定义任意 OpenAI 兼容 endpoint。

## 特点

- **极致兼容性**：原生 ES5 + jQuery slim，全部 Flexbox 布局，避免 ReadableStream / 可选链 / CSS Grid 等老 Safari 不支持的特性
- **流式响应**：通过 XHR `onprogress` 增量读取 `responseText` 实现 SSE 流式输出，无需 ReadableStream
- **零后端存储**：会话和密钥仅存在浏览器 localStorage，可一键导入/导出 JSON
- **多模型支持**：内置小米 MiMo、DeepSeek、Qwen、Kimi、本地 Ollama 等预设；任意 OpenAI 兼容 API 都能用
- **复古主题**：CRT 绿屏 / 老 Mac 灰白 双主题切换
- **Vercel 一键部署**：一个 Serverless Function 做 SSE 代理，前端纯静态

## 项目结构

```
retro-chat/
├── index.html
├── css/style.css
├── js/
│   ├── storage.js   # localStorage 封装
│   ├── stream.js    # XHR 流式读取
│   ├── chat.js      # 消息渲染与会话管理
│   ├── settings.js  # 设置面板
│   └── app.js       # 入口
├── api/
│   └── chat.js      # Vercel Serverless Function — SSE 代理
├── vercel.json
└── package.json
```

## 本地开发

```bash
# 1) 复制环境变量模板，填入你的 mimo Base URL 和 Key
cp .env.example .env.local
# 编辑 .env.local，填上 MIMO_BASE_URL 和 MIMO_API_KEY

# 2) 启动本地服务（无需安装依赖，纯 Node.js）
npm run dev
# 等价于：node dev-server.js

# 3) 浏览器访问
open http://localhost:3000
```

设置面板里 **Base URL** 和 **API Key** 留空即可，请求会自动用 `.env.local` 里的值。

## 部署到 Vercel

```bash
# 用 Vercel CLI
npm i -g vercel
vercel deploy --prod
```

或直接把仓库连到 Vercel Dashboard，自动部署。

**关键：在 Vercel Dashboard 配置环境变量**

进入项目 → Settings → Environment Variables，添加：

| Name | Value | Environments |
|---|---|---|
| `MIMO_BASE_URL` | `https://token-plan-cn.xiaomimimo.com/v1` | Production, Preview, Development |
| `MIMO_API_KEY` | `tp-...` (你的 mimo key) | Production, Preview, Development |

⚠️ **不要**把 API Key 写进前端代码或 commit 到 git —— 它会暴露在 bundle 里被任何人查看。

Vercel 会自动：
- 把仓库根作为静态资源
- 把 `api/chat.js` 部署为 Serverless Function
- 把环境变量注入到 Function 运行时
- 透传 SSE 流（已在 `vercel.json` 关闭缓存）

> **注意**：Hobby 套餐 Function 单次响应上限 10 秒。如果你的模型响应较长，建议 Pro 套餐（60s）或在客户端设置 `maxTokens` 上限。

## 凭据优先级

后端 `api/chat.js` 按以下顺序选用上游凭据：

1. **请求体里的 baseUrl + apiKey**（用户在设置面板填的）
2. **环境变量** `MIMO_BASE_URL` + `MIMO_API_KEY`（兜底默认）
3. 都没有 → 返回 400 错误

注意：要么两个都用用户的，要么两个都用环境变量的 —— 不会混搭。如果用户只填了 baseUrl 没填 apiKey（或反之），前端会高亮报错让用户补全。

## 使用其他模型

设置面板里有快速预设（**MiMo / DeepSeek / Custom**）。选 DeepSeek 或 Custom 时**必须**同时填入你自己的 Base URL 和 API Key —— 服务器环境变量只兜底 mimo。

任何符合 OpenAI Chat Completions 协议（`POST /v1/chat/completions` + `stream:true` SSE 输出）的服务都能用，包括：

- DeepSeek `https://api.deepseek.com`
- 通义 / DashScope `https://dashscope.aliyuncs.com/compatible-mode`
- Moonshot / Kimi `https://api.moonshot.cn`
- 本地 Ollama `http://127.0.0.1:11434`

## 老设备兼容性测试

- **桌面 Safari 模拟**：菜单栏 Develop → User Agent → Safari iOS 12
- **真机**：iPhone 5s 升级到 iOS 12.5.7 后访问 Vercel preview URL
- **iOS 模拟器**：Xcode → Window → Devices and Simulators，下载 iOS 12 runtime

## 数据导出 / 导入

设置面板底部有 **Export JSON** / **Import JSON** 按钮，可备份所有会话与配置（API Key 也会被导出，妥善保管）。

## 已知限制

- 老 Safari（iOS < 14）不支持 Service Worker 离线缓存，所以 RetroChat 没有 PWA
- 长对话超过浏览器 localStorage 容量（约 5MB）时会自动剔除最旧会话
- iOS 12 可能不支持部分新 Markdown 特性（如表格渲染样式）

## License

MIT
