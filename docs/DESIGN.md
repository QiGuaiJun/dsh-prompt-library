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

**v3 依据「我不知道该用哪条」的真实困惑新增**

| # | 项 | 说明 |
|---|---|---|
| 22 | 引导入口 | 列表页搜索行**上方**一条虚线按钮「不知道下一句说什么？让库里挑一条给我」，点一下**直接填入**，不弹问卷 |
| 23 | 填入内容（三分支） | **A 强匹配**：直接把某一条的**正文全文**填进去，可直接发送；**B 有库但没把握**：只列 5 条候选（标题+什么时候用+标签），让对话里的模型挑 1 条；**C 空库**：退回「一次一问」的追问流程（6 条规则，详见 6.1/6.2） |
| 24 | 必须真按内容挑 | 本地 `scorePrompts()` 打分决定走哪个分支，**不是每次都填同一段话**——用户原话：「固定的提示词……那我还要引导干嘛呢」 |
| 25 | 覆盖保护 | 输入框已有内容时 `window.confirm` 先问「要替换吗」，取消则不写入、面板保持打开 |
| 26 | 带上最近对话 | 填入的文本必须包含最近 6 条对话（`我：` / `AI：` 角色标注）——否则每点一次都从零开始问，用户前几轮说的话全白费。来源是会话域注入的 `useChat` 快照（`nodes.values()`），经 `InputBridge` 渲染期采集存入模块级 `currentDialogue` |
| 27 | 带上写了一半的草稿 | 输入框里的现有内容**不能只是被询问是否覆盖**：用户点「确定」后，那段文字要作为「【我刚在输入框里写了一半的】」原样带进新文本（超过 2000 字截断），并注明「请在此基础上问我，不要当没看见」 |
| 28 | 挑错了不如不挑 | A 分支闸门必须三条全满足（命中 ≥2 词、≥1 个核心字段命中、领先第二名 1.6 倍），否则降级到 B。真实 34 条库实测过一次「自信地给错一条」，比不给更糟 |
| 26 | 带上最近对话 | 填入的文本必须包含最近 6 条对话（`我：` / `AI：` 角色标注），并要求 AI「已经清楚的直接跳过，从还没定下来的那一环开始问」——否则每点一次都从零开始问，用户前几轮说的话全白费。来源是会话域注入的 `useChat` 快照（`nodes.values()`），经 `InputBridge` 渲染期采集存入模块级 `currentDialogue` |
| 27 | 带上写了一半的草稿 | 输入框里的现有内容**不能只是被询问是否覆盖**：用户点「确定」后，那段文字要作为「【我刚在输入框里写了一半的】」原样带进新文本（超过 2000 字截断），并注明「请在此基础上问我，不要当没看见」。它正是用户口中最直接的「我给的需求」 |

