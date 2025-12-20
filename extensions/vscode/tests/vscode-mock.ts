import type { Plugin } from 'vite'

export const mock_vscode = (): Plugin => ({
  name: `vscode-mock`,
  enforce: `pre`,
  resolveId: (module_id) => (module_id === `vscode` ? `\0vscode-mock` : null),
  load: (module_id) =>
    module_id === `\0vscode-mock`
      ? `
export const __noop = () => undefined
const __proxy = new Proxy(function(){}, { get: () => __proxy, apply: () => undefined, construct: () => ({}) })
export const window = __proxy
export const commands = __proxy
export const workspace = __proxy
export default { window, commands, workspace }
`
      : null,
})
