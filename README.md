# Prompt Jury

> Compare multiple LLM responses, judge the differences, and synthesize the best answer.

Prompt Jury 是一款 Chrome / Edge Manifest V3 浏览器扩展。当前 MVP 已完成 Step 1～Step 6：项目骨架、完整消息链路、四个平台 Adapter、Evaluation Run、本地历史、导出、匿名 Judge 与综合答案。

## 目前功能

- 自动检测已打开并登录的 ChatGPT、Gemini、Kimi 和豆包标签页；
- 一次输入 Prompt，并行发送到任意多个已选择的平台；
- 独立跟踪每个平台的生成状态，单个平台失败或超时不会中断其他平台；
- 提取各平台本轮最新回答，并在 Side Panel 中统一展示；
- 将 Prompt、回答、耗时和失败信息保存为本地 Evaluation Run；
- 查看和删除历史运行，或将完整结果导出为 Markdown、JSON；
- 使用用户配置的 OpenAI-compatible API 匿名评审候选回答；
- 展示评分、排名、优缺点、风险、共识和分歧；
- 按“最优综合版”“修正最佳回答”或“保留分歧版”生成并分别保存综合答案。

## 安装后的使用指南

### 1. 准备模型页面

分别打开需要比较的平台并完成登录。Prompt Jury 支持：

- ChatGPT：`https://chatgpt.com/`；
- Gemini：`https://gemini.google.com/app`；
- Kimi：`https://www.kimi.com/` 或 `https://kimi.moonshot.cn/`；
- 豆包：`https://www.doubao.com/`。

如果模型页面早于扩展安装或更新打开，请刷新模型页面，使 Content Script 重新注入。模型生成过程中应保持对应标签页打开。

### 2. 收集多个模型的回答

1. 点击浏览器工具栏中的 Prompt Jury 图标，打开 Side Panel；
2. 检查 Provider 列表，需要使用的平台应显示为可选状态；
3. 勾选至少两个平台；
4. 在 Prompt 输入框中输入一次问题；
5. 点击“发送到所选模型”；
6. 等待各平台完成，回答会依次显示在同一个 Evaluation Run 中。

如果 Provider 显示 `not_open`，请打开并登录对应平台后点击“重新检测”。如果显示 `error`，请查看平台下方的错误详情，并优先尝试刷新模型页面和重新加载扩展。

### 3. 查看历史与导出

- 点击顶部“历史”查看本机保存的 Evaluation Run；
- 点击某条历史记录可恢复其 Prompt、回答、Judge 结果和综合答案；
- 在 Evaluation Run 区域点击“Markdown”或“JSON”下载完整结果；
- 不再需要的记录可从历史列表中删除。

### 4. 配置 AI Judge

1. 在 Side Panel 的“AI Judge”区域点击“设置”；
2. 填写 OpenAI-compatible API 的 Base URL 或完整 Chat Completions URL；
3. 填写 API Key、Model、Temperature 和 Max Tokens；
4. 根据需要调整六项评分权重，并确保总和为 100%；
5. 点击“保存 Judge 配置”，并允许扩展访问该 API 地址。

Judge 配置保存在浏览器本地。API Key 不会写入运行历史或导出文件；运行 Judge 或生成综合答案时，当前 Prompt 和候选回答会发送到用户配置的 API。

### 5. 运行评审与生成综合答案

1. 确保当前 Evaluation Run 至少成功收集两个回答；
2. 点击“运行 Judge”，等待匿名评审完成；
3. 查看各回答的排名、评分、优缺点、风险、共识和分歧；
4. 选择一种综合方式并点击“生成综合答案”；
5. 可以依次生成不同方式的综合答案，已有结果不会被覆盖，并会随当前运行一同保存在本地。

## 开发

需要 Node.js 20+ 和 npm。

```bash
npm install
npm run dev
npm run build
npm run test
npm run lint
npm run typecheck
```

