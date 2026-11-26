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
| 22 | 引导入口 | 列表页搜索行**上方**一条虚线按钮「说不清要什么？让 AI 先问清楚」，点一下**直接填入**，不弹问卷 |
| 23 | 填入内容 | 一段元提示词：要求 AI 一次只问一个问题、每题给 2-3 个具体选项、每 2-3 轮给个看得见的东西、说「不对」时猜原因而不是重问、不一次抛一堆、能用一句话说清才动手（详见 6.1） |
| 24 | 附带收藏目录 | 同段话里附上最多 60 条收藏的**标题 + 什么时候用 + 标签**（不含正文），授权 AI 命中时改写成可直接发送的指令；不适配就明说缺什么 |
| 25 | 覆盖保护 | 输入框已有内容时 `window.confirm` 先问「要替换吗」，取消则不写入、面板保持打开 |
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
| 引导入口「说不清要什么？让 AI 先问清楚」 | **点一下就填**，不弹问卷。`guideFill()` 读模块级 `currentDraftText`（由 `InputBridge` 的 `props.useInput` 快照写入）判断输入框是否已有内容 |
| 引导（输入框为空） | 直接 `setDraft(buildGuideText(prompts))`，toast「已填入输入框，按回车发送，让 AI 接着问你」，面板关闭 |
| 引导（输入框已有内容） | `window.confirm('输入框里已经有内容，要用「帮我理清需求」替换掉吗？')`；取消则什么都不做、面板保持打开 |
| 引导（无可用输入框） | toast「当前没有可用的对话输入框，请先打开一个会话」 |

### 6.1 「说不清要什么」引导：为什么是一段话而不是一张问卷

这一节记录**被否掉的方案**，避免以后重走。

最初设计过弹窗问卷（4 个目标选项 + 一句处境描述，`GuideDialog` + `GUIDE_GOALS`），用户看过之后明确指出需要的不是「帮他分类」，而是：**「我的 AI 每当我迷茫下一步不知道该怎么跟 AI 聊的时候，可以通过我给的需求、场景、或者对话内容就知道我下一步该怎么跟你对话」**。于是弹窗整块删除，改成一次点击把一段元提示词填进输入框，由当前对话里的模型来完成追问。

理由：预设问题树面对真正模糊的需求几乎必然问偏——它不知道用户的行业、上下文和已经试过什么；而**当前对话里的模型全都知道**。插件只负责把「怎么问」的方法论 + 自己的收藏目录递到手边。

`buildGuideText(prompts)` 的输出结构（固定 6 条规则 + 收藏目录）：

```
我有个还很模糊的想法，说不清到底要什么。请先帮我把需求问清楚，再动手做。

【请你这样做】
1. 一次只问我一个问题，每个问题给我 2-3 个具体选项让我选，不要开放式提问。
2. 我选完，你先说一句你据此做的判断，再问下一个。
3. 每问 2-3 轮，就给我一个能立刻看到的东西（界面草图、一段话、一个最小版本），让我判断对不对。
4. 我说「不对」但说不清哪里不对时，你猜一个具体原因让我确认（「是因为 X 吗？」），不要重新问我想要什么。
5. 不要一次给我一堆问题或方案清单。
6. 等我能用一句话说出「我要什么、明确不要什么」时，你停下来总结一遍，再开始动手。

【顺便：我收藏了一些提示词】
在问我的过程中，如果你发现下面某一条正好能用上，就把它改写成一段我能直接发出去的指令，并说明为什么是这条。没有合适的就别硬凑。

- 苏格拉底式提问｜什么时候用：先把问题问清楚时用｜标签：问清问题
- …（最多 60 条）
```

设计约束（**不要改坏**）：
1. **只给标题 + `note` + 标签，绝不塞 `content` 正文**。34 条正文加起来一万多字，塞进去会挤掉用户真正的问题描述，也超出实用提示词长度。
2. **空收藏也要能生成**——目录段替换成「（我的收藏还是空的，这一步跳过。）」，前面的 6 条规则对任何对话都有效。
3. **读当前草稿只能靠 hook 快照**：`InputActions` 只暴露 `setDraft`，没有 getter；`InputState.draft` 在 `contract/input.ts:308`，通过 `InputBridge` 里的 `props.useInput((s) => s)` 渲染期取到，存进模块级 `currentDraftText`，全程 try/catch 降级空串（取不到就当空，不阻塞填入）。
4. 用户选的是「先问一句再替换」而不是「直接覆盖」，所以确认框不能省。
5. **必须带上最近对话**。这是需求 #26：没有对话段，AI 每次都从零开始问，用户前几轮已经说过的信息全白费——用户的诉求原话就是「通过我给的需求、场景、或者对话内容就知道我下一步该怎么跟你对话」。对话来源是会话域的 `useChat` 快照（`nodes.values()`），由 `InputBridge` 渲染期采集进模块级 `currentDialogue`，只留最近 6 条、单条超 1200 字截断。**没有对话时不能输出空标题**（用 `recent.length > 0` 守卫）。
6. **输入框里写了一半的内容要带走**。这是需求 #27：它是用户口中最直接的「我给的需求」，不能只被询问是否覆盖就丢掉。截断上限 2000 字，并注明「请在此基础上问我，不要当没看见」。
7. 段落顺序固定为：开头一句 → 【我刚在输入框里写了一半的】（可选）→【我们前面已经聊到的】（可选）→【请你这样做】→【顺便：我收藏了一些提示词】。上下文在前、流程在中、目录在后，模型读到规则时已经知道上下文。

