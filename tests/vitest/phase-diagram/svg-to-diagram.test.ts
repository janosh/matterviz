import { build_diagram, parse_phase_diagram_svg } from '$lib/phase-diagram'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

// Load MPDS SVG test fixtures
const fixtures_dir = resolve(import.meta.dirname, `../fixtures/phase-diagram-svgs`)

function load_fixture(filename: string): string {
  return readFileSync(resolve(fixtures_dir, filename), `utf-8`)
}

describe(`parse_phase_diagram_svg`, () => {
  test.each([
    [`C108094-Cu-Si-mpds.svg`, [`Cu`, `Si`]],
    [`C905892-Ni-B-mpds.svg`, [`B`, `Ni`]],
  ])(`parses MPDS SVG %s with correct components`, (filename, expected_components) => {
    const svg = load_fixture(filename)
    const input = parse_phase_diagram_svg(svg)
    const data = build_diagram(input)

    expect(data.components).toEqual(expected_components)
    expect(data.regions.length).toBeGreaterThan(0)
    expect(data.boundaries.length).toBeGreaterThan(0)
    expect(data.temperature_range[0]).toBeLessThan(data.temperature_range[1])
  })
})
