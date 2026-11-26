/**
 * dsh-prompt-library —— 宿主半边（最小壳）。
 *
 * 数据持久化放在客户端半边（浏览器 localStorage），
 * 所以这里不再注册 RPC 通道，只保证 bundle 能被正常加载。
 */

export const name = 'dsh-prompt-library'

export function apply(ctx) {
  ctx?.logger?.info?.('prompt-library: ready (client-side storage)')
}

export default { name, apply }
