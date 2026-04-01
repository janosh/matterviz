import DOMPurify from 'dompurify'
import { format_formula_html } from './phase-diagram/utils'

const SAFE_TAGS = [`a`, `b`, `i`, `em`, `strong`, `sub`, `sup`, `br`, `span`, `code`, `small`]
const SAFE_ATTRS = [`style`, `class`, `title`, `href`, `target`, `rel`]
// only allow safe CSS properties for text formatting
const SAFE_STYLE_RE =
  /^\s*(color|font-weight|font-style|font-size|text-decoration|vertical-align)\s*:/
// tags that are always dangerous and must be removed before allowlist filtering
const DANGEROUS_TAGS = [
  `script`,
  `style`,
  `iframe`,
  `object`,
  `embed`,
  `form`,
  `input`,
  `textarea`,
  `select`,
  `button`,
  `meta`,
  `link`,
  `base`,
  `template`,
  `noscript`,
]

// undefined = not yet checked, null = no DOM available (SSR), instance = ready
let purify: ReturnType<typeof DOMPurify> | null | undefined

function get_purify(): ReturnType<typeof DOMPurify> | null {
  if (purify !== undefined) return purify
  const instance = DOMPurify()
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
      const rel = new Set((node.getAttribute(`rel`) ?? ``).split(/\s+/).filter(Boolean))
      rel.add(`noopener`)
      node.setAttribute(`rel`, [...rel].join(` `))
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
// Two-pass: first explicitly forbid dangerous elements, then restrict to allowlist.
// This works around a happy-dom quirk where removing a non-allowed parent can
// promote dangerous children that would have been caught in a real browser.
export function sanitize_html(html: unknown): string {
  const str = html == null ? `` : String(html)
  const dp = get_purify()
  if (!dp) return str
  const safe = dp.sanitize(str, { FORBID_TAGS: DANGEROUS_TAGS, ADD_ATTR: [`target`] })
  return dp.sanitize(safe, { ALLOWED_TAGS: SAFE_TAGS, ALLOWED_ATTR: SAFE_ATTRS })
}

// Sanitize a chemical formula with optional subscript formatting
export const sanitize_formula = (formula: string, use_subscripts = true): string =>
  sanitize_html(format_formula_html(formula, use_subscripts))

const SVG_TEXT_TAGS = [`tspan`, `title`]
const SVG_TEXT_ATTRS = [
  `dx`,
  `dy`,
  `x`,
  `y`,
  `fill`,
  `font-size`,
  `font-weight`,
  `baseline-shift`,
]

// Sanitize HTML intended for SVG text contexts (tspan, title)
export const sanitize_svg = (html: string): string =>
  sanitize_svg_content(html, SVG_TEXT_TAGS, SVG_TEXT_ATTRS)

const SVG_ICON_TAGS = [
  `path`,
  `circle`,
  `rect`,
  `line`,
  `polyline`,
  `polygon`,
  `g`,
  `ellipse`,
  `clipPath`,
  `defs`,
  `mask`,
  `use`,
  `title`,
]
const SVG_ICON_ATTRS = [
  `d`,
  `fill`,
  `stroke`,
  `stroke-width`,
  `stroke-linecap`,
  `stroke-linejoin`,
  `cx`,
  `cy`,
  `r`,
  `rx`,
  `ry`,
  `x`,
  `y`,
  `x1`,
  `y1`,
  `x2`,
  `y2`,
  `width`,
  `height`,
  `viewBox`,
  `points`,
  `transform`,
  `opacity`,
  `clip-path`,
  `clip-rule`,
  `fill-rule`,
  `id`,
  `class`,
]

// Sanitize inline SVG markup (path, circle, rect, etc.) for icon rendering
export const sanitize_icon_svg = (html: string): string =>
  sanitize_svg_content(html, SVG_ICON_TAGS, SVG_ICON_ATTRS)
