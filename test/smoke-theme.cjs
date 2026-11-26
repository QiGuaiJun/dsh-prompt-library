/* 离线 harness：验证主题明暗跟随宿主 theme 服务（而不是猜 OS） */
const path = require('path')
const fs = require('fs')

const FILE = path.join(__dirname, '..', 'lib', 'client.js')

/* ---- 极简 React shim（同其它 harness） ---- */
const hookStore = new Map()
let hookCursor = 0
let currentComp = null
function shallowEq(a, b) {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
const React = {
  createElement(type, props, ...children) {
    const flat = []
    const push = (c) => {
      if (c === null || c === undefined || c === false || c === true) return
      if (Array.isArray(c)) return c.forEach(push)
      flat.push(c)
    }
    push(children)
    return { $$el: true, type, props: props || {}, children: flat }
  },
  Fragment: 'Fragment',
  useState(init) {
    const key = (currentComp || 'anon') + ':' + hookCursor++
    if (!hookStore.has(key)) hookStore.set(key, typeof init === 'function' ? init() : init)
    const set = (v) => hookStore.set(key, typeof v === 'function' ? v(hookStore.get(key)) : v)
    return [hookStore.get(key), set]
  },
  useEffect(fn, deps) {
    const key = (currentComp || 'anon') + ':effect:' + hookCursor++
    const prev = hookStore.get(key)
    if (!prev || !deps || !shallowEq(prev, deps)) {
      hookStore.set(key, deps || [])
      try { const c = fn(); if (typeof c === 'function') hookStore.set(key + ':cleanup', c) } catch (e) {}
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
    const pc = currentComp, pk = hookCursor
    currentComp = type.name || 'anon'
    hookCursor = 0
    let out
    try { out = render(type({ ...props, children })) } finally { currentComp = pc; hookCursor = pk }
    return out
  }
  if (type === 'Fragment') return render(children)
  const kids = render(children)
  return { $$dom: true, type, props: props || {}, children: Array.isArray(kids) ? kids : kids === null ? [] : [kids] }
}

function walk(node, visit) {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit))
  if (typeof node === 'string') return
  visit(node)
  walk(node.children || [], visit)
}
function find(node, pred) {
  const out = []
  walk(node, (n) => { if (pred(n)) out.push(n) })
  return out
}
function texts(node) {
  const out = []
  walk(node, (n) => { for (const c of n.children || []) if (typeof c === 'string') out.push(c) })
  return out.join(' ')
}

/* ---- 假环境 ---- */
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
global.document = {
  createElement: () => ({ setAttribute() {}, appendChild() {}, removeChild() {}, style: {}, click() {} }),
  head: { appendChild() {} },
  body: { appendChild() {} },
}
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText() {} } },
  configurable: true,
  writable: true,
})
global.Blob = function () {}
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} }
global.FileReader = function () {}
global.setTimeout = (fn) => 0

let captured = null
global.window.__ModuleLoader__ = {
  load({ id, factory }) { captured = { id, exports: factory((n) => (n === 'react' ? React : {})) } },
}

const src = fs.readFileSync(FILE, 'utf8')
new Function('window', 'document', src)(global.window, global.document)

const results = []
function check(name, cond, extra) { results.push({ name, ok: !!cond, extra }) }

/* ---- 可变主题快照 ---- */
let activeScheme = 'dark'
const themeService = {
  getTheme() { return { preference: 'system', active: { id: activeScheme, colorScheme: activeScheme, tokens: {} }, themes: [], revision: 1 } },
  setTheme() {},
}
const themeListeners = []

const regs = []
const ctx = {
  effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
  get(name) { return name === 'theme' ? themeService : undefined },
  on(name, fn) { themeListeners.push({ name, fn }); return () => {} },
  slots: {
    inject(slot, fn) { fn(); return () => {} },
    register(options, component) { regs.push({ options, component }); return () => {} },
  },
}

const mod = captured.exports
mod.apply(ctx)

check('导出了 apply', typeof mod.apply === 'function')
check('订阅了 theme/change', themeListeners.length === 1 && themeListeners[0].name === 'theme/change', JSON.stringify(themeListeners.map((l) => l.name)))

const byName = {}
for (const r of regs) byName[r.options.name] = r
const Trigger = byName['conversation.input.left'].component
const Overlay = byName['shell.overlay'].component

/* 打开面板 */
storage.set('dsh:prompt-library:v1', JSON.stringify({
  version: 1,
  prompts: [{ id: 'p1', title: '示例', content: '正文内容', tags: ['前端'], note: '', source: '手动新建', starred: false, pinned: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
}))

function renderOverlay(times) {
  let node = null
  for (let i = 0; i < (times || 3); i++) node = render({ $$el: true, type: Overlay, props: {}, children: [] })
  return node
}

/* 先点入口按钮打开 */
const trigNode = render({ $$el: true, type: Trigger, props: {}, children: [] })
const trigBtn = find(trigNode, (n) => n.type === 'button')[0]
check('入口按钮可点', !!trigBtn)
trigBtn.props.onClick()

let node = renderOverlay(3)
check('面板已渲染', node !== null)

/* --- 暗色：不应带 pcl-light --- */
const darkRoot = node
check('暗色时 root 无 pcl-light', typeof darkRoot.props.className === 'string' && darkRoot.props.className.indexOf('pcl-light') < 0, darkRoot.props.className)

/* --- 切到亮色：宿主发 theme/change --- */
activeScheme = 'light'
for (const l of themeListeners) l.fn({ active: { colorScheme: 'light' } })

node = renderOverlay(3)
const lightRoot = node
check('亮色时 root 带 pcl-light', typeof lightRoot.props.className === 'string' && lightRoot.props.className.indexOf('pcl-light') >= 0, lightRoot.props.className)

/* --- 再切回暗色 --- */
activeScheme = 'dark'
for (const l of themeListeners) l.fn({ active: { colorScheme: 'dark' } })
node = renderOverlay(3)
check('切回暗色后 pcl-light 消失', String(node.props.className).indexOf('pcl-light') < 0, node.props.className)

/* --- theme 服务缺失时不应崩 --- */
check('无 theme 服务时仍能 apply', (() => {
  const ctx2 = {
    effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
    get() { return undefined },
    slots: { inject(s, fn) { fn(); return () => {} }, register() { return () => {} } },
  }
  try { mod.apply(ctx2); return true } catch { return false }
})())

check('getTheme 抛异常时仍能 apply', (() => {
  const ctx3 = {
    effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
    get() { return { getTheme() { throw new Error('boom') } } },
    on() { return () => {} },
    slots: { inject(s, fn) { fn(); return () => {} }, register() { return () => {} } },
  }
  try { mod.apply(ctx3); return true } catch { return false }
})())

/* ---- 输出 ---- */
const failed = results.filter((r) => !r.ok)
for (const r of results) {
  if (!r.ok) console.log('  ✗ ' + r.name + (r.extra !== undefined ? '  → ' + r.extra : ''))
}
console.log('')
if (failed.length === 0) console.log('全部 ' + results.length + ' 项检查通过')
else { console.log('失败 ' + failed.length + ' 项，共 ' + results.length + ' 项'); process.exitCode = 1 }
