/* 离线 harness 2：详情页交互 + 编辑保存 + 置顶 + 填入对话 */
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
function byText(node, label) {
  return find(node, (n) => n.props && typeof n.props.className === 'string' &&
    n.props.className.indexOf('pcl-btn') === 0 && texts(n) === label)[0]
}

const storage = new Map()
global.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
  confirm: () => true,
}
global.localStorage = global.window.localStorage
let clipboardValue = null
/* Node 24 自带全局 navigator（只读 getter），必须 defineProperty 才能覆盖 */
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: (v) => { clipboardValue = v; return Promise.resolve() } } },
  configurable: true,
  writable: true,
})
/* 记录型 DOM：file input 必须能"挂进 body 再 click"才符合修复后的实现 */
let lastFileInput = null
const bodyChildren = []
global.document = {
  createElement: (tag) => {
    const el = {
      tag, type: '', accept: '', files: null, onchange: null, parentNode: null,
      style: {}, setAttribute() {}, appendChild() {},
      click() { if (tag === 'input') lastFileInput = el },
    }
    return el
  },
  head: { appendChild() {} },
  body: {
    appendChild(el) { el.parentNode = global.document.body; bodyChildren.push(el) },
    removeChild(el) {
      const i = bodyChildren.indexOf(el)
      if (i >= 0) bodyChildren.splice(i, 1)
      el.parentNode = null
    },
  },
}
global.Blob = function () {}
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} }
/* 从 __text 同步回调，模拟浏览器 FileReader */
global.FileReader = function () {
  const self = this
  self.result = null
  self.onload = null
  self.onerror = null
  self.readAsText = function (file) {
    self.result = file.__text
    if (self.onload) self.onload()
  }
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

/* 桥接真实 inputActions */
let draft = null
render(React.createElement(Bridge, { inputActions: { setDraft: (v) => { draft = v } } }))
check('桥接已挂载', true)

storage.set('dsh:prompt-library:v1', JSON.stringify({
  version: 1,
  prompts: [
    { id: 'p1', title: '地铁跑酷网页游戏', content: '创建一个可直接玩的地铁跑酷网页游戏：玩家控制角色在三条铁轨之间左右移动。', tags: ['前端'], note: '', source: '用户提示词', starred: false, pinned: false, createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z' },
    { id: 'p2', title: 'AIHOT 动效', content: '为网站 AIHOT 制作一支顶级水准的动效宣传视频。', tags: ['视频'], note: '', source: '手动新建', starred: false, pinned: true, createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T00:00:00.000Z' },
  ],
}))

function openPanel() {
  hookStore.clear()
  const t = render(React.createElement(Trigger, {}))
  find(t, (n) => n.props && typeof n.props.onClick === 'function')[0].props.onClick()
}
function draw() {
  render(React.createElement(Overlay, {}))
  render(React.createElement(Overlay, {}))
  return render(React.createElement(Overlay, {}))
}

/* ---- 列表 → 详情 ---- */
openPanel()
let node = draw()
const cards = find(node, (n) => n.props && n.props.className === 'pcl-card')
check('列表有 2 张卡片', cards.length === 2, 'got ' + cards.length)
check('置顶条目排在最前', texts(cards[0]).indexOf('AIHOT') >= 0, texts(cards[0]).slice(0, 40))

cards[0].props.onClick()
node = draw()
const dbody = texts(node)
check('进入详情页：标题', dbody.indexOf('AIHOT 动效') >= 0, dbody.slice(0, 80))
check('详情页有「返回」', dbody.indexOf('返回') >= 0)
check('详情页有「复制」', dbody.indexOf('复制') >= 0, dbody.slice(0, 160))
check('详情页有「填入对话」', dbody.indexOf('填入对话') >= 0)
check('详情页有「编辑」', dbody.indexOf('编辑') >= 0)
check('详情页有「取消置顶」', dbody.indexOf('取消置顶') >= 0)
check('详情页有「删除」', dbody.indexOf('删除') >= 0)
check('详情页有「正文」小节', dbody.indexOf('正文') >= 0)
check('详情页有「来源」小节', dbody.indexOf('来源') >= 0)
check('详情页显示来源值', dbody.indexOf('手动新建') >= 0)
check('正文完整渲染', dbody.indexOf('顶级水准的动效宣传视频') >= 0)

/* ---- 复制 ---- */
clipboardValue = null
byText(node, '复制').props.onClick()
check('复制写入剪贴板', clipboardValue && clipboardValue.indexOf('AIHOT') >= 0, String(clipboardValue).slice(0, 40))

/* ---- 填入对话 ---- */
byText(node, '填入对话').props.onClick()
check('填入对话调用 setDraft', draft && draft.indexOf('AIHOT') >= 0, String(draft).slice(0, 40))

/* 面板应自动关闭 */
node = draw()
check('填入后面板关闭', node === null)

/* ---- 重新打开 → 编辑 ---- */
openPanel()
node = draw()
find(node, (n) => n.props && n.props.className === 'pcl-card')[0].props.onClick()
node = draw()
byText(node, '编辑').props.onClick()
node = draw()
check('打开编辑弹窗', find(node, (n) => n.props && n.props.className === 'pcl-dialog').length === 1)

/* 改正文并保存 */
const ta = find(node, (n) => n.tag === 'textarea')[0]
check('编辑框有正文', !!ta)
ta.props.onChange({ target: { value: '改过的正文内容 ABC' } })
node = draw()
byText(node, '保存').props.onClick()
node = draw()
const saved = JSON.parse(storage.get('dsh:prompt-library:v1'))
const p2 = saved.prompts.find((p) => p.id === 'p2')
check('保存后正文已更新', p2 && p2.content === '改过的正文内容 ABC', p2 && p2.content)
check('保存后置顶状态保留', p2 && p2.pinned === true, String(p2 && p2.pinned))

/* ---- 返回列表 ---- */
find(node, (n) => n.props && n.props.className === 'pcl-back')[0].props.onClick()
node = draw()
check('返回后回到列表页', find(node, (n) => n.props && n.props.className === 'pcl-card').length === 2,
  'got ' + find(node, (n) => n.props && n.props.className === 'pcl-card').length)

/* ---- 新建 ---- */
byText(node, '新建').props.onClick()
node = draw()
const modal = find(node, (n) => n.props && n.props.className === 'pcl-dialog')[0]
const inputs = find(modal, (n) => n.tag === 'input')
const areas = find(modal, (n) => n.tag === 'textarea')
check('新建弹窗有输入框', inputs.length >= 2 && areas.length === 1, 'inputs=' + inputs.length + ' areas=' + areas.length)
const titleInput = inputs[1] // [0]=标题 [1]=标签 ... 但按 placeholder 更稳
const titleField = inputs.filter((i) => String(i.props.placeholder || '').indexOf('接口用例') >= 0)[0]
areas[0].props.onChange({ target: { value: '这是新建的提示词正文' } })
titleField.props.onChange({ target: { value: '新建标题' } })
node = draw()
byText(node, '保存').props.onClick()
node = draw()
const after = JSON.parse(storage.get('dsh:prompt-library:v1'))
check('新建后共 3 条', after.prompts.length === 3, 'got ' + after.prompts.length)
check('新建的标题正确', after.prompts.some((p) => p.title === '新建标题'), JSON.stringify(after.prompts.map((p) => p.title)))

/* ---- 刷新按钮：外部改动 localStorage 后点「刷新」应重新读取 ---- */
const ext = JSON.parse(storage.get('dsh:prompt-library:v1'))
ext.prompts.push({
  id: 'p9', title: '外部写入的卡片', content: '外部写入的正文', tags: ['外部'], note: '', source: '手动新建',
  starred: false, pinned: false, createdAt: '2026-11-21T00:00:00.000Z', updatedAt: '2026-11-21T00:00:00.000Z',
})
storage.set('dsh:prompt-library:v1', JSON.stringify(ext))
node = draw()
check('未点刷新时界面仍是旧数据', find(node, (n) => n.props && n.props.className === 'pcl-card').length === 3,
  'got ' + find(node, (n) => n.props && n.props.className === 'pcl-card').length)
byText(node, '刷新').props.onClick()
node = draw()
check('点刷新后读到 4 张卡片', find(node, (n) => n.props && n.props.className === 'pcl-card').length === 4,
  'got ' + find(node, (n) => n.props && n.props.className === 'pcl-card').length)
check('刷新后新卡片可见', texts(node).indexOf('外部写入的卡片') >= 0)
check('刷新后有提示', texts(node).indexOf('已刷新') >= 0)
/* 复原：移除外部条目再刷新 */
const back = JSON.parse(storage.get('dsh:prompt-library:v1'))
back.prompts = back.prompts.filter((p) => p.id !== 'p9')
storage.set('dsh:prompt-library:v1', JSON.stringify(back))
byText(node, '刷新').props.onClick()
node = draw()
check('复原后回到 3 张', find(node, (n) => n.props && n.props.className === 'pcl-card').length === 3,
  'got ' + find(node, (n) => n.props && n.props.className === 'pcl-card').length)

/* ---- 标签筛选（先把搜索框清空，避免上一步残留） ---- */
const searchBox = find(node, (n) => n.props && n.props.className === 'pcl-search')[0]
searchBox.props.onChange({ target: { value: '' } })
node = draw()
const sel = find(node, (n) => n.props && n.props.className === 'pcl-select')[0]
check('标签下拉含「前端」', find(sel, (n) => n.tag === 'option' && texts(n) === '前端').length === 1)
sel.props.onChange({ target: { value: '前端' } })
node = draw()
const filtered = find(node, (n) => n.props && n.props.className === 'pcl-card')
check('按标签筛选后只剩 1 张', filtered.length === 1, 'got ' + filtered.length)

/* ---- chip 也等效 ---- */
sel.props.onChange({ target: { value: '' } })
node = draw()
const chips = find(node, (n) => n.props && typeof n.props.className === 'string' && n.props.className.indexOf('pcl-chip') === 0 && n.props.className.indexOf('pcl-chips') < 0)
const frontChip = chips.filter((c) => texts(c) === '前端')[0]
frontChip.props.onClick()
node = draw()
check('chip 点「前端」同样只剩 1 张', find(node, (n) => n.props && n.props.className === 'pcl-card').length === 1,
  'got ' + find(node, (n) => n.props && n.props.className === 'pcl-card').length)
frontChip.props.onClick()
node = draw()

/* ---- 搜索 ---- */
const search = find(node, (n) => n.props && n.props.className === 'pcl-search')[0]
search.props.onChange({ target: { value: '地铁' } })
node = draw()
const searched = find(node, (n) => n.props && n.props.className === 'pcl-card')
check('搜索命中标题', searched.length === 1, 'got ' + searched.length)

/* ---- 导入：粘贴路径（不依赖文件对话框） ---- */
search.props.onChange({ target: { value: '' } })
node = draw()
/* 前面的 chip 测试留下了「前端」筛选，先清掉 */
find(node, (n) => n.props && n.props.className === 'pcl-select')[0].props.onChange({ target: { value: '' } })
node = draw()
const beforeImport = find(node, (n) => n.props && n.props.className === 'pcl-card').length

/* 弹窗内的按钮：按 dialog 作用域取，避免命中标题行的同名按钮 */
function inDialog(n, label) {
  const dlg = find(n, (x) => x.props && x.props.className === 'pcl-dialog')[0]
  if (!dlg) return null
  return find(dlg, (x) => x.props && typeof x.props.className === 'string' &&
    x.props.className.indexOf('pcl-btn') === 0 && texts(x) === label)[0]
}

byText(node, '导入').props.onClick()
node = draw()
const importDialog = find(node, (n) => n.props && n.props.className === 'pcl-dialog')[0]
check('点导入弹出导入弹窗', !!importDialog)
check('导入弹窗有选文件按钮', texts(importDialog).indexOf('选择 JSON 文件') >= 0, texts(importDialog).slice(0, 120))
check('导入弹窗有粘贴框', find(importDialog, (n) => n.tag === 'textarea').length === 1)

const pasteArea = find(importDialog, (n) => n.tag === 'textarea')[0]
pasteArea.props.onChange({
  target: {
    value: JSON.stringify({
      version: 1,
      prompts: [
        { id: 'imp1', title: '粘贴导入一', content: '粘贴进来的正文一', tags: ['导入'] },
        { id: 'imp2', title: '粘贴导入二', content: '粘贴进来的正文二', tags: ['导入'] },
      ],
    }),
  },
})
node = draw()
inDialog(node, '导入').props.onClick()
node = draw()
check('粘贴导入后卡片数 +2',
  find(node, (n) => n.props && n.props.className === 'pcl-card').length === beforeImport + 2,
  'before=' + beforeImport + ' after=' + find(node, (n) => n.props && n.props.className === 'pcl-card').length)
check('粘贴导入后有提示', texts(node).indexOf('已导入 2 条') >= 0, texts(node).slice(0, 120))
const stored1 = JSON.parse(storage.get('dsh:prompt-library:v1'))
check('粘贴导入真正写进 localStorage', stored1.prompts.some((p) => p.id === 'imp1'), JSON.stringify(stored1.prompts.map((p) => p.id)))

/* ---- 导入：选文件路径（input 挂进 body 后才 click） ---- */
check('导入弹窗已关闭', find(node, (n) => n.props && n.props.className === 'pcl-dialog').length === 0)
byText(node, '导入').props.onClick()
node = draw()
/* 校验修复点：选文件按钮点击后，input 必须已挂到 body 上 */
bodyChildren.length = 0
lastFileInput = null
const pickBtn = find(node, (n) => n.props && n.props.className === 'pcl-btn' && texts(n) === '选择 JSON 文件…')[0]
check('导入弹窗有「选择 JSON 文件…」按钮', !!pickBtn)
pickBtn.props.onClick()
check('文件 input 已挂进 DOM 再 click', !!lastFileInput && lastFileInput.parentNode === global.document.body,
  'input=' + !!lastFileInput + ' parent=' + !!(lastFileInput && lastFileInput.parentNode))

lastFileInput.files = [{
  __text: JSON.stringify({
    version: 1,
    prompts: [{ id: 'imp3', title: '选文件导入', content: '选文件进来的正文', tags: ['导入'] }],
  }),
}]
lastFileInput.onchange()
node = draw()
check('选文件导入后有提示', texts(node).indexOf('已导入 1 条') >= 0, texts(node).slice(0, 140))
const stored2 = JSON.parse(storage.get('dsh:prompt-library:v1'))
check('选文件导入真正写进 localStorage', stored2.prompts.some((p) => p.id === 'imp3'), JSON.stringify(stored2.prompts.map((p) => p.id)))
check('选文件后 input 已从 DOM 摘除', bodyChildren.length === 0, 'left=' + bodyChildren.length)
check('导入后弹窗自动关闭', find(node, (n) => n.props && n.props.className === 'pcl-dialog').length === 0)

/* ---- 导入：坏数据不能静默吞掉 ---- */
byText(node, '导入').props.onClick()
node = draw()
const area2 = find(node, (n) => n.tag === 'textarea')[0]
area2.props.onChange({ target: { value: '这不是 JSON' } })
node = draw()
inDialog(node, '导入').props.onClick()
node = draw()
check('非法 JSON 有明确提示', texts(node).indexOf('不是合法的 JSON') >= 0, texts(node).slice(0, 140))
check('非法 JSON 不写入数据', JSON.parse(storage.get('dsh:prompt-library:v1')).prompts.length === stored2.prompts.length)
inDialog(node, '取消').props.onClick()
node = draw()

console.log('')
let fails = 0
for (const r of results) {
  if (!r.ok) fails++
  console.log((r.ok ? '  ok  ' : '  FAIL') + '  ' + r.name + (r.ok ? '' : '   <<< ' + (r.extra || '')))
}
console.log('')
console.log(fails === 0 ? '全部 ' + results.length + ' 项检查通过' : fails + ' 项失败 / 共 ' + results.length)
process.exit(fails === 0 ? 0 : 1)