> 未采纳的方案（留档避免重走）：`/prompt` 斜杠命令、agent 侧工具、`{{变量}}` 占位符填充、
> **引导做成弹窗问卷**（v3 曾实现 `GuideDialog` + 4 个目标选项，被用户否掉后整块删除，理由见 6.1）。

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
| 新建 | 打开 EditDialog，正文为空、需用户填；**建议顺手填「什么时候用」** |
| 编辑 | EditDialog 可改 标题 / 正文 / 标签 / **什么时候用** / 来源 / 星标；`note` 经 `upsertPrompt` 写成 `(draft.note \|\| '').trim()` |
| 「什么时候用」为什么是必填建议 | 它是引导功能的**语义索引**：`guideLine()` 把它拼进元提示词的收藏目录，AI 靠它判断该不该选这条。**缺了它，该条目在引导里只剩标题和标签**。列表卡片也会显示这一行（`.pcl-card-note`，accent 色、2 行截断）；详情页小节名从「备注」改为「什么时候用」 |
| 消息下「存为提示词」 | 打开 EditDialog，`content` 预填该消息正文，`source` 预填「用户提示词」/「助手回复」 |
| 标题留空 | 保存时用 `deriveTitle(content)` 兜底 |
| 标签输入 | `splitTags()`：按 `,` `，` `\n` `\r` 切分 → trim → 去重 → 每条限 40 字 → 最多 24 条 |
| 标签筛选 | 下拉单选；chips 是同一状态的快捷入口，点选/再点取消 |
| 置顶 | 切换 `pinned`；列表排序**置顶优先**，其余按 `updatedAt` 倒序 |
| 删除 | `window.confirm` 二次确认 |
| 导出 | 生成 `prompt-library.json` 触发下载 |
| 刷新 | 重新执行 `loadState()` 覆盖组件状态，toast「已刷新」；用于别的标签页改动后同步 |
| 导入 | 打开导入弹窗，两条等价入口：**选文件** 或 **直接粘贴 JSON**。两条路都走 `safeParse` → 以 `id` 为键合并，同 id 覆盖 → 刷新列表，并 toast「已导入 N 条」 |
| 导入（选文件） | `pickJsonFile()`：`<input type=file>` **必须先挂进 `document.body` 再 `click()`**。游离节点在 Electron 下可能不弹框 / 不触发 `onchange`；读完立刻从 DOM 摘除 |
| 导入（粘贴） | 不依赖文件对话框，桌面版选文件失灵时的兜底路径 |
| 导入失败 | 非法 JSON 提示「这段内容不是合法的 JSON」；无可用条目提示「文件里没有可导入的提示词」；绝不静默吞掉 |
| 引导入口「不知道下一句说什么？让库里挑一条给我」 | **点一下就填**，不弹问卷。`guideFill()` 读模块级 `currentDraftText`（由 `InputBridge` 的 `props.useInput` 快照写入）判断输入框是否已有内容 |
| 引导（输入框为空） | `setDraft(buildGuideText(...))`，面板关闭；toast 分叉：挑中了就点名「已填入「标题」，按回车发送」，没挑中就「已填入输入框，按回车发送，让 AI 接着问你」 |
| 引导（输入框已有内容） | `window.confirm('输入框里已经有内容，要用挑好的提示词替换掉吗？')`；取消则什么都不做、面板保持打开 |
| 引导（无可用输入框） | toast「当前没有可用的对话输入框，请先打开一个会话」 |
| 引导的三条分支 | **A 强匹配**：直接把那一条的**正文全文**交出去，可直接发送（另附最多 4 条备选标题）；**B 有库但没把握**：只列 5 条候选（标题+什么时候用+标签），由对话里的模型挑 1 条；**C 空库**：退回「一次一问」的追问流程 |
| 强匹配的判定 | `hits >= 2`（至少命中两个词）**且** `core >= 1`（至少一个命中来自 标题/标签/「什么时候用」，只在正文里撞词不算）**且** `score >= 第二名 × 1.6`（不是并列）。三条全满足才敢「替用户挑」，否则降级到 B |
| 打分权重 | 「什么时候用」3 > 标签 2 = 标题 2 > 正文前 400 字 1，再乘 IDF；正文**先剔除 `【…】` 占位符**（模板里的「【填写产品、公司…】」曾把无关条目顶到第一）；含虚词的碎渣双字（了什/是我/个问/的原）整块丢弃 |
| toast 为什么在面板关掉后还在 | `PanelOverlay` 的 `if (!open)` 分支不直接 return null，而是渲染一个 `.pcl-toast-float` 悬空 toast。引导是「填入后立刻关面板」，toast 若跟着消失，用户分不清到底填没填进去 |

### 6.1 引导：为什么不再是「一段固定话」

这一节记录**两次被否掉的方案**，避免以后重走。

**第一次被否：弹窗问卷。** 最初设计过 `GuideDialog`（4 个目标选项 + 一句处境描述，`GUIDE_GOALS`）。用户看过之后明确指出需要的不是「帮他分类」，而是：**「我的 AI 每当我迷茫下一步不知道该怎么跟 AI 聊的时候，可以通过我给的需求、场景、或者对话内容就知道我下一步该怎么跟你对话」**。理由：预设问题树面对真正模糊的需求几乎必然问偏——它不知道用户的行业、上下文和已经试过什么；而当前对话里的模型全都知道。

