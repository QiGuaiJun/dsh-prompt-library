# 提示词卡 · 开发设计文档

> 插件包名：`dsh-prompt-library`　仓库根目录：`dsh-prompt-library/`
> 目标运行时：DeepSeek Harness（DSH）Web 桌面版
> 文档版本：v2（UI 按最终效果图重写：输入框按钮 + 居中浮层 + 卡片列表 + 详情页）

---

## 1. 背景与目标

日常做测试时会反复敲同一批提示词（造数据、出用例、写断言、复现步骤……），散落在历史会话里非常难找。
做一个插件，把常用提示词收藏起来，随时挑一条塞回输入框。

**验收标准**

| # | 能力 | 判定方式 |
|---|---|---|
| 1 | 输入框工具条出现「☆ 提示词卡」按钮，点击能打开面板 | 肉眼可见 |
| 2 | 面板内可新建 / 编辑 / 删除 / 星标 / 置顶 | 操作可用、刷新后仍在 |
| 3 | 可按标签单选筛选，可全文搜索（标题+正文+标签） | 输入关键字结果收敛 |
| 4 | 详情页点「填入对话」→ 正文整条替换当前对话输入框草稿 | 输入框内容变成该提示词 |
| 5 | 数据只存本地，且可导出/导入 JSON | 断网可用；导入合并去重 |
| 6 | 每条消息下方可「存为提示词」 | 弹编辑框，正文预填 |

---

## 2. 需求确认结论

**v1 已与用户逐条确认的 14 条**（其中第 1 条在 v2 被效果图覆盖）：

1. ~~**入口形态**：侧边栏一个图标~~ → **v2 改为输入框工具条按钮**（用户在效果图里明确指定）
2. **复用行为**：点条目 = **整条替换**当前草稿（不是追加、不是插入光标处）
3. **字段**：标题 / 标签 / 备注 / 星标 + 创建时间、修改时间（v2 增加**来源**与**置顶**）
4. **星标语义**：条目标记 + 「只看星标」开关式筛选，**不参与排序**
5. **标签筛选**：**单选**（不是多选、不是与搜索互斥）
6. **一键收藏**：落在**每条消息下方**（用户消息与助手消息都要）
7. **保存交互**：弹编辑框，正文**预填**、用户补齐标题/标签/备注
8. **数据范围**：**全局一套**，所有会话/工作区共享
9. **面板形态**：浮层覆盖在界面上（不是把侧边栏变宽、不是独立窗口）
10. **填入后**：面板**自动关闭**
11. **搜索范围**：标题 + 正文 + 标签
12. **标签录入**：自由文本，逗号或回车分隔，**自动去重**
13. **持久化**：本地 JSON 文件，且支持**导出 / 导入**
14. **导入策略**：追加合并，同 ID 覆盖

**v2 依据最终效果图新增/调整**

| # | 项 | 说明 |
|---|---|---|
| 15 | 入口文案 | 「☆ 提示词卡」，位于「完全权限」右侧、模型选择左侧 |
| 16 | 列表页布局 | 标题行（提示词卡 + 刷新/导入/导出/新建 + ×）→ 搜索框 + 「按标签筛选」下拉 → 标签 chips → 卡片列表 |
| 17 | 卡片内容 | 标题（不带标签 chips 到标题行）、正文 3 行截断、标签 chips |
| 18 | 详情页 | 顶部「‹ 返回　提示词卡　×」；标题行右侧一排操作：复制 / 填入对话 / 编辑 / 置顶 / 删除 |
| 19 | 详情页字段 | 标题 + 标签 chips + 「正文」小节 + 「来源」小节 |
| 20 | 置顶 | 新增 `pinned` 字段，列表里置顶优先，其余按 `updatedAt` 倒序 |
| 21 | 来源 | 新增 `source` 字段，用户消息存「用户提示词」，助手消息存「助手回复」，手动新建存「手动新建」 |

> 未采纳的方案（留档避免重走）：`/prompt` 斜杠命令、agent 侧工具、`{{变量}}` 占位符填充。

---

## 3. 技术约束（读源码 + cordis_inspect_query 实机核实过的硬事实）

### 3.1 入口：输入框工具条按钮（v2 改版）

