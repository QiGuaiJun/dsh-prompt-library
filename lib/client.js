/**
 * dsh-prompt-library —— 客户端半边。
 *
 * 入口：输入框工具条上的「☆ 提示词卡」按钮
 * 面板：居中浮层（列表页 / 详情页两种视图）
 * 复用：点「填入对话」把正文整条填进当前输入框
 * 数据：浏览器 localStorage（只在本机），支持导出/导入 JSON
 */

window.__ModuleLoader__.load({
  id: 'dsh-prompt-library',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const ID = 'dsh-prompt-library'
    const STORE_KEY = 'dsh:prompt-library:v1'

    /* ---------------- 数据层 ---------------- */

    function emptyState() {
      return { version: 1, prompts: [] }
    }

    function newId() {
      return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
    }

    function safeParse(raw) {
      if (typeof raw !== 'string' || raw === '') return emptyState()
      try {
        const data = JSON.parse(raw)
        if (!data || !Array.isArray(data.prompts)) return emptyState()
        return {
          version: 1,
          prompts: data.prompts
            .filter((p) => p && typeof p.content === 'string' && p.content !== '')
            .map((p) => ({
              id: typeof p.id === 'string' && p.id ? p.id : newId(),
              title: typeof p.title === 'string' ? p.title : '',
              content: p.content,
              tags: Array.isArray(p.tags)
                ? p.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
                : [],
              note: typeof p.note === 'string' ? p.note : '',
              source: typeof p.source === 'string' ? p.source : '',
              starred: p.starred === true,
              pinned: p.pinned === true,
              createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
              updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString(),
            })),
        }
      } catch {
        return emptyState()
      }
    }

    function loadState() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY)
        return safeParse(raw === null ? '' : raw)
      } catch {
        return emptyState()
      }
    }

    function saveState(state) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(state))
      } catch {
        /* 配额满或隐私模式：静默失败，界面仍可用 */
      }
    }

    function splitTags(text) {
      if (typeof text !== 'string') return []
      const out = []
      for (const part of text.split(/[,，\n\r]+/)) {
        const t = part.trim()
        if (!t) continue
        if (out.indexOf(t) >= 0) continue
        out.push(t.length > 40 ? t.slice(0, 40) : t)
        if (out.length >= 24) break
      }
      return out
    }

    function deriveTitle(content) {
      const text = String(content || '')
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim()
        if (t) return t.length > 60 ? t.slice(0, 60) : t
      }
      return '未命名提示词'
    }

    /* ---------------- 「不知道怎么选」引导 ----------------
     * 设计取舍（见 docs/DESIGN.md 4.1）：
     * 插件自己不调模型（纯本地 localStorage，没有 API key / 额度 / 延迟保障），
     * 也不做关键词精确匹配（新手连提示词叫什么都不知道，词汇鸿沟必然失配）。
     * 点一下就把一段元提示词填进输入框，由当前对话里的模型完成追问与改写。
     */

    /** 一条提示词在索引里如何呈现：标题 + 适用场景 + 标签，够模型判断即可，不塞正文 */
    function guideLine(p) {
      const parts = ['- ' + (p.title || deriveTitle(p.content))]
      if (p.note && p.note.trim()) parts.push('｜什么时候用：' + p.note.trim())
      if (p.tags && p.tags.length) parts.push('｜标签：' + p.tags.join('/'))
      return parts.join('')
    }

    /* 纯噪声的双字组合，不参与匹配（否则「我们」「怎么」这类词会主导打分） */
    const STOP_BIGRAMS = [
      '我们', '你们', '他们', '现在', '怎么', '什么', '这个', '那个', '的话', '可以', '需要',
      '帮我', '一个', '还是', '就是', '没有', '不是', '因为', '所以', '如果', '时候', '知道',
      '觉得', '感觉', '东西', '问题', '情况', '我想', '我要', '你能', '不能', '这样', '那样',
      '然后', '已经', '应该', '可能', '比较', '一直', '有点', '一点', '不太', '到底', '如何',
      '哪些', '哪个', '这些', '那些', '第一', '第二', '两个', '几个', '一下', '一样',
      '一遍', '系统', '直接', '清楚', '整体', '具体', '大致', '大概', '通常', '一般',
      '其中', '之间', '方面', '方式', '过程', '结果', '内容', '包括', '通过', '根据',
    ]

    /* 含这些字的双字组合基本都是「跨词切出来的碎渣」（了什 / 是我 / 个问 / 的原 / 面症），
       它们会撞上正文里的偶然相邻字，把不相干的条目顶到第一。整块丢掉。
       代价是召回会低一些：拿不准时走「列候选」分支，比自信地给错一条安全。 */
    const STOP_CHARS = new Set(
      '的了是我你他她它在个这不和就都也很要会更太挺真呀哦吗呢吧啊把被给让对从到与及或而但又再还只才之其每各该此另哪'
    )

    /** 极简切词：中文按双字切、英文按词切。纯本地，不调模型。 */
    function tokenize(text) {
      const s = String(text || '').toLowerCase()
      const out = []
      const keep = (t) => {
        if (!t) return false
        for (const ch of t) if (STOP_CHARS.has(ch)) return false
        return true
      }
      const words = s.match(/[a-z0-9][a-z0-9_+#.\-]{1,}/g)
      if (words) for (const w of words) out.push(w)
      const runs = s.match(/[\u4e00-\u9fff]+/g)
      if (runs) {
        for (const run of runs) {
          if (run.length === 1) {
            if (keep(run)) out.push(run)
            continue
          }
          for (let i = 0; i + 1 < run.length; i++) {
            const bi = run.slice(i, i + 2)
            if (keep(bi)) out.push(bi)
          }
        }
      }
      return out
    }

    /**
     * 按「当前对话 + 输入框草稿」给收藏打分。
     * 权重：什么时候用(3) > 标签(2) = 标题(2) > 正文前 400 字(1)，
     * 再用 IDF 压低「在很多条里都出现」的通用词，让有区分度的词胜出。
     * 正文要先去占位符：很多模板正文带「【填写产品、公司、人物…】」这种空槽说明，
     * 那里的「产品」「公司」跟用户真实处境毫无关系，会把模板硬顶到第一名。
     * 纯本地计算，没有模型调用，也不做「关键词必须精确命中」那种硬规则。
     */
    function scorePrompts(prompts, contextText) {
      const list = Array.isArray(prompts) ? prompts : []
      const qSet = new Set()
      const q = []
      for (const t of tokenize(contextText)) {
        if (t.length < 2) continue
        if (STOP_BIGRAMS.indexOf(t) >= 0) continue
        if (qSet.has(t)) continue
        qSet.add(t)
        q.push(t)
      }
      if (!list.length || !q.length) return []

      const docs = list.map((p) => ({
        prompt: p,
        fields: [
          { w: 3, toks: new Set(tokenize(p.note || '')) },
          { w: 2, toks: new Set(tokenize((p.tags || []).join(' '))) },
          { w: 2, toks: new Set(tokenize(p.title || '')) },
          /* 正文只留「实义部分」：去掉【…】里的填写提示、以及「请使用 xx 法」这类格式话。 */
          {
            w: 1,
            toks: new Set(
              tokenize(
                String(p.content || '')
                  .replace(/【[^】]*】/g, ' ')
                  .replace(/＊|—{2,}|\*{2,}/g, ' ')
                  .slice(0, 400)
              )
            ),
          },
        ],
      }))

      const df = new Map()
      for (const d of docs) {
        const all = new Set()
        for (const f of d.fields) for (const t of f.toks) all.add(t)
        for (const t of all) df.set(t, (df.get(t) || 0) + 1)
      }
      const N = docs.length
      const idf = (t) => Math.log(1 + N / (1 + (df.get(t) || 0)))

      const scored = []
      for (const d of docs) {
        let score = 0
        let hits = 0
        /* core = 命中「标题/标签/什么时候用」的次数。只看正文撞词不算核心命中，
           因为正文里的通用名词（产品、方案、代码…）区分度太低。 */
        let core = 0
        const words = []
        for (const t of q) {
          let best = 0
          for (const f of d.fields) if (f.toks.has(t) && f.w > best) best = f.w
          if (best > 0) {
            score += idf(t) * best
            hits++
            if (best >= 2) core++
            words.push(t + (best >= 2 ? '*' : ''))
          }
        }
        if (score > 0) scored.push({ prompt: d.prompt, score, hits, core, words })
      }
      return scored.sort(
        (a, b) => (b.score - a.score) || String(b.prompt.updatedAt).localeCompare(String(a.prompt.updatedAt))
      )
    }

    /** 从库里挑候选：强匹配（够格直接给正文）与弱匹配（只能列出来让 AI 挑） */
    function pickGuideCandidates(prompts, dialogue, draftText) {
      const recent = Array.isArray(dialogue) ? dialogue : []
      const draft = String(draftText || '').trim()
      const ctx = []
      if (draft) ctx.push(draft)
      for (const m of recent) if (m && m.text) ctx.push(m.text)
      const ranked = scorePrompts(prompts, ctx.join('\n'))
      /* 判「强」不看绝对分（分数随库大小浮动），只看三条：
         ①至少命中两个词，不是偶然撞上一个；
         ②至少一个命中来自标题/标签/「什么时候用」——只在正文里撞词的不算，
           否则模板正文里的通用名词会把不相干的条目顶上来；
         ③明显领先第二名（1.6 倍），不是并列。 */
      const first = ranked[0]
      const second = ranked[1]
      const leading = !!(first && first.hits >= 2 && first.core >= 1 && (!second || first.score >= second.score * 1.6))
      const strong = leading ? [first] : []
      const near = ranked.filter((r) => r.hits >= 1).slice(0, 5)
      return { strong, near, recent, draft }
    }

    const GUIDE_PROBE_RULES = [
      '1. 一次只问我一个问题，每个问题给我 2-3 个具体选项让我选，不要开放式提问。',
      '2. 我选完，你先说一句你据此做的判断，再问下一个。',
      '3. 每问 2-3 轮，就给我一个能立刻看到的东西（界面草图、一段话、一个最小版本），让我判断对不对。',
      '4. 我说「不对」但说不清哪里不对时，你猜一个具体原因让我确认（「是因为 X 吗？」），不要重新问我想要什么。',
      '5. 不要一次给我一堆问题或方案清单。',
      '6. 等我能用一句话说出「我要什么、明确不要什么」时，你停下来总结一遍，再开始动手。',
    ]

    /**
     * 组装填进输入框的文本。三种情况走不同分支，**不再是同一段固定话**：
     *   A. 库里有强匹配 → 直接把那条的正文给你，你可以直接发送
     *   B. 只有弱匹配   → 列出候选，让对话里的 AI 从库里替你挑一条
     *   C. 库是空的     → 退回「一次一问」的追问流程
     * 三种都会带上「最近对话」和「输入框里写了一半的草稿」。
     */
    function buildGuideText(prompts, dialogue, draftText) {
      const list = Array.isArray(prompts) ? prompts : []
      const { strong, near, recent, draft } = pickGuideCandidates(list, dialogue, draftText)
      const top = strong[0] ? strong[0].prompt : null
      const out = []

      out.push(
        top
          ? '按我们前面聊的内容，我从我的提示词库里挑好了一条，直接发送就能用。'
          : list.length
            ? '我说不清该用哪条，请从我的提示词库里替我挑一条，然后直接帮我往下做。'
            : '我有个还很模糊的想法，说不清到底要什么。请先帮我把需求问清楚，再动手做。'
      )

      if (draft) {
        out.push('')
        out.push('【我刚在输入框里写了一半的】')
        out.push(draft.length > 2000 ? draft.slice(0, 2000) + '…' : draft)
        out.push('（这是我自己写的，可能不完整也不准确，请在此基础上继续，不要当没看见。）')
      }

      if (recent.length > 0) {
        out.push('')
        out.push('【我们前面已经聊到的】')
        out.push('（这部分是既有对话，请当成已知信息，不要再问一遍。）')
        for (const m of recent) out.push(m.role + '：' + m.text)
      }

      if (top) {
        /* A：强匹配——把那条的正文原样交出，这才是「挑出适合下一轮的 prompt」 */
        out.push('')
        out.push('【我挑的这条】')
        out.push(
          '《' +
            (top.title || deriveTitle(top.content)) +
            '》' +
            (top.note && top.note.trim() ? '——' + top.note.trim() : '')
        )
        out.push('')
        out.push(String(top.content || '').trim())

        const others = near.filter((r) => r.prompt.id !== top.id).slice(0, 4)
        if (others.length) {
          out.push('')
          out.push('【如果这条不对路，下面几条可能更接近】')
          for (const r of others) out.push(guideLine(r.prompt))
        }

        out.push('')
        out.push('【请你这样做】')
        out.push('1. 我挑的这条如果不对路，不要反问我想要什么，直接从上面的候选里另挑一条，说一句为什么。')
        out.push('2. 对路就直接按它做；确实缺关键信息时，只问我一个最关键的问题。')
        out.push('3. 上面「已经聊到的」里清楚的不要再问。')
      } else if (list.length) {
        /* B：有库但没把握——列出候选，让对话里的模型来挑 */
        out.push('')
        out.push('【我收藏里看起来可能相关的】')
        if (near.length) {
          for (const r of near) out.push(guideLine(r.prompt))
        } else {
          out.push('（没有明显相关的，可能得先补一条。）')
        }
        out.push('')
        out.push('【请你这样做】')
        out.push('1. 从上面挑出最适合我现在情况的那一条，只挑 1 条，说一句为什么。')
        out.push('2. 都不合适就明说，并告诉我该补一条什么样的提示词。')
        out.push('3. 然后按你挑的那条，帮我把这件事往下推进；需要我补信息时只问一个最关键的问题。')
        out.push('4. 上面「已经聊到的」里清楚的不要再问。')
      } else {
        /* C：空库——退回追问流程 */
        out.push('')
        out.push('【请你这样做】')
        for (const r of GUIDE_PROBE_RULES) out.push(r)
        if (recent.length > 0 || draft) {
          out.push('7. 上面「已经聊到的」里已经清楚的，直接跳过，从还没定下来的那一环开始问。')
        }
        out.push('')
        out.push('【顺便：我收藏了一些提示词】')
        out.push('（我的收藏还是空的，这一步跳过。攒起来之后，我会按你的处境自动挑给你。）')
      }

      return { text: out.join('\n'), picked: top }
    }

    /** 排序：置顶优先，其次按更新时间倒序 */
    function sortPrompts(list) {
      return list.slice().sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return String(b.updatedAt).localeCompare(String(a.updatedAt))
      })
    }

    function upsertPrompt(draft) {
      const state = loadState()
      const now = new Date().toISOString()
      const tags = splitTags(draft.tagsText != null ? draft.tagsText : (draft.tags || []).join(','))
      if (draft.id) {
        const i = state.prompts.findIndex((p) => p.id === draft.id)
        if (i >= 0) {
          state.prompts[i] = {
            ...state.prompts[i],
            title: (draft.title || '').trim() || deriveTitle(draft.content),
            content: draft.content,
            tags,
            note: (draft.note || '').trim(),
            source: (draft.source || '').trim() || state.prompts[i].source || '手动新建',
            starred: draft.starred === true,
            updatedAt: now,
          }
        }
      } else {
        state.prompts.unshift({
          id: newId(),
          title: (draft.title || '').trim() || deriveTitle(draft.content),
          content: draft.content,
          tags,
          note: (draft.note || '').trim(),
          source: (draft.source || '').trim() || '手动新建',
          starred: draft.starred === true,
          pinned: false,
          createdAt: now,
          updatedAt: now,
        })
      }
      saveState(state)
    }

    function removePrompt(id) {
      const state = loadState()
      state.prompts = state.prompts.filter((p) => p.id !== id)
      saveState(state)
    }

    function togglePin(id) {
      const state = loadState()
      const p = state.prompts.find((x) => x.id === id)
      if (p) p.pinned = !p.pinned
      saveState(state)
    }

    /* ---------------- 面板开关（模块级，跨槽共享） ---------------- */

    let panelOpen = false
    const openListeners = new Set()

    function setPanelOpen(next) {
      panelOpen = next
      for (const fn of Array.from(openListeners)) {
        try {
          fn(panelOpen)
        } catch {
          /* ignore */
        }
      }
    }

    function usePanelOpen() {
      const [open, setOpen] = React.useState(panelOpen)
      React.useEffect(() => {
        openListeners.add(setOpen)
        setOpen(panelOpen)
        return () => {
          openListeners.delete(setOpen)
        }
      }, [])
      return open
    }

    /* ---------------- 主题明暗（跟随宿主，而不是猜 OS） ----------------
     * client Service `theme`：getTheme() → snapshot.active.colorScheme: 'light' | 'dark'
     * 变化通过 `theme/change` 事件推送。
     */

    let themeService = null
    let colorScheme = 'dark'
    const schemeListeners = new Set()

    function readColorScheme() {
      try {
        if (themeService && typeof themeService.getTheme === 'function') {
          const snap = themeService.getTheme()
          const scheme = snap && snap.active ? snap.active.colorScheme : ''
          if (scheme === 'light' || scheme === 'dark') return scheme
        }
      } catch {
        /* 服务不可用时退回暗色 */
      }
      return ''
    }

    function publishScheme(next) {
      if (!next || next === colorScheme) return
      colorScheme = next
      for (const fn of Array.from(schemeListeners)) {
        try {
          fn(colorScheme)
        } catch {
          /* ignore */
        }
      }
    }

    function useColorScheme() {
      const [scheme, setScheme] = React.useState(colorScheme)
      React.useEffect(() => {
        schemeListeners.add(setScheme)
        const now = readColorScheme()
        if (now) publishScheme(now)
        setScheme(colorScheme)
        return () => {
          schemeListeners.delete(setScheme)
        }
      }, [])
      return scheme
    }

    function schemeClass(base) {
      return base + (colorScheme === 'light' ? ' pcl-light' : '')
    }

    /* ---------------- 填入对话 ---------------- */

    let currentInputActions = null
    /** 最近一次渲染时输入框里的草稿文本，用于判断「要不要先问一句覆盖」 */
    let currentDraftText = ''
    /** 最近几条对话（我/AI 交替），引导功能用它判断你已说到哪一步 */
    let currentDialogue = []

    function InputBridge(props) {
      if (props && props.inputActions) currentInputActions = props.inputActions
      /* useInput 是 SnapshotSelectorHook，只能在渲染期调用，所以放在这里读一次存起来 */
      let draft = ''
      try {
        if (props && typeof props.useInput === 'function') {
          const snap = props.useInput((s) => s)
          draft = snap && typeof snap.draft === 'string' ? snap.draft : ''
        }
      } catch {
        draft = ''
      }
      currentDraftText = draft
      /* 会话域还注入了 useChat，顺手把最近几条对话存下来给引导功能用 */
      try {
        currentDialogue = pickRecentDialogue(props, 6)
      } catch {
        currentDialogue = []
      }
      return null
    }

    function fillDraft(text) {
      try {
        if (currentInputActions && typeof currentInputActions.setDraft === 'function') {
          currentInputActions.setDraft(text)
          return true
        }
      } catch {
        /* ignore */
      }
      return false
    }

    /* ---------------- 消息正文提取 ---------------- */

    function pickMessageText(props) {
      if (!props || typeof props !== 'object') return ''
      if (typeof props.text === 'string') return props.text
      const matched = props.matched
      if (typeof matched === 'string') return matched
      if (matched && typeof matched === 'object' && typeof matched.text === 'string') return matched.text
      const source = props.source
      if (typeof source === 'string') return source
      if (source && typeof source === 'object') {
        if (typeof source.text === 'string') return source.text
        if (typeof source.content === 'string') return source.content
      }
      return ''
    }

    /** 助手消息：靠会话域注入的 useChat 快照按 messageId 找回文本块 */
    function pickAssistantText(props) {
      try {
        if (!props || typeof props !== 'object') return ''
        const messageId = props.messageId
        if (!messageId || typeof props.useChat !== 'function') return ''
        const snap = props.useChat((s) => s)
        const nodes = snap && snap.nodes
        if (!nodes || typeof nodes.values !== 'function') return ''
        for (const node of nodes.values()) {
          const data = node && node.data
          if (!data) continue
          const finalId = data.finalNode && data.finalNode.messageId
          if (finalId !== messageId && data.messageId !== messageId) continue
          const blocks = Array.isArray(data.blocks) ? data.blocks : []
          const parts = []
          for (const b of blocks) {
            if (b && b.kind === 'text' && typeof b.text === 'string' && b.text.trim()) {
              parts.push(b.text)
            }
          }
          return parts.join('\n\n')
        }
        return ''
      } catch {
        return ''
      }
    }

    /**
     * 最近几条对话：用户说了什么、AI 回了什么。
     * 引导功能靠它判断「你已经说到哪一步了」，避免每次都从零开始问。
     */
    function pickRecentDialogue(props, limit) {
      const max = typeof limit === 'number' && limit > 0 ? limit : 6
      const out = []
      try {
        if (!props || typeof props.useChat !== 'function') return out
        const snap = props.useChat((s) => s)
        const nodes = snap && snap.nodes
        if (!nodes || typeof nodes.values !== 'function') return out
        for (const node of nodes.values()) {
          const data = node && node.data
          if (!data) continue
          const kind = node.kind || data.kind || ''
          let text = ''
          if (kind === 'user' || data.source != null) {
            text = pickMessageText({ source: data.source })
          }
          if (!text) {
            const blocks = Array.isArray(data.blocks) ? data.blocks : []
            const parts = []
            for (const b of blocks) {
              if (b && b.kind === 'text' && typeof b.text === 'string' && b.text.trim()) parts.push(b.text)
            }
            text = parts.join('\n\n')
          }
          const trimmed = String(text || '').trim()
          if (!trimmed) continue
          out.push({ role: kind === 'user' ? '我' : 'AI', text: trimmed })
        }
      } catch {
        return []
      }
      /* 太长的单条会挤掉上下文，只留开头 */
      return out.slice(-max).map((m) => ({
        role: m.role,
        text: m.text.length > 1200 ? m.text.slice(0, 1200) + '…' : m.text,
      }))
    }

    /* ---------------- 通用小控件 ---------------- */

    /** 老浏览器兜底：临时 textarea + execCommand('copy') */
    function legacyCopy(text, onToast) {
      try {
        if (typeof document === 'undefined' || !document.body) {
          onToast('复制失败，请手动选择正文')
          return
        }
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.top = '-1000px'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false
        document.body.removeChild(ta)
        onToast(ok ? '已复制' : '复制失败，请手动选择正文')
      } catch {
        onToast('复制失败，请手动选择正文')
      }
    }

    function Btn({ children, primary, danger, onClick, title, disabled }) {
      const cls =
        'pcl-btn' + (primary ? ' primary' : '') + (danger ? ' danger' : '') + (disabled ? ' disabled' : '')
      return h(
        'button',
        { type: 'button', className: cls, onClick, title: title || undefined, disabled: disabled || undefined },
        children
      )
    }

    function TagChip({ label, active, onClick }) {
      return h('button', { type: 'button', className: 'pcl-chip' + (active ? ' on' : ''), onClick }, label)
    }

    function Tag({ children }) {
      return h('span', { className: 'pcl-tag' }, children)
    }

    function describeError(err) {
      if (!err) return '未知错误'
      if (typeof err === 'string') return err
      return String(err.message || err)
    }

    /** 选一个 JSON 文件并把文本交给 onPicked。
     *  input 必须挂进 DOM 再 click()：游离节点在 Electron 下可能不弹框、
     *  也不触发 onchange，异常再被外层 try/catch 吞掉，用户看到的就是"点了没反应"。 */
    function pickJsonFile(onPicked, onError) {
      let input = null
      const cleanup = () => {
        try {
          if (input && input.parentNode) input.parentNode.removeChild(input)
        } catch {
          /* 已经不在文档里就算了 */
        }
      }
      try {
        if (typeof document === 'undefined') {
          onError('当前环境打不开文件选择框，请把 JSON 内容粘贴到下面')
          return
        }
        input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json,application/json'
        input.style.position = 'fixed'
        input.style.left = '-10000px'
        input.style.top = '0'
        if (document.body) document.body.appendChild(input)
        input.onchange = () => {
          const file = input.files && input.files[0]
          if (!file) {
            cleanup()
            return
          }
          try {
            const reader = new FileReader()
            reader.onload = () => {
              cleanup()
              onPicked(String(reader.result || ''))
            }
            reader.onerror = () => {
              cleanup()
              onError('读取文件失败，请改用粘贴导入')
            }
            reader.readAsText(file)
          } catch (err) {
            cleanup()
            onError('读取文件失败（' + describeError(err) + '），请改用粘贴导入')
          }
        }
        input.click()
      } catch (err) {
        cleanup()
        onError('打开文件选择框失败（' + describeError(err) + '），请改用粘贴导入')
      }
    }

    /** 导入弹窗：既能选文件，也能直接粘 JSON。
     *  粘贴这条路完全不依赖文件对话框，桌面版选文件失灵时仍然能导进去。 */
    function ImportDialog({ onCancel, onMerge, onToast }) {
      const [text, setText] = React.useState('')

      const merge = (raw) => {
        const raw2 = String(raw || '')
        if (!raw2.trim()) {
          onToast('请先选择文件或粘贴 JSON')
          return
        }
        let parsed
        try {
          parsed = JSON.parse(raw2)
        } catch {
          onToast('这段内容不是合法的 JSON')
          return
        }
        let count = 0
        try {
          count = onMerge(parsed)
        } catch (err) {
          onToast('导入失败：' + describeError(err))
          return
        }
        if (!count) {
          onToast('文件里没有可导入的提示词')
          return
        }
        onToast('已导入 ' + count + ' 条')
        onCancel()
      }

      return h(
        'div',
        {
          className: 'pcl-mask',
          onMouseDown: (e) => {
            if (e.target === e.currentTarget) onCancel()
          },
        },
        h(
          'div',
          { className: 'pcl-dialog' },
          h('h3', null, '导入提示词'),
          h(
            'div',
            { className: 'pcl-field' },
            h('label', null, '选一个 JSON 文件'),
            h(
              Btn,
              {
                onClick: () =>
                  pickJsonFile(
                    (raw) => merge(raw),
                    (msg) => onToast(msg)
                  ),
              },
              '选择 JSON 文件…'
            )
          ),
          h(
            'div',
            { className: 'pcl-field' },
            h('label', null, '或者：把 JSON 内容粘贴到这里'),
            h('textarea', {
              value: text,
              onChange: (e) => setText(e.target.value),
              placeholder: '{"version":1,"prompts":[…]}',
            })
          ),
          h(
            'div',
            { className: 'pcl-dialog-foot' },
            h(Btn, { onClick: onCancel }, '取消'),
            h(
              Btn,
              { primary: true, disabled: text.trim() === '', onClick: () => merge(text) },
              '导入'
            )
          )
        )
      )
    }

    /* ---------------- 编辑弹窗 ---------------- */

    function EditDialog({ initial, onCancel, onSave }) {
      const base = initial || {}
      const [title, setTitle] = React.useState(base.title || '')
      const [content, setContent] = React.useState(base.content || '')
      const [tagsText, setTagsText] = React.useState(
        Array.isArray(base.tags) ? base.tags.join(', ') : base.tagsText || ''
      )
      const [source, setSource] = React.useState(base.source || '')
      const [note, setNote] = React.useState(base.note || '')
      const [starred, setStarred] = React.useState(base.starred === true)

      const canSave = content.trim() !== ''

      return h(
        'div',
        {
          className: 'pcl-mask',
          onMouseDown: (e) => {
            if (e.target === e.currentTarget) onCancel()
          },
        },
        h(
          'div',
          { className: 'pcl-dialog' },
          h('h3', null, base.id ? '编辑提示词' : '新建提示词'),
          h(
            'div',
            { className: 'pcl-field' },
            h('label', null, '标题（留空自动取正文首行）'),
            h('input', {
              value: title,
              onChange: (e) => setTitle(e.target.value),
              placeholder: '例如：接口用例生成',
            })
          ),
          h(
            'div',
            { className: 'pcl-field' },
            h('label', null, '正文 *'),
            h('textarea', {
              value: content,
              onChange: (e) => setContent(e.target.value),
              placeholder: '把常用的提示词粘到这里…',
            })
          ),
          h(
            'div',
            { className: 'pcl-field' },
            h('label', null, '标签（逗号或回车分隔）'),
            h('input', {
              value: tagsText,
              onChange: (e) => setTagsText(e.target.value),
              placeholder: '前端, 视频, 代码审查',
            })
          ),
          h(
            'div',
            { className: 'pcl-field' },
            h('label', null, '什么时候用（一句话，帮 AI 判断该不该选它）'),
            h('input', {
              value: note,
              onChange: (e) => setNote(e.target.value),
              placeholder: '例如：先对齐再出方案，避免一次给出偏离喜好的三版',
            })
          ),
          h(
            'div',
            { className: 'pcl-field' },
            h('label', null, '来源'),
            h('input', {
              value: source,
              onChange: (e) => setSource(e.target.value),
              placeholder: '手动新建 / 用户提示词 / 助手回复',
            })
          ),
          h(
            'label',
            { className: 'pcl-check' },
            h('input', {
              type: 'checkbox',
              checked: starred,
              onChange: (e) => setStarred(e.target.checked),
            }),
            '加星标'
          ),
          h(
            'div',
            { className: 'pcl-dialog-foot' },
            h(Btn, { onClick: onCancel }, '取消'),
            h(
              Btn,
              {
                primary: true,
                disabled: !canSave,
                onClick: () => {
                  if (!canSave) return
                  onSave({ title, content, tagsText, source, note, starred, id: base.id })
                },
              },
              '保存'
            )
          )
        )
      )
    }

    /* ---------------- 「不知道怎么选」——一键填入，不弹问卷 ---------------- */

    /**
     * 点一下就填。输入框里已经有字时先问一句，避免把用户写了一半的内容冲掉。
     * 这是用户 m02176 选定的方案 B。
     */
    function guideFill(prompts, onToast) {
      const hasContent = String(currentDraftText || '').trim() !== ''
      if (hasContent) {
        let ok = false
        try {
          ok = window.confirm('输入框里已经有内容，要用挑好的提示词替换掉吗？')
        } catch {
          ok = true
        }
        if (!ok) return
      }
      const built = buildGuideText(prompts, currentDialogue, currentDraftText)
      if (fillDraft(built.text)) {
        onToast(
          built.picked
            ? '已填入「' + (built.picked.title || deriveTitle(built.picked.content)) + '」，按回车发送'
            : '已填入输入框，按回车发送，让 AI 接着问你'
        )
        setPanelOpen(false)
      } else {
        onToast('当前没有可用的对话输入框，请先打开一个会话')
      }
    }

    /* ---------------- 列表页 ---------------- */

    function ListView({
      prompts,
      query,
      setQuery,
      activeTag,
      setActiveTag,
      onOpen,
      onNew,
      onImport,
      onExport,
      onRefresh,
      onGuide,
    }) {
      const allTags = React.useMemo(() => {
        const seen = new Set()
        for (const p of prompts) for (const t of p.tags) seen.add(t)
        return Array.from(seen).sort((a, b) => a.localeCompare(b, 'zh'))
      }, [prompts])

      const visible = React.useMemo(() => {
        const q = query.trim().toLowerCase()
        return sortPrompts(
          prompts.filter((p) => {
            if (activeTag && p.tags.indexOf(activeTag) < 0) return false
            if (!q) return true
            return (
              p.title.toLowerCase().indexOf(q) >= 0 ||
              p.content.toLowerCase().indexOf(q) >= 0 ||
              p.tags.some((t) => t.toLowerCase().indexOf(q) >= 0)
            )
          })
        )
      }, [prompts, query, activeTag])

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'pcl-head' },
          h('h2', { className: 'pcl-head-title' }, '提示词卡'),
          h(
            'div',
            { className: 'pcl-head-actions' },
            h(Btn, { onClick: onRefresh, title: '重新读取本机数据' }, '刷新'),
            h(Btn, { onClick: onImport }, '导入'),
            h(Btn, { onClick: onExport }, '导出'),
            h(Btn, { primary: true, onClick: onNew }, '新建')
          ),
          h(
            'button',
            { type: 'button', className: 'pcl-x', onClick: () => setPanelOpen(false), title: '关闭' },
            '×'
          )
        ),
        h(
          'div',
          { className: 'pcl-guidebar' },
          h(
            'button',
            { type: 'button', className: 'pcl-guide-btn', onClick: onGuide, title: '按当前对话从收藏里挑一条，填进输入框' },
            h('span', { className: 'pcl-guide-icon' }, '?'),
            h('span', { className: 'pcl-guide-main' }, '不知道下一句说什么？让库里挑一条给我'),
            h('span', { className: 'pcl-guide-arrow' }, '›')
          )
        ),
        h(
          'div',
          { className: 'pcl-searchrow' },
          h('input', {
            className: 'pcl-search',
            placeholder: '搜索标题、正文、标签…',
            value: query,
            onChange: (e) => setQuery(e.target.value),
          }),
          h(
            'select',
            { className: 'pcl-select', value: activeTag, onChange: (e) => setActiveTag(e.target.value) },
            h('option', { value: '' }, '按标签筛选'),
            ...allTags.map((t) => h('option', { key: t, value: t }, t))
          )
        ),
        prompts.length > 0
          ? h(
              'div',
              { className: 'pcl-chips' },
              h(TagChip, { label: '全部', active: activeTag === '', onClick: () => setActiveTag('') }),
              ...allTags.map((t) =>
                h(TagChip, {
                  key: t,
                  label: t,
                  active: activeTag === t,
                  onClick: () => setActiveTag(activeTag === t ? '' : t),
                })
              )
            )
          : null,
        h(
          'div',
          { className: 'pcl-body' },
          visible.length === 0
            ? h(
                'div',
                { className: 'pcl-empty' },
                prompts.length === 0 ? '还没有提示词，点右上角「新建」' : '没有匹配的提示词'
              )
            : visible.map((p) =>
                h(
                  'div',
                  { key: p.id, className: 'pcl-card', onClick: () => onOpen(p.id) },
                  h(
                    'div',
                    { className: 'pcl-card-title' },
                    p.pinned ? h('span', { className: 'pcl-pin' }, '📌') : null,
                    p.title
                  ),
                  h('div', { className: 'pcl-card-body' }, p.content),
                  p.note && p.note.trim()
                    ? h('div', { className: 'pcl-card-note' }, '什么时候用：' + p.note.trim())
                    : null,
                  p.tags.length > 0
                    ? h('div', { className: 'pcl-card-tags' }, ...p.tags.map((t) => h(Tag, { key: t }, t)))
                    : null
                )
              )
        )
      )
    }

    /* ---------------- 详情页 ---------------- */

    function DetailView({ prompt, onBack, onEdit, onDelete, onToast }) {
      const copy = () => {
        const text = prompt.content
        try {
          const nav = typeof navigator !== 'undefined' ? navigator : null
          if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
            const p = nav.clipboard.writeText(text)
            if (p && typeof p.then === 'function') {
              p.then(
                () => onToast('已复制'),
                () => legacyCopy(text, onToast)
              )
              return
            }
            onToast('已复制')
            return
          }
        } catch {
          /* 落到兜底方案 */
        }
        legacyCopy(text, onToast)
      }

      const fill = () => {
        if (fillDraft(prompt.content)) {
          onToast('已填入对话')
          setPanelOpen(false)
        } else {
          onToast('当前没有可用的对话输入框，请先打开一个会话')
        }
      }

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'pcl-head' },
          h('button', { type: 'button', className: 'pcl-back', onClick: onBack }, '‹ 返回'),
          h('h2', { className: 'pcl-head-title' }, '提示词卡'),
          h(
            'button',
            { type: 'button', className: 'pcl-x', onClick: () => setPanelOpen(false), title: '关闭' },
            '×'
          )
        ),
        h(
          'div',
          { className: 'pcl-body' },
          h(
            'div',
            { className: 'pcl-detail-top' },
            h('div', { className: 'pcl-detail-title' }, prompt.title),
            h(
              'div',
              { className: 'pcl-detail-actions' },
              h(Btn, { onClick: copy }, '复制'),
              h(Btn, { primary: true, onClick: fill }, '填入对话'),
              h(Btn, { onClick: () => onEdit(prompt) }, '编辑'),
              h(Btn, { onClick: () => togglePin(prompt.id) }, prompt.pinned ? '取消置顶' : '置顶'),
              h(Btn, { danger: true, onClick: () => onDelete(prompt) }, '删除')
            )
          ),
          prompt.tags.length > 0
            ? h('div', { className: 'pcl-card-tags' }, ...prompt.tags.map((t) => h(Tag, { key: t }, t)))
            : null,
          h('div', { className: 'pcl-sec' }, '正文'),
          h('div', { className: 'pcl-pre' }, prompt.content),
          prompt.source
            ? h(
                React.Fragment,
                null,
                h('div', { className: 'pcl-sec' }, '来源'),
                h('div', { className: 'pcl-pre' }, prompt.source)
              )
            : null,
          prompt.note
            ? h(
                React.Fragment,
                null,
                h('div', { className: 'pcl-sec' }, '什么时候用'),
                h('div', { className: 'pcl-pre' }, prompt.note)
              )
            : null
        )
      )
    }

    /* ---------------- 浮层容器 ---------------- */

    function PanelOverlay() {
      const open = usePanelOpen()
      useColorScheme()
      const [state, setState] = React.useState(() => ({ version: 1, prompts: [] }))
      const [query, setQuery] = React.useState('')
      const [activeTag, setActiveTag] = React.useState('')
      const [openId, setOpenId] = React.useState('')
      const [editing, setEditing] = React.useState(null)
      const [importing, setImporting] = React.useState(false)
      const [toast, setToast] = React.useState('')

      const refresh = React.useCallback(() => setState(loadState()), [])

      React.useEffect(() => {
        if (open) {
          refresh()
          setOpenId('')
          setImporting(false)
        }
      }, [open, refresh])

      const flash = (msg) => {
        setToast(msg)
        setTimeout(() => setToast(''), 2200)
      }

      const doRefresh = () => {
        refresh()
        flash('已刷新')
      }

      const doExport = () => {
        try {
          const blob = new Blob([JSON.stringify(loadState(), null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = 'prompt-library.json'
          a.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        } catch {
          flash('导出失败')
        }
      }

      /** 把一份已解析的导入内容按 id 合并进本地库，返回真正写入的条数。 */
      const mergeImported = (parsed) => {
        const list = parsed && Array.isArray(parsed.prompts) ? parsed.prompts : null
        if (!list) throw new Error('缺少 prompts 数组')
        /* 借 safeParse 走一遍同样的字段清洗与校验（空正文会被丢掉） */
        const clean = safeParse(JSON.stringify({ version: 1, prompts: list }))
        if (clean.prompts.length === 0) return 0
        const current = loadState()
        const byId = new Map(current.prompts.map((p) => [p.id, p]))
        for (const p of clean.prompts) byId.set(p.id, p)
        saveState({ version: 1, prompts: Array.from(byId.values()) })
        refresh()
        return clean.prompts.length
      }

      if (!open) {
        /* 面板关了也要能看到提示：引导是「填入后立刻关面板」，
           toast 若跟着面板一起消失，用户就分不清到底填没填进去。 */
        return toast ? h('div', { className: schemeClass('pcl-detached') }, h('div', { className: 'pcl-toast pcl-toast-float' }, toast)) : null
      }

      const active = state.prompts.find((p) => p.id === openId) || null

      return h(
        'div',
        {
          className: schemeClass('pcl-root'),
          onMouseDown: (e) => {
            if (e.target === e.currentTarget) setPanelOpen(false)
          },
        },
        h(
          'div',
          { className: 'pcl-modal' },
          active
            ? h(DetailView, {
                prompt: active,
                onBack: () => setOpenId(''),
                onEdit: (p) => setEditing(p),
                onDelete: (p) => {
                  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
                    if (!window.confirm('确定删除「' + p.title + '」？')) return
                  }
                  removePrompt(p.id)
                  refresh()
                  setOpenId('')
                  flash('已删除')
                },
                onToast: flash,
              })
            : h(ListView, {
                prompts: state.prompts,
                query,
                setQuery,
                activeTag,
                setActiveTag,
                onOpen: (id) => setOpenId(id),
                onNew: () => setEditing({ content: '' }),
                onImport: () => setImporting(true),
                onExport: doExport,
                onRefresh: doRefresh,
                onGuide: () => guideFill(state.prompts, flash),
              }),
          importing
            ? h(ImportDialog, {
                onCancel: () => setImporting(false),
                onMerge: mergeImported,
                onToast: flash,
              })
            : null,
          editing
            ? h(EditDialog, {
                initial: editing,
                onCancel: () => setEditing(null),
                onSave: (draft) => {
                  upsertPrompt(draft)
                  setEditing(null)
                  refresh()
                  flash('已保存')
                },
              })
            : null,
          toast ? h('div', { className: 'pcl-toast' }, toast) : null
        )
      )
    }

    /* ---------------- 入口按钮 ---------------- */

    function TriggerButton() {
      const open = usePanelOpen()
      return h(
        'button',
        {
          type: 'button',
          className: 'pcl-trigger' + (open ? ' on' : ''),
          onClick: () => setPanelOpen(!panelOpen),
          title: '提示词卡',
        },
        h('span', { className: 'pcl-trigger-star' }, '☆'),
        h('span', null, '提示词卡')
      )
    }

    /* ---------------- 消息下方「存为提示词」 ---------------- */

    function SaveAction(props) {
      const [editing, setEditing] = React.useState(false)
      const text = pickMessageText(props) || pickAssistantText(props)
      const fromAssistant = typeof props.messageId === 'string'
      const scheme = useColorScheme()
      return h(
        React.Fragment,
        null,
        h(
          'button',
          {
            type: 'button',
            className: 'pcl-save',
            title: text.trim() ? '存为提示词' : '正文留空，请粘贴',
            onClick: () => setEditing(true),
          },
          '存为提示词'
        ),
        editing
          ? h(
              'div',
              { className: scheme === 'light' ? 'pcl-detached pcl-light' : 'pcl-detached' },
              h(EditDialog, {
                initial: {
                  content: text,
                  source: fromAssistant ? '助手回复' : '用户提示词',
                },
                onCancel: () => setEditing(false),
                onSave: (draft) => {
                  upsertPrompt(draft)
                  setEditing(false)
                },
              })
            )
          : null
      )
    }

    function userBeforeEntry() {
      return {
        select: (owner) => {
          const text = pickMessageText(owner)
          return text.trim() ? { text } : null
        },
      }
    }

    /* ---------------- 样式 ----------------
     * 刻意不使用 --dsw-alias-* 作为「面」的颜色：
     * 实测宿主主题里 bg-base / bg-layer-* / brand-primary 可能是半透明甚至是纯白，
     * 直接拿来当背景会让页面文字透出来（面板看起来像"没底"），
     * 也会出现白底白字的按钮。所以这里自带一套实色令牌，
     * 只沿用宿主主题做亮/暗判定。
     */

    const CSS = `
.pcl-trigger { display:inline-flex; align-items:center; gap:5px; height:28px; padding:0 10px;
  border-radius:8px; border:1px solid var(--dsw-alias-border-l2); background:transparent;
  color:var(--dsw-alias-label-secondary); font:inherit; font-size:12px; cursor:pointer; }
.pcl-trigger:hover { color:var(--dsw-alias-label-primary); border-color:var(--dsw-alias-brand-primary); }
.pcl-trigger.on { color:var(--dsw-alias-label-primary); border-color:var(--dsw-alias-brand-primary); }
.pcl-trigger-star { font-size:13px; line-height:1; }
.pcl-save { font:inherit; font-size:11px; padding:2px 8px; border-radius:5px; cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2); background:transparent; color:var(--dsw-alias-label-secondary); }
.pcl-save:hover { color:var(--dsw-alias-label-primary); border-color:var(--dsw-alias-brand-primary); }

/* ---- 实色令牌：暗色为默认，.pcl-light 覆盖为亮色 ---- */
.pcl-root, .pcl-detached { position:fixed; inset:0; z-index:1200;
  --pcl-bg:#16171b; --pcl-card:#1e2026; --pcl-field:#121317;
  --pcl-line:#2d3038; --pcl-line-strong:#3b3f49;
  --pcl-text:#f3f4f6; --pcl-dim:#9aa0aa;
  --pcl-accent:#4c7dff; --pcl-accent-hover:#5e8bff; --pcl-on-accent:#ffffff;
  --pcl-danger:#f36b6b; --pcl-overlay:#1b1d22;
}
.pcl-root { display:flex; align-items:center; justify-content:center;
  background:rgba(0,0,0,.62); pointer-events:auto; }
.pcl-detached { display:block; pointer-events:none; }
.pcl-root.pcl-light, .pcl-detached.pcl-light {
  --pcl-bg:#ffffff; --pcl-card:#f6f7f9; --pcl-field:#ffffff;
  --pcl-line:#e3e5ea; --pcl-line-strong:#cfd3da;
  --pcl-text:#1c1e23; --pcl-dim:#666c78;
  --pcl-accent:#2f6bff; --pcl-accent-hover:#1f5cf0; --pcl-on-accent:#ffffff;
  --pcl-danger:#d92d2d; --pcl-overlay:#ffffff; }
.pcl-root.pcl-light { background:rgba(0,0,0,.38); }

.pcl-modal { position:relative; display:flex; flex-direction:column; overflow:hidden;
  width:min(1040px, 94vw); height:min(860px, 86vh); max-height:86vh;
  border-radius:16px; border:1px solid var(--pcl-line);
  background:var(--pcl-bg); color:var(--pcl-text);
  box-shadow:0 24px 80px rgba(0,0,0,.6); isolation:isolate; }

.pcl-head { display:flex; align-items:center; gap:12px; padding:18px 22px 14px; flex:0 0 auto; }
.pcl-head-title { margin:0; font-size:20px; font-weight:600; flex:1; color:var(--pcl-text); }
.pcl-head-actions { display:flex; gap:8px; }
.pcl-back { font:inherit; font-size:13px; padding:4px 10px 4px 4px; border-radius:6px; cursor:pointer;
  border:none; background:transparent; color:var(--pcl-dim); }
.pcl-back:hover { color:var(--pcl-text); }
.pcl-x { width:30px; height:30px; border-radius:8px; border:none; background:transparent;
  color:var(--pcl-dim); font-size:18px; line-height:1; cursor:pointer; }
.pcl-x:hover { background:var(--pcl-card); color:var(--pcl-text); }

.pcl-btn { font:inherit; font-size:13px; height:34px; padding:0 14px; border-radius:8px; cursor:pointer;
  border:1px solid var(--pcl-line-strong); background:transparent; color:var(--pcl-text); }
.pcl-btn:hover { border-color:var(--pcl-accent); }
.pcl-btn.primary { background:var(--pcl-accent); border-color:var(--pcl-accent); color:var(--pcl-on-accent); }
.pcl-btn.primary:hover { background:var(--pcl-accent-hover); border-color:var(--pcl-accent-hover); }
.pcl-btn.danger { color:var(--pcl-danger); }
.pcl-btn.danger:hover { border-color:var(--pcl-danger); }
.pcl-btn.disabled { opacity:.45; cursor:not-allowed; }
.pcl-btn.disabled:hover { border-color:var(--pcl-line-strong); }

.pcl-guidebar { padding:14px 22px 0; flex:0 0 auto; }
.pcl-guide-btn { display:flex; align-items:center; gap:10px; width:100%; box-sizing:border-box;
  padding:11px 14px; border-radius:11px; cursor:pointer; font:inherit; text-align:left;
  border:1px dashed var(--pcl-line-strong); background:var(--pcl-card); color:var(--pcl-text); }
.pcl-guide-btn:hover { border-color:var(--pcl-accent); }
.pcl-guide-icon { flex:0 0 auto; width:20px; height:20px; line-height:20px; text-align:center;
  border-radius:50%; font-size:12px; font-weight:700;
  background:var(--pcl-accent); color:var(--pcl-on-accent); }
.pcl-guide-main { flex:1 1 auto; font-size:13px; line-height:1.5; }
.pcl-guide-arrow { flex:0 0 auto; font-size:16px; color:var(--pcl-dim); }

.pcl-searchrow { display:flex; gap:12px; padding:0 22px; flex:0 0 auto; }
.pcl-search { flex:1; height:42px; box-sizing:border-box; padding:0 14px; border-radius:10px;
  font:inherit; font-size:13px; color:var(--pcl-text); background:var(--pcl-field);
  border:1px solid var(--pcl-line); }
.pcl-search::placeholder { color:var(--pcl-dim); }
.pcl-search:focus, .pcl-select:focus { outline:none; border-color:var(--pcl-accent); }
.pcl-select { height:42px; min-width:150px; padding:0 12px; border-radius:10px; font:inherit; font-size:13px;
  color:var(--pcl-text); background:var(--pcl-field); border:1px solid var(--pcl-line); cursor:pointer; }

.pcl-chips { display:flex; flex-wrap:wrap; gap:8px; padding:14px 22px 6px; flex:0 0 auto; }
.pcl-chip { font:inherit; font-size:13px; height:32px; padding:0 14px; border-radius:999px; cursor:pointer;
  border:1px solid var(--pcl-line); background:transparent; color:var(--pcl-text); }
.pcl-chip:hover { border-color:var(--pcl-accent); }
.pcl-chip.on { background:var(--pcl-accent); border-color:var(--pcl-accent); color:var(--pcl-on-accent); }

.pcl-body { flex:1 1 auto; min-height:0; overflow-y:auto; padding:10px 22px 22px; }
.pcl-card { border:1px solid var(--pcl-line); border-radius:12px; padding:16px 18px;
  margin-bottom:12px; cursor:pointer; background:var(--pcl-card); }
.pcl-card:hover { border-color:var(--pcl-accent); }
.pcl-card-title { font-size:16px; font-weight:600; line-height:1.4; display:flex;
  align-items:center; gap:6px; color:var(--pcl-text); }
.pcl-pin { font-size:12px; }
.pcl-card-body { margin-top:8px; font-size:13px; line-height:1.75; color:var(--pcl-dim);
  white-space:pre-wrap; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.pcl-card-note { margin-top:8px; font-size:12px; line-height:1.7; color:var(--pcl-accent);
  white-space:pre-wrap; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.pcl-card-tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
.pcl-tag { font-size:11px; line-height:20px; padding:0 10px; border-radius:999px;
  color:var(--pcl-dim); background:var(--pcl-field); border:1px solid var(--pcl-line); }
.pcl-empty { padding:56px 16px; text-align:center; font-size:13px; color:var(--pcl-dim); }

.pcl-detail-top { display:flex; align-items:flex-start; gap:16px; padding:6px 0 4px; }
.pcl-detail-title { flex:1; font-size:22px; font-weight:600; line-height:1.35;
  word-break:break-word; color:var(--pcl-text); }
.pcl-detail-actions { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; flex:0 0 auto; }
.pcl-sec { font-size:12px; color:var(--pcl-dim); margin:22px 0 8px; }
.pcl-pre { white-space:pre-wrap; word-break:break-word; font-size:13px; line-height:1.8;
  padding:16px 18px; border-radius:12px; background:var(--pcl-field);
  border:1px solid var(--pcl-line); color:var(--pcl-text); }

.pcl-mask { position:absolute; inset:0; background:rgba(0,0,0,.62); display:flex;
  align-items:center; justify-content:center; z-index:10; pointer-events:auto; }
.pcl-dialog { width:min(600px, 92%); max-height:88%; overflow:auto; border-radius:14px; padding:20px;
  background:var(--pcl-overlay); border:1px solid var(--pcl-line-strong);
  box-shadow:0 20px 60px rgba(0,0,0,.55); color:var(--pcl-text); }
.pcl-dialog h3 { margin:0 0 16px; font-size:16px; color:var(--pcl-text); }
.pcl-field { margin-bottom:12px; }
.pcl-field label { display:block; font-size:12px; margin-bottom:6px; color:var(--pcl-dim); }
.pcl-field input, .pcl-field textarea { width:100%; box-sizing:border-box; font:inherit; font-size:13px;
  padding:9px 12px; border-radius:8px; border:1px solid var(--pcl-line);
  background:var(--pcl-field); color:var(--pcl-text); }
.pcl-field input:focus, .pcl-field textarea:focus { outline:none; border-color:var(--pcl-accent); }
.pcl-field textarea { min-height:180px; resize:vertical; line-height:1.7; }
.pcl-check { display:flex; align-items:center; gap:8px; font-size:13px; margin-bottom:4px;
  color:var(--pcl-text); }
.pcl-dialog-foot { display:flex; justify-content:flex-end; gap:10px; margin-top:18px; }
.pcl-toast { position:absolute; left:50%; bottom:26px; transform:translateX(-50%);
  padding:9px 18px; border-radius:999px; font-size:13px; white-space:nowrap;
  background:var(--pcl-overlay); border:1px solid var(--pcl-line-strong);
  color:var(--pcl-text); box-shadow:0 8px 24px rgba(0,0,0,.5); }
.pcl-toast-float { position:fixed; bottom:96px; pointer-events:none; }
`

    /* ---------------- 注册 ---------------- */

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          if (typeof ctx.effect === 'function') ctx.effect(() => insertStyles(), 'prompt-library: styles')
          else insertStyles()
        } catch {
          /* 样式注入失败不应阻断注册 */
        }

        // 主题明暗：跟随宿主的 theme 服务 + theme/change 事件。
        // theme 是**可选服务**，通常晚于 apply 才就绪：不能在 apply 里只取一次，
        // 也不能写进 inject（声明式依赖缺失会把整个插件 park）。
        // 所以短轮询，拿到即接上（同一处只接一次）。
        try {
          const attachTheme = (svc) => {
            if (!svc || typeof svc.getTheme !== 'function') return false
            themeService = svc
            const now = readColorScheme()
            if (now) colorScheme = now
            if (typeof ctx.on === 'function') {
              ctx.effect(
                () => ctx.on('theme/change', () => publishScheme(readColorScheme())),
                'prompt-library: theme'
              )
            }
            return true
          }
          const lookup = () => {
            try {
              return typeof ctx.get === 'function' ? ctx.get('theme') : null
            } catch {
              return null
            }
          }
          if (!attachTheme(lookup())) {
            const setT =
              typeof ctx.timer !== 'undefined' && ctx.timer && typeof ctx.timer.timeout === 'function'
                ? (fn, ms) => ctx.timer.timeout(fn, ms)
                : typeof setTimeout === 'function'
                  ? (fn, ms) => setTimeout(fn, ms)
                  : null
            if (setT) {
              let waited = 0
              const STEP = 250
              const LIMIT = 8000
              const tick = () => {
                if (attachTheme(lookup())) return
                waited += STEP
                if (waited >= LIMIT) return
                setT(tick, STEP)
              }
              setT(tick, STEP)
            }
          }
        } catch {
          /* 主题服务拿不到就退回暗色，不影响主路径 */
        }

        // 输入框工具条：☆ 提示词卡
        ctx.slots.inject('conversation.input.left', () =>
          ctx.slots.register(
            { name: 'conversation.input.left', id: ID + '-trigger', order: 50 },
            TriggerButton
          )
        )

        // 居中浮层
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register({ name: 'shell.overlay', id: ID, order: 100 }, PanelOverlay)
        )

        // 会话域桥接：拿到 inputActions.setDraft
        ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register({ name: 'conversation.input.right', id: ID + '-bridge' }, InputBridge)
        )

        // 用户消息「存为提示词」
        ctx.slots.inject('conversation.chat.user.before', () =>
          ctx.slots.register({ name: 'conversation.chat.user.before', ...userBeforeEntry() }, SaveAction)
        )

        // 助手消息「存为提示词」
        ctx.slots.inject('conversation.chat.assistant-actions', () =>
          ctx.slots.register(
            { name: 'conversation.chat.assistant-actions', id: ID + '-save-assistant', order: 20 },
            SaveAction
          )
        )
      },
    }

    function insertStyles() {
      if (typeof document === 'undefined') return () => {}
      const el = document.createElement('style')
      el.setAttribute('data-dsh-plugin', ID)
      el.textContent = CSS
      document.head.appendChild(el)
      return () => {
        if (el.parentNode) el.parentNode.removeChild(el)
      }
    }
  },
})
