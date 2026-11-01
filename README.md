# Static Character Runtime V0.1

一个不依赖框架的浏览器原型：读取角色清单、生成状态面板，并在完整角色图片之间平滑切换。

## 项目信息

- **Name:** Static Character Runtime
- **Version:** 0.1.0
- **Status:** Prototype / Stage E（动作建议校验）
- **License:** MIT（程序代码）
- **Sample character:** GitHub娘

> `github娘-表情/` 是保留在本机的原始表情库，不属于公开仓库内容。仓库中的示例角色图片用于当前原型演示，角色素材权利不因代码采用 MIT 许可证而自动转让。

## 使用方法

1. 双击 `start.cmd`。
2. 启动脚本会自动使用 Microsoft Edge 打开 <http://127.0.0.1:4173>。
3. 点击右侧状态按钮切换图片。
4. 关闭启动窗口或按 `Ctrl+C` 停止。

若端口 `4173` 已被其他项目占用，启动器会自动尝试 `4174` 至 `4183`，并让 Edge 打开实际使用的地址。

启动器只使用 Windows 自带的 PowerShell，不需要安装 Node.js、Python 或其他依赖。

## 添加其他角色

复制 `characters/github-girl` 目录并修改其中的 `character.json`。然后使用查询参数指定新清单：

```text
http://127.0.0.1:4173/?manifest=./characters/新角色/character.json
```

清单中每个状态只需要提供 `id`、`label`、`group`、`image` 和可选的 `description`。图片路径相对于该角色的 `character.json`。

## 当前能力

- 从 JSON 清单加载角色，并验证版本、必需字段、重复状态和图片相对路径。
- 根据清单自动生成状态按钮。
- 双图层预加载与稳定切换，支持淡入淡出、弹跳、弹出和无动画。
- 内置过渡编辑器，可实时调整动画类型、时长和弹跳幅度。
- 提供统一事件入口和事件模拟器，可由聊天、任务或未来 AI 模块驱动状态。
- 提供动作建议白名单校验、参数限制和重复动作冷却；当前仅使用模拟器，未连接真实 AI。
- 固定舞台比例，兼容素材之间 1 像素的画布差异。
- 图片或状态不存在时回退到默认待机状态。
- 不绑定 GitHub娘，其他角色可以使用同一运行时。
- 支持基础状态、临时覆盖、优先级、持续时间和自动恢复。
- 支持按角色或单个状态调整缩放、锚点和偏移。

## 项目结构

```text
runtime/character-loader.js       角色清单读取、验证与图片预加载
runtime/state-manager.js          基础状态、临时覆盖、优先级与自动恢复
runtime/event-dispatcher.js       统一事件校验、映射与分发
runtime/action-intent-controller.js  动作建议校验、冷却与安全执行
characters/<character-id>/        独立角色包
app.js                            页面协调与控制面板
```

完整角色包字段与自定义方法见 [`characters/README.md`](./characters/README.md)。

## 事件接口

页面加载后，外部模块可以调用：

```js
window.staticCharacterRuntime.dispatch({
  type: "assistant_thinking",
  payload: {}
});
```

合法的动作建议可以通过同一个只读运行时入口提交：

```js
window.staticCharacterRuntime.suggestAction({
  state: "happy",
  intensity: 0.7,
  durationMs: 2500,
  reason: "积极回应"
});
```

`state` 必须属于当前角色；`intensity` 范围为 0–1；`durationMs` 范围为 250–10000。动作建议不能指定图片路径。

事件只能使用角色清单 `events` 中已注册的映射；未知事件会被安全忽略。

控制面板中的状态按钮也通过统一的 `state_requested` 事件工作。运行事件测试：

```powershell
node tests/event-dispatcher.test.mjs
node tests/action-intent-controller.test.mjs
```

测试需要 Node.js，但项目的正常启动和使用仍然不需要 Node.js。

## 常见问题

- 若 `4173` 被占用，启动器会自动选择后续空闲端口。仅当 `4173` 至 `4183` 全部占用时才会停止。
- 页面必须通过 `start.cmd` 打开，不能直接双击 `index.html`，否则浏览器无法读取 JSON 角色清单。

## 许可证

程序代码使用 [MIT License](./LICENSE)。角色图片和其他视觉素材不自动适用 MIT 许可证。