```js
ctx.slots.inject('conversation.input.left', () =>
  ctx.slots.register(
    { name: 'conversation.input.left', id: ID + '-trigger', order: 50 },
    TriggerButton
  )
)
```

- 槽位契约：`{ kind: 'list', scope: 'session' }`，注册项 `{ id, order?, label? }`
- 位置：输入框左下工具区，「完全权限」右边、模型选择左边
- 这是**我们自己的按钮**，`onClick` 完全由我们掌控（不像侧边栏图标被宿主接管）

### 3.2 面板：`shell.overlay` 居中浮层

```js
ctx.slots.inject('shell.overlay', () =>
  ctx.slots.register({ name: 'shell.overlay', id: ID, order: 100 }, PanelOverlay)
)
```

- 槽位契约：`{ kind: 'list', scope: 'root' }`，"Frame-wide floating layer, above every column
  and outside their scroll containers"
- 目录原文："the layer itself is click-through — entries opt back into pointer events —
  so an occupant never blocks the app underneath. This is the additive seat for a
  frame-wide surface of your own: a fresh `id` is added beside the shipped entries
  instead of replacing them."
- 所以浮层根节点必须自己设 `pointer-events:auto` 才能接住点击

### 3.2.1 面板必须自带实色底，不能拿主题背景变量当「面」

实测（用户截图反馈）：面板打开后页面文字从面板后面透出来，看起来像"没底"；
「新建」按钮还是白底白字。

原因是宿主主题里的 `--dsw-alias-bg-base` / `--dsw-alias-bg-layer-1|2` / `--dsw-alias-bg-overlay`
**可能是半透明甚至是纯白**，`--dsw-alias-brand-primary` 在该配色下也可能是白色。
`Theme.listTokens` 对这些 token 全部标注 `requiresLightAndDark: true` —— 它们本意是
"给我成对的明暗覆盖"，不是"直接当背景色用"。

**定论**：插件自带一套**实色令牌**（`--pcl-bg / --pcl-card / --pcl-field / --pcl-line /
--pcl-text / --pcl-dim / --pcl-accent / --pcl-on-accent / --pcl-danger / --pcl-overlay`），
暗色为默认值，`.pcl-light` 覆盖成亮色；宿主主题变量只用于**触发按钮**的边框/文字
（那里透明是正确的）。面板内**零处**使用 `--dsw-alias-bg-*`。

### 3.2.2 明暗判断：跟随 `theme` 服务，不猜 OS

`theme` 是 **Client Service**（不是 Host Service，`Service.listService` 在 host 侧查不到它）：

```ts
getTheme(): ThemeSnapshot   // snapshot.active.colorScheme: 'light' | 'dark'
```
事件 `theme/change` `(snapshot: ThemeSnapshot): void` 在偏好切换 / 注册表变化 /
OS 配色在 `system` 偏好下翻转时触发。

**启动竞态（实测，必须处理）**：`theme` 是**可选服务**，通常晚于 `apply` 才就绪
（wallpaper-engine 的注释记录：7ms 时 `ctx.get('theme')` 为 null，325ms 才有）。
所以：

- 不能只在 `apply` 里取一次；
- 更不能写进 `inject`（声明式依赖缺失会把整个插件 park 死）；
- 做法：`apply` 里先试一次，拿不到就短轮询 `ctx.get('theme')`（250ms × 最多 8s），
  **拿到即停**，然后 `ctx.on('theme/change', ...)` 订阅并把快照推给组件。

**反向教训**：v2 第一版用 `@media (prefers-color-scheme: light)` 猜，用户系统是浅色但
宿主主题是深色时会整片配色车祸。这不只是"猜得不准"，而是**两个独立偏好**。

### 3.3 侧边栏方案为什么被放弃（v1 的历史，留档避免重走）

v1 用的是侧边栏入口。宿主侧边栏的点击行为是硬接管的：

宿主 `SidebarRoot.tsx:80-100` 的 `onClick` 调 `selectPanel(id)`，
最终落到 `ILayout.selectPanel(panelId)`（`dsh-client-ui-layout/src/client/service.ts:36`）：

```ts
selectPanel(panelId: MainPanelId | null): void
```

- 该 API 在 `panelId` 未注册时会 **throw**：
  `layout.selectPanel: main panel "${panelId}" is not registered`
  （`dsh-client-ui-layout/src/client/service.ts:71-78`）