**第二次被否：只有方法论，没有挑选。** 改成一次点击填一段元提示词后，用户又指出致命问题：**「像你现在这种就是固定的提示词，每次问我的需求，AI 提示词给我的内容都固定，那我还要引导干嘛呢，我直接把这段话作为提示词不是更好」**。这句话是对的——如果每次填进去的都是同一段话，那它就该被当成一条普通提示词存起来，插件没有任何增量价值。

**现在的做法：三分支 + 本地挑选。** 插件用 `scorePrompts()` 在**本机**给收藏打分（纯字符串运算，不调模型、不发网络请求），按匹配强度走三条不同出口：

```
A 强匹配（hits>=2 且 core>=1 且领先第二名 1.6 倍）
    → 【我挑的这条】直接把那条的正文全文交出去，可直接发送
    → 另附最多 4 条「如果这条不对路」的备选标题

B 有库但没把握
    → 【我收藏里看起来可能相关的】列出 5 条（标题+什么时候用+标签，不塞正文）
    → 让对话里的模型挑 1 条并说明为什么

C 空库
    → 【请你这样做】+ 6 条「一次一问」规则 + 一句「攒起来之后我会按你的处境自动挑给你」
```

三种分支**都**会带上「最近对话」和「输入框里写了一半的草稿」，段落顺序固定为：开头一句 → 草稿段 → 对话段 → 分支内容 → 收尾要求。

**为什么 A 的闸门这么严。** 用户真实 34 条库上实测过：早期判定只看「领先第二名 1.6 倍」，结果「我想给公司做一个内部工具，不知道第一版做哪些功能」被自信地判给《横纵分析法》——那条是研究陌生领域/竞品的，与「设计产品第一版功能」不是一回事，赢纯属正文里撞上了「产品」「公司」。**一条自信的错推荐比不推荐更糟**（用户无力识破）。所以加了 `core >= 1`（必须在标题/标签/什么时候用里命中，正文撞词不算）和正文去占位符两道闸；代价是召回明显变低——现在四处境全部降级到 B，宁可让对话里的模型挑，也不替用户瞎点。

### 6.2 「一次一问」的 6 条规则（C 分支 / 通用）

`GUIDE_PROBE_RULES`，逐字保留：

```
1. 一次只问我一个问题，每个问题给我 2-3 个具体选项让我选，不要开放式提问。
2. 我选完，你先说一句你据此做的判断，再问下一个。
3. 每问 2-3 轮，就给我一个能立刻看到的东西（界面草图、一段话、一个最小版本），让我判断对不对。
4. 我说「不对」但说不清哪里不对时，你猜一个具体原因让我确认（「是因为 X 吗？」），不要重新问我想要什么。
5. 不要一次给我一堆问题或方案清单。
6. 等我能用一句话说出「我要什么、明确不要什么」时，你停下来总结一遍，再开始动手。
```

这 6 条来自一个判断：**模糊需求没法靠「想清楚」解决，只能靠三轮「问 → 做 → 否定」**，因为人对「不想要什么」的判断力远强于对「想要什么」的描述力。

设计约束（**不要改坏**）：
1. **B 分支只给标题 + `note` + 标签，绝不塞 `content` 正文**。34 条正文加起来一万多字，塞进去会挤掉用户真正的问题描述。
2. **A 分支必须给正文全文**——那才是「挑出适合下一轮的 prompt」，只给标题等于没给。
3. **空收藏也要能生成**——退回 C 分支，6 条规则对任何对话都有效。
4. **读当前草稿只能靠 hook 快照**：`InputActions` 只暴露 `setDraft`，没有 getter；`InputState.draft` 在 `contract/input.ts:308`，通过 `InputBridge` 里的 `props.useInput((s) => s)` 渲染期取到，存进模块级 `currentDraftText`，全程 try/catch 降级空串。
5. **必须带上最近对话**（需求 #26）。来源是会话域 `useChat` 快照（`nodes.values()`），由 `InputBridge` 渲染期采集进模块级 `currentDialogue`，只留最近 6 条、单条超 1200 字截断。没有对话时不能输出空标题。
6. **输入框里写了一半的内容要带走**（需求 #27）。截断上限 2000 字，并注明「请在此基础上问我，不要当没看见」。
7. **A 的闸门不许放宽**。放宽的直接后果是「自信地给错一条」，比降级到 B 差得多。宁可多走 B。

