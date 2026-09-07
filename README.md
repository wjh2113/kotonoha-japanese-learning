# 言の葉 KOTONOHA

面向中文母语日语初学者的单词学习工具。支持按单元管理词汇、TXT/CSV/JSON 导入、AI 补全释义与例句、日语朗读、麦克风跟读纠音及选择题测试。

## 本地运行

```bash
npm install
copy .env.example .env
npm run dev
```

打开 `http://localhost:5173`。不配置 API Key 也可以使用内置示例词库和本地兜底解析。

## 启用 AIapiMgr 网关

在 `.env` 中设置服务端环境变量：

```env
LLM_GATEWAY_URL=https://aiapimgrapi.aidigitcloud.cn
LLM_GATEWAY_API_KEY=你的 Japan 租户 Key
LLM_GATEWAY_TENANT=Japan
LLM_GATEWAY_CHAT_CAPABILITY=quality-chat
LLM_GATEWAY_SPEECH_CAPABILITY=speech
```

密钥只由 `server.mjs` 读取，不会发送到浏览器。业务服务按照 AIapiMgr 手册调用 `/api/ai/chat` 与 `/api/ai/transcribe/json`，只传逻辑能力 `capability`，不写死任何上游模型。

## 导入格式

- DOCX：支持普通段落、项目列表，以及“单词 / 读音 / 释义”表格
- TXT：每行一个单词
- CSV：`单词, 读音, 释义`
- JSON：字符串数组，或含 `term / reading / meaning` 字段的对象数组

旧版二进制 `.doc` 不直接解析，请先在 Word 中另存为 `.docx`。

## 语音说明

- 朗读使用浏览器 Web Speech Synthesis，自动选择日语音色。
- 跟读录音通过服务端发送到 AIapiMgr `speech` 能力进行日语转写；网关不可用时降级为 Web Speech Recognition。
- 当前评分衡量转写词形与目标假名的匹配度，并提示长音、促音和浊音。若需要音素级声学评分，可继续接入专门的发音评测服务。

## 测试

```bash
npm test
npm run build
```

## 网页部署

该项目包含前端和隐藏 API Key 的 Node.js BFF，不能只部署到纯静态 GitHub Pages。推荐部署到 Render、Railway、Fly.io 或其他支持 Node.js 的平台：

1. 构建命令：`npm install && npm run build`
2. 启动命令：`npm start`
3. 配置 `.env.example` 中列出的环境变量，切勿上传本地 `.env`
