import { RdfPlot } from '$lib'
import type { RdfPattern } from '$lib/rdf'
import type { Pbc, PymatgenStructure } from '$lib/structure'
import { structure_map } from '$site/structures'
import { mount } from 'svelte'
import { describe, expect, test } from 'vitest'

const nacl_structure = structure_map.get(`mp-1234`)
const pd_structure = structure_map.get(`mp-2`)
const bi2zr2o8_structure = structure_map.get(`Bi2Zr2O8-Fm3m`)

if (!nacl_structure || !pd_structure || !bi2zr2o8_structure) {
  throw new Error(`Required test structures not found in structure_map`)
}

// Helper to create a simple synthetic RDF pattern
function create_synthetic_pattern(
  n_points = 50,
  peaks: number[] = [2, 4],
  heights: number[] = [2, 1.5],
): RdfPattern {
  const r = Array.from({ length: n_points }, (_, idx) => (idx + 1) * 0.2)
  const g_r = r.map((r_val) => {
    let g = 1 - Math.exp(-r_val / 2)
    for (let idx = 0; idx < peaks.length; idx++) {
      g += heights[idx] * Math.exp(-((r_val - peaks[idx]) ** 2) / 0.3)
    }
    return g
  })
  return { r, g_r, element_pair: [`Li`, `O`] }
}

describe(`RdfPlot`, () => {
  // Test various input types (patterns, structures)
  test.each([
    [
      { patterns: { label: `Test`, pattern: create_synthetic_pattern() } },
      `pattern entry`,
    ],
    [
      {
        patterns: [
          { label: `Pattern 1`, pattern: create_synthetic_pattern() },
          {
            label: `Pattern 2`,
            pattern: create_synthetic_pattern(50, [3, 5], [1.8, 1.2]),
          },
        ],
      },
      `multiple patterns`,
    ],
    [{ structures: nacl_structure }, `single structure`],
    [{ structures: [nacl_structure, pd_structure] }, `structures array`],
    [{ structures: { NaCl: nacl_structure, Pd: pd_structure } }, `structures object`],
    [{ structures: [], patterns: [] }, `empty inputs`],
  ])(`renders %s`, (props, _desc) => {
    mount(RdfPlot, { target: document.body, props })
  })

  // Test modes (element_pairs vs full)
  test.each(
    [
      [`element_pairs`, nacl_structure],
      [`full`, pd_structure],
      [`element_pairs`, bi2zr2o8_structure],
    ] as const,
  )(`mode=%s`, (mode, structure) => {
    mount(RdfPlot, { target: document.body, props: { structures: structure, mode } })
  })

  // Test cutoff and n_bins options (including edge cases)
  test.each([
    [{ cutoff: 1, n_bins: 20 }], // very small
    [{ cutoff: 10, n_bins: 100 }], // typical
    [{ cutoff: 20, n_bins: 200 }], // very large
  ])(`cutoff/n_bins %s`, (opts) => {
    mount(RdfPlot, {
      target: document.body,
      props: { structures: pd_structure, ...opts },
    })
  }, 10_000 // Increased timeout for long tests in CI
  )

  // Test PBC settings
  test.each([
    [[true, true, true] as Pbc],
    [[false, false, false] as Pbc],
  ])(`pbc=%s`, (pbc) => {
    mount(RdfPlot, { target: document.body, props: { structures: nacl_structure, pbc } })
  })

  // Test show_reference_line prop
  test.each([[true], [false]])(`show_reference_line=%s`, (show_ref) => {
    mount(RdfPlot, {
      target: document.body,
      props: {
        patterns: { label: `Test`, pattern: create_synthetic_pattern() },
        show_reference_line: show_ref,
      },
    })
  })

  // Test custom props (labels, style, class, enable_drop)
  test(`custom props`, () => {
    const pattern = { label: `Test`, pattern: create_synthetic_pattern() }
    mount(RdfPlot, {
      target: document.body,
      props: {
        patterns: pattern,
        x_label: `Custom X`,
        y_label: `Custom Y`,
        style: `height: 500px;`,
        class: `custom-class`,
        enable_drop: true,
      },
    })
  })

  // Test children snippet
  test(`children snippet`, () => {
    let called = false
    mount(RdfPlot, {
      target: document.body,
      props: {
        patterns: { label: `Test`, pattern: create_synthetic_pattern() },
        children: () => {
          called = true
        },
      },
    })
    expect(called).toBe(true)
  })

  // Test mixed patterns and structures
  test(`mixed patterns and structures`, () => {
    mount(RdfPlot, {
      target: document.body,
      props: {
        patterns: { label: `Test`, pattern: create_synthetic_pattern() },
        structures: nacl_structure,
        mode: `full`,
      },
    })
  })

  // Test color assignment
  test(`color assignment`, () => {
    mount(RdfPlot, {
      target: document.body,
      props: {
        patterns: [
          { label: `Red`, pattern: create_synthetic_pattern(), color: `red` },
          {
            label: `Blue`,
            pattern: create_synthetic_pattern(50, [3], [2]),
            color: `blue`,
          },
        ],
      },
    })
  })

  // Test edge case: single atom structure
  test(`single atom structure`, () => {
    const single_atom: PymatgenStructure = {
      lattice: {
        matrix: [[5.0, 0.0, 0.0], [0.0, 5.0, 0.0], [0.0, 0.0, 5.0]],
        pbc: [true, true, true],
        volume: 125.0,
        a: 5.0,
        b: 5.0,
        c: 5.0,
        alpha: 90,
        beta: 90,
        gamma: 90,
      },
      sites: [
        {
          species: [{ element: `Si`, occu: 1, oxidation_state: 0 }],
          xyz: [0.0, 0.0, 0.0],
          abc: [0.0, 0.0, 0.0],
          label: `Si1`,
          properties: {},
        },
      ],
    }
    mount(RdfPlot, {
      target: document.body,
      props: { structures: single_atom, mode: `full` },
    })
  })
})