---

## 7. 已知取舍与风险

| # | 问题 | 现状 | 备选方案 |
|---|---|---|---|
| 1 | ~~面板是「中央栏切换」而不是「浮动浮层」~~ **v2 已解决** | 入口改为 `conversation.input.left` 自己的按钮，面板挂 `shell.overlay` 居中浮层，完全满足需求 #9 与 #10 | — |
| 2 | ~~助手消息下的「存为提示词」拿不到正文~~ **已解决** | 会话域槽位的 `standardProps` 里有 `useChat: UseChat`，`ChatSnapshot.nodes.values()` 能拿到每个 assistant 节点的 `blocks` 与 `finalNode.messageId`。按 `messageId` 匹配后拼接所有 `{kind:'text'}` 块（跳过 `reasoning`）。失败/取不到时退化为空正文，不崩 | — |
| 3 | 数据存 localStorage | 换机器/换浏览器不同步 | 补宿主 RPC 文件存储，客户端数据层是唯一需替换的模块 |
| 4 | `label` 传的是中文字面量 | 未接 i18n（`locale/en.json` 里已备好英文） | 后续接 `t()` + `ctx.locale` |
| 5 | 引导只负责「递方法/挑一条」，不保证模型照做 | A 分支给的是可直接发送的正文；B 分支的挑选权交给对话里的模型，插件无法校验它挑得对不对 | 可在详情页加「自定义引导词」。**不做**：插件自己调模型（纯 localStorage、无 API key/额度/延迟保障） |
| 6 | 本地打分天花板低 | 用双字切词 + 字段权重 + IDF，能认出「明显对得上」，但认不出同义改写（用户说「画出来」、库里写「出图」）。所以闸门收紧，多数情况降级到 B 让模型挑 | 换更厚的本地词表 / 引入同义词映射；但那会让插件变大变慢，收益存疑。**不做**：联网调 embedding |

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
node test/smoke-guide.cjs       # 「让库里挑一条」三分支 + 打分边界
```

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `test/smoke-client.cjs` | 槽位注册契约 + 列表页渲染（搜索框/下拉/chips/卡片/图钉/刷新按钮/「什么时候用」行） | 29 项通过 |
| `test/smoke-detail.cjs` | 详情页 + 复制 + 填入对话 + 编辑保存（含「什么时候用」落库）+ 新建 + 刷新 + 标签筛选 + 搜索 + **导入（粘贴/选文件/坏数据）** + 关闭后悬空 toast | 52 项通过 |
| `test/smoke-asst.cjs` | 助手消息正文提取（text 块拼接、跳过 reasoning、异常降级） | 7 项通过 |
| `test/smoke-theme.cjs` | `theme` 服务已就绪时：订阅 `theme/change`、亮/暗切换驱动 `pcl-light`、服务缺失/抛异常都不崩 | 9 项通过 |
| `test/smoke-theme-poll.cjs` | `theme` **晚就绪**：先轮询、就绪后接上并停轮询、永不就绪时 8s 后放弃且槽位仍全注册 | 12 项通过 |
| `test/smoke-guide.cjs` | 三分支：**A** 强匹配给正文全文/给出理由/开头说挑好了/toast 点名标题；**B** 列候选/带标题/不塞正文/只挑 1 条/允许说不合适/没命中不崩/提示补一条；**C** 空库 6 条规则；边界：并列不硬点、多字段命中才强匹配、**只在正文撞词不算**、**占位符不参与打分**；上下文：带最近对话、带草稿、填入后关面板、已有内容弹确认、关闭后留 toast | 46 项通过 |

合计 **155 项，失败 0**。

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

**列表页 29 项**（`test/smoke-client.cjs`）：模块注册、`inject` 含 `slots`、5 个槽位注册契约逐条比对
（`conversation.input.left` 带 `id+order`、`shell.overlay` 带 `id+order`、`input.right` 带 `id`、
`user.before` 只有 `select` 且**不带 id**、`assistant-actions` 带 `id+order`）、
chain `select` 命中返 `{text}` / 空文本返 `null`、面板默认关闭不渲染、
点入口按钮后渲染出标题/搜索框/下拉/新建/刷新/chips/卡片、
卡片显示「什么时候用」那一行、置顶条目带 📌 且排最前。

**详情页 52 项**（`test/smoke-detail.cjs`）：进入详情页显示标题与 6 个操作按钮、
「复制」写入剪贴板、「填入对话」调用 `setDraft` 且面板自动关闭（关闭后仍留一条悬空 toast）、
「编辑」改正文后正确落库且保留 `pinned`、「编辑」框里有「什么时候用」输入项且保存后落到 `note`、
「返回」回到列表、
「新建」填标题+正文后落库且标题正确、
外部改 `localStorage` 后未点「刷新」仍显示旧数据、点「刷新」后读到新条目并 toast「已刷新」、
标签下拉与 chips 行为一致（都只剩 1 张）、搜索命中标题、
**导入粘贴路径**（弹窗有选文件按钮与粘贴框、粘贴 2 条后卡片 +2 且真正落库、toast「已导入 2 条」）、
**导入选文件路径**（点按钮时 file input 必须已挂进 `document.body`、读入后落库、读完从 DOM 摘除、弹窗自动关闭）、
**导入坏数据**（非法 JSON 有明确提示且不写入任何数据）。

**助手正文提取 7 项**（`test/smoke-asst.cjs`）：按 `messageId` 命中目标消息、
拼接多个 `text` 块（空行连接）、跳过 `reasoning` 块、
来源自动预填「助手回复」、未知 `messageId` 时正文为空、`useChat` 抛异常时仍渲染按钮不崩。

**明暗跟随 9 + 12 项**（`test/smoke-theme.cjs` / `test/smoke-theme-poll.cjs`）：
`apply` 订阅 `theme/change`、宿主发亮色快照后浮层根节点带上 `pcl-light`、
再切回暗色后 `pcl-light` 消失、`theme` 服务缺失 / `getTheme()` 抛异常时 `apply` 不抛且 5 个槽位
仍全部注册；服务晚就绪时先安排轮询、就绪后立刻接上并**停止轮询**、永不就绪时到 8s 上限放弃
（不订阅、不崩）。

**引导 46 项**（`test/smoke-guide.cjs`）：列表页有 `.pcl-guide-btn` 且文案是「让库里挑一条给我」、
排在 `.pcl-searchrow` 之前、`liveDraft` 为空时不调 `window.confirm`、
点一下就把结果写进 `setDraft`；
**A 分支**：强匹配时给出该条正文全文、正文前有小标题【我挑的这条】、带挑选理由（`note`）、
开头说「挑好了一条」、toast 点名标题、另附备选标题但备选**不塞正文**；
**B 分支**：列出候选、带候选标题、**不塞正文**、只让挑 1 条、允许明说不合适、没命中词时不崩仍给可发送内容、提示可能得补一条；
**C 分支**：空库时 6 条规则关键句都在（一次只问一个 / 2-3 个具体选项 / 每问 2-3 轮给可见结果 /
「不对」时猜原因 / 不要抛一堆 / 一句话说清才动手）、含「收藏还是空的」；
**判定边界**：两条分数接近时走候选分支不硬点、同一条命中多个核心字段且明显领先才算强匹配、
**只在正文里撞词时降级为候选**、**正文里的【占位符】不参与打分**；
**上下文**：带最近对话（角色标注、在流程段之前、无对话不出现空标题）、带输入框草稿、
填入后关面板、关闭后留悬空 toast、草稿非空时 `confirmCalls.length === 1` 且文案含「替换」、
`confirmAnswer=false` 时不写且面板仍开、`confirmAnswer=true` 后才写入并关面板。

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
