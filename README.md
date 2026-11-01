# Static Character Runtime V0.1

一个不依赖框架的浏览器原型：读取角色清单、生成状态面板，并在完整角色图片之间平滑切换。

## 项目信息

- **Name:** Static Character Runtime
- **Version:** 0.1.0
- **Status:** Prototype / Stage A baseline
- **License:** MIT（程序代码）
- **Sample character:** GitHub娘

> `github娘-表情/` 是保留在本机的原始表情库，不属于公开仓库内容。仓库中的示例角色图片用于当前原型演示，角色素材权利不因代码采用 MIT 许可证而自动转让。

## 使用方法

1. 双击 `start.cmd`。
2. 启动脚本会自动使用 Microsoft Edge 打开 <http://127.0.0.1:4173>。
3. 点击右侧状态按钮切换图片。
4. 关闭启动窗口或按 `Ctrl+C` 停止。

启动器只使用 Windows 自带的 PowerShell，不需要安装 Node.js、Python 或其他依赖。

## 添加其他角色

复制 `characters/github-girl` 目录并修改其中的 `character.json`。然后使用查询参数指定新清单：

```text
http://127.0.0.1:4173/?manifest=./characters/新角色/character.json
```

清单中每个状态只需要提供 `id`、`label`、`group`、`image` 和可选的 `description`。图片路径相对于该角色的 `character.json`。

## 当前能力

- 从 JSON 清单加载角色。
- 根据清单自动生成状态按钮。
- 双图层淡入淡出和轻微缩放过渡。
- 固定舞台比例，兼容素材之间 1 像素的画布差异。
- 图片或状态不存在时回退到默认待机状态。
- 不绑定 GitHub娘，其他角色可以使用同一运行时。

## 常见问题

- 如果提示端口 `4173` 被占用，请先关闭之前打开的启动窗口，再重新双击 `start.cmd`。
- 页面必须通过 `start.cmd` 打开，不能直接双击 `index.html`，否则浏览器无法读取 JSON 角色清单。

## 许可证

程序代码使用 [MIT License](./LICENSE)。角色图片和其他视觉素材不自动适用 MIT 许可证。
