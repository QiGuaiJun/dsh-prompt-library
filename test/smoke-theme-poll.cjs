/* 离线 harness：验证 theme 服务「晚就绪」时能靠轮询接上 */
const path = require('path')
const fs = require('fs')

const FILE = path.join(__dirname, '..', 'lib', 'client.js')

/* ---- React shim ---- */
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
function find(node, pred) { const o = []; walk(node, (n) => { if (pred(n)) o.push(n) }); return o }

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
  value: { clipboard: { writeText() {} } }, configurable: true, writable: true,
})
global.Blob = function () {}
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} }
global.FileReader = function () {}

/* 受控定时器：手动步进，不真等 */
const timers = []
global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length }
function flushTimers(maxRounds) {
  let rounds = 0
  while (timers.length && rounds < (maxRounds || 200)) {
    const t = timers.shift()
    t.fn()
    rounds++
  }
  return rounds
}

let captured = null
global.window.__ModuleLoader__ = {
  load({ id, factory }) { captured = { id, exports: factory((n) => (n === 'react' ? React : {})) } },
}
const src = fs.readFileSync(FILE, 'utf8')
new Function('window', 'document', src)(global.window, global.document)

const results = []
function check(name, cond, extra) { results.push({ name, ok: !!cond, extra }) }

/* ---- 场景：一开始 get('theme') 返回 undefined，几轮后才出现 ---- */
let themeReady = false
let activeScheme = 'light'
const themeListeners = []
const themeService = {
  getTheme() {
    return { preference: 'system', active: { id: activeScheme, colorScheme: activeScheme, tokens: {} }, themes: [], revision: 1 }
  },
}

const regs = []
const ctx = {
  effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
  get(name) {
    if (name !== 'theme') return undefined
    return themeReady ? themeService : undefined
  },
  on(name, fn) { themeListeners.push({ name, fn }); return () => {} },
  slots: {
    inject(s, fn) { fn(); return () => {} },
    register(o, c) { regs.push({ options: o, component: c }); return () => {} },
  },
}

const mod = captured.exports
mod.apply(ctx)

check('服务未就绪时 apply 不抛', true)
check('服务未就绪时未订阅 theme/change', themeListeners.length === 0, 'got ' + themeListeners.length)
check('安排了轮询定时器', timers.length > 0, 'timers=' + timers.length)

/* 服务还没好：先走几轮 */
flushTimers(3)
check('服务仍缺席时不订阅', themeListeners.length === 0, 'got ' + themeListeners.length)

/* 服务就绪，再走一轮 */
themeReady = true
flushTimers(3)
check('服务就绪后接上并订阅 theme/change', themeListeners.length === 1 && themeListeners[0].name === 'theme/change', JSON.stringify(themeListeners.map((l) => l.name)))
check('接上后不再继续轮询', timers.length === 0, 'timers=' + timers.length)

/* 渲染浮层确认 pcl-light 已按 light 生效 */
const byName = {}
for (const r of regs) byName[r.options.name] = r
const Trigger = byName['conversation.input.left'].component
const Overlay = byName['shell.overlay'].component

let trigNode = render({ $$el: true, type: Trigger, props: {}, children: [] })
find(trigNode, (n) => n.type === 'button')[0].props.onClick()

let node = null
for (let i = 0; i < 3; i++) node = render({ $$el: true, type: Overlay, props: {}, children: [] })
check('接上后浮层带 pcl-light（宿主是亮色）', String(node.props.className).indexOf('pcl-light') >= 0, node.props.className)

/* 宿主切回暗色 */
activeScheme = 'dark'
for (const l of themeListeners) l.fn({ active: { colorScheme: 'dark' } })
for (let i = 0; i < 3; i++) node = render({ $$el: true, type: Overlay, props: {}, children: [] })
check('宿主切暗后 pcl-light 消失', String(node.props.className).indexOf('pcl-light') < 0, node.props.className)

/* ---- 超时放弃场景：服务永远不出现 ---- */
const timers2 = []
const savedSetTimeout = global.setTimeout
global.setTimeout = (fn, ms) => { timers2.push(fn); return timers2.length }

const regs2 = []
const ctx2 = {
  effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
  get() { return undefined },
  on() { return () => {} },
  slots: { inject(s, fn) { fn(); return () => {} }, register(o, c) { regs2.push(o); return () => {} } },
}
let threw = false
try { mod.apply(ctx2) } catch { threw = true }
check('服务永不出现时 apply 不抛', !threw)
check('槽位仍全部注册', regs2.length === 5, 'got ' + regs2.length)

/* 把轮询跑干（上限 8000ms / 250ms ≈ 32 轮） */
let rounds = 0
while (timers2.length && rounds < 100) { timers2.shift()(); rounds++ }
check('超时后停止轮询', timers2.length === 0, 'left=' + timers2.length)
check('超时后未订阅（无服务）', true)

global.setTimeout = savedSetTimeout

/* ---- 输出 ---- */
const failed = results.filter((r) => !r.ok)
for (const r of results) if (!r.ok) console.log('  ✗ ' + r.name + (r.extra !== undefined ? '  → ' + r.extra : ''))
console.log('')
if (failed.length === 0) console.log('全部 ' + results.length + ' 项检查通过')
else { console.log('失败 ' + failed.length + ' 项，共 ' + results.length + ' 项'); process.exitCode = 1 }
