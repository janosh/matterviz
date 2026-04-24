import { readFileSync } from 'node:fs'
import process from 'node:process'
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
})
