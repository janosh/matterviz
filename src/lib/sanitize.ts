import DOMPurify from 'dompurify'
import { format_formula_html } from './phase-diagram/utils'
import { escape_html } from './utils'

const SAFE_TAGS = [`a`, `b`, `i`, `em`, `strong`, `sub`, `sup`, `br`, `span`, `code`, `small`]
const SAFE_ATTRS = [`style`, `class`, `title`, `href`, `target`, `rel`]
const SAFE_TAG_SET = new Set(SAFE_TAGS)
const SAFE_ATTR_SET = new Set(SAFE_ATTRS)
// only allow safe CSS properties for text formatting
const SAFE_STYLE_RE =
  /^\s*(?:color|font-weight|font-style|font-size|text-decoration|vertical-align)\s*:/

const ensure_token = (value: string, token: string): string => {
  const tokens = new Set(value.split(/\s+/).filter(Boolean))
  tokens.add(token)
  return [...tokens].join(` `)
}

// undefined = not yet checked, null = no DOM available, instance = ready
let purify: ReturnType<typeof DOMPurify> | null | undefined

function get_purify(): ReturnType<typeof DOMPurify> | null {
  if (purify !== undefined) return purify
  if (typeof globalThis.window === `undefined`) return (purify = null)
  const instance = DOMPurify()
  if (typeof instance.sanitize !== `function`) return (purify = null)
  purify = instance
  instance.addHook(`uponSanitizeAttribute`, (node, data) => {
    if (data.attrName === `style`) {
      const rules = data.attrValue.split(`;`).filter((rule) => SAFE_STYLE_RE.test(rule))
      if (rules.length === 0) data.keepAttr = false
      else data.attrValue = rules.join(`;`)
    }
    // force rel="noopener" on links to prevent window.opener attacks
    if (data.attrName === `href`) {
      node.setAttribute(`rel`, ensure_token(node.getAttribute(`rel`) ?? ``, `noopener`))
    }
    if (data.attrName === `rel`) data.attrValue = ensure_token(data.attrValue, `noopener`)
  })
  return instance
}

// Strip void / raw-text blocks that must not leak content when tags are removed
const DANGEROUS_BLOCK_RE =
  /<(?<block>script|style|iframe|object|embed|textarea|noscript|template)\b[^>]*>[\s\S]*?<\/\k<block>\s*>/gi
const ATTR_RE =
  /(?<name>[^\s=]+)(?:\s*=\s*(?:"(?<dq>[^"]*)"|'(?<sq>[^']*)'|(?<bare>[^\s"'=<>`]+)))?/g
