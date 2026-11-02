# 角色包格式

每个角色使用一个独立目录：

```text
characters/<character-id>/
├── character.json
├── Basic/
├── Emotion/
├── Interact/
└── Special/
```

运行时不要求角色拥有固定动作。角色可以自行定义状态 ID、分组、名称和图片，只需满足清单格式。

## 必需字段

| 字段 | 作用 |
|---|---|
| `schemaVersion` | 清单格式版本，当前为 `1` |
| `id` | 角色唯一 ID |
| `name` | 界面显示名称 |
| `version` | 角色包版本 |
| `defaultState` | 默认状态 ID |
| `states` | 状态列表 |

每个状态至少包含：

```json
{
  "id": "idle",
  "label": "待机",
  "image": "Basic/idle.png"
}
```

可选字段包括 `group` 和 `description`。状态数量和名称均可自定义。

状态还可以声明表现方式：

```json
"behavior": { "mode": "override", "priority": 80, "durationMs": 2500 }
```

- `base`：长期基础状态。
- `override`：临时覆盖状态，到期后恢复基础状态。
- 同时存在多个覆盖状态时，优先级更高者显示；同优先级使用最新状态。

## 可选配置

```json
{
  "canvas": { "width": 1024, "height": 1536 },
  "display": { "scale": 1, "anchorX": 50, "anchorY": 50, "offsetX": 0, "offsetY": 0 },
  "transition": { "type": "bounce", "durationMs": 320, "distancePx": 18 },
  "events": {
    "assistant_thinking": { "state": "thinking", "mode": "base" },
    "greeting": { "state": "greeting", "mode": "override", "priority": 80, "durationMs": 2500 }
  },
  "groups": { "basic": "基础状态" }
}
```

`display` 可以放在角色清单顶层作为默认值，也可以放在单个状态中覆盖，用于修正不同图片的缩放、锚点和像素偏移。

`transition.type` 支持 `crossfade`（淡入淡出）、`bounce`（弹跳）、`pop`（弹出）和 `none`（无动画）。`durationMs` 控制时长，`distancePx` 控制弹跳幅度。页面内的过渡编辑器可实时预览这些参数，但不会写回配置文件。

`events` 把外部事件映射为基础状态或临时覆盖状态。事件名称及映射均属于角色配置，运行时不会把某个角色的状态写死在核心代码中。

建议优先使用以下标准事件，角色可以只配置自己需要的部分：

- `user_message_received`、`user_input_started`
- `assistant_thinking`、`assistant_response_started`、`assistant_response_chunk`、`assistant_response_finished`
- `task_started`、`task_progress`、`task_succeeded`、`task_failed`
- `greeting`、`farewell`

`state_requested` 是控制面板使用的内置测试事件，不需要写入角色清单。

## 路径规则

- 图片路径必须相对于角色目录。
- 使用 `/` 作为分隔符。
- 不允许绝对路径、网址、反斜杠或 `../` 跳出角色目录。
- 新增角色时不需要修改运行时核心代码，可通过 `?manifest=` 指定清单。

## 图片素材建议

- 推荐不同状态图片使用相同画布尺寸和分辨率，并采用透明背景，方便角色在同一舞台保持大小和站位一致。
- 这只是推荐，不是限制。尺寸、分辨率或背景不同的图片也可以使用；可在清单的 `display` 或具体状态的 `display` 中调整缩放、锚点与偏移。
- 推荐使用 PNG 或 WebP 透明图。JPEG 不支持透明背景，会以完整矩形背景显示；GIF、AVIF 等格式需以当前 Edge 的实际解码支持为准。
- 保持图片扩展名与图像实际编码格式一致，避免浏览器无法显示。

## 推荐素材目录

```text
characters/<character-id>/
├── character.json
├── Basic/
├── Emotion/
├── Interact/
└── Special/
```

目录名称大小写不敏感。`Basic` 放基础状态，`Emotion` 放情绪动作，`Interact` 放问候、道歉等交互动作，`Special` 放休眠或特殊效果。图片文件名作为动作显示名称的默认值；角色包可自行扩展其他分区。

导入器也识别常见缩写目录：`Emo` 对应 `Emotion`，`inter` 对应 `Interact`，`Spec` 对应 `Special`。新角色导入时，`Basic` 状态默认作为长期基础状态；`Emotion`、`Interact` 和 `Special` 状态默认作为临时覆写，2.5 秒后恢复当前基础状态。已有清单即使没有 `behavior` 字段，运行时也会按分组采用相同默认值；显式配置的 `behavior` 优先。

导入器可以从 ZIP 或浏览器选中的角色文件夹识别分区。若压缩包/文件夹带一个未登记角色根目录，确认后会创建 `characters/<character-id>/`、生成 `character.json`，并写入 `characters/index.json`；若导入的是已登记角色，则素材归入该角色。包含多个未登记角色的导入会被拒绝。ZIP 中的路径必须经过安全校验，不能覆盖角色目录以外的文件。

编辑器修改动作显示名称时，建议只更新 `character.json` 中对应状态的 `label`，图片文件名保持不变，以免破坏引用。用户仍可选择单独重命名图片。手动编辑 JSON 或移动文件后，需要刷新页面重新读取角色清单。

## 登记到角色选择器

素材由角色包作者自行提供。把完整角色目录放入 `characters/` 后，在
`characters/index.json` 的 `characters` 数组增加一项即可出现在编辑测试台：

```json
{ "id": "demo", "name": "示例角色", "manifest": "./demo/character.json" }
```

角色包之间互不引用素材。仓库维护者可以只提交清单示例，不必代为托管第三方素材。