- 判定依据 `hasMainPanel`：`ctx.slots.entries('main').some(e => e.options.key === id)`
  （`dsh-client-ui-layout/src/client/index.ts:188-189`）

**推论**：插件不能自己给图标挂 `onClick`；注册了 `sidebar.panellist` 就必须同时注册
同 key 的 `main` 面板；侧边栏点击**只能把中央栏切到 main 面板，开不出浮动浮层**。
这与"居中浮层面板"的视觉要求冲突，所以 v2 改走输入框按钮 + `shell.overlay`。

### 3.3 往输入框写内容

唯一入口是 `inputActions.setDraft(text: string): void`（整条替换，会清掉内联引用芯片）
（`dsh-client-ui-conversation/src/client/contract/input.ts:260-334`，签名见 `:194-195` / `:281-282`）

拿 `inputActions` 的办法：往 `conversation.input.right` 槽注册一个**渲染为 null 的桥接组件**。
该槽是 `session` 域 list 槽，宿主会自动注入 `SessionStandardProps`：

```ts
{ useConversation, useInput, inputActions }   // contract/slots.ts:395-402
```

> `sessions` 服务**不**暴露活跃会话的 `inputActions`，所以必须走槽位桥接。
> 桥接组件把 `props.inputActions` 存到模块级变量，会话切换时自动覆盖；无会话时保持 `null`，需判空。

### 3.4 消息下方按钮

消息级槽位**不在** `dsh-client-ui-conversation`，而在 `dsh-client-ui-chat`：

| 槽位 | 形态 | owner props |
|---|---|---|
| `conversation.chat.user.before` | chain / session | `{ source, kind: 'user' \| 'steering' }` |
| `conversation.chat.turnTail` | list / session | `{ turn: TurnLocation; seq: number; openFile }` |
| `conversation.chat.assistant-actions` | list / session | `{ messageId: MessageId }` |

（`dsh-client-ui-chat/src/client/contract/slots.ts:462 / :492 / :498`，owner props 在 `:59-69`、`:230-235`、`:257-260`）

**用户消息**的内容可直接从 `source` 拿到纯文本（`UserContentData.text`，同文件 `:257-260`）。

**助手消息**的 owner props 只有 `{ messageId }`，没有正文。取正文靠**会话域槽位自动注入的 `useChat`**：

```ts
useChat: UseChat            // = SnapshotSelectorHook<ChatSnapshot>
ChatSnapshot.nodes.values() // → ChatConversationViewNode[]
node.data.blocks            // AssistantBlock[]，{kind:'text'|'reasoning'|'tool-call'|...}
node.data.finalNode.messageId
```

详见 `dsh-client-ui-chat/src/client/contract/snapshot.ts:111-118`（`ChatSnapshot`）、
`:33-55`（`ChatNodeStore`）、`chat-nodes.ts:37-51`（`AssistantChatData`）、
`dsh-client-ui-conversation/src/client/contract/records.ts:34-39`（`AssistantBlock`）。

> **`conversation.chat.user.before` 是 `chain` 槽，注册契约与 list 槽不同**：
> 注册项必须提供 `select(owner) => unknown | null`，返回非 `null` 即选中该组件，
> 并把返回值作为 `matched` prop 传进来。实测宿主把 `inputActions` 也注入了 session 域槽位。
>
> 当前实现：
> - `user.before` → `{ select: (owner) => pickMessageText(owner).trim() ? { text } : null }`，
>   `pickMessageText` 依次尝试 `owner.text` → `owner.matched`(string|`{text}`) → `owner.source`(string|`{text|content}`)
> - `assistant-actions` → `{ id: '<pkg>-save-assistant', order: 20 }`；正文由
>   `pickAssistantText(props)` 从 `useChat` 快照里按 `messageId` 匹配 `blocks` 的 `{kind:'text'}` 拼接得到

### 3.5 其它硬性约束

- 宿主半边是**普通 Node ESM**，不在沙箱里，可用 `node:fs` / `node:path` / `node:crypto`
- 客户端**禁止** `require('@deepseek-ai/dsh-client-ui-primitives')`，控件自己写
- 配色只能用 `--dsw-alias-*` CSS 变量，且必须同时适配亮色/暗色
- 不要在组件外直接改 DOM（除了注入 `<style>`）
- 服务只能在 `apply()` 里 `ctx.get(...)` 拿，不能在 `factory` 里 require

