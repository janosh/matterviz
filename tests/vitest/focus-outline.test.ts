import { globSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vite-plus/test'

// Browsers ring a focused SVG element's bounding box, which reads as a stray rectangle around a
// whole plot or a pie slice. Focusable plots drop that outline; focusable plot items trade it for
// a shape-tracing stroke so keyboard users still see which item has focus.
// selector of the block holding css[idx], skipping nested blocks closed before it
const enclosing_selector = (css: string, idx: number): string => {
  let depth = 0
  for (let pos = idx; pos >= 0; pos--) {
    if (css[pos] === `}`) depth++
    else if (css[pos] === `{` && depth-- === 0) {
      const start = Math.max(...[`;`, `{`, `}`].map((char) => css.lastIndexOf(char, pos - 1)))
      return css.slice(start + 1, pos)
    }
  }
  return ``
}
// comments stripped, so a commented-out declaration doesn't count
const style_block = (text: string) =>
  (/<style[^>]*>(?<css>[\s\S]*?)<\/style>/.exec(text)?.groups?.css ?? ``).replaceAll(
    /\/\*[\s\S]*?\*\//g,
    ``,
  )

describe(`SVG focus outlines`, () => {
  test(`components with a focusable <svg> suppress its outline`, () => {
    const checked: string[] = []
    const offenders = globSync(`src/lib/**/*.svelte`).filter((file) => {
      const text = readFileSync(file, `utf8`)
      // an <svg ...> opening tag (attribute values may contain `>` inside braces)
      const svg_tag = [...text.matchAll(/<svg\b(?:[^>{]|\{[^}]*\})*>/g)]
        .map(([tag]) => tag)
        .find((tag) => /\btabindex\b/.test(tag))
      if (!svg_tag) return false
      checked.push(file)
      // the rule must target the svg itself (by tag or its static class), not some other element
      const svg_class = /\bclass="(?<name>[\w-]+)"/.exec(svg_tag)?.groups?.name
      const targets_svg = (selector: string) =>
        selector.split(`,`).some((part) => {
          const last = part.trim().split(/\s+/).at(-1) ?? ``
          return (
            /^svg\b/.test(last) ||
            (svg_class !== undefined && last.startsWith(`.${svg_class}`))
          )
        })
      const css = style_block(text)
      return ![...css.matchAll(/outline:\s*(?:none|0)\b/g)].some(({ index }) =>
        targets_svg(enclosing_selector(css, index)),
      )
    })
    // guards against the tag scan silently matching nothing
    expect(checked).toContain(`src/lib/plot/core/components/CartesianFrame.svelte`)
    expect(offenders).toEqual([])
  })

  test.each([
    [`src/lib/plot/core/components/CartesianFrame.svelte`, /--plot-focus-stroke/],
    [`src/lib/plot/sankey/Sankey.svelte`, /--sankey-focus-stroke/],
  ])(`%s swaps item outlines for a focus stroke`, (file, focus_var) => {
    const css = style_block(readFileSync(file, `utf8`))
    expect(css).toMatch(/:focus\)?\s*\{\s*outline:\s*none/)
    // the replacement highlight is keyboard-only and themable
    expect(css).toMatch(/:focus-visible/)
    expect(css).toMatch(focus_var)
  })
})
