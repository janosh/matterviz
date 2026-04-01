import DOMPurify from 'dompurify'
import { format_formula_html } from './phase-diagram/utils'

// SSR: provide a DOM for DOMPurify when no browser window exists (e.g. during vite build)
let ssr_window: unknown
if (typeof globalThis.window === `undefined`) {
  try {
    const { Window } = await import(`happy-dom`)
    ssr_window = new Window()
  } catch {
    // happy-dom not available at runtime — get_purify() will fall back to pass-through
  }
}

const SAFE_TAGS = [`a`, `b`, `i`, `em`, `strong`, `sub`, `sup`, `br`, `span`, `code`, `small`]
const SAFE_ATTRS = [`style`, `class`, `title`, `href`, `target`, `rel`]
// only allow safe CSS properties for text formatting
const SAFE_STYLE_RE =
  /^\s*(color|font-weight|font-style|font-size|text-decoration|vertical-align)\s*:/

// Add a token to a space-separated string if not already present
const ensure_token = (value: string, token: string): string => {
  const tokens = new Set(value.split(/\s+/).filter(Boolean))
  tokens.add(token)
  return [...tokens].join(` `)
}

// undefined = not yet checked, null = no DOM available, instance = ready
let purify: ReturnType<typeof DOMPurify> | null | undefined

function get_purify(): ReturnType<typeof DOMPurify> | null {
  if (purify !== undefined) return purify
  const instance = ssr_window
    ? DOMPurify(ssr_window as Parameters<typeof DOMPurify>[0])
    : DOMPurify()
  if (typeof instance.sanitize !== `function`) {
    purify = null
    return null
  }
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
    if (data.attrName === `rel`) {
      data.attrValue = ensure_token(data.attrValue, `noopener`)
    }
  })
  return instance
}

// Wrap in <svg>, sanitize with allowlist, then unwrap. Required because DOMPurify
// needs the <svg> parent to parse children in the SVG namespace.
function sanitize_svg_content(
  html: string,
  allowed_tags: string[],
  allowed_attrs: string[],
): string {
  const dp = get_purify()
  if (!dp) return html
  const wrapped = dp.sanitize(`<svg>${html}</svg>`, {
    ALLOWED_TAGS: [...allowed_tags, `svg`],
    ALLOWED_ATTR: allowed_attrs,
  })
  const open_end = wrapped.indexOf(`>`)
  const close_start = wrapped.lastIndexOf(`</svg>`)
  if (open_end < 0 || close_start < 0) return wrapped
  return wrapped.slice(open_end + 1, close_start)
}

// Sanitize HTML string, allowing only safe formatting tags and links.
// Two-pass: happy-dom promotes dangerous children when a non-allowed parent is
// stripped (e.g. <div><script>…</script></div> → <script>…</script>). The first
// pass explicitly removes dangerous tags so they can't survive promotion.
export function sanitize_html(html: unknown): string {
  const str = html == null ? `` : String(html)
  const dp = get_purify()
  if (!dp) return str
  // oxfmt-ignore
  const safe = dp.sanitize(str, { ADD_ATTR: [`target`], FORBID_TAGS: [
    `script`, `style`, `iframe`, `object`, `embed`, `form`, `input`, `textarea`,
    `select`, `button`, `meta`, `link`, `base`, `template`, `noscript`,
  ] })
  return dp.sanitize(safe, { ALLOWED_TAGS: SAFE_TAGS, ALLOWED_ATTR: SAFE_ATTRS })
}

// Sanitize a chemical formula with optional subscript formatting
export const sanitize_formula = (formula: string, use_subscripts = true): string =>
  sanitize_html(format_formula_html(formula, use_subscripts))

const SVG_TEXT_TAGS = [`tspan`, `title`]
// oxfmt-ignore
const SVG_TEXT_ATTRS = [`dx`, `dy`, `x`, `y`, `fill`, `font-size`, `font-weight`, `baseline-shift`]

// Sanitize HTML intended for SVG text contexts (tspan, title)
export const sanitize_svg = (html: string): string =>
  sanitize_svg_content(html, SVG_TEXT_TAGS, SVG_TEXT_ATTRS)

// oxfmt-ignore
const SVG_ICON_TAGS = [
  `path`, `circle`, `rect`, `line`, `polyline`, `polygon`, `g`, `ellipse`,
  `clipPath`, `defs`, `mask`, `use`, `title`,
]
// oxfmt-ignore
const SVG_ICON_ATTRS = [
  `d`, `fill`, `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`,
  `cx`, `cy`, `r`, `rx`, `ry`, `x`, `y`, `x1`, `y1`, `x2`, `y2`,
  `width`, `height`, `viewBox`, `points`, `transform`, `opacity`,
  `clip-path`, `clip-rule`, `fill-rule`, `id`, `class`,
]

// Sanitize inline SVG markup (path, circle, rect, etc.) for icon rendering
export const sanitize_icon_svg = (html: string): string =>
  sanitize_svg_content(html, SVG_ICON_TAGS, SVG_ICON_ATTRS)
