// Formula markup (subscripts/superscripts) as HTML or SVG. Pure string work with no
// element-data imports (only the bare symbol list), so sanitize.ts (imported by every plot and
// table) can format formulas without pulling the periodic-table dataset into consumers' bundles.
import { ELEM_SYMBOLS } from '#lib/element/types'

// Markup token for rendering a formula: plain text, subscript, or superscript run.
// (Not FormulaSpecies from ./parse, which is an element/amount pair.)
export interface FormulaMarkupToken {
  text?: string
  sub?: string
  sup?: string
}

// Whether a component name is a compound rather than a single element ("Fe", "He"): it
// contains digits ("Fe3C", "SiO2") or several uppercase letters, i.e. elements ("MgO")
export const is_compound = (name: string): boolean =>
  /\d/.test(name) || (name.match(/[A-Z]/g)?.length ?? 0) >= 2

// Token classes, in priority order:
// - `coeff`: a number or parenthesized expression at the start, after a hydrate separator or after
//   a reaction arrow counts whole formula units, so it stays full size: 2H2O, CuSO4·5H2O,
//   CuSO4 · 5H2O, (1-x)LiMnO2, 2H2+O2->2H2O. (parse_formula reads 2H2O as 2 × H2O, not ₂H₂O.)
// - `caret`: a caret charge in the parser's syntax (`^2-`, `^-2`, `^3+`, `^+`, `^2`) is a
//   superscript without its caret (SO4^2-, [Fe(CN)6]^4-), as is a leading isotope mass (^13CO2).
//   It comes before `sub` so the digits of a charge are not read as a count.
// - `sub`: a count or stoichiometric expression: 2, 0.95, 1/3, 1-x, 2-δ, 1+x, (1-x), and a bare
//   variable after a closing bracket ((CH2)n). A bare variable after a symbol (Lix, CxHy, Tx)
//   is split off the `element` run in scan_formula.
// - `sup`: a bare sign at the end or followed by digits (NH4+, OH-, Cl-2). Trailing digits are
//   always a count, so Fe3+ is Fe₃⁺; write Fe^3+ for the ion.
// - `element`: an uppercase letter and its lowercase run; any other sign (Fe-Fe3C), prefix (α-,
//   2H-), site separator ((Ba,Sr)) or state label ((aq)) is `other` text, merged into the
//   preceding text.
// Variables are x, y, z, n and δ; signs include the Unicode minus (OH−, Li1−xCoO2).
const NUMBER = String.raw`\d+(?:\.\d+|/\d+)?|\.\d+`
const SIGN = `[+\\-−]`
const CARET_CHARGE = String.raw`${SIGN}\d+|\d+${SIGN}?|${SIGN}`
const VAR = `[xyzδn]`
const TERM = String.raw`(?:${NUMBER})?${VAR}|${NUMBER}`
// a parenthesized stoichiometric expression has an operator, unlike a group: (1-x) vs (OH)
const PAREN_EXPR = String.raw`\((?:${TERM})(?:${SIGN}(?:${TERM}))+\)`
const COUNT = String.raw`(?:${NUMBER})(?:${SIGN}(?:${NUMBER})?${VAR})*`
const SEPARATORS = `·⋅•∙*`
// what may follow a bare variable count (Lix|Co, (OH)x|·): no letter, so labels (Hex_A3) and
// words (Taxi) keep their x
const AFTER_VAR = String.raw`(?=[A-Z(\[{)\]}${SEPARATORS}]|$)`
const AFTER_VAR_RE = new RegExp(AFTER_VAR, `y`)
const FUSED_VAR_RE = new RegExp(`${VAR}$`)
const FORMULA_TOKEN_RE = new RegExp(
  String.raw`(?<coeff>(?<=^|[${SEPARATORS}]\s*|->|→)(?:${NUMBER}|${PAREN_EXPR}))|\^(?<caret>${CARET_CHARGE})|(?<sub>${COUNT}|${PAREN_EXPR}|(?<=[)\]}])${VAR}${AFTER_VAR})|(?<sup>${SIGN}(?:\d+|$))|(?<element>[A-Z][a-z]*)|(?<other>${SIGN}|\.(?!\d)|\^|[)\]}${SEPARATORS}]|[^A-Z\d.^+\-−)\]}${SEPARATORS}]+)`,
  `g`,
)
// Multi-phase labels ("La2NiO4 + NiO") split on their " + " separators, which are kept
const PHASE_SEPARATOR_RE = /(?<separator>\s*\+\s*)/
const ELEMENT_SET: ReadonlySet<string> = new Set(ELEM_SYMBOLS)
// hydrogen isotopes, which formulas write as symbols (D2O, T2O, Ti3C2Tx)
export const ISOTOPE_SYMBOLS: ReadonlySet<string> = new Set([`D`, `T`])
const is_known_symbol = (symbol: string) =>
  ELEMENT_SET.has(symbol) || ISOTOPE_SYMBOLS.has(symbol)

