/* 离线 harness 6：「说不清要什么」一键填入 —— 入口、填入内容、覆盖确认、空库兜底 */
const path = require('path')
const fs = require('fs')

const FILE = path.join(__dirname, '..', 'lib', 'client.js')

const hookStore = new Map()
let hookCursor = 0
let currentComp = null

function shallowEq(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const React = {
  createElement(type, props, ...children) {
    const flat = []
    const push = (c) => {
      if (c === null || c === undefined || c === false || c === true) return
      if (Array.isArray(c)) { c.forEach(push); return }
      flat.push(c)
    }
    push(children)
    return { $$el: true, type, props: props || {}, children: flat }
  },
  Fragment: 'Fragment',
  useState(init) {
    const key = (currentComp || 'anon') + ':' + hookCursor++
    if (!hookStore.has(key)) hookStore.set(key, typeof init === 'function' ? init() : init)
    const set = (v) => {
      const next = typeof v === 'function' ? v(hookStore.get(key)) : v
      hookStore.set(key, next)
    }
    return [hookStore.get(key), set]
  },
  useEffect(fn, deps) {
    const key = (currentComp || 'anon') + ':effect:' + hookCursor++
    const prev = hookStore.get(key)
    if (!prev || !deps || !shallowEq(prev, deps)) {
      hookStore.set(key, deps || [])
      try { fn() } catch (e) { /* ignore */ }
    }
  },
  useCallback(fn, deps) {
    const key = (currentComp || 'anon') + ':cb:' + hookCursor++
    const prev = hookStore.get(key)
    if (!prev || !deps || !shallowEq(prev.deps, deps)) hookStore.set(key, { fn, deps: deps || [] })
    return hookStore.get(key).fn
  },
  useMemo(fn, deps) {
    const key = (currentComp || 'anon') + ':mm:' + hookCursor++
    const prev = hookStore.get(key)
    if (!prev || !deps || !shallowEq(prev.deps, deps)) hookStore.set(key, { v: fn(), deps: deps || [] })
    return hookStore.get(key).v
  },
}

function render(el) {
  if (el === null || el === undefined || el === false || el === true) return null
  if (Array.isArray(el)) return el.map(render)
  if (typeof el === 'string' || typeof el === 'number') return String(el)
  if (!el.$$el) return null
  const { type, props, children } = el
  if (typeof type === 'function') {
    const prevComp = currentComp, prevCursor = hookCursor
    currentComp = type.name || 'anon'
    hookCursor = 0
    let out
    try { out = render(type({ ...props, children })) } finally { currentComp = prevComp; hookCursor = prevCursor }
    return out
  }
  return { tag: type, props, children: children.map(render) }
}

function walk(node, fn) {
  if (!node) return
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return }
  if (typeof node === 'string') { fn(node); return }
  fn(node)
  if (node.children) node.children.forEach((c) => walk(c, fn))
}
function texts(node) {
  const out = []
  walk(node, (n) => { if (typeof n === 'string') out.push(n) })
  return out.join(' ')
}
function find(node, pred) {
  const hits = []
  walk(node, (n) => { if (n && typeof n === 'object' && pred(n)) hits.push(n) })
  return hits
}
function byClass(node, cls) {
  return find(node, (n) => n.props && n.props.className === cls)
}

const storage = new Map()
let confirmAnswer = true
let confirmCalls = []
global.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
  confirm: (msg) => { confirmCalls.push(msg); return confirmAnswer },
}
global.localStorage = global.window.localStorage
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: () => Promise.resolve() } },
  configurable: true,
  writable: true,
})
global.document = {
  createElement: (tag) => ({
    tag, type: '', accept: '', files: null, onchange: null, parentNode: null,
    style: {}, setAttribute() {}, appendChild() {}, click() {},
  }),
  head: { appendChild() {} },
  body: { appendChild() {}, removeChild() {} },
}
global.Blob = function () {}
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} }
global.FileReader = function () {
  const self = this
  self.result = null
  self.onload = null
  self.readAsText = function (file) { self.result = file.__text; if (self.onload) self.onload() }
}
global.setTimeout = () => 0

let captured = null
global.window.__ModuleLoader__ = {
  load({ id, factory }) { captured = { id, exports: factory((n) => (n === 'react' ? React : {})) } },
}

const src = fs.readFileSync(FILE, 'utf8')
new Function('window', 'document', src)(global.window, global.document)
const mod = captured.exports

const results = []
function check(name, cond, extra) { results.push({ name, ok: !!cond, extra }) }

const regs = []
const ctx = {
  effect(cb) { try { cb() } catch (e) {} return () => {} },
  get() { return undefined },
  slots: { inject(s, fn) { fn(); return () => {} }, register(o, c) { regs.push({ options: o, component: c }); return () => {} } },
}
mod.apply(ctx)
const byName = {}
for (const r of regs) byName[r.options.name] = r
const Overlay = byName['shell.overlay'].component
const Trigger = byName['conversation.input.left'].component
const Bridge = byName['conversation.input.right'].component

