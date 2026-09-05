# UCASxk Tampermonkey

在已经登录的 UCAS xkgo 页面中运行的选课辅助脚本。它可以观察课程余量、准备 SID、调用本机 `ddddocr` 识别验证码，并把同一轮有余量的课程一次性加入预选。

> 脚本不会提交最终选课单，也不提供代理、指纹伪造、多账号并发或 SEP 密码自动登录。请只在你本人有权操作的账号和系统中使用。

## 组成

- `src/`：模块化 TypeScript userscript 源码。
- `dist/ucasxk.user.js`：构建后可直接安装到 Tampermonkey 的单文件脚本。
- `ocr_api/`：只监听 `127.0.0.1` 的本地 OCR 服务。

首版面向 Chrome/Edge 与 Tampermonkey。脚本仅匹配 `https://xkgo.ucas.ac.cn:3000/*`。

## 1. 启动本地 OCR

需要安装 [uv](https://docs.astral.sh/uv/)。服务固定使用 Python 3.12：

```bash
cd ocr_api
uv sync --extra test
uv run ucasxk-ocr
```

启动后可检查：

```bash
curl http://127.0.0.1:8765/health
```

OCR 接口只绑定回环地址、不开放 CORS，并要求油猴请求携带专用客户端头。不要把监听地址改为 `0.0.0.0`，也不要通过公网转发该端口。

## 2. 构建并安装 userscript

```bash
npm install
npm run check
npm test
npm run build
```

在 Tampermonkey 中选择“添加新脚本”，导入 `dist/ucasxk.user.js`，并允许它访问 `127.0.0.1`。重新构建后需要在 Tampermonkey 中更新脚本内容。

## 3. 登录和使用

1. 在浏览器中正常登录 SEP，从“选课系统”进入 xkgo。
2. 页面右上角会出现“UCASxk 选课助手”悬浮面板。
3. 每行填写一个课程编码，选择模式并开始。

支持的模式：

- **观察余量**：循环查询，出现余量时停止，不提交任何课程。
- **自动加入预选**：查询所有目标，把同一轮有余量的课程用一张验证码批量加入预选。
- **准备并下载 SID**：查询所有课程，下载与原 Python 工具兼容的 version 1 SID JSON。
- **导入 SID 直接提交**：读取上述 JSON，不查询余量，直接用其中的 SID 批量加入预选。

自动提交模式会在开始前再次确认。暂停会在当前导航或请求结束后生效；停止后不会再发送请求。刷新页面会从持久化检查点恢复，但只有页面路径与预期阶段完全一致才会继续。

## SID 文件

SID 文件保持以下结构和顺序：

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

## 开发验证

```bash
npm run check
npm test
npm run build

cd ocr_api
uv run pytest -q
```

正式页面验收应使用本人账号，先从“观察余量”验证解析，再验证 SID 准备。加入预选后仍需在学校页面由本人检查并提交最终选课单。

## 常见问题

### 页面没有出现悬浮面板

- 确认当前地址以 `https://xkgo.ucas.ac.cn:3000/` 开头；脚本不会在 SEP 登录页运行。
- 确认 Tampermonkey 中脚本已经启用，并刷新 xkgo 页面。
- 如果刚重新构建，需把新的 `dist/ucasxk.user.js` 重新导入或覆盖旧脚本。

### 无法连接 OCR 服务

- 保持运行 `uv run ucasxk-ocr` 的终端窗口不要关闭。
- 访问 `http://127.0.0.1:8765/health`，应返回 `model_loaded: true`。
- 首次启动需要加载约百兆字节的模型依赖，出现健康响应前可能需要等待一段时间。
- 在 Tampermonkey 的站点权限中允许脚本连接 `127.0.0.1`。

### 刷新后任务停止

脚本只会在“保存的预期路径”和当前页面路径一致时恢复。运行期间手工切换页面会触发安全停止，以避免重复查询或重复提交；请回到选课系统后重新开始任务。

### 直接 SID 模式没有查询余量

这是预期行为。直接模式完全跳过 `selectCourse`，仅适合使用同一账号近期生成的 SID 文件。选课首日或 SID 来源不确定时，应使用“自动加入预选”模式重新查询。