---

## 4. 架构

```
┌───────────────────────── 客户端半边 lib/client.js ─────────────────────────┐
│                                                                            │
│  conversation.input.left ──► TriggerButton   「☆ 提示词卡」                │
│        点一下 → setPanelOpen(!panelOpen)（模块级，跨槽共享）                │
│                                                                            │
│  shell.overlay ──► PanelOverlay                                             │
│        ├─ ListView   搜索 / 按标签筛选下拉 / 标签 chips / 卡片列表          │
│        ├─ DetailView 复制 / 填入对话 / 编辑 / 置顶 / 删除 + 正文 + 来源     │
│        └─ EditDialog 新建或编辑                                             │
│                                                                            │
│  conversation.input.right ──► InputBridge (render null)                    │
│        把 props.inputActions 存进模块级 currentInputActions                 │
│                                                                            │
│  conversation.chat.user.before ──► SaveAction  (chain 槽，靠 select 命中)   │
│  conversation.chat.assistant-actions ──► SaveAction (list 槽，id 常驻)      │
│        点「存为提示词」→ EditDialog（正文预填）→ 入库                        │
│                                                                            │
│  数据层  localStorage['dsh:prompt-library:v1']  ⇄  load/save/导入/导出      │
└────────────────────────────────────────────────────────────────────────────┘
┌───────────────────────── 宿主半边 lib/index.js ───────────────────────────┐
│  最小壳：export const name / export function apply(ctx) 打一行日志          │
└────────────────────────────────────────────────────────────────────────────┘
```

**为什么宿主要做成空壳**：原本设计用 `ctx.connection.rpc.handle('/prompt-library', handler)`
把数据写到 `~/.dsh/prompt-library/prompts.json`，但**客户端如何调用这个 RPC 通道始终没验证成功**
（翻遍 `dsh-context` / `dsh-boot-suite` / 各 client bundle 都没拿到确切调用方式）。
为了不把整个功能卡死在这个未知数上，改为 **localStorage 持久化**——依然 100% 只存本地，
且天然满足需求 #13 的导出/导入（导出即把 localStorage 内容序列化成 JSON 文件下载）。

> 若后续要做「跨浏览器/跨机器共享」或「数据文件可被 Git 管理」，
> 再补宿主侧文件存储 + RPC 即可，客户端数据层是唯一需要替换的模块。

---

## 5. 数据模型

```jsonc
{
  "version": 1,
  "prompts": [
    {
      "id": "p_lq3k9x_a1b2c3",          // 新建时生成，用于覆盖合并
      "title": "接口用例生成",           // 留空自动取正文首个非空行前 60 字
      "content": "请根据以下接口文档…",   // 必填
      "tags": ["自动化", "接口"],        // 去重、每条 ≤40 字符、最多 24 个
      "note": "配合 V3 网关用",          // 可选，详情页有内容时才显示
      "source": "手动新建",              // v2 新增：手动新建 / 用户提示词 / 助手回复
      "starred": false,
      "pinned": false,                  // v2 新增：置顶优先排序
      "createdAt": "2026-11-20T08:12:33.000Z",
      "updatedAt": "2026-11-20T08:12:33.000Z"
    }
  ]
}
```

**排序规则**：`pinned` 优先，其次 `updatedAt` 倒序。

**容错策略**：`safeParse` 遇到非法 JSON / 结构不符一律回退空状态，不抛异常；
单条记录缺 `content` 直接丢弃，缺其它字段补默认值（`source` 缺省为空串、`pinned` 缺省 false）。
旧版数据（无 `source`/`pinned`）可直接读取，不需要迁移。

---

## 6. 交互细节