// Markup tokens plus the element symbols they contain (after splitting variables off: Lix -> Li)
function scan_formula(formula: string): { tokens: FormulaMarkupToken[]; symbols: string[] } {
  const tokens: FormulaMarkupToken[] = []
  const symbols: string[] = []
  // multi-phase notation (a spaced ` + `, unlike a charge) passes through
  if (/\s\+\s/.test(formula)) return { tokens: formula ? [{ text: formula }] : [], symbols }
  // whether the last match was a non-element word (`mp`): a signed number after one is an
  // entry id (`mp-1234`), not a charge
  let after_word = false
  for (const { groups, index } of formula.matchAll(FORMULA_TOKEN_RE)) {
    const { coeff, caret, sub, sup, element, other } = groups ?? {}
    const prev = tokens.at(-1)
    const was_after_word = after_word
    after_word = other !== undefined && /[a-z]$/i.test(other)
    if (sup && was_after_word && prev?.text !== undefined) prev.text += sup
    else if (coeff) {
      if (prev?.text !== undefined) prev.text += coeff
      else tokens.push({ text: coeff })
    } else if (caret) tokens.push({ sup: caret })
    else if (sub) tokens.push({ sub })
    else if (sup) tokens.push({ sup })
    else if (element) {
      // a variable count fused onto its symbol (Lix, Srx, Tx) is split off, unless the run is a
      // real symbol (Dy, Sn) or a word goes on (Hex_A3)
      const symbol = element.slice(0, -1)
      AFTER_VAR_RE.lastIndex = index + element.length
      const fused_var =
        !ELEMENT_SET.has(element) &&
        FUSED_VAR_RE.test(element) &&
        is_known_symbol(symbol) &&
        AFTER_VAR_RE.test(formula)
      if (fused_var) tokens.push({ text: symbol }, { sub: element.slice(-1) })
      else tokens.push({ text: element })
      symbols.push(fused_var ? symbol : element)
    } else if (prev?.text !== undefined) prev.text += other
    else tokens.push({ text: other })
  }
  return { tokens, symbols }
}

// Tokenize a chemical formula for rendering with subscripts/superscripts, e.g.
// "Li0.5FeO2" -> [{text: "Li"}, {sub: "0.5"}, {text: "Fe"}, {text: "O"}, {sub: "2"}]
export const tokenize_formula_markup = (formula: string): FormulaMarkupToken[] =>
  scan_formula(formula).tokens

// Strip all whitespace from a pymatgen-style formula ("Ac6 U2" -> "Ac6U2") so FormulaText and
// the formatters read it as one formula word
export const compact_formula = (formula: string): string => formula.replaceAll(/\s+/g, ``)

// Formulas inside free text such as file labels ("BaTiO3 cubic perovskite", "δ-CsPbI3",
// "Li2O_relax.traj"). FORMULA_WORD_RE finds formula-shaped words: letter runs with counts and
// caret charges, brackets of any kind and depth, a leading coefficient or isotope mass, a
// trailing charge. scan_formula then decides what is a symbol and is_formula_word whether the
// word is a formula, so both renderers agree. Brackets need not balance within a word: each
// part of a hydrate (CuSO4·5H2O) or site list ((Ba,Sr)TiO3) is its own word, and their tokens
// join up to the same markup. Words never sit against a letter, digit or slash, so space groups
// (I4/mmm, P6_3/mmc) and redox pairs (Fe^2+/Fe^3+) stay plain. A caret charge is matched whole or
// not at all, as is a decimal or fraction: backtracking to a prefix (Fe^2 of Fe^2+/, Li0 of
// Li0.5Coα) would mark up a partial charge or count.
// Variables are matched as part of the letter run (Lix, Oδ) or after a closer ((OH)x), never as
// an optional unit of their own, so a word parses one way only (no exponential backtracking).
const WORD_SCRIPTS = String.raw`(?:${COUNT}(?![./]\d)|${PAREN_EXPR})?(?:\^(?:${CARET_CHARGE})(?![\d+\-−]))?`
const WORD_UNIT = String.raw`(?:\^\d+)?[A-Z][a-z]*δ?${WORD_SCRIPTS}|[(\[{]|[)\]}](?:${VAR}(?![a-z]))?${WORD_SCRIPTS}`
const FORMULA_WORD_RE = new RegExp(
  String.raw`(?<![\p{L}\p{Nd}/])(?:${NUMBER}|${PAREN_EXPR}|${VAR}(?=[A-Z(\[{]))?(?:${WORD_UNIT})+(?:\d*${SIGN}(?!>))?(?![\p{L}\p{N}/]|_\d)`,
  `gu`,
)

