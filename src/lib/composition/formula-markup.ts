// Formula markup (subscripts/superscripts) as HTML or SVG. Pure string work with no
// element-data imports, so sanitize.ts (imported by every plot and table) can format
// formulas without pulling the full periodic-table dataset into consumers' bundles.

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

// Token classes: number runs (incl. decimals) become subscripts; a caret charge in the
// parser's syntax (`^2-`, `^-2`, `^3+`, `^+`, `^2`) is a superscript without its caret
// ("SO4^2-"), as is a bare '+' or '-' at the end of the string or followed by digits ("O2-",
// "Cl-2", "Fe3+"); any other '+' or '-' stays text ("Fe-Fe3C"); element symbols (uppercase +
// lowercase run) are separate text tokens; any other run of characters merges into the
// preceding text token.
// `coeff` comes first so it wins over `sub`: the number after a hydrate separator counts whole
// water molecules, not atoms in the preceding group, so `CuSO4·5H2O` must render its 5 full
// size. Every digit run classified as a subscript printed it as CuSO4·₅H₂O. A leading number
// is the same coefficient (parse_formula reads 2H2O as 2 × H2O), not ₂H₂O. `caret` comes
// before `sub` so the digits of a charge are not read as a count (SO<sub>4</sub>^<sub>2</sub>).
const FORMULA_TOKEN_RE =
  /(?<coeff>(?<=^|[·⋅•∙*])(?:\d+(?:\.\d+)?|\.\d+))|\^(?<caret>[+-]\d+|\d+[+-]?|[+-])|(?<sub>\d+(?:\.\d+)?|\.\d+)|(?<sup>[+-](?:\d+|$))|(?<element>[A-Z][a-z]*)|(?<other>[+-]|\.(?!\d)|\^|[^A-Z\d.^+-]+)/g
// Multi-phase labels ("La2NiO4 + NiO") split on their " + " separators, which are kept
const PHASE_SEPARATOR_RE = /(?<separator>\s*\+\s*)/

// Tokenize a chemical formula for rendering with subscripts/superscripts, e.g.
// "Li0.5FeO2" -> [{text: "Li"}, {sub: "0.5"}, {text: "Fe"}, {text: "O"}, {sub: "2"}]
export function tokenize_formula_markup(formula: string): FormulaMarkupToken[] {
  if (!formula) return []
  // Greek letters or multi-phase notation (a spaced ` + `, unlike a charge) pass through
  if (/[α-ωΑ-Ω]/.test(formula) || /\s\+\s/.test(formula)) return [{ text: formula }]

  const tokens: FormulaMarkupToken[] = []
  // whether the last match was a non-element word (`mp`): a signed number after one is an
  // entry id (`mp-1234`), not a charge
  let after_word = false
  for (const { groups } of formula.matchAll(FORMULA_TOKEN_RE)) {
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
    else if (element) tokens.push({ text: element })
    else if (other !== `-` && prev?.text !== undefined) prev.text += other
    else tokens.push({ text: other })
  }
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

// Render a compound's markup tokens, wrapping each sub/superscript run with `wrap_script`
const format_formula_markup = (
  formula: string,
  use_subscripts: boolean,
  wrap_script: (script: string, tag: `sub` | `sup`) => string,
): string =>
  use_subscripts && is_compound(formula)
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
