# RetroChat

> 一个能在 iPhone 5s 上跑的 AI 聊天客户端。

RetroChat 是面向**老旧设备**的网页 AI 聊天应用。它的核心目标是在 iPhone 5s（iOS 12 / Safari 12）这类 10 年前的设备上仍能流畅使用。默认接入由服务器环境变量配置的预设模型，并允许用户自定义任意 OpenAI 兼容 endpoint。

## 特点

- **极致兼容性**：原生 ES5 + jQuery slim，全部 Flexbox 布局，避免 ReadableStream / 可选链 / CSS Grid 等老 Safari 不支持的特性
- **流式响应**：通过 XHR `onprogress` 增量读取 `responseText` 实现 SSE 流式输出，无需 ReadableStream
- **零后端存储**：会话和密钥仅存在浏览器 localStorage，可一键导入/导出 JSON
- **多模型支持**：内置预设服务开箱即用（Base URL / API Key / 模型 ID 全部在 Vercel 环境变量配置），也可自定义任意 OpenAI 兼容 API（DeepSeek、通义、Kimi、本地 Ollama 等）
- **复古主题**：CRT 绿屏 / 老 Mac 灰白 双主题切换
- **PWA 安装**：可"添加到主屏幕"作为独立 app 启动；Service Worker 离线缓存让重复访问几乎秒开（iPhone 5s / iOS 12 同样支持）
- **Vercel 一键部署**：一个 Serverless Function 做 SSE 代理，前端纯静态

## 项目结构

```
retro-chat/
├── index.html
├── css/style.css
├── js/
│   ├── vendor/       # jQuery slim + marked，本地托管（见下）
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

### 第三方库为什么不用 CDN

`js/vendor/` 里的两个库是提交进仓库的，不走 cdnjs：

| 文件 | 版本 | SHA-512 (SRI) |
|---|---|---|
| `jquery.slim.min.js` | 3.6.4 | `sha512-fYjSocDD6ctuQ1QGIo9+Nn9Oc4mfau2IiE8Ki1FyMV4OcESUt81FMqmhsZe9zWZ6g6NdczrEMAos1GlLLAipWg==` |
| `marked.min.js` | 4.3.0 | `sha512-zAs8dHhwlTbfcVGRX1x0EZAH/L99NjAFzX6muwOcOJc7dbGFNaW4O7b9QOyCMRYBNjO+E0Kx6yLDsiPQhhWm7g==` |

原因有三：CDN 被投毒等于任意脚本拿到用户的 API Key；cdnjs 抖一下首屏就直接白屏（Service Worker 只能尽力缓存跨域资源，装不上就是装不上）；同源之后 Service Worker 可以把它们当成普通关键资源做「全有或全无」的预缓存。同源资源不需要 SRI —— 它们和页面本身在同一个信任边界内 —— 上表仅供你核对下载来源。

要重新验证或升级：

```bash
curl -s https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.4/jquery.slim.min.js \
  | openssl dgst -sha512 -binary | openssl base64 -A
