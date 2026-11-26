# 提示词卡 · dsh-prompt-library

一个 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）客户端插件：把常用的提示词收藏起来，
点一下就能填进对话框复用。

> 日常做测试时会反复敲同一批提示词（造数据、出用例、写断言、复现步骤……），散落在历史会话里很难找。
> 这个插件把它们收进一个可搜索、可打标签的浮层面板，随时挑一条塞回输入框。

---

## 功能

- **输入框工具条入口**：「☆ 提示词卡」按钮，位于「完全权限」右侧、模型选择左侧
- **居中浮层面板**：列表页 + 详情页两视图
- **列表页**：搜索框（匹配标题 + 正文 + 标签）、按标签筛选下拉、标签 chips 快捷筛选、卡片列表
- **详情页**：复制 / 填入对话 / 编辑 / 置顶 / 删除，正文与来源分节展示
- **填入对话**：整条替换当前草稿（`inputActions.setDraft`）
- **消息下方收藏**：用户消息与助手消息都可以一键「存为提示词」，弹编辑框、正文预填
- **置顶与星标**：置顶永远排最前，其余按最近修改倒序
- **纯本地存储**：浏览器 `localStorage`，支持导出 / 导入 JSON（按 id 合并，同 id 覆盖）
- **跟随明暗主题**：读 DSH 的 `theme` 服务，不猜操作系统配色

## 安装

插件以 bundle 形式安装，宿主半边只做注册壳，全部 UI 在客户端半边。

```bash
# 1. 克隆到任意目录
git clone https://github.com/QiGuaiJun/dsh-prompt-library.git

# 2. 在 DSH 里安装这个目录（插件管理器 → 安装 bundle → 填入该目录绝对路径）
```

或在 DSH 会话里让 agent 调用 `plugin_manager` 的 `install_bundle`，目标为仓库目录的绝对路径。

安装完成后 **刷新页面（Ctrl+R）** 才能加载客户端 bundle。

## 使用

| 操作 | 位置 |
|---|---|
| 打开面板 | 输入框工具条的「☆ 提示词卡」 |
| 新建 | 面板右上角「新建」 |
| 填入对话 | 详情页「填入对话」按钮（面板会同时关闭） |
| 收藏某条消息 | 消息下方的「存为提示词」 |
| 备份 / 迁移 | 面板右上角「导出」→ 另一台机器「导入」 |

数据存在浏览器 `localStorage`，键名 `dsh:prompt-library:v1`。清空站点数据会丢失，请先导出。

## 数据模型

```json
{
  "version": 1,
  "prompts": [
    {
      "id": "p_lq3k9x_a1b2c3",
      "title": "接口用例生成",
      "content": "请根据以下接口文档…",
      "tags": ["自动化", "接口"],
      "note": "配合 V3 网关用",
      "source": "手动新建",
      "starred": false,
      "pinned": false,
      "createdAt": "2026-11-20T08:12:33.000Z",
      "updatedAt": "2026-11-20T08:12:33.000Z"
    }
  ]
}
```

边界：正文 ≤ 200000 字符、标题 ≤ 160 字符、标签 ≤ 24 个、单个标签 ≤ 40 字符。
数据损坏（JSON 不合法 / 结构不符）时自动回退空列表，不会崩。

## 实现要点

插件挂在 5 个槽位上：

| 槽位 | 契约 | 用途 |
|---|---|---|
| `conversation.input.left` | `list` / `session` | 「☆ 提示词卡」触发按钮 |
| `shell.overlay` | `list` / `root` | 居中浮层面板 |
| `conversation.input.right` | `list` / `session` | 渲染为 `null` 的桥接，捕获 `inputActions` |
| `conversation.chat.user.before` | `chain` / `session` | 用户消息下方「存为提示词」（必须提供 `select(owner)`） |
| `conversation.chat.assistant-actions` | `list` / `session` | 助手消息下方「存为提示词」 |

两个坑写在这里，避免后来者重走：

1. **面板必须自带实色底**。`--dsw-alias-bg-base` / `bg-layer-*` / `bg-overlay` 在本机主题下是半透明，
   `--dsw-alias-brand-primary` 甚至可能是纯白（白底白字）。这组 token 标注 `requiresLightAndDark: true`，
   本意是"给成对明暗覆盖"，不适合当背景色。插件自带 `--pcl-*` 实色令牌。
2. **明暗必须问 `theme` 服务，不能用 `prefers-color-scheme` 猜**。系统配色与 DSH 主题偏好是两个独立偏好。
   而且 `theme` 是可选服务、通常晚于 `apply` 就绪（实测 7ms 时为 null、325ms 才有），
   所以只能短轮询拿服务，**不能写进 `inject`**（声明式依赖缺失会把插件 park 死）。

完整设计见 [`docs/DESIGN.md`](docs/DESIGN.md)，用户向说明见 [`docs/DETAIL.md`](docs/DETAIL.md)。

## 目录结构

```
dsh-prompt-library/
├── package.json          # dsh.bundle.patch + dsh.client{platform:'web',immediately:true}
├── cordis.patch.yml      # bundle 插入声明
├── icon.svg              # 插件图标
├── lib/
│   ├── index.js          # 宿主半边（最小壳）
│   └── client.js         # 客户端半边（全部 UI + 数据层）
├── locale/
│   ├── en.json
│   └── zh.json
└── docs/
    ├── DESIGN.md         # 开发设计文档
    └── DETAIL.md         # 用户向使用说明
```

## License

MIT