`npm run dev` 启动 Vite 监听构建。修改 Manifest 或扩展入口后，可能需要在扩展管理页重新加载。

## 本地安装

1. 执行 `npm install`；
2. 执行 `npm run build`；
3. Chrome 打开 `chrome://extensions/`（Edge 打开 `edge://extensions/`）；
4. 开启开发者模式；
5. 点击“加载已解压的扩展程序”；
6. 选择项目生成的 `dist` 目录；
7. 固定扩展，打开并登录 ChatGPT、Gemini、Kimi 或豆包；
8. 点击扩展图标打开 Side Panel。

已经打开的平台页面若早于扩展安装，需要刷新一次，使 Content Script 注入页面。

Side Panel 始终显示四个平台的检测结果：`not_open` 表示没有匹配的标签页；`error` 通常表示扩展更新后页面尚未刷新，错误详情会直接显示在 Provider 下方。

生产构建会将每个平台的 Content Script 打包成独立 IIFE 文件，以兼容不同站点的页面安全策略。

### 已知缺陷：Edge 无法执行 Gemini Content Script

在部分 Microsoft Edge 环境中，扩展能够识别已打开的 `https://gemini.google.com/app` 标签页，但 Edge 会阻止 Content Script 执行，并显示 `Edge blocked script execution (Blocked)`。即使满足以下条件，该问题仍可能出现：

- 扩展详情中已自动允许访问 `https://*.gemini.google.com/*`；
- `edge://policy` 中没有限制扩展或脚本执行的策略；
- Gemini 标签页未休眠、未被丢弃，并且已经刷新；
- 已通过扩展图标授予 `activeTab` 临时权限。

同一构建在 Chrome 中可以正常检测和使用 Gemini，因此目前将其记录为 Edge 特定的兼容性缺陷，MVP 暂不提供进一步规避方案。遇到该问题时，请使用 Chrome 测试 Gemini；Edge 仍可用于 ChatGPT、Kimi 和豆包。

回答等待时长默认为 180 秒；考虑到 Kimi 深度思考可能耗时更久，Kimi Adapter 的默认等待时长为 300 秒。轮询间隔保持较短，以便回答完成后及时返回。

ChatGPT 的联网搜索回答可能先渲染引用来源、暂停后再补充正文，因此需要文本连续稳定约 10 秒并经过 1.5 秒缓冲后才会采集。

## 验证消息链路

打开 ChatGPT 标签页，在 Side Panel 输入任意文本并点击“测试 Mock 链路”。请求将依次经过 Side Panel、Background、Content Script，再原路返回；Mock 不会向 ChatGPT 页面提交文本。

勾选一个或多个平台后，点击“发送到所选模型”会并行调用各自 Adapter；单个平台失败不会中断其他平台。每个平台的 selector 集中维护在对应的 `src/adapters/*-adapter.ts` 文件中。

## 架构说明

- `src/adapters/`：平台隔离的 Adapter 接口、注册表和 DOM selector；
- `src/background/`：标签页发现及跨上下文消息路由；
- `src/content/`：页面注入入口，只负责调用 Adapter；
- `src/messaging/`：所有跨上下文消息的 Zod schema 与类型；
- `src/sidepanel/`、`src/options/`：React UI；
- `src/storage/`：IndexedDB 封装；
- `tests/unit/`：Vitest 单元测试。

扩展不依赖自建后端，不读取或上传 Cookie，也不会把 Prompt 和回答写入控制台。Manifest 的固定 `host_permissions` 仅覆盖当前支持的 ChatGPT、Gemini、Kimi 和豆包页面。配置 OpenAI-compatible Judge 时，扩展会请求对应 API 地址的可选 Host Permission；只有运行 Judge 或生成综合答案时，当前 Prompt 和候选回答才会发送到用户配置的 API。API Key 与运行历史仍仅保存在浏览器本地，不会写入导出文件。
