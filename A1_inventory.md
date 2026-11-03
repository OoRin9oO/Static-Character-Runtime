# SCR P0 / A1 现状盘点

检查日期：2026-11-02  
范围：源码、项目目录、已有测试与静态语法；未启动本地服务或浏览器。

## 1. 技术栈、目录与入口

- 无框架浏览器应用：`index.html`、`styles.css`、原生 JavaScript ES modules（`app.js` 与 `runtime/`）。
- Windows 本地 HTTP 服务：`start.cmd` 调用 Windows PowerShell，入口脚本为 `server.ps1`，默认从 4173 起尝试至 4183，并可启动 Edge。
- 角色包位于 `characters/<id>/`；配置在 `config/`；设计文档在 `docs/`；Node 测试在 `tests/`。JSZip 3.10.1 由 `runtime/vendor-jszip.min.js` 本地加载。
- 正常网页运行不需要 Node.js；运行现有自动化测试需要 Node.js。

## 2. 动作控制面板

源码可确认已包括：按角色 manifest 生成状态按钮、基础/覆盖状态展示、事件模拟、动作意图 JSON 校验、快捷动作、过渡动画编辑、角色/场景编辑，以及素材导入与动作名称编辑。主要页面协调逻辑在 `app.js`，元素结构在 `index.html`。

## 3. 图片加载与切换

- `runtime/character-loader.js` 读取并验证角色 manifest、约束图片相对路径、解析注册角色清单和预加载图片。
- `app.js` 使用两层图片元素切换，包含淡入淡出、弹跳、弹出和无动画样式；加载错误会走默认状态回退逻辑。
- 角色图片可为完整图片；服务器 MIME 类型覆盖 PNG、JPEG、WebP、GIF、AVIF。图片适配和实际不同尺寸表现尚未在浏览器中实测。

## 4. 数据与状态

- 全局角色目录：`characters/index.json`；每个角色自己的动作清单：各角色目录中的 `character.json`。
- `runtime/state-manager.js` 管理基础状态和临时覆盖；`runtime/event-dispatcher.js` 校验事件并映射状态；`runtime/action-intent-controller.js` 校验状态白名单、参数和冷却。
- 场景和部分编辑器偏好保存在浏览器 `localStorage`。
- `runtime/live-event-interface.js` 提供通用直播事件输入格式；`config/live-platforms.json` 当前将 B 站连接器标记为禁用。

## 5. 透明窗口、缓存与性能

- 有 OBS 浏览器展示模式（`?mode=live`），不是独立桌面透明窗口。
- 有图片预加载和双层切换；未发现可配置缓存上限或正式性能基线。启动时间、空闲占用、图片解码/切换和长时间稳定性均需运行测量。

## 6. 状态分类

### 已实现（源码与单元测试可确认）

- Manifest 状态按钮、事件/动作白名单校验、状态覆盖与恢复、过渡动画设置。
- 场景数据结构和编辑功能、ZIP/文件夹素材导入的规划逻辑、角色清单生成。
- 单轮模型请求代码和 OBS 展示页代码。

### 部分实现（流程或外部条件尚需运行验证）

- ZIP/文件夹角色包导入：前端预览、PowerShell 写入角色包/清单/索引的实现存在；未做本轮浏览器端到端验证。
- 图片切换、拖动、实例设置、启动脚本和服务器 HTTP 路由：源码存在；本轮未启动程序实测。
- AI 单轮对话依赖有效 API Key、服务可用性和模型响应。

### 未实现或禁用（按当前源码/配置）

- 独立桌面透明窗口。
- 真实 B 站直播连接器；配置明确禁用。
- 无 manifest 的通用文件夹扫描流程尚未在现有加载器接口中确认；当前基础入口是 JSON manifest。

### 未知（需运行验证）

- 本机启动是否正常、Edge 中角色能否正确显示、端口释放行为。
- ZIP 导入完整提交后的实际文件写入、索引同步、导入中断恢复。
- 含背景/不同尺寸/损坏图片的浏览器显示结果与资源占用。

## 7. 本轮代码审查修复

- 修正 `runtime/asset-import.js`：文件夹显示名与既有角色 ID 冲突时，不再误认为是已登记同名角色；会明确提示重新命名。
- 修正 `server.ps1`：创建新角色时，在写入目录和清单前检查角色索引中的 ID，避免直接 API 请求替换已有目录项。
- 清理 `app.js` 中未使用的导入结果数组；删除素材导入后重复写角色索引的调用。
- 在 `tests/asset-import.test.mjs` 加入 ID 冲突回归用例。
- 当前工作区原有 `characters/index.json` 用户改动仍保留，本轮没有编辑该文件或任何图片。

## 8. 验证结果与限制

- `node --check`：`app.js`、`runtime/asset-import.js` 通过。
- `node --test tests/*.test.mjs`：6 组通过，0 失败。
- PowerShell Parser：`server.ps1` 语法通过。
- `git diff --check`：通过；Git 提示部分文件换行符将由 Git 转成 CRLF，这是仓库换行设置提示。
- 未启动本地服务器，因此以上不代表浏览器端到端验收。

## 9. 下一步候选（等待用户选择）

| 选项 | 成本 | 预计涉及 | 风险 | 验收 |
|---|---|---|---|---|
| A. Edge 启动与显示冒烟验证 | 低 | `start.cmd`、`server.ps1`，必要时 `app.js` | 短暂启动本机服务、打开 Edge；验证后关闭本轮启动的进程 | 页面可加载、默认角色图显示、状态切换成功、服务退出后端口释放 |
| B. 无 manifest 的最小文件夹扫描 | 中 | `server.ps1`、`runtime/character-loader.js`、`app.js`、测试 | 影响既有 manifest 加载路径，需保持旧包兼容 | 纯文件夹可扫描并显示完整图片；含透明/不透明背景和多张图均可用 |
| C. 假 AI 动作请求场景验证 | 低 | `app.js`、`runtime/action-intent-controller.js`、测试 | 不调用真实模型；验证边界输入与连续状态请求 | 合法、未知、错误格式及连续请求均可预测处理且不崩溃 |
