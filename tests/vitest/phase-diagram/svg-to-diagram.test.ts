import { build_diagram, parse_phase_diagram_svg } from '$lib/phase-diagram'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const fixtures_dir = resolve(import.meta.dirname, `../fixtures/phase-diagram-svgs`)
const load_fixture = (name: string) => readFileSync(resolve(fixtures_dir, name), `utf-8`)

describe(`parse_phase_diagram_svg`, () => {
  test.each([
    { file: `C108094-Cu-Si-mpds.svg`, components: [`Cu`, `Si`] },
    { file: `C905892-Ni-B-mpds.svg`, components: [`B`, `Ni`] },
  ])(`parses MPDS SVG $file`, ({ file, components }) => {
    const data = build_diagram(parse_phase_diagram_svg(load_fixture(file)))

    expect(data.components).toEqual(components)
    expect(data.regions.length).toBeGreaterThan(0)
    expect(data.boundaries.length).toBeGreaterThan(0)
    expect(data.temperature_range[0]).toBeLessThan(data.temperature_range[1])
    // MPDS diagrams use °C and composition as mole fraction
    expect(data.temperature_unit).toBe(`°C`)
    expect(data.composition_unit).toBe(`fraction`)
  })

  test.each([
    [`not valid xml`, /Invalid SVG/],
    [`<svg xmlns="http://www.w3.org/2000/svg"></svg>`, /at least 2/],
  ])(`throws on invalid input: %s`, (svg, pattern) => {
    expect(() => parse_phase_diagram_svg(svg)).toThrow(pattern)
  })

  test(`throws on SVG with ticks but no boundaries`, () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <line x1="0" y1="100" x2="10" y2="100" class="tick-line"/>
      <text x="-10" y="105" class="tick-text">0</text>
      <line x1="0" y1="0" x2="10" y2="0" class="tick-line"/>
      <text x="-10" y="5" class="tick-text">100</text>
      <text x="50" y="120" class="tick-text-x">0.0</text>
      <text x="150" y="120" class="tick-text-x">1.0</text>
    </svg>`
    expect(() => parse_phase_diagram_svg(svg)).toThrow(/No phase boundaries/)
  })
})
