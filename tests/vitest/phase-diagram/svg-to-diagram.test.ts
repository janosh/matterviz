import { build_diagram, parse_phase_diagram_svg } from '$lib/phase-diagram'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, test } from 'vitest'

// Load SVG fixture files
const fixtures_dir = resolve(__dirname, `../fixtures/phase-diagram-svgs`)

function load_fixture(filename: string): string {
  return readFileSync(resolve(fixtures_dir, filename), `utf-8`)
}

describe(`parse_phase_diagram_svg`, () => {
  // MPDS SVGs use custom font encoding and unusual coordinate systems
  // that lack standard tick marks. The parser should reject them with
  // a clear error about missing axis ticks.
  test(`rejects MPDS format (Cu-Si) with tick error`, () => {
    const svg = load_fixture(`C108094-Cu-Si.svg`)
    expect(() => parse_phase_diagram_svg(svg)).toThrow(/at least 2 x-axis ticks/)
  })

  test(`parses matplotlib La-Ni-O SVG into valid PhaseDiagramData`, () => {
    const svg = load_fixture(`La-Ni-O-T-x-phase-diagram-gpt5.2.svg`)
    const input = parse_phase_diagram_svg(svg)
    const data = build_diagram(input)

    expect(data.components).toHaveLength(2)
    expect(data.regions.length).toBeGreaterThan(0)
    expect(data.boundaries.length).toBeGreaterThan(0)
    expect(data.temperature_range[0]).toBeLessThan(data.temperature_range[1])
  })
})