const SAFE_HREF_RE = /^(?:\/|#|https?:|mailto:)/i

function filter_attrs(attr_str: string, allowed: ReadonlySet<string>, tag: string): string {
  let out = ``
  let rel = ``
  let has_href = false
  ATTR_RE.lastIndex = 0
  for (const match of attr_str.matchAll(ATTR_RE)) {
    const name = (match.groups?.name ?? ``).toLowerCase()
    if (name.startsWith(`on`) || !allowed.has(name)) continue
    const raw = match.groups?.dq ?? match.groups?.sq ?? match.groups?.bare ?? ``
    if (name === `rel`) {
      rel = raw
      continue
    }
    if (name === `href`) {
      if (!SAFE_HREF_RE.test(raw.trim())) continue
      has_href = true
    } else if (name === `style`) {
      const rules = raw.split(`;`).filter((rule) => SAFE_STYLE_RE.test(rule))
      if (rules.length === 0) continue
      out += ` style="${escape_html(rules.join(`;`))}"`
      continue
    }
    out += ` ${name}="${escape_html(raw)}"`
  }
  if (tag === `a` && (has_href || rel)) {
    out += ` rel="${escape_html(ensure_token(rel, `noopener`))}"`
  }
  return out
}

// DOM-free allowlist sanitizer for SSR / no-window contexts. Never returns raw input.
function sanitize_allowlist_ssr(
  html: string,
  tags: ReadonlySet<string>,
  attrs: ReadonlySet<string>,
): string {
  const without_blocks = html
    .replace(DANGEROUS_BLOCK_RE, ``)
    .replaceAll(/<!--[\s\S]*?-->/g, ``)
  const tag_re = /<\/?(?<tag>[A-Za-z][\w:-]*)\b(?<attrs>[^>]*)\/?>/g
  let out = ``
  let last = 0
  for (const match of without_blocks.matchAll(tag_re)) {
    out += without_blocks.slice(last, match.index)
    last = match.index + match[0].length
    const name = (match.groups?.tag ?? ``).toLowerCase()
    if (!tags.has(name)) continue
    if (match[0].startsWith(`</`)) {
      out += `</${name}>`
      continue
    }
    const filtered = filter_attrs(match.groups?.attrs ?? ``, attrs, name)
    out +=
      match[0].endsWith(`/>`) || name === `br`
        ? `<${name}${filtered} />`
        : `<${name}${filtered}>`
  }
  return out + without_blocks.slice(last)
}

// Wrap in <svg>, sanitize with allowlist, then unwrap. Required because DOMPurify
// needs the <svg> parent to parse children in the SVG namespace.
function sanitize_svg_content(
  html: string,
  tags: ReadonlySet<string>,
  attrs: readonly string[],
): string {
  const dp = get_purify()
  if (!dp) return sanitize_allowlist_ssr(html, tags, new Set(attrs))
  const wrapped = dp.sanitize(`<svg>${html}</svg>`, {
    ALLOWED_TAGS: [...tags, `svg`],
    ALLOWED_ATTR: [...attrs],
  })
  const open_end = wrapped.indexOf(`>`)
  const close_start = wrapped.lastIndexOf(`</svg>`)
  if (open_end === -1 || close_start === -1) return wrapped
  return wrapped.slice(open_end + 1, close_start)
}

const stringify_html_input = (html: unknown): string => {
  if (html == null) return ``
  if (typeof html === `string`) return html
  if (typeof html === `number`) return Number.isNaN(html) ? `NaN` : `${html}`
  if (typeof html === `boolean` || typeof html === `bigint`) return `${html}`
  if (typeof html !== `object`) return ``
  try {
    return JSON.stringify(html) ?? ``
  } catch {
    return ``
  }
}

const sanitize_cache = new Map<string, string>()
const cache_sanitize = (key: string, result: string): string => {
  if (sanitize_cache.size >= 4096) sanitize_cache.clear()
  sanitize_cache.set(key, result)
  return result
}

// Sanitize HTML string, allowing only safe formatting tags and links.
// Two-pass: happy-dom promotes dangerous children when a non-allowed parent is
// stripped (e.g. <div><script>…</script></div> → <script>…</script>). The first
// pass explicitly removes dangerous tags so they can't survive promotion.
export function sanitize_html(html: unknown): string {
  const str = stringify_html_input(html)
  const cached = sanitize_cache.get(str)
  if (cached !== undefined) return cached
  const dp = get_purify()
  if (!dp) return cache_sanitize(str, sanitize_allowlist_ssr(str, SAFE_TAG_SET, SAFE_ATTR_SET))
  // oxfmt-ignore
  const safe = dp.sanitize(str, { ADD_ATTR: [`target`], FORBID_TAGS: [
    `script`, `style`, `iframe`, `object`, `embed`, `form`, `input`, `textarea`,
    `select`, `button`, `meta`, `link`, `base`, `template`, `noscript`,
  ] })
  return cache_sanitize(
    str,
    dp.sanitize(safe, { ALLOWED_TAGS: SAFE_TAGS, ALLOWED_ATTR: SAFE_ATTRS }),
  )
}

export const compact_formula = (formula: string): string => formula.replaceAll(/\s+/g, ``)

export const sanitize_formula = (formula: string, use_subscripts = true): string =>
  sanitize_html(format_formula_html(formula, use_subscripts))

export const sanitize_compact_formula = (formula: string, use_subscripts = true): string =>
  sanitize_formula(compact_formula(formula), use_subscripts)

const SVG_TEXT_TAGS = new Set([`tspan`, `title`])
// oxfmt-ignore
const SVG_TEXT_ATTRS = [`dx`, `dy`, `x`, `y`, `fill`, `font-size`, `font-weight`, `baseline-shift`]

export const sanitize_svg = (html: string): string =>
  sanitize_svg_content(html, SVG_TEXT_TAGS, SVG_TEXT_ATTRS)

// oxfmt-ignore
const SVG_ICON_TAGS = new Set([
  `path`, `circle`, `rect`, `line`, `polyline`, `polygon`, `g`, `ellipse`,
  `clipPath`, `defs`, `mask`, `use`, `title`,
])
// oxfmt-ignore
const SVG_ICON_ATTRS = [
  `d`, `fill`, `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`,
  `cx`, `cy`, `r`, `rx`, `ry`, `x`, `y`, `x1`, `y1`, `x2`, `y2`,
  `width`, `height`, `viewBox`, `points`, `transform`, `opacity`,
  `clip-path`, `clip-rule`, `fill-rule`, `id`, `class`,
]

export const sanitize_icon_svg = (html: string): string =>
  sanitize_svg_content(html, SVG_ICON_TAGS, SVG_ICON_ATTRS)