---

## 7. 已知取舍与风险

| # | 问题 | 现状 | 备选方案 |
|---|---|---|---|
| 1 | ~~面板是「中央栏切换」而不是「浮动浮层」~~ **v2 已解决** | 入口改为 `conversation.input.left` 自己的按钮，面板挂 `shell.overlay` 居中浮层，完全满足需求 #9 与 #10 | — |
| 2 | ~~助手消息下的「存为提示词」拿不到正文~~ **已解决** | 会话域槽位的 `standardProps` 里有 `useChat: UseChat`，`ChatSnapshot.nodes.values()` 能拿到每个 assistant 节点的 `blocks` 与 `finalNode.messageId`。按 `messageId` 匹配后拼接所有 `{kind:'text'}` 块（跳过 `reasoning`）。失败/取不到时退化为空正文，不崩 | — |
| 3 | 数据存 localStorage | 换机器/换浏览器不同步 | 补宿主 RPC 文件存储，客户端数据层是唯一需替换的模块 |
| 4 | `label` 传的是中文字面量 | 未接 i18n（`locale/en.json` 里已备好英文） | 后续接 `t()` + `ctx.locale` |
| 5 | 引导只负责「递方法」，不保证模型照做 | 填进去的是**指令文本**，遵守程度取决于当前会话的模型；插件无法校验它有没有真的「一次只问一个」 | 可在详情页加「自定义引导词」，或在面板里加一句「模型没照做就重发一次」的提示。**不做**：插件自己调模型（纯 localStorage、无 API key/额度/延迟保障） |

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
| `test/smoke-client.cjs` | 槽位注册契约 + 列表页渲染（搜索框/下拉/chips/卡片/图钉/刷新按钮/「什么时候用」行） | 29 项通过 |
| `test/smoke-detail.cjs` | 详情页 + 复制 + 填入对话 + 编辑保存（含「什么时候用」落库）+ 新建 + 刷新 + 标签筛选 + 搜索 + **导入（粘贴/选文件/坏数据）** | 51 项通过 |
| `test/smoke-asst.cjs` | 助手消息正文提取（text 块拼接、跳过 reasoning、异常降级） | 7 项通过 |
| `test/smoke-theme.cjs` | `theme` 服务已就绪时：订阅 `theme/change`、亮/暗切换驱动 `pcl-light`、服务缺失/抛异常都不崩 | 9 项通过 |
| `test/smoke-theme-poll.cjs` | `theme` **晚就绪**：先轮询、就绪后接上并停轮询、永不就绪时 8s 后放弃且槽位仍全注册 | 12 项通过 |
| `test/smoke-guide.cjs` | 「说不清要什么」引导：入口文案与位置、输入框为空不弹确认、一键填入、6 条规则关键句齐全、带收藏标题/`note`/标签、**不塞正文**、允许 AI 改写、别硬凑、填入后关面板、已有内容时弹确认（取消不覆盖/确认才写）、**带回最近对话（角色标注/顺序在流程段前/无对话不出现空标题）**、**带回输入框里写了一半的草稿**、空收藏也能生成 | 38 项通过 |

合计 **146 项，失败 0**。

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

**详情页 51 项**（`test/smoke-detail.cjs`）：进入详情页显示标题与 6 个操作按钮、
「复制」写入剪贴板、「填入对话」调用 `setDraft` 且面板自动关闭、
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

**引导 28 项**（`test/smoke-guide.cjs`）：列表页有 `.pcl-guide-btn` 且文案是「让 AI 先问清楚」、
排在 `.pcl-searchrow` 之前、`liveDraft` 为空时不调 `window.confirm`、
点一下就把 `buildGuideText` 的结果写进 `setDraft`、
输出里 6 条规则的关键句都在（一次只问一个 / 2-3 个具体选项 / 每问 2-3 轮给可见结果 /
「不对」时猜原因 / 不要抛一堆 / 一句话说清才动手）、
**带收藏的标题与 `note` 与标签**、**不含任何条目正文**、包含「改写成一段我能直接发出去的指令」与「别硬凑」、
填入后 `shell.overlay` 渲染为 `null`（面板已关）、
草稿非空时 `confirmCalls.length === 1` 且文案含「替换」、`confirmAnswer=false` 时不写且面板仍开、
`confirmAnswer=true` 后才写入并关面板、空收藏时仍生成且含「收藏还是空的」。

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