| 场景 | 行为 |
|---|---|
| 点卡片主体 | 进入详情页 |
| 详情页「填入对话」 | 取 `content` 调 `setDraft(content)`，toast「已填入对话」，面板自动关闭 |
| 详情页「复制」 | `navigator.clipboard.writeText(content)`；失败则 `execCommand('copy')` 兜底；再失败 toast「复制失败，请手动选择正文」 |
| 无可用输入框 | toast「当前没有可用的对话输入框，请先打开一个会话」，不静默失败 |
| 新建 | 打开 EditDialog，正文为空、需用户填 |
| 消息下「存为提示词」 | 打开 EditDialog，`content` 预填该消息正文，`source` 预填「用户提示词」/「助手回复」 |
| 标题留空 | 保存时用 `deriveTitle(content)` 兜底 |
| 标签输入 | `splitTags()`：按 `,` `，` `\n` `\r` 切分 → trim → 去重 → 每条限 40 字 → 最多 24 条 |
| 标签筛选 | 下拉单选；chips 是同一状态的快捷入口，点选/再点取消 |
| 置顶 | 切换 `pinned`；列表排序**置顶优先**，其余按 `updatedAt` 倒序 |
| 删除 | `window.confirm` 二次确认 |
| 导出 | 生成 `prompt-library.json` 触发下载 |
| 刷新 | 重新执行 `loadState()` 覆盖组件状态，toast「已刷新」；用于别的标签页改动后同步 |
| 导入 | 读文件 → `safeParse` → 以 `id` 为键合并，同 id 覆盖 → 刷新列表 |

---

## 7. 已知取舍与风险

| # | 问题 | 现状 | 备选方案 |
|---|---|---|---|
| 1 | ~~面板是「中央栏切换」而不是「浮动浮层」~~ **v2 已解决** | 入口改为 `conversation.input.left` 自己的按钮，面板挂 `shell.overlay` 居中浮层，完全满足需求 #9 与 #10 | — |
| 2 | ~~助手消息下的「存为提示词」拿不到正文~~ **已解决** | 会话域槽位的 `standardProps` 里有 `useChat: UseChat`，`ChatSnapshot.nodes.values()` 能拿到每个 assistant 节点的 `blocks` 与 `finalNode.messageId`。按 `messageId` 匹配后拼接所有 `{kind:'text'}` 块（跳过 `reasoning`）。失败/取不到时退化为空正文，不崩 | — |
| 3 | 数据存 localStorage | 换机器/换浏览器不同步 | 补宿主 RPC 文件存储，客户端数据层是唯一需替换的模块 |
| 4 | `label` 传的是中文字面量 | 未接 i18n（`locale/en.json` 里已备好英文） | 后续接 `t()` + `ctx.locale` |

---

## 8. 文件清单

```
dsh-prompt-library/
├── package.json          # dsh.bundle.patch + dsh.client{platform:'web',immediately:true}
├── cordis.patch.yml      # bundle 插入声明
├── icon.svg              # 插件图标
├── lib/
│   ├── index.js          # 宿主半边（当前最小壳）
│   └── client.js         # 客户端半边（全部 UI + 数据层）
├── locale/
│   ├── en.json           # meta.title / meta.description
│   └── zh.json
└── docs/
    ├── DESIGN.md         # 本文档
    └── DETAIL.md         # 插件详情页（用户向使用说明）
```

---

## 9. 验证记录

全部在**离线 harness** 里跑通（假 `window.__ModuleLoader__` + React shim + 记录型 `ctx` + 内存版 `localStorage`），
脚本在仓库的 `test/` 目录（CommonJS，`.cjs` 后缀——因为 `package.json` 声明了 `"type": "module"`）：

```bash
cd dsh-prompt-library
node test/smoke-client.cjs      # 槽位契约 + 列表页
node test/smoke-detail.cjs      # 详情页 + 复制 + 填入 + 编辑 + 新建
node test/smoke-asst.cjs        # 助手消息正文提取
node test/smoke-theme.cjs       # 明暗跟随（服务已就绪）
node test/smoke-theme-poll.cjs  # 明暗跟随（服务晚就绪）
```

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `test/smoke-client.cjs` | 槽位注册契约 + 列表页渲染（搜索框/下拉/chips/卡片/图钉/刷新按钮） | 28 项通过 |
| `test/smoke-detail.cjs` | 详情页 + 复制 + 填入对话 + 编辑保存 + 新建 + 刷新 + 标签筛选 + 搜索 | 34 项通过 |
| `test/smoke-asst.cjs` | 助手消息正文提取（text 块拼接、跳过 reasoning、异常降级） | 7 项通过 |
| `test/smoke-theme.cjs` | `theme` 服务已就绪时：订阅 `theme/change`、亮/暗切换驱动 `pcl-light`、服务缺失/抛异常都不崩 | 9 项通过 |
| `test/smoke-theme-poll.cjs` | `theme` **晚就绪**：先轮询、就绪后接上并停轮询、永不就绪时 8s 后放弃且槽位仍全注册 | 12 项通过 |

