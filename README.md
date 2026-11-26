# UCASxk Tampermonkey

这是一个在登录国科大选课系统后使用的选课辅助脚本。它可以观察课程余量、准备 SID、调用本机 `ddddocr` 识别验证码，并把同一轮有余量的课程一次性加入预选。

> 脚本不会提交最终选课单，也不提供代理、指纹伪造、多账号并发或 SEP 密码自动登录。请只在你本人有权操作的账号和系统中使用。

## 快速开始

在 Chrome 或 Edge 安装 Tampermonkey，使用仓库里已构建的 [用户脚本](dist/ucasxk.user.js)。观察余量和导出 SID 可以直接从第 2 步开始；两种加入预选的模式需要先启动本机 OCR。SID 是选课系统为课程提供的短期标识。

### 1. 首次准备并启动本地 OCR

需要安装 [uv](https://docs.astral.sh/uv/)。服务固定使用 Python 3.12：

```bash
cd ocr_api
uv sync
uv run ucasxk-ocr
```

启动后可检查：

```bash
curl http://127.0.0.1:8765/health
```

OCR 接口只绑定回环地址、不开放 CORS，并要求油猴请求携带专用客户端头。不要把监听地址改为 `0.0.0.0`，也不要通过公网转发该端口。

以后使用时，只需在 `ocr_api` 目录运行：

```bash
uv run ucasxk-ocr
```

### 2. 直接安装 userscript

国科大选课系统域名可能不定期变更，请以登录 SEP 后从“选课系统”进入的实际地址为准。如果地址与脚本声明不一致，请检查是否有适配新域名的脚本版本。

1. 安装 Chrome/Edge 的 Tampermonkey 扩展。
2. 在 Tampermonkey 中选择“添加新脚本”。
3. 打开仓库中的 `dist/ucasxk.user.js`，复制全部内容覆盖编辑器中的默认内容并保存。
4. 浏览器询问访问权限时，允许脚本连接 `127.0.0.1`。

更新时，将新版 `dist/ucasxk.user.js` 导入 Tampermonkey 并刷新选课页面。

### 3. 登录和使用

1. 在浏览器中正常登录 SEP，从“选课系统”进入选课页面。
2. 页面右上角会出现“UCASxk 选课助手”悬浮面板。
3. 每行填写一个课程编码，选择模式并点击对应的操作按钮。

| 面板模式 | 源码标识 | 操作结果 |
| --- | --- | --- |
| 观察一次余量 | `watch` | 查询一次待查课程并显示人数。可以导入 SID 文件填充课程编码。 |
| 自动加入预选 | `enroll` | 跳过已在预选列表的课程，逐门查询其余课程，将同一轮可选课程批量加入预选。适合选课首日。 |
| 准备并下载 SID | `prepare_sids` | 查询目标课程，导出与原 Python 工具兼容的 version 1 JSON 文件。 |
| 导入 SID 直接提交 | `direct` | 使用同一账号近期导出的 SID 批量加入预选，跳过已选列表和余量查询。 |

面板会保存课程编码、模式、间隔、OCR 地址、折叠状态和已导入的 SID 信息。运行时可查看逐课进度，暂停会在当前导航或请求结束后生效。任务结束后，点击“返回配置”调整下一次任务；请在学校页面核对并自行提交最终选课单。

## 请求方法、路径与预期响应

下表描述当前客户端如何读取响应。学校端的路径相对于 `https://xkgodj.ucas.ac.cn`，本机 OCR 服务默认使用 `http://127.0.0.1:8765`。

| 服务 | 方法 | 路径 | 用途 | 客户端预期响应 |
| --- | --- | --- | --- | --- |
| 学校 | `GET` | `/courseManage/main` | 打开预选主页 | 已登录的 HTML 页面。`parseSelectedCodes()` 从表格的“课程编码”列读取已预选课程。 |
| 学校 | `GET` | `/courseManage/selectCourse` | 打开课程列表 | 已登录的课程列表 HTML。确认登录状态后开始逐门查询。 |
| 学校 | `POST` | `/courseManage/selectCourse` | 按课程编码查询 | 查询结果 HTML。`parseQueryPage()` 从表格读取课程编码、名称、SID、限选人数、已选人数和可选状态；人数无法解析时记为 `null`。 |
| 学校 | `GET` | `/captchaImage` | 获取验证码 | 文本形式的 PNG data URL，以 `data:image/png;base64,` 开头，解码后具有 PNG 文件签名。 |
| 本机 | `POST` | `/v1/ocr` | 识别图片 | HTTP 200 和 JSON 对象，包含 `text`（字符串）、`confidence`（数值）、`accepted`（布尔值）。`accepted` 表示本机是否接受识别结果。 |
| 学校 | `POST` | `/courseManage/saveCourse` | 批量加入预选 | 结果 HTML。`parseSubmitBatch()` 按课程解析反馈，HTTP 请求完成不代表整批成功。 |
| 本机 | `GET` | `/health` | 手动检查服务 | 健康检查 JSON；`model_loaded` 为 `true` 表示模型已加载。此请求用于排障。 |

**提交结果。** 成功或已选的课程移出队列；时间冲突的课程标记原因后移出。遇到满员，自动模式下一轮重新查询，直接 SID 模式沿用缓存。结果无法判定时，任务停止，保留提示供用户核对。

**两处等待。** `handleCaptcha()` 在本机接受识别结果后等待 **3.0–3.5 秒**，再检查任务状态并提交本批课程。`waitAndContinue()` 在仍有待处理课程时等待下一轮，默认 **3.0–3.1 秒**，下限为 3 秒。面板的间隔设置只影响后者。

学校的课程页面通过浏览器导航或原生表单加载，查看网络记录时应包含文档请求。验证码图片由 `fetch()` 获取，本机识别使用 `GM_xmlhttpRequest()`。

## SID 文件

SID 文件名格式为 `ucasxk-sids-YYYYMMDD-HHMMSS.json`，并保持以下结构和顺序：

```json
{
  "version": 1,
  "created_at": "2026-09-05T00:00:00.000Z",
  "courses": [
    {
      "code": "COURSE-CODE",
      "name": "课程名称",
      "sid": "短期服务端标识",
      "limit": 50,
      "selected": 49,
      "selectable": true
    }
  ]
}
```

SID 可能随账号、会话、课程调整或学期变化而失效。不要长期复用，不要把真实 SID 文件提交到版本库或分享给他人。

## 安全停止规则

脚本遇到以下情况会停止，并且不会自动重放无法确认结果的 `saveCourse`：

- 会话过期、页面路径与恢复阶段不一致；
- 403、429、5xx 或可识别的频率/风控提示；
- 验证码接口不是合法 PNG data URL；
- 连续 5 张验证码识别不合格，或服务端连续 3 次拒绝验证码；
- 保存结果无法明确归类。

运行状态只保存课程、SID、阶段和脱敏日志；不保存 Cookie、验证码图片、页面原文或浏览器指纹。

## 开发者构建与验证

维护时可按问题定位源码：

- [engine.ts](src/engine.ts) 管理运行阶段、轮询、提交与停止条件。[navigation.ts](src/navigation.ts) 实现 GET 导航和 POST 表单提交。
- [parser.ts](src/parser.ts) 解析学校 HTML；页面结构变化时，优先核对这里和 [解析测试](tests/parser.test.ts)。
- [ocr.ts](src/ocr.ts) 定义本机 OCR 客户端的地址与响应校验。[ocr_api/](ocr_api/) 提供服务端实现。
- [build.mjs](scripts/build.mjs) 定义用户脚本的版本和匹配域名，构建产物为 [dist/ucasxk.user.js](dist/ucasxk.user.js)。

在仓库根目录检查、测试并构建用户脚本：

```bash
npm install
npm run check
npm test
npm run build
```

在仓库根目录运行以下命令验证本机 OCR 服务：

```bash
cd ocr_api
uv run pytest -q
```

正式页面验收应使用本人账号，先从“观察余量”验证解析，再验证 SID 准备。加入预选后仍需在学校页面由本人检查并提交最终选课单。

## 常见问题

### 页面没有出现悬浮面板

- 确认当前地址以 `https://xkgodj.ucas.ac.cn/` 开头；脚本不会在 SEP 登录页运行。
- 确认 Tampermonkey 中脚本已经启用，并刷新选课页面。
- 如果刚重新构建，需把新的 `dist/ucasxk.user.js` 重新导入或覆盖旧脚本。

### 无法连接 OCR 服务

- 保持运行 `uv run ucasxk-ocr` 的终端窗口不要关闭。
- 访问 `http://127.0.0.1:8765/health`，应返回 `model_loaded: true`。
- 首次启动需要加载约百兆字节的模型依赖，出现健康响应前可能需要等待一段时间。
- 在 Tampermonkey 的站点权限中允许脚本连接 `127.0.0.1`。

### 刷新后任务停止

课程输入和界面选项会正常保留。运行任务只会在“保存的预期路径”和当前页面路径一致时恢复；运行期间手工切换到其他页面仍会触发安全停止，以避免重复查询或重复提交。此时请回到选课系统后重新开始任务。

### 直接 SID 模式没有查询余量

这是预期行为。直接模式完全跳过 `selectCourse`，仅适合使用同一账号近期生成的 SID 文件。选课首日或 SID 来源不确定时，应使用“自动加入预选”模式重新查询。
