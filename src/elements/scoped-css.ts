import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const app_css_path = resolve(import.meta.dirname, `../lib/app.css`)
const SHELL_LAYER = `@layer matterviz-shell {`
const COLOR_SCHEME = `color-scheme: light dark;`

// app.css for a host page (one with custom elements, a notebook with widgets). Its theme tokens
// stay on :root at zero specificity (so any page rule beats them), and on :host for a sheet
// adopted into a shadow root, without color-scheme, which each embedded component root sets
// itself. The demo site's matterviz-shell layer (body, links, headings) goes, and every other
// rule is scoped to the `scope` selector, so bare button/input/table rules leave the page alone.
export const scoped_app_css = (scope: string): string => {
  const css = readFileSync(app_css_path, `utf8`).replaceAll(/\/\*[\s\S]*?\*\//g, ``)
  const rules: string[] = []
  let [depth, start] = [0, 0]
  for (let idx = 0; idx < css.length; idx++) {
    if (css[idx] === `{`) depth++
    else if (css[idx] === `}` && --depth === 0) {
      rules.push(css.slice(start, idx + 1).trim())
      start = idx + 1
    }
  }
  const is_token = (rule: string) => /^:(?:root|host)\b/.test(rule)
  const tokens = rules.filter(is_token).join(`\n`)
  if (depth !== 0 || css.slice(start).trim() || !tokens.includes(COLOR_SCHEME)) {
    throw new Error(`${app_css_path}: unbalanced braces or no ${COLOR_SCHEME} in its tokens`)
  }
  if (!rules.some((rule) => rule.startsWith(SHELL_LAYER))) {
    throw new Error(`${app_css_path}: ${SHELL_LAYER} not found`)
  }
  const scoped = rules.filter((rule) => !is_token(rule) && !rule.startsWith(SHELL_LAYER))
  // :host stays bare: no page rule reaches into a shadow root to compete with it
  const zero_specificity = tokens
    .replace(COLOR_SCHEME, ``)
    .replaceAll(/:root(?:\[[^\]]*\])?/g, (selector) => `:where(${selector})`)
  return `${zero_specificity}
@scope (${scope}) {
${scoped.join(`\n`)}
}`
}