// A word is a formula when all its symbols are known and it has a numeric count or a caret.
// Words with only variable counts or bare signs (NOx, OH-) and isotope symbols (D2O) need a
// second symbol, so prose (By, Can), suspended hyphens (Fe- and Co-based), lone ions (Li+, as
// format_formula_html leaves them) and method names (PBE-D3, T1) stay plain. A word without
// scripts renders as plain text either way.
function is_formula_word(word: string, { tokens, symbols }: ReturnType<typeof scan_formula>) {
  if (symbols.length === 0 || !symbols.every(is_known_symbol)) return false
  const numeric =
    word.includes(`^`) || tokens.some(({ sub, sup }) => /\d/.test(sub ?? sup ?? ``))
  const needs_pair = !numeric || symbols.some((symbol) => ISOTOPE_SYMBOLS.has(symbol))
  return !needs_pair || symbols.length >= 2
}

export function formula_text_tokens(text: string): FormulaMarkupToken[] {
  const tokens: FormulaMarkupToken[] = []
  let plain_from = 0
  for (const { 0: word, index } of text.matchAll(FORMULA_WORD_RE)) {
    const scanned = scan_formula(word)
    if (!is_formula_word(word, scanned)) continue
    if (index > plain_from) tokens.push({ text: text.slice(plain_from, index) })
    tokens.push(...scanned.tokens)
    plain_from = index + word.length
  }
  if (plain_from < text.length) tokens.push({ text: text.slice(plain_from) })
  return tokens
}

// Flat label segments for canvas/3D renderers that can only offset subscripts: adjacent
// plain runs (incl. charge superscripts and " + " separators) are merged into one segment.
export interface FormulaLabelSegment {
  text: string
  subscript: boolean
}

// Labels are often entry names rather than formulas (`mp-1234`, `Fe2O3 2`): a number right
// after whitespace is an id or count rather than a stoichiometry and stays plain text, as a
// leading coefficient does in every renderer. (Only here: tokenize_formula_markup keeps
// formula semantics for the HTML/SVG renderers.)
export function get_formula_label_segments(label: string): FormulaLabelSegment[] {
  const segments: FormulaLabelSegment[] = []
  // the ` + ` separators tokenize to a single plain text token themselves
  for (const part of label.split(PHASE_SEPARATOR_RE)) {
    const tokens = tokenize_formula_markup(part)
    for (const [idx, token] of tokens.entries()) {
      const at_word_start = /\s$/.test(tokens[idx - 1]?.text ?? ``)
      const subscript = token.sub !== undefined && !at_word_start
      const text = token.text ?? token.sub ?? token.sup ?? ``
      const prev = segments.at(-1)
      if (prev && !subscript && !prev.subscript) prev.text += text
      else segments.push({ text, subscript })
    }
  }
  return segments.length > 0 ? segments : [{ text: label, subscript: false }]
}

// Render a compound's markup tokens, wrapping each sub/superscript run with `wrap_script`. A
// caret charge marks up a lone element too, which otherwise passes through (Cu^+ stayed plain).
const format_formula_markup = (
  formula: string,
  use_subscripts: boolean,
  wrap_script: (script: string, tag: `sub` | `sup`) => string,
): string =>
  use_subscripts && (is_compound(formula) || formula.includes(`^`))
    ? tokenize_formula_markup(formula)
        .map(
          ({ text, sub, sup }) => text ?? wrap_script(sub ?? sup ?? ``, sub ? `sub` : `sup`),
        )
        .join(``)
    : formula

// Native baseline shifts are scoped to each tspan, so adjacent scripts and trailing text
// align without cumulative dy offsets or invisible reset characters.
export const format_formula_svg = (formula: string, use_subscripts = true): string =>
  format_formula_markup(
    formula,
    use_subscripts,
    (script, tag) =>
      `<tspan baseline-shift="${tag === `sub` ? `-0.25em` : `0.4em`}" font-size="0.75em">${script}</tspan>`,
  )

// Format chemical formula as HTML with <sub> and <sup> tags
export const format_formula_html = (formula: string, use_subscripts = true): string =>
  format_formula_markup(formula, use_subscripts, (script, tag) => `<${tag}>${script}</${tag}>`)

// Split a multi-phase label on " + " and format each part with the given formatter
function format_label_parts(
  label: string,
  use_subscripts: boolean,
  formatter: (formula: string, use_sub: boolean) => string,
): string {
  if (!use_subscripts) return label
  return label
    .split(PHASE_SEPARATOR_RE)
    .map((part) => (part.trim() === `+` ? part : formatter(part.trim(), use_subscripts)))
    .join(``)
}

// Format a phase region label (e.g. "La2NiO4 + NiO") as SVG with subscripts
export const format_label_svg = (label: string, use_subscripts = true): string =>
  format_label_parts(label, use_subscripts, format_formula_svg)

// Format a phase region label as HTML with subscripts (splits on " + ")
export const format_label_html = (label: string, use_subscripts = true): string =>
  format_label_parts(label, use_subscripts, format_formula_html)