```

输出应与上表一致。升级版本时记得同步 `sw.js` 的 `CACHE_VERSION`。

### Service Worker 缓存策略

`sw.js` 对同源静态资源用 **stale-while-revalidate**：先从缓存秒开，同时后台重新拉取并更新缓存，所以客户端最多落后一次加载就会自愈。导航请求走 **network-first**（离线才回落到缓存的 shell），`/api/*` 和 `/_vercel/*` 永不缓存。

这一点值得说明，因为它改变了发版流程：项目没有构建步骤，资源 URL 是不带 hash 的（`/js/chat.js` 永远是 `/js/chat.js`）。**原来的 cache-first + 不写运行时缓存意味着，客户端拿到新代码的唯一途径就是 bump `CACHE_VERSION`** —— 忘了 bump，所有回访用户就被永久钉死在旧版本上，包括安全修复。改成 SWR 之后 `CACHE_VERSION` 只用于强制清空（比如从预缓存列表里删文件），不再是发布普通代码改动的必要条件。

### 安全响应头

`vercel.json` 为所有路径下发 CSP：`script-src 'self'` 挡住任何注入的内联脚本和外部脚本加载，配合 `object-src 'none'` / `base-uri 'self'` / `frame-ancestors 'none'`。页面里没有内联 `<script>` 也没有 `onclick=` 之类的属性，所以这条策略不需要任何豁免。

`style-src` 保留了 `'unsafe-inline'`，因为 `index.html` 有一个防启动白闪的内联 `<style>`；用 hash 更严格，但改动那行样式时忘记更新 hash 会让 iOS PWA 启动白闪的 bug 复发，代价不值得 —— 何况 AI 输出里的 HTML 现在已经全部转义，CSS 注入没有入口。

⚠️ `Referrer-Policy` 是 `same-origin` 而不是 `no-referrer`：后端在 `Origin` 缺失时会拿同源 `Referer` 作为「这是浏览器请求」的备用判据（见「滥用与成本防护」），`no-referrer` 会连同源请求的 `Referer` 一起掐掉，导致老 Safari 被 403。跨域请求依然不带任何 referrer。

## 本地开发

```bash
# 1) 复制环境变量模板，填入你的预设服务 Base URL、Key 和模型 ID
cp .env.example .env.local
# 编辑 .env.local，填上 PRESET_BASE_URL、PRESET_API_KEY 和 PRESET_MODEL

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
| `PRESET_BASE_URL` | `https://api.example.com/v1`（你的预设服务地址） | Production, Preview, Development |
| `PRESET_API_KEY` | `sk-...`（你的预设服务 key） | Production, Preview, Development |
| `PRESET_MODEL` | 预设服务使用的模型 ID | Production, Preview, Development |

改任何一项后重新部署即可生效，客户端无需更新。

⚠️ **不要**把 API Key 写进前端代码或 commit 到 git —— 它会暴露在 bundle 里被任何人查看。

### 滥用与成本防护（可选环境变量）

`PRESET_API_KEY` 花的是**你的**钱，所以 `/api/chat` 默认做了三层限制。全部可选，不配置就用下面的默认值：

| Name | 默认 | 作用 |
|---|---|---|
| `RATE_LIMIT_RPM` | `15` | 每 IP 每分钟请求数上限，`0` 关闭 |
| `RATE_LIMIT_RPH` | `120` | 每 IP 每小时请求数上限，`0` 关闭 |
| `MAX_MESSAGES` | `100` | 单次请求最多几条消息，`0` 关闭 |
| `MAX_INPUT_CHARS` | `60000` | 单次请求 prompt 总字符数上限，`0` 关闭 |
| `MAX_TOKENS_CAP` | `8192` | 强制下发的 `max_tokens` 上限；客户端可以要更少但不能要更多，`0` 表示不封顶 |
| `ALLOW_KEYLESS_API` | `0` | 设为 `1` 才允许无 Origin/Referer 的请求使用预设凭据 |
| `STREAM_BUDGET_MS` | `55000` | 流式响应自我了断的时限，需低于 `vercel.json` 里的 `maxDuration` |

两点需要知道：

- **预设凭据只发给浏览器请求。** 请求的 `Origin` 或 `Referer` 必须命中白名单（同源、localhost、或 `ALLOWED_ORIGINS`），否则直接 403。这挡住了「拿到 URL 就 curl 白嫖」这种最常见的情况。自带 `baseUrl` + `apiKey` 的请求不受此限——花的是用户自己的钱。
- **限流器是进程内的。** Vercel 会复用热实例，所以它能挡住单个客户端的持续刷量，但**不是全局配额**：并发冷启动各有各的计数窗口。要硬性上限，需要在前面接 Vercel KV 或 Upstash。把它当减速带 + 花费天花板，不要当密码学边界。

如果你用的是推理模型（thinking token 也算进 `max_tokens`），发现回答被截断，调高 `MAX_TOKENS_CAP` 即可。

Vercel 会自动：
- 把仓库根作为静态资源
- 把 `api/chat.js` 部署为 Serverless Function
- 把环境变量注入到 Function 运行时
- 透传 SSE 流（已在 `vercel.json` 关闭缓存）

> **Function 超时**：`vercel.json` 已把 `api/chat.js` 的 `maxDuration` 设为 **60 秒**（Hobby 套餐上限；Pro 可调到 300）。服务端另有一道 `STREAM_BUDGET_MS`（默认 55000）会在平台强杀之前主动收尾，向客户端发一条明确的「响应被截断」错误帧 —— 否则回答会被无声切断，看起来就像模型自己说完了。改 `maxDuration` 时记得同步调 `STREAM_BUDGET_MS`，留几秒余量。

## Web Analytics

部署到 Vercel 后默认接入了 [Vercel Web Analytics](https://vercel.com/docs/analytics)，统计聚合的页面访问量、访问国家、设备类型 —— **不使用 cookie、不做指纹识别、不收集个人数据**，符合 GDPR / CCPA。

纯 HTML 站点需要 `index.html` 里**两个**标签配合，缺一不可：

```html
<script src="/js/analytics.js"></script>              <!-- 队列 shim，本身不上报 -->
<script defer src="/_vercel/insights/script.js"></script>  <!-- 真正的采集脚本 -->
```

第二个标签**不会**被 Vercel 自动注入 —— 那只发生在 Next.js 等框架集成里。此外还需要在 Vercel Dashboard → Analytics 标签页手动 **Enable** 一次（这一步会注册 `/_vercel/insights/*` 路由）。

> 如果你在 Dashboard 启用了按项目生成的 unique path（用于规避广告拦截器），把上面的 `src` 换成 `/<unique-path>/script.js`。
>
> 验证方式：部署后打开浏览器 Network 面板，应该能看到一条发往 `/_vercel/insights/view` 的请求。看不到就说明没生效。

不想要的话：

1. 删掉 `index.html` 里上面两行 `<script>`
2. 在 Dashboard 关掉 Analytics

> RetroChat 的核心隐私承诺不变：**所有会话内容和 API Key 仍然只存在你的浏览器 localStorage**，从未上传到任何后端（除了你配置的 AI endpoint）。

## 凭据优先级

后端 `api/chat.js` 按以下顺序选用上游凭据：

1. **请求体里的 baseUrl + apiKey + model**（用户在设置面板选"自定义"时填的）
2. **环境变量** `PRESET_BASE_URL` + `PRESET_API_KEY` + `PRESET_MODEL`（预设服务；旧的 `MIMO_*` 变量名仍兼容）—— 仅在请求来自允许的 Origin/Referer 时下发，见上文「滥用与成本防护」
3. 都没有 → 返回 400 错误

注意：要么两个都用用户的，要么两个都用环境变量的 —— 不会混搭。如果用户只填了 baseUrl 没填 apiKey（或反之），前端会高亮报错让用户补全。

## 使用其他模型

设置面板里只有两个预设：**预设服务（开箱即用，由服务器环境变量决定用哪个模型）** 和 **Custom（自定义）**。选 Custom 时填入你自己的 Base URL、API Key 和模型 ID —— 服务器环境变量只服务于预设选项。

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

- 长对话超过浏览器 localStorage 容量（约 5MB）时会自动剔除最旧会话
- iOS 12 可能不支持部分新 Markdown 特性（如表格渲染样式）

## License

MIT
