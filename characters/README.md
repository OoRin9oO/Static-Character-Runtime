# 角色包格式

每个角色使用一个独立目录：

```text
characters/<character-id>/
├── character.json
└── assets/
    └── 状态图片.png
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
  "image": "assets/idle.png"
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
  "transition": { "type": "crossfade", "durationMs": 220 },
  "groups": { "basic": "基础状态" }
}
```

`display` 可以放在角色清单顶层作为默认值，也可以放在单个状态中覆盖，用于修正不同图片的缩放、锚点和像素偏移。

## 路径规则

- 图片路径必须相对于角色目录。
- 使用 `/` 作为分隔符。
- 不允许绝对路径、网址、反斜杠或 `../` 跳出角色目录。
- 新增角色时不需要修改运行时核心代码，可通过 `?manifest=` 指定清单。
