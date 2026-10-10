import DOMPurify from 'dompurify'
import { format_formula_html } from './composition/format'
import { evict_oldest } from './labels'
import { escape_html } from './utils'

const SAFE_TAGS = [`a`, `b`, `i`, `em`, `strong`, `sub`, `sup`, `br`, `span`, `code`, `small`]
const SAFE_ATTRS = [`style`, `class`, `title`, `href`, `target`, `rel`]
const SAFE_TAG_SET = new Set(SAFE_TAGS)
const SAFE_ATTR_SET = new Set(SAFE_ATTRS)
// only allow safe CSS properties for text formatting
const SAFE_STYLE_RE =
  /^\s*(?:color|font-weight|font-style|font-size|text-decoration|vertical-align)\s*:/
// The safe declarations of a style attribute, empty when none survive
const safe_style = (style: string): string =>
  style
    .split(`;`)
    .filter((rule) => SAFE_STYLE_RE.test(rule))
    .join(`;`)

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
      const style = safe_style(data.attrValue)
      if (style) data.attrValue = style
      else data.keepAttr = false
    }
    // force rel="noopener" on links to prevent window.opener attacks
    if (data.attrName === `href`) {
      node.setAttribute(`rel`, ensure_token(node.getAttribute(`rel`) ?? ``, `noopener`))
    }
    if (data.attrName === `rel`) data.attrValue = ensure_token(data.attrValue, `noopener`)
  })
  return instance
}

// Openers of void / raw-text blocks that must not leak content when tags are removed.
// `[^<>]*` for the attribute run, not `[^>]*`, which rescans to end of input from every
// unclosed `<` (quadratic). An attribute value containing `<` then reads as text, the safe
// direction for an allowlist sanitizer: it is escaped, not passed through.
const DANGEROUS_OPENER_RE =
  /<(?<block>script|style|iframe|object|embed|textarea|noscript|template)\b[^<>]*>/gi

// Cut every `opener … first closer after it` span, like replacing
// /opener[\s\S]*?closer/g but linear: that lazy scan ran from each unclosed opener to the
// end of input (128 KB of `<script>` took 175 ms). A closer search that fails once fails
// for every later opener of the same kind too, so the kind is not searched again.
function cut_spans(
  html: string,
  opener_re: RegExp,
  closer_re_for: (opener: RegExpExecArray) => { kind: string; closer_re: RegExp },
): string {
  const unclosed = new Set<string>()
  let out = ``
  let last = 0
  opener_re.lastIndex = 0
  for (let opener = opener_re.exec(html); opener; opener = opener_re.exec(html)) {
    const { kind, closer_re } = closer_re_for(opener)
    if (unclosed.has(kind)) continue
    closer_re.lastIndex = opener_re.lastIndex
    const closer = closer_re.exec(html)
    if (!closer) {
      unclosed.add(kind)
      continue
    }
    out += html.slice(last, opener.index)
    last = closer.index + closer[0].length
    opener_re.lastIndex = last
  }
  return out + html.slice(last)
}

const block_closer_res = new Map<string, RegExp>()
const strip_dangerous_blocks = (html: string): string =>
  cut_spans(html, DANGEROUS_OPENER_RE, (opener) => {
    const kind = (opener.groups?.block ?? ``).toLowerCase()
    const closer_re = block_closer_res.get(kind) ?? new RegExp(`</${kind}\\s*>`, `gi`)
    block_closer_res.set(kind, closer_re)
    return { kind, closer_re }
  })
const COMMENT_OPENER_RE = /<!--/g
const COMMENT_CLOSER_RE = /-->/g
const strip_comments = (html: string): string =>
  cut_spans(html, COMMENT_OPENER_RE, () => ({ kind: `comment`, closer_re: COMMENT_CLOSER_RE }))
// The tag name is matched atomically (lookahead + backreference, as JS has no possessive
// quantifiers): a backtracking `[\w:-]*\b[^<>]*` re-split `<a-a-a-…` at every `-` and rescanned
// the rest each time, 15 s for 200 KB. A name ending in `-` or `:` is now that name (`<b->`
// is a `b-` tag, dropped) rather than `b` with an attribute `-`.
const TAG_RE = /<\/?(?=(?<tag>[A-Za-z][\w:-]*))\k<tag>(?<attrs>[^<>]*)\/?>/g
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
      const style = safe_style(raw)
      if (style) out += ` style="${escape_html(style)}"`
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
  const without_blocks = strip_comments(strip_dangerous_blocks(html))
  // Text between the tags is escaped, never copied verbatim. `TAG_RE` needs a closing `>`, so
  // an unterminated tag was not seen as one and survived byte for byte - and SSR emits this
  // into the middle of a page, where the following markup supplies the `>`. That turned
  // `<img src=x onerror=alert(1)` into a live img element with a working handler.
  const escape_markup = (text: string) => text.replaceAll(`<`, `&lt;`)
  let out = ``
  let last = 0
  for (const match of without_blocks.matchAll(TAG_RE)) {
    out += escape_markup(without_blocks.slice(last, match.index))
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
  return out + escape_markup(without_blocks.slice(last))
}

// Wrap in <svg>, sanitize with allowlist, then unwrap. Required because DOMPurify
// needs the <svg> parent to parse children in the SVG namespace.
function sanitize_svg_content(
  html: string,
  tags: ReadonlySet<string>,
  attrs: readonly string[],
): string {
  const purifier = get_purify()
  if (!purifier) return sanitize_allowlist_ssr(html, tags, new Set(attrs))
  const wrapped = purifier.sanitize(`<svg>${html}</svg>`, {
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
  evict_oldest(sanitize_cache)
  sanitize_cache.set(key, result)
  return result
}

// Use this for both SSR and the first client render when byte-identical HTML is required
// for hydration. Browser code should switch to sanitize_html() after mounting.
export function sanitize_html_ssr(html: unknown): string {
  const str = stringify_html_input(html)
  return str.includes(`<`) ? sanitize_allowlist_ssr(str, SAFE_TAG_SET, SAFE_ATTR_SET) : str
}

// Sanitize HTML string, allowing only safe formatting tags and links.
// Two-pass: happy-dom promotes dangerous children when a non-allowed parent is
// stripped (e.g. <div><script>…</script></div> → <script>…</script>). The first
// pass explicitly removes dangerous tags so they can't survive promotion.
export function sanitize_html(html: unknown): string {
  const str = stringify_html_input(html)
  const cached = sanitize_cache.get(str)
  if (cached !== undefined) return cached
  // DOMPurify makes the same `indexOf('<') === -1` check and returns `dirty` untouched, so
  // this is byte-identical by construction. Don't delete it on those grounds though: it bails
  // only after setConfig() rebuilds the allow-lists below, and that dominates — 0.036 us here
  // vs 319 us for the two sanitize() calls on the same five axis labels.
  if (!str.includes(`<`)) return cache_sanitize(str, str)
  const purifier = get_purify()
  if (!purifier) return cache_sanitize(str, sanitize_html_ssr(str))
  // oxfmt-ignore
  const safe = purifier.sanitize(str, { ADD_ATTR: [`target`], FORBID_TAGS: [
    `script`, `style`, `iframe`, `object`, `embed`, `form`, `input`, `textarea`,
    `select`, `button`, `meta`, `link`, `base`, `template`, `noscript`,
  ] })
  return cache_sanitize(
    str,
    purifier.sanitize(safe, { ALLOWED_TAGS: SAFE_TAGS, ALLOWED_ATTR: SAFE_ATTRS }),
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
