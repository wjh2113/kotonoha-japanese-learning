# 言の葉 KOTONOHA

面向中文母语日语初学者的单词学习工具。支持按单元管理词汇、「词汇手册」Excel /「课文整理」Markdown 导入、AI 补全释义与例句、日语朗读、麦克风跟读纠音及选择题测试。业务数据存储在 PostgreSQL。

生产地址：https://japan.aidigitcloud.cn

## 核心功能

- 测试可先选听力或词义。每种模式会按随机顺序测完本单元全部已有释义的单词，一题一词。没有中文释义的占位词会先后台补全，补完后再测即可覆盖全部。
- 课文仅支持「课文整理」Markdown 模版导入。导入后支持：逐句朗读与跟读纠音、逐句逐词中文解释、语法标识。
- 词库按单元管理；创建单元时只填写名称。上传词汇手册后（以及已有占位文案的单元）会由大模型根据单词归纳 4–12 字中文主题。
- 发音跟读与纠音以内嵌面板合并到当前学习词卡，不再跳离学习页面。
- 生词本保存用户主动收藏的单词。
- 待复习采用 1 / 2 / 4 / 7 / 15 / 30 天间隔；尚未安排过复习的词第一次「记住了」进入 1 天档。遗忘词会在 10 分钟后再次出现。
- 设置支持文字头像与男声、女声日语朗读偏好；页面会显示当前设备是否检测到对应日语音色。
- 生产环境启用访问密码，写接口与词库快照不会对公网裸奔。
- 安卓：用 Chrome 打开 https://japan.aidigitcloud.cn ，菜单里选「添加到主屏幕」，即可全屏当 App 使用。底部导航覆盖学习、课文、词库、复习；测试和生词本在「我的」。

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
LLM_GATEWAY_ENRICH_CAPABILITY=fast-chat
LLM_GATEWAY_SPEECH_CAPABILITY=speech
```

密钥只由 `server.mjs` 读取，不会发送到浏览器。业务服务按照 AIapiMgr 手册调用 `/api/ai/chat` 与 `/api/ai/transcribe/json`，只传逻辑能力 `capability`，不写死任何上游模型。

## 导入格式

- 词汇：仅支持「词汇手册」Excel 模版（`.xlsx`）。表头需含序号、单词、假名、词性、中文释义等字段；表内内容原样入库。
- 课文：仅支持「课文整理」Markdown 模版（`.md`）。不接受 Word、图片、粘贴或自由正文。

模版可在词库 / 课文页下载：`public/templates/词汇导入模版.xlsx`、`public/templates/课文导入模版.md`。

## 语音说明

- 朗读使用浏览器 Web Speech Synthesis，并在浏览器音色列表加载完成后优先匹配所选的日语男声或女声；设备没有对应音色时使用默认日语语音并应用音高补偿。
- 跟读优先使用浏览器 Web Speech Recognition；浏览器不可用或连不上时再走服务端 AIapiMgr `speech` 能力转写。
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
