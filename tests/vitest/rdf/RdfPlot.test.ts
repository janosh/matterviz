import { RdfPlot } from '$lib'
import type { RdfPattern } from '$lib/rdf'
import type { Pbc } from '$lib/structure'
import { structure_map } from '$site/structures'
import { createRawSnippet, mount } from 'svelte'
import { describe, test } from 'vitest'
import { make_crystal } from '../setup'

const nacl_structure = structure_map.get(`mp-1234`)
const pd_structure = structure_map.get(`mp-2`)
const bi2zr2o8_structure = structure_map.get(`Bi2Zr2O8-Fm3m`)

if (!nacl_structure || !pd_structure || !bi2zr2o8_structure) {
  throw new Error(`Required test structures not found in structure_map`)
}

function create_synthetic_pattern(
  n_points = 50,
  peaks: number[] = [2, 4],
  heights: number[] = [2, 1.5],
): RdfPattern {
  const r = Array.from({ length: n_points }, (_, idx) => (idx + 1) * 0.2)
  const g_r = r.map((r_val) => {
    let g_val = 1 - Math.exp(-r_val / 2)
    for (let idx = 0; idx < peaks.length; idx++) {
      g_val += heights[idx] * Math.exp(-((r_val - peaks[idx]) ** 2) / 0.3)
    }
    return g_val
  })
  return { r, g_r, element_pair: [`Li`, `O`] }
}

describe(`RdfPlot`, () => {
  test.each([
    [{ patterns: { label: `Test`, pattern: create_synthetic_pattern() } }],
    [{
      patterns: [{ label: `P1`, pattern: create_synthetic_pattern() }, {
        label: `P2`,
        pattern: create_synthetic_pattern(50, [3, 5], [1.8, 1.2]),
      }],
    }],
    [{ structures: nacl_structure }],
    [{ structures: [nacl_structure, pd_structure] }],
    [{ structures: { NaCl: nacl_structure, Pd: pd_structure } }],
    [{ structures: [], patterns: [] }],
  ])(`renders %s`, (props) => {
    mount(RdfPlot, { target: document.body, props })
  })

  test.each(
    [
      [`element_pairs`, nacl_structure],
      [`full`, pd_structure],
      [`element_pairs`, bi2zr2o8_structure],
    ] as const,
  )(`mode=%s`, (mode, structure) => {
    mount(RdfPlot, { target: document.body, props: { structures: structure, mode } })
  })

  test.each([
    [{ cutoff: 1, n_bins: 20 }],
    [{ cutoff: 10, n_bins: 100 }],
    [{ cutoff: 20, n_bins: 200 }],
  ])(`cutoff/n_bins %s`, (opts) => {
    mount(RdfPlot, {
      target: document.body,
      props: { structures: pd_structure, ...opts },
    })
  }, 10_000)

  test.each([
    [[true, true, true] as Pbc],
    [[false, false, false] as Pbc],
  ])(`pbc=%s`, (pbc) => {
    mount(RdfPlot, { target: document.body, props: { structures: nacl_structure, pbc } })
  })

  test.each([[true], [false]])(`show_reference_line=%s`, (show_ref) => {
    mount(RdfPlot, {
      target: document.body,
      props: {
        patterns: { label: `Test`, pattern: create_synthetic_pattern() },
        show_reference_line: show_ref,
      },
    })
  })

  test(`custom props`, () => {
    mount(RdfPlot, {
      target: document.body,
      props: {
        patterns: { label: `Test`, pattern: create_synthetic_pattern() },
        x_axis: { label: `Custom X` },
        y_axis: { label: `Custom Y` },
        style: `height: 500px;`,
        class: `custom-class`,
        enable_drop: true,
      },
    })
  })

  test(`children snippet`, () => {
    mount(RdfPlot, {
      target: document.body,
      props: {
        patterns: { label: `Test`, pattern: create_synthetic_pattern() },
        children: createRawSnippet(() => ({ render: () => `<div></div>` })),
      },
    })
  })

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

  test(`color assignment`, () => {
    mount(RdfPlot, {
      target: document.body,
      props: {
        patterns: [{ label: `Red`, pattern: create_synthetic_pattern(), color: `red` }, {
          label: `Blue`,
          pattern: create_synthetic_pattern(50, [3], [2]),
          color: `blue`,
        }],
      },
    })
  })

  test(`single atom structure`, () => {
    const single_atom = make_crystal(5, [{ element: `Si`, abc: [0, 0, 0] }])
    mount(RdfPlot, {
      target: document.body,
      props: { structures: single_atom, mode: `full` },
    })
  })
})
