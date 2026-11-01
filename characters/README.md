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

## 可选配置

```json
{
  "canvas": { "width": 1024, "height": 1536 },
  "transition": { "type": "crossfade", "durationMs": 220 },
  "groups": { "basic": "基础状态" }
}
```

## 路径规则

- 图片路径必须相对于角色目录。
- 使用 `/` 作为分隔符。
- 不允许绝对路径、网址、反斜杠或 `../` 跳出角色目录。
- 新增角色时不需要修改运行时核心代码，可通过 `?manifest=` 指定清单。