合计 **90 项，失败 0**。

**在线槽位核实**（`cordis_inspect_query` 读运行中 GUI 的真实槽位树，全部 `active: true`）

| 槽 | 我们的注册 |
|---|---|
| `conversation.input.left` | `id: dsh-prompt-library-trigger`, `order: 50` |
| `shell.overlay` | `id: dsh-prompt-library`, `order: 100` |
| `conversation.input.right` | `id: dsh-prompt-library-bridge` |
| `conversation.chat.assistant-actions` | `id: dsh-prompt-library-save-assistant`, `order: 20` |

**槽位注册契约（离线 5 项）**

| 槽 | 注册项 |
|---|---|
| `conversation.input.left` | `{ name, id:'dsh-prompt-library-trigger', order:50 }` |
| `shell.overlay` | `{ name, id:'dsh-prompt-library', order:100 }` |
| `conversation.input.right` | `{ name, id:'dsh-prompt-library-bridge' }` |
| `conversation.chat.user.before` | `{ name, select(owner) }`（chain 槽，无 id） |
| `conversation.chat.assistant-actions` | `{ name, id:'dsh-prompt-library-save-assistant', order:20 }` |

**列表页 28 项**（`test/smoke-client.cjs`）：模块注册、`inject` 含 `slots`、5 个槽位注册契约逐条比对
（`conversation.input.left` 带 `id+order`、`shell.overlay` 带 `id+order`、`input.right` 带 `id`、
`user.before` 只有 `select` 且**不带 id**、`assistant-actions` 带 `id+order`）、
chain `select` 命中返 `{text}` / 空文本返 `null`、面板默认关闭不渲染、
点入口按钮后渲染出标题/搜索框/下拉/新建/刷新/chips/卡片、置顶条目带 📌 且排最前。

**详情页 34 项**（`test/smoke-detail.cjs`）：进入详情页显示标题与 6 个操作按钮、
「复制」写入剪贴板、「填入对话」调用 `setDraft` 且面板自动关闭、
「编辑」改正文后正确落库且保留 `pinned`、「返回」回到列表、
「新建」填标题+正文后落库且标题正确、
外部改 `localStorage` 后未点「刷新」仍显示旧数据、点「刷新」后读到新条目并 toast「已刷新」、
标签下拉与 chips 行为一致（都只剩 1 张）、搜索命中标题。

**助手正文提取 7 项**（`test/smoke-asst.cjs`）：按 `messageId` 命中目标消息、
拼接多个 `text` 块（空行连接）、跳过 `reasoning` 块、
来源自动预填「助手回复」、未知 `messageId` 时正文为空、`useChat` 抛异常时仍渲染按钮不崩。

**明暗跟随 9 + 12 项**（`test/smoke-theme.cjs` / `test/smoke-theme-poll.cjs`）：
`apply` 订阅 `theme/change`、宿主发亮色快照后浮层根节点带上 `pcl-light`、
再切回暗色后 `pcl-light` 消失、`theme` 服务缺失 / `getTheme()` 抛异常时 `apply` 不抛且 5 个槽位
仍全部注册；服务晚就绪时先安排轮询、就绪后立刻接上并**停止轮询**、永不就绪时到 8s 上限放弃
（不订阅、不崩）。

> 备注：测试中一度出现「保存后 localStorage 为空」，定位为 harness 自身缺陷
> （`saveState` 用 `window.localStorage`，而 harness 只挂了 `global.localStorage`，
> 异常被 `try/catch` 静默吞掉）。另一处「新建标题没生效」也是 harness 选择器问题
> （`inputs[0]` 实际是搜索框）。修正 harness 后全绿，**均不是插件 bug**。

---

## 10. 待办（按优先级）

1. `label` / 面板文案接 i18n（`locale/en.json` 已备好英文）
2. 补宿主侧文件存储（若确需跨端同步）
3. 面板打开时自动聚焦搜索框
4. 助手消息提取目前依赖 `data.finalNode.messageId ?? data.messageId` 匹配；
   若后续 DSH 把 `messageId` 只放在别处，需跟进调整
