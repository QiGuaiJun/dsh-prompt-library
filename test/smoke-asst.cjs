/* 验证助手消息正文提取（pickAssistantText 走 useChat 快照） */
const path = require('path')
const fs = require('fs')
const FILE = path.join(__dirname, '..', 'lib', 'client.js')

const hookStore = new Map()
let hookCursor = 0
let currentComp = null
const shallowEq = (a, b) => a === b || (a && b && a.length === b.length && a.every((v, i) => v === b[i]))

const React = {
  createElement(type, props, ...children) {
    const flat = []
    const push = (c) => { if (c === null || c === undefined || c === false || c === true) return; if (Array.isArray(c)) { c.forEach(push); return } flat.push(c) }
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
    if (!prev || !deps || !shallowEq(prev, deps)) { hookStore.set(key, deps || []); try { fn() } catch (e) {} }
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
    currentComp = type.name || 'anon'; hookCursor = 0
    let out
    try { out = render(type({ ...props, children })) } finally { currentComp = pc; hookCursor = pk }
    return out
  }
  return { tag: type, props, children: children.map(render) }
}
function walk(n, fn) { if (!n) return; if (Array.isArray(n)) { n.forEach((x) => walk(x, fn)); return } if (typeof n === 'string') { fn(n); return } fn(n); if (n.children) n.children.forEach((c) => walk(c, fn)) }
const texts = (n) => { const o = []; walk(n, (x) => { if (typeof x === 'string') o.push(x) }); return o.join(' ') }
const find = (n, p) => { const o = []; walk(n, (x) => { if (x && typeof x === 'object' && p(x)) o.push(x) }); return o }

const storage = new Map()
global.window = { localStorage: { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) }, confirm: () => true }
global.localStorage = global.window.localStorage
global.document = { createElement: () => ({ setAttribute() {}, appendChild() {}, style: {}, click() {} }), head: { appendChild() {} } }
global.Blob = function () {}
global.URL = { createObjectURL: () => 'b', revokeObjectURL() {} }
global.FileReader = function () {}
global.setTimeout = () => 0

let captured = null
global.window.__ModuleLoader__ = { load({ id, factory }) { captured = { id, exports: factory((n) => (n === 'react' ? React : {})) } } }
new Function('window', 'document', fs.readFileSync(FILE, 'utf8'))(global.window, global.document)

const regs = []
const ctx = { effect(cb) { try { cb() } catch (e) {} return () => {} }, get() { return undefined }, slots: { inject(s, f) { f(); return () => {} }, register(o, c) { regs.push({ options: o, component: c }); return () => {} } } }
captured.exports.apply(ctx)
const byName = {}; for (const r of regs) byName[r.options.name] = r
const SaveAction = byName['conversation.chat.assistant-actions'].component

const results = []
const check = (n, c, e) => results.push({ name: n, ok: !!c, extra: e })

/* 构造一个假的 ChatSnapshot */
function makeChat(mapping) {
  return (selector) => {
    const snap = {
      nodes: {
        values() { return Array.from(mapping.values()) },
      },
    }
    return typeof selector === 'function' ? selector(snap) : snap
  }
}

/* 助手消息：两个 text 块 + 一个 reasoning 块 */
const nodes = new Map()
nodes.set('n1', {
  data: {
    kind: 'assistant',
    finalNode: { messageId: 'm-abc' },
    blocks: [
      { kind: 'reasoning', text: '思考中不该被采集' },
      { kind: 'text', text: '这是助手的第一段回复。' },
      { kind: 'tool-call', name: 'bash' },
      { kind: 'text', text: '这是第二段。' },
    ],
  },
})
const useChat = makeChat(nodes)

hookStore.clear()
let node = render(React.createElement(SaveAction, { messageId: 'm-abc', useChat }))
check('助手消息渲染出「存为提示词」', texts(node).indexOf('存为提示词') >= 0, texts(node))

/* 点开编辑框，检查正文是否预填 */
find(node, (n) => n.props && n.props.className === 'pcl-save')[0].props.onClick()
node = render(React.createElement(SaveAction, { messageId: 'm-abc', useChat }))
node = render(React.createElement(SaveAction, { messageId: 'm-abc', useChat }))
const ta = find(node, (n) => n.tag === 'textarea')[0]
check('正文预填了两个 text 块', ta && ta.props.value.indexOf('这是助手的第一段回复。') >= 0 && ta.props.value.indexOf('这是第二段。') >= 0, ta && JSON.stringify(ta.props.value))
check('reasoning 块被跳过', ta && ta.props.value.indexOf('思考中不该被采集') < 0, ta && JSON.stringify(ta.props.value))
check('两段用空行连接', ta && ta.props.value.indexOf('第一段回复。\n\n这是第二段') >= 0, ta && JSON.stringify(ta.props.value))

/* 来源自动标为「助手回复」 */
const inputs = find(node, (n) => n.tag === 'input')
const srcInput = inputs.filter((i) => String(i.props.placeholder || '').indexOf('助手回复') >= 0)[0]
check('来源预填「助手回复」', srcInput && srcInput.props.value === '助手回复', srcInput && JSON.stringify(srcInput.props.value))

/* 找不到 messageId 时降级为空正文 */
hookStore.clear()
node = render(React.createElement(SaveAction, { messageId: 'm-zzz', useChat }))
find(node, (n) => n.props && n.props.className === 'pcl-save')[0].props.onClick()
node = render(React.createElement(SaveAction, { messageId: 'm-zzz', useChat }))
node = render(React.createElement(SaveAction, { messageId: 'm-zzz', useChat }))
const ta2 = find(node, (n) => n.tag === 'textarea')[0]
check('未知 messageId 时正文为空', ta2 && ta2.props.value === '', ta2 && JSON.stringify(ta2.props.value))

/* useChat 抛异常时不能炸 */
hookStore.clear()
const boom = () => { throw new Error('snapshot 未就绪') }
node = render(React.createElement(SaveAction, { messageId: 'm-abc', useChat: boom }))
check('useChat 抛异常仍渲染按钮', texts(node).indexOf('存为提示词') >= 0, texts(node))

console.log('')
let fails = 0
for (const r of results) {
  if (!r.ok) fails++
  console.log((r.ok ? '  ok  ' : '  FAIL') + '  ' + r.name + (r.ok ? '' : '   <<< ' + (r.extra || '')))
}
console.log('')
console.log(fails === 0 ? '全部 ' + results.length + ' 项检查通过' : fails + ' 项失败 / 共 ' + results.length)
process.exit(fails === 0 ? 0 : 1)
