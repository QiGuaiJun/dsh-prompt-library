/* 离线 harness：验证客户端半边的槽位注册契约 + 面板渲染 */
const path = require('path')
const fs = require('fs')

const FILE = path.join(__dirname, '..', 'lib', 'client.js')

/* ---- 极简 React shim ---- */
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
      try { const c = fn(); if (typeof c === 'function') hookStore.set(key + ':cleanup', c) } catch (e) { /* ignore */ }
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

/* ---- 渲染 ---- */
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
global.navigator = { clipboard: { writeText() {} } }
global.Blob = function () {}
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} }
global.FileReader = function () {}
global.setTimeout = (fn) => 0

let captured = null
global.window.__ModuleLoader__ = {
  load({ id, factory }) {
    captured = { id, exports: factory((name) => (name === 'react' ? React : {})) }
  },
}

const src = fs.readFileSync(FILE, 'utf8')
new Function('window', 'document', src)(global.window, global.document)

const results = []
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra })
}

check('模块已注册', captured && captured.id === 'dsh-prompt-library', captured && captured.id)
const mod = captured && captured.exports
check('导出 inject', mod && Array.isArray(mod.inject) && mod.inject.indexOf('slots') >= 0, JSON.stringify(mod && mod.inject))
check('导出 apply', mod && typeof mod.apply === 'function')

/* ---- 记录型 ctx ---- */
const regs = []
const ctx = {
  effect(cb) { try { cb() } catch (e) { /* ignore */ } return () => {} },
  get() { return undefined },
  slots: {
    inject(slot, fn) { fn(); return () => {} },
    register(options, component) {
      regs.push({ options, component })
      return () => {}
    },
  },
}

mod.apply(ctx)

check('注册槽位数量 = 5', regs.length === 5, 'got ' + regs.length)

const byName = {}
for (const r of regs) byName[r.options.name] = r

const trig = byName['conversation.input.left']
check('入口：conversation.input.left', !!trig && trig.options.id === 'dsh-prompt-library-trigger', trig && JSON.stringify(trig.options))
check('入口组件 = TriggerButton', trig && trig.component && trig.component.name === 'TriggerButton', trig && trig.component && trig.component.name)

const overlay = byName['shell.overlay']
check('浮层：shell.overlay', !!overlay && overlay.options.id === 'dsh-prompt-library', overlay && JSON.stringify(overlay.options))
check('浮层组件 = PanelOverlay', overlay && overlay.component && overlay.component.name === 'PanelOverlay', overlay && overlay.component && overlay.component.name)

const bridge = byName['conversation.input.right']
check('桥接：conversation.input.right', !!bridge && bridge.options.id === 'dsh-prompt-library-bridge', bridge && JSON.stringify(bridge.options))

const chain = byName['conversation.chat.user.before']
check('用户消息链槽：有 select', !!chain && typeof chain.options.select === 'function', chain && JSON.stringify(Object.keys(chain.options)))
check('用户消息链槽：无 id（契约）', chain && chain.options.id === undefined, chain && JSON.stringify(chain.options))

if (chain) {
  const hit = chain.options.select({ source: { text: '帮我写十条测试数据' }, kind: 'user' })
  check('chain select 命中返回 {text}', hit && hit.text === '帮我写十条测试数据', JSON.stringify(hit))
  const miss = chain.options.select({ source: { text: '   ' }, kind: 'user' })
  check('chain select 空文本返回 null', miss === null, JSON.stringify(miss))
}

const asst = byName['conversation.chat.assistant-actions']
check('助手消息列表槽', !!asst && asst.options.id === 'dsh-prompt-library-save-assistant' && asst.options.order === 20, asst && JSON.stringify(asst.options))

/* ---- 面板渲染：默认关闭 ---- */
let node = render(React.createElement(overlay.component, {}))
check('面板默认关闭不渲染内容', node === null, JSON.stringify(node))

/* ---- 打开面板：渲染列表页 ---- */
storage.set('dsh:prompt-library:v1', JSON.stringify({
  version: 1,
  prompts: [
    { id: 'p1', title: '地铁跑酷网页游戏', content: '创建一个可直接玩的地铁跑酷网页游戏…', tags: ['前端'], note: '', source: '用户提示词', starred: false, pinned: false, createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z' },
    { id: 'p2', title: 'AIHOT 动效', content: '为网站 AIHOT 制作一支顶级水准的动效宣传视频…', tags: ['视频'], note: '', source: '手动新建', starred: false, pinned: true, createdAt: '2026-11-19T00:00:00.000Z', updatedAt: '2026-11-19T00:00:00.000Z' },
  ],
}))

hookStore.clear()
node = render(React.createElement(overlay.component, {}))
check('未打开时仍为空', node === null)

/* 通过入口按钮点开 */
const trigNode = render(React.createElement(trig.component, {}))
const trigBtns = find(trigNode, (n) => n.props && n.props.onClick && typeof n.props.onClick === 'function')
check('入口按钮存在', trigBtns.length >= 1, 'count=' + trigBtns.length)
check('入口按钮文案 = 提示词卡', texts(trigNode).indexOf('提示词卡') >= 0, texts(trigNode))
trigBtns[0].props.onClick()

hookStore.clear()
node = render(React.createElement(overlay.component, {}))
check('点开后渲染出内容', node !== null)
/* useEffect 在渲染内执行，状态更新需要再走一轮（模拟 React 重渲染） */
node = render(React.createElement(overlay.component, {}))
node = render(React.createElement(overlay.component, {}))
const body = texts(node)
check('标题：提示词卡', body.indexOf('提示词卡') >= 0, body.slice(0, 120))
check('有搜索框 placeholder', find(node, (n) => n.props && n.props.className === 'pcl-search').length === 1)
check('有按标签筛选下拉', find(node, (n) => n.props && n.props.className === 'pcl-select').length === 1)
check('有「新建」按钮', body.indexOf('新建') >= 0)
check('有标签 chips：全部', body.indexOf('全部') >= 0)
check('渲染出 2 张卡片', find(node, (n) => n.props && n.props.className === 'pcl-card').length === 2,
  'got ' + find(node, (n) => n.props && n.props.className === 'pcl-card').length)
check('卡片含标题', body.indexOf('地铁跑酷网页游戏') >= 0)
check('置顶条目带图钉', body.indexOf('📌') >= 0)

console.log('')
let fails = 0
for (const r of results) {
  if (!r.ok) fails++
  console.log((r.ok ? '  ok  ' : '  FAIL') + '  ' + r.name + (r.ok ? '' : '   <<< ' + (r.extra || '')))
}
console.log('')
console.log(fails === 0 ? '全部 ' + results.length + ' 项检查通过' : fails + ' 项失败 / 共 ' + results.length)
process.exit(fails === 0 ? 0 : 1)