/* 桥接：模拟真实会话域注入的 inputActions + useInput + useChat */
let draft = null
let liveDraft = ''
let liveNodes = []
function mountBridge() {
  render(React.createElement(Bridge, {
    inputActions: { setDraft: (v) => { draft = v; liveDraft = v } },
    useInput: (sel) => sel({ draft: liveDraft }),
    useChat: (sel) => sel({ nodes: { values: () => liveNodes } }),
  }))
}

storage.set('dsh:prompt-library:v1', JSON.stringify({
  version: 1,
  prompts: [
    { id: 'g1', title: '苏格拉底式提问', content: '先不给建议，用最多 6 个追问帮我找到真正值得回答的问题。', tags: ['问清问题'], note: '先把问题问清楚时用', source: '导入', starred: false, pinned: false, createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z' },
    { id: 'g2', title: '专家会诊', content: '组 3 个互补的专家视角互相质疑。', tags: ['解决问题'], note: '方案两难时用', source: '导入', starred: false, pinned: false, createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T00:00:00.000Z' },
  ],
}))

function openPanel() {
  hookStore.clear()
  mountBridge()
  const t = render(React.createElement(Trigger, {}))
  find(t, (n) => n.props && typeof n.props.onClick === 'function')[0].props.onClick()
}
function draw() {
  render(React.createElement(Overlay, {}))
  render(React.createElement(Overlay, {}))
  render(React.createElement(Overlay, {}))
  return render(React.createElement(Overlay, {}))
}

/* ---- 入口 ---- */
openPanel()
let node = draw()
const guideBtn = byClass(node, 'pcl-guide-btn')[0]
check('列表页有引导入口', !!guideBtn)
check('入口文案是「让 AI 先问清楚」', texts(guideBtn || node).indexOf('让 AI 先问清楚') >= 0,
  texts(guideBtn || node).slice(0, 60))
const rowOrder = find(node, (n) => n.props && (n.props.className === 'pcl-guidebar' || n.props.className === 'pcl-searchrow'))
check('入口排在搜索行之前', rowOrder.length === 2 && rowOrder[0].props.className === 'pcl-guidebar',
  rowOrder.map((r) => r.props.className).join(','))

/* ---- 一键填入（输入框为空，不应弹确认） ---- */
liveDraft = ''
draft = null
confirmCalls = []
guideBtn.props.onClick()
check('输入框为空时不弹确认', confirmCalls.length === 0, JSON.stringify(confirmCalls))
check('点一下就把内容写进输入框', !!draft, String(draft).slice(0, 40))
check('内容先说明我需求模糊', draft && draft.indexOf('还很模糊的想法') >= 0, String(draft).slice(0, 80))
check('要求一次只问一个问题', draft && draft.indexOf('一次只问我一个问题') >= 0)
check('要求每题给 2-3 个具体选项', draft && draft.indexOf('2-3 个具体选项') >= 0)
check('要求每 2-3 轮给个看得见的东西', draft && draft.indexOf('每问 2-3 轮') >= 0)
check('说「不对」时让你猜原因而不是重问', draft && draft.indexOf('你猜一个具体原因让我确认') >= 0)
check('不许一次抛一堆问题', draft && draft.indexOf('不要一次给我一堆问题') >= 0)
check('收到能一句话说清时才动手', draft && draft.indexOf('再开始动手') >= 0)

/* ---- 带上收藏目录（用户选了 B） ---- */
check('带上收藏的标题', draft && draft.indexOf('苏格拉底式提问') >= 0)
check('带上「什么时候用」', draft && draft.indexOf('先把问题问清楚时用') >= 0)
check('带上标签', draft && draft.indexOf('问清问题') >= 0)
check('不塞单条正文（控制体积）', draft && draft.indexOf('用最多 6 个追问') < 0,
  'draft 里出现了正文内容')
check('允许 AI 发现合适就改写', draft && draft.indexOf('改写成一段我能直接发出去的指令') >= 0)
check('没有合适的就别硬凑', draft && draft.indexOf('别硬凑') >= 0)

node = draw()
check('填入后面板关闭', node === null)

/* ---- 输入框已有内容 → 先问一句（用户选了 B） ---- */
openPanel()
node = draw()
liveDraft = '我原来写了一半的话'
confirmCalls = []
confirmAnswer = false
draft = null
byClass(node, 'pcl-guide-btn')[0].props.onClick()
check('输入框有内容时弹出确认', confirmCalls.length === 1, JSON.stringify(confirmCalls))
check('确认文案说明会替换', String(confirmCalls[0] || '').indexOf('替换') >= 0, String(confirmCalls[0]))
check('点「取消」不覆盖已有内容', draft === null)
node = draw()
check('取消后面板仍开着', byClass(node, 'pcl-root').length === 1)

confirmAnswer = true
confirmCalls = []
byClass(node, 'pcl-guide-btn')[0].props.onClick()
check('确认后又问了一次', confirmCalls.length === 1)
check('点「确定」才写入输入框', !!draft && draft.indexOf('还很模糊的想法') >= 0, String(draft).slice(0, 60))
node = draw()
check('确认填入后面板关闭', node === null)

/* ---- 输入框里写了一半的需求也要带上（不丢用户已写的字） ---- */
liveNodes = []
liveDraft = '我想做一个给运营用的日报名单工具，但还没想清楚要不要做审批流'
draft = null
hookStore.clear()
openPanel()
node = draw()
byClass(node, 'pcl-guide-btn')[0].props.onClick()
check('带回输入框里写了一半的内容', !!draft && draft.indexOf('日报名单工具') >= 0, String(draft).slice(0, 120))
check('草稿段有小标题', !!draft && draft.indexOf('【我刚在输入框里写了一半的】') >= 0)
check('告诉 AI 不要当没看见', !!draft && draft.indexOf('不要当没看见') >= 0)

/* ---- 空收藏也能用（跳过目录段） ---- */
storage.set('dsh:prompt-library:v1', JSON.stringify({ version: 1, prompts: [] }))
openPanel()
node = draw()
liveDraft = ''
draft = null
byClass(node, 'pcl-guide-btn')[0].props.onClick()
check('空收藏时也能生成', !!draft && draft.indexOf('还很模糊的想法') >= 0)
check('空收藏时说明跳过目录', draft && draft.indexOf('收藏还是空的') >= 0, String(draft).slice(-80))

/* ---- 带上最近对话（用户要的「通过对话内容判断下一步」） ---- */
liveNodes = [
  { kind: 'user', data: { source: { text: '我想给公司做一个内部工具' } } },
  { kind: 'assistant', data: { blocks: [{ kind: 'text', text: '你希望先解决哪类人的问题？' }] } },
  { kind: 'user', data: { source: { text: '先解决运营同学每天手工导表的问题' } } },
]
storage.set('dsh:prompt-library:v1', JSON.stringify({
  version: 1,
  prompts: [{ id: 'g1', title: '对齐目标', content: 'C', tags: [], note: '方向模糊时用', source: '', starred: false, pinned: false, createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z' }],
}))
liveDraft = ''
draft = null
openPanel()
node = draw()
byClass(node, 'pcl-guide-btn')[0].props.onClick()
check('带上最近对话的小标题', !!draft && draft.indexOf('【我们前面已经聊到的】') >= 0, String(draft).slice(0, 80))
check('带上用户说过的话', !!draft && draft.indexOf('先解决运营同学每天手工导表的问题') >= 0)
check('带上 AI 说过的话', !!draft && draft.indexOf('你希望先解决哪类人的问题') >= 0)
check('对话标注了角色', !!draft && draft.indexOf('我：') >= 0 && draft.indexOf('AI：') >= 0)
check('要求跳过已明确的', !!draft && draft.indexOf('已经清楚的，直接跳过') >= 0)
check('对话段在流程段之前', !!draft && draft.indexOf('【我们前面已经聊到的】') < draft.indexOf('【请你这样做】'),
  'i1=' + (draft ? draft.indexOf('【我们前面已经聊到的】') : 'nul') + ' i2=' + (draft ? draft.indexOf('【请你这样做】') : 'nul'))

/* 没有对话时不该冒出空标题 */
liveNodes = []
storage.set('dsh:prompt-library:v1', JSON.stringify({ version: 1, prompts: [] }))
liveDraft = ''
draft = null
openPanel()
node = draw()
byClass(node, 'pcl-guide-btn')[0].props.onClick()
check('没有对话时不出现对话段', !!draft && draft.indexOf('【我们前面已经聊到的】') < 0, String(draft).slice(0, 60))

/* ---- 没有可用输入框时给出提示而不是静默 ---- */
hookStore.clear()
const overlayAlone = render(React.createElement(Overlay, {}))
storage.set('dsh:prompt-library:v1', JSON.stringify({
  version: 1,
  prompts: [{ id: 'x1', title: 'T', content: 'C', tags: [], note: '', source: '', starred: false, pinned: false, createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z' }],
}))

console.log('')
let fails = 0
for (const r of results) {
  if (!r.ok) fails++
  console.log((r.ok ? '  ok  ' : '  FAIL') + '  ' + r.name + (r.ok ? '' : '   <<< ' + (r.extra || '')))
}
console.log('')
console.log(fails === 0 ? '全部 ' + results.length + ' 项检查通过' : fails + ' 项失败 / 共 ' + results.length)
process.exit(fails === 0 ? 0 : 1)
