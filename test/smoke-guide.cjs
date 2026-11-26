/* 离线 harness 6：引导入口 —— 按当前对话/草稿从库里挑提示词，三种分支各走一遍 */
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
const toasts = []
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

function setLib(list) {
  storage.set('dsh:prompt-library:v1', JSON.stringify({ version: 1, prompts: list }))
}
function mk(id, title, content, tags, note) {
  return { id, title, content, tags: tags || [], note: note || '', source: '导入', starred: false, pinned: false, createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z' }
}

/* 库：两条，「对齐目标」的 note/标签/标题都贴着「需求/目标」这类词 */
const LIB = [
  mk('g1', '对齐目标', '在动手前，先用一句话复述我的目标，列出你认为的关键约束，互相确认后再开始。', ['问清问题'], '需求模糊、方向没定的时候用'),
  mk('g2', '专家会诊', '组 3 个互补的专家视角互相质疑，从分歧里挖真信息。', ['解决问题'], '方案两难时用'),
  mk('g3', '苏格拉底式提问', '先不给建议，用最多 6 个追问帮我找到真正值得回答的问题。', ['问清问题'], '先把问题问清楚时用'),
]

function openPanel() {
  hookStore.clear()
  mountBridge()
  /* 面板开关是模块级状态（usePanelOpen 的订阅存），hookStore.clear() 不会重置它；
     所以按当前状态决定点几下，确保最终是「打开」。 */
  let t = render(React.createElement(Trigger, {}))
  find(t, (n) => n.props && typeof n.props.onClick === 'function')[0].props.onClick()
  if (!render(React.createElement(Overlay, {}))) {
    t = render(React.createElement(Trigger, {}))
    find(t, (n) => n.props && typeof n.props.onClick === 'function')[0].props.onClick()
  }
}
function draw() {
  render(React.createElement(Overlay, {}))
  render(React.createElement(Overlay, {}))
  render(React.createElement(Overlay, {}))
  return render(React.createElement(Overlay, {}))
}
function clickGuide(node) {
  const b = byClass(node, 'pcl-guide-btn')[0]
  b.props.onClick()
}

/* ---- 入口 ---- */
setLib(LIB)
liveNodes = []
liveDraft = ''
openPanel()
let node = draw()
const guideBtn = byClass(node, 'pcl-guide-btn')[0]
check('列表页有引导入口', !!guideBtn)
check('入口文案说「让库里挑一条」', texts(guideBtn || node).indexOf('让库里挑一条给我') >= 0,
  texts(guideBtn || node).slice(0, 60))
const rowOrder = find(node, (n) => n.props && (n.props.className === 'pcl-guidebar' || n.props.className === 'pcl-searchrow'))
check('入口排在搜索行之前', rowOrder.length === 2 && rowOrder[0].props.className === 'pcl-guidebar',
  rowOrder.map((r) => r.props.className).join(','))
const hintNode = byClass(node, 'pcl-guide-hint')[0]
check('入口下面写清点完会发生什么', !!hintNode && texts(hintNode).indexOf('按回车发送') >= 0,
  texts(hintNode || '').slice(0, 80))
check('入口下面说明三种情况', !!hintNode && texts(hintNode).indexOf('拿不准就列几条') >= 0)

/* ---- A 分支：对话里明确提到「目标/需求」，应直接挑出「对齐目标」并给出正文 ---- */
liveDraft = ''
draft = null
confirmCalls = []
toasts.length = 0
liveNodes = [
  { kind: 'user', data: { source: { text: '我想给公司做一个内部工具，但需求还比较模糊，方向没定' } } },
  { kind: 'assistant', data: { blocks: [{ kind: 'text', text: '你希望先解决哪类人的问题？' }] } },
]
hookStore.clear()
openPanel()
node = draw()
clickGuide(node)
check('输入框为空时不弹确认', confirmCalls.length === 0, JSON.stringify(confirmCalls))
check('点一下就写进输入框', !!draft, String(draft).slice(0, 40))
check('强匹配时直接给出该条正文', !!draft && draft.indexOf('先用一句话复述我的目标') >= 0,
  '未带正文；开头是：' + String(draft).slice(0, 120))
check('强匹配时开头只说「用下面这条」', !!draft && draft.indexOf('用下面这条，直接做') >= 0,
  String(draft).slice(0, 60))
check('强匹配时不注水：不含挑选理由/请你这样做等段落', !!draft &&
  draft.indexOf('【请你这样做】') < 0 && draft.indexOf('需求模糊、方向没定的时候用') < 0,
  String(draft).slice(0, 120))
check('强匹配时全文不超过 120 字', !!draft && draft.length <= 120, '实际 ' + String(draft).length + ' 字')
node = draw()
const toastNode = find(node, (n) => n.props && String(n.props.className || '').indexOf('pcl-toast') >= 0)[0]
const toastText = texts(toastNode || '')
check('面板关了也能看到提示', !!toastNode, 'no toast')
check('toast 里点名挑中的标题', toastText.indexOf('对齐目标') >= 0, toastText)
/* 关闭态专用：悬空 toast（.pcl-toast-float）只会出现在「面板已关」那条分支里。
   注意不能用 pcl-root 计数判断开关——harness 的 useState 按 key 缓存，
   setPanelOpen 的通知拿不到真实 React 的重渲染。 */
check('填入后面板关闭', String((toastNode || {}).props ? toastNode.props.className : '').indexOf('pcl-toast-float') >= 0,
  String((toastNode || {}).props ? toastNode.props.className : 'no toast'))

/* ---- 不再抄对话原文：对话内容模型本来就看得到，抄过去纯占字数 ---- */
check('不再把对话原文抄进输入框', !!draft && draft.indexOf('我想给公司做一个内部工具') < 0,
  String(draft).slice(0, 160))
check('不再有「我们前面已经聊到的」大段', !!draft && draft.indexOf('【我们前面已经聊到的】') < 0)
check('不再有角色标注的对话行', !!draft && draft.indexOf('AI：你希望先解决哪类人的问题') < 0)

/* ---- 带上输入框里写了一半的草稿（这个模型真的看不到） ---- */
liveNodes = []
liveDraft = '我想做一个给运营用的日报名单工具，但还没想清楚要不要做审批流'
draft = null
hookStore.clear()
openPanel()
node = draw()
clickGuide(node)
check('带回输入框里写了一半的内容', !!draft && draft.indexOf('日报名单工具') >= 0, String(draft).slice(0, 120))
check('草稿说明模型之前没看到过', !!draft && draft.indexOf('你之前没看到') >= 0)

/* ---- B 分支：有相关词但不够强 → 只列候选，不塞正文 ---- */
liveNodes = [
  { kind: 'user', data: { source: { text: '这个地方有点两难，不知道选哪个' } } },
]
liveDraft = ''
draft = null
setLib(LIB)
hookStore.clear()
openPanel()
node = draw()
clickGuide(node)
check('弱匹配时列出候选', !!draft && draft.indexOf('从下面这几条里挑一条') >= 0,
  String(draft).slice(0, 120))
check('弱匹配时带上候选标题', !!draft && draft.indexOf('专家会诊') >= 0)
check('弱匹配时不直接塞正文', !!draft && draft.indexOf('组 3 个互补的专家视角互相质疑') < 0)
check('弱匹配时要求挑完直接做', !!draft && draft.indexOf('直接用它帮我把这件事做出来') >= 0)
check('弱匹配时允许说不合适', !!draft && draft.indexOf('都不太对就说一声') >= 0)
check('弱匹配时全文不超过 320 字', !!draft && draft.length <= 320, '实际 ' + String(draft).length + ' 字')

/* ---- B 分支：完全没命中 → 列候选但也允许"没有明显相关" ---- */
liveNodes = []
liveDraft = '帮我写一首关于秋天的诗'
draft = null
hookStore.clear()
openPanel()
node = draw()
clickGuide(node)
check('没命中词时不崩，仍给出可发送内容', !!draft && draft.length > 40, String(draft).slice(0, 60))
check('没命中词时提示这批对不上', !!draft && draft.indexOf('这批都对不上') >= 0,
  String(draft).slice(0, 160))

/* ---- C 分支：空库 → 退回追问流程 ---- */
setLib([])
liveNodes = []
liveDraft = ''
draft = null
hookStore.clear()
openPanel()
node = draw()
clickGuide(node)
check('空收藏时也能生成', !!draft && draft.indexOf('还很模糊的想法') >= 0, String(draft).slice(0, 60))
check('空收藏时说明跳过目录', !!draft && draft.indexOf('收藏还是空的') >= 0, String(draft).slice(-90))
check('空库时给一次一问的规则', !!draft && draft.indexOf('一次只问我一个问题') >= 0)
check('空库时每题给 2-3 个选项', !!draft && draft.indexOf('2-3 个具体选项') >= 0)
check('空库时要求每 2-3 轮给看得见的东西', !!draft && draft.indexOf('每问 2-3 轮') >= 0)
check('空库时说「不对」时猜原因', !!draft && draft.indexOf('你猜一个具体原因让我确认') >= 0)
check('空库时不许抛一堆问题', !!draft && draft.indexOf('不要一次给我一堆问题') >= 0)
check('空库时能一句话说清才动手', !!draft && draft.indexOf('再开始动手') >= 0)

/* ---- 输入框已有内容 → 先问一句，且确认文案说会替换 ---- */
setLib(LIB)
liveNodes = [
  { kind: 'user', data: { source: { text: '需求还很模糊，方向没定' } } },
]
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
check('确认后写入输入框', !!draft && draft.indexOf('用下面这条') >= 0, String(draft).slice(0, 60))
node = draw()
const toast2 = find(node, (n) => n.props && String(n.props.className || '').indexOf('pcl-toast-float') >= 0)[0]
check('确认填入后面板关闭', !!toast2, toast2 ? 'ok' : String(node && node.tag))

/* ---- 挑中判定：两个词命中但分数接近时不应硬说"挑好了" ---- */
setLib([
  mk('t1', '提示词甲', 'AAAAAAAAAA', [], '需求模糊时用'),
  mk('t2', '提示词乙', 'BBBBBBBBBB', [], '方向没定时用'),
])
liveNodes = []
liveDraft = '需求模糊，方向没定'
draft = null
hookStore.clear()
openPanel()
node = draw()
clickGuide(node)
check('并列时不硬点一条（走候选分支）', !!draft && draft.indexOf('用下面这条') < 0,
  String(draft).slice(0, 80))

/* ---- 挑中判定：同一条命中两个不同字段、明显领先 → 算强匹配 ---- */
setLib([
  mk('s1', '对齐目标', '把目标先复述一遍再动手。', ['需求分析'], '需求模糊的时候用'),
  mk('s2', '其它', '无关内容。', [], '完全不相干'),
])
liveNodes = [
  { kind: 'user', data: { source: { text: '现在的需求还很模糊，我想先把需求说清楚' } } },
]
liveDraft = ''
draft = null
hookStore.clear()
openPanel()
node = draw()
clickGuide(node)
check('多字段命中且领先时算强匹配', !!draft && draft.indexOf('用下面这条') >= 0,
  String(draft).slice(0, 100))
check('强匹配给出的是那条的正文', !!draft && draft.indexOf('把目标先复述一遍再动手') >= 0)

/* ---- 只在正文里撞词不算强匹配：正文命中再多，也不能硬点这条 ---- */
setLib([
  // 正文里塞满对话中出现过的词，标题/标签/什么时候用 一个都不沾
  mk('c1', '某模板', '公司 产品 功能 设计 用户 需求 场景 全部堆在正文里。', ['图像编辑'], '完全不相干'),
  mk('c2', '另一条', '也无关。', [], '同样不相干'),
])
liveNodes = [{ kind: 'user', data: { source: { text: '我想给公司做一个产品，第一版功能怎么设计' } } }]
liveDraft = ''
draft = null
hookStore.clear()
openPanel()
node = draw()
clickGuide(node)
check('只在正文撞词时降级为候选分支', !!draft && draft.indexOf('【我挑的这条】') < 0,
  String(draft).slice(0, 90))

/* ---- 正文里的【占位符】不参与打分（模板的「【填写产品、公司…】」曾把无关条目顶到第一） ---- */
setLib([
  mk('h1', '横纵分析法', '研究对象是：【填写产品、公司、人物、技术、行业或事件】。请做纵向分析。', ['学习'], '研究陌生领域时用'),
  mk('h2', '别的', '无关。', [], '无关'),
])
liveNodes = [{ kind: 'user', data: { source: { text: '我想给公司做一个产品，不知道第一版做哪些功能' } } }]
liveDraft = ''
draft = null
hookStore.clear()
openPanel()
node = draw()
clickGuide(node)
check('占位符里的词不再把无关模板顶成强匹配', !!draft && draft.indexOf('【我挑的这条】') < 0,
  String(draft).slice(0, 90))


console.log('')
let fails = 0
for (const r of results) {
  if (!r.ok) fails++
  console.log((r.ok ? '  ok  ' : '  FAIL') + '  ' + r.name + (r.ok ? '' : '   <<< ' + (r.extra || '')))
}
console.log('')
console.log(fails === 0 ? '全部 ' + results.length + ' 项检查通过' : fails + ' 项失败 / 共 ' + results.length)
process.exit(fails === 0 ? 0 : 1)
