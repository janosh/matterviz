import { sanitize_formula } from '$lib/sanitize'

export { format_mev } from './format-mev'

// HTML for a balanced equation such as `2 Li2CO3 + O2 → 4 LiCoO2`: every species gets
// subscripts while coefficients and operators stay as text
export const format_equation_html = (equation: string): string =>
  equation
    .split(/(?<operator> \+ | → )/)
    .map((token) => {
      if (token === ` + ` || token === ` → `) return token
      const groups = /^(?<coefficient>[\d.]+ )?(?<formula>.*)$/.exec(token)?.groups
      return `${groups?.coefficient ?? ``}${sanitize_formula(groups?.formula ?? token)}`
    })
    .join(``)
