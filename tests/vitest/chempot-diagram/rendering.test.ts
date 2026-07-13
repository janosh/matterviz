import { readFileSync } from 'node:fs'
import process from 'node:process'
import { sanitize_html } from '$lib/sanitize'
import { describe, expect, test } from 'vitest'

const chempot_3d_source = readFileSync(
  `${process.cwd()}/src/lib/chempot-diagram/ChemPotDiagram3D.svelte`,
  `utf8`,
)

describe(`ChemPotDiagram3D rendering contracts`, () => {
  test(`clips HTML portal labels at the component root`, () => {
    expect(chempot_3d_source).toMatch(/<extras\.HTML[\s\S]*?portal=\{wrapper\}/)
    expect(chempot_3d_source).toMatch(
      /\.chempot-diagram-3d\s*\{\s*position:\s*relative;\s*overflow:\s*clip;/,
    )
  })

  test(`sanitizes generated and custom axis labels at the raw-HTML sink`, () => {
    expect(chempot_3d_source).toContain(`import { sanitize_html } from '$lib/sanitize'`)
    expect(chempot_3d_source).toMatch(/\{@html sanitize_html\(gc\.label\)\}/)

    const payload = `Δμ<sub><img src=x onerror=alert(1)></sub> <span class="axis-unit">(eV)</span>`
    const rendered = sanitize_html(payload)
    expect(rendered).not.toContain(`<img`)
    expect(rendered).not.toMatch(/onerror\s*=/i)
    expect(rendered).toContain(`<span class="axis-unit">(eV)</span>`)
  })
})
