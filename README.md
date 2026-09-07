# 言の葉 KOTONOHA

面向中文母语日语初学者的单词学习工具。支持按单元管理词汇、Word/TXT/CSV/JSON 导入、AI 补全释义与例句、日语朗读、麦克风跟读纠音及选择题测试。业务数据存储在 PostgreSQL。

生产地址：https://japan.aidigitcloud.cn

## 核心功能

- 顶部导航包含词库、学习、测试、生词本、待复习和设置。
- 词库按单元管理；创建单元时只填写名称，上传词汇后由大模型自动归纳单元主题。
- 发音跟读与纠音以内嵌面板合并到当前学习词卡，不再跳离学习页面。
- 生词本保存用户主动收藏的单词。
- 待复习采用 1 / 2 / 4 / 7 / 15 / 30 天间隔；尚未安排过复习的词第一次「记住了」进入 1 天档。遗忘词会在 10 分钟后再次出现。
- 设置支持文字头像与男声、女声日语朗读偏好；页面会显示当前设备是否检测到对应日语音色。
- 生产环境启用访问密码，写接口与词库快照不会对公网裸奔。

## 本地运行

```bash
npm install
cp .env.example .env    # Windows: copy .env.example .env
```

在 `.env` 中把 `POSTGRES_PASSWORD` 与 `DATABASE_URL` 中的密码改成相同的强密码。

### macOS / Linux（推荐本机 PostgreSQL 18）

本机已安装 PostgreSQL 18 时，不必使用 Docker：

```bash
npm run db:local:init
```

把 `.env` 里的连接串改为：

```env
DATABASE_URL=postgresql://kotonoha_app@127.0.0.1:5433/kotonoha
```

然后 `npm run dev`。后续可用 `db:local:start`、`db:local:status`、`db:local:stop` 管理隔离实例。Windows 对应命令加 `:win` 后缀，例如 `npm run db:local:init:win`。

### Docker Compose

```bash
docker compose up -d postgres
npm run dev
```

打开 `http://localhost:5173`。服务启动时会自动执行 `db/schema.sql`，空数据库会由前端导入内置词库。现有旧版本浏览器数据会在首次成功连接后自动迁移到数据库。

不配置大模型 API Key 仍可使用内置示例词库和本地兜底解析，但 PostgreSQL 是必需依赖。本地可将 `ACCESS_PASSWORD` 留空以跳过登录门。

## 数据存储

- `units`：单元、说明、颜色及排序。
- `words`：词卡内容、掌握状态、生词标记、复习阶段与复习时间。
- `app_settings`：头像与朗读音色偏好。
- 浏览器只保留当前页面运行状态；`kotonoha-units-v1` 和 `kotonoha-settings-v1` 旧数据迁移成功后会被清除。
- 所有数据库写入均由服务端参数化 SQL 和事务执行，浏览器不能直接连接 PostgreSQL。
- 生产环境 Node 只监听 `127.0.0.1`，由 nginx 反代；`PUT /api/state`、导入补全和语音转写需访问令牌，并对 AI 接口做了频率限制。

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

- 朗读使用浏览器 Web Speech Synthesis，并在浏览器音色列表加载完成后优先匹配所选的日语男声或女声；设备没有对应音色时使用默认日语语音并应用音高补偿。
- 跟读录音通过服务端发送到 AIapiMgr `speech` 能力进行日语转写；网关不可用时降级为 Web Speech Recognition。
- 当前评分衡量转写词形与目标假名的匹配度，并提示长音、促音和浊音。若需要音素级声学评分，可继续接入专门的发音评测服务。

## 测试

```bash
npm test
npm run build
```

## 网页部署

该项目包含前端和隐藏 API Key 的 Node.js BFF，不能只部署到纯静态 GitHub Pages。京东云生产部署：

```bash
npm run deploy
```

脚本会构建前端、rsync 到 `ubuntu@111.228.6.222:/opt/kotonoha-japanese-learning`、创建 PostgreSQL 库、写入 nginx（`japan.aidigitcloud.cn`）并用 pm2 启动 `127.0.0.1:8791`。

首次上线需要给域名加一条 DNS：

| 类型 | 主机记录 | 记录值 |
|---|---|---|
| A | `japan` | `111.228.6.222` |

证书已使用 `*.aidigitcloud.cn` 通配符，DNS 生效后即可 HTTPS 访问。其他 Node 平台也可：

1. 构建命令：`npm install && npm run build`
2. 启动命令：`npm start`
3. 配置 `.env.example` 中列出的环境变量，切勿上传本地 `.env`
