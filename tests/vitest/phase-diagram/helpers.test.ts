import type { D3InterpolateName } from '$lib/colors'
import {
  build_entry_tooltip_text,
  compute_max_energy_threshold,
  find_pd_entry_at_mouse,
  get_energy_color_scale,
  get_point_color_for_entry,
} from '$lib/phase-diagram/helpers'
import { get_phase_diagram_stats } from '$lib/phase-diagram/thermodynamics'
import type { PhaseEntry } from '$lib/phase-diagram/types'
import { describe, expect, test } from 'vitest'

describe(`helpers: energy color scale + point color`, () => {
  test(`get_energy_color_scale returns null when not energy mode or empty`, () => {
    const color_scale: D3InterpolateName = `interpolateViridis`
    const scale_null = get_energy_color_scale(`stability`, color_scale, [])
    expect(scale_null).toBeNull()
  })

  test(`get_energy_color_scale maps distances to colors and get_point_color_for_entry uses it`, () => {
    const entries: Array<{ e_above_hull?: number }> = [{ e_above_hull: 0 }, {
      e_above_hull: 0.5,
    }]
    const color_scale: D3InterpolateName = `interpolateViridis`
    const scale = get_energy_color_scale(`energy`, color_scale, entries)
    expect(scale).not.toBeNull()
    const c0 = get_point_color_for_entry({ e_above_hull: 0 }, `energy`, undefined, scale)
    const c1 = get_point_color_for_entry(
      { e_above_hull: 0.5 },
      `energy`,
      undefined,
      scale,
    )
    expect(typeof c0).toBe(`string`)
    expect(typeof c1).toBe(`string`)
    expect(c0).not.toBe(c1)
  })

  test(`get_point_color_for_entry stability mode`, () => {
    const stable = get_point_color_for_entry(
      { is_stable: true },
      `stability`,
      undefined,
      null,
    )
    const unstable = get_point_color_for_entry(
      { is_stable: false },
      `stability`,
      undefined,
      null,
    )
    expect(stable).toBe(`#0072B2`)
    expect(unstable).toBe(`#E69F00`)
  })
})

describe(`helpers: thresholds and tooltips`, () => {
  test(`compute_max_energy_threshold returns robust default and range`, () => {
    expect(compute_max_energy_threshold([] as unknown as PhaseEntry[])).toBeCloseTo(0.5)
    const v = compute_max_energy_threshold([
      { e_above_hull: 0 } as unknown as PhaseEntry,
      { e_above_hull: 0.2 } as unknown as PhaseEntry,
    ])
    expect(v).toBeGreaterThan(0.2)
  })

  test(`build_entry_tooltip_text contains key fields`, () => {
    const t1 = build_entry_tooltip_text(
      { composition: { Li: 1 }, energy: -1 } as unknown as PhaseEntry,
    )
    expect(t1).toMatch(/Li/)
    const t2 = build_entry_tooltip_text(
      {
        composition: { Li: 1, O: 1 },
        energy: -6,
        e_form_per_atom: -3,
        e_above_hull: 0,
        entry_id: `mp-1`,
      } as unknown as PhaseEntry,
    )
    expect(t2).toMatch(/E above hull/)
    expect(t2).toMatch(/Formation Energy/)
    expect(t2).toMatch(/ID/)
  })

  test.each([
    {
      name: `ternary stats with mixed stability`,
      elements: [`Li`, `O`, `Na`] as unknown as string[],
      max_arity: 3 as const,
      entries: [
        { composition: { Li: 1 }, energy: 0, e_above_hull: 0, energy_per_atom: 0 },
        { composition: { O: 2 }, energy: -10, e_above_hull: 0, energy_per_atom: -5 },
        {
          composition: { Li: 1, O: 1 },
          energy: -6,
          e_above_hull: 0.05,
          energy_per_atom: -3,
        },
        {
          composition: { Li: 1, Na: 1 },
          energy: -2,
          e_above_hull: 0,
          energy_per_atom: -1,
        },
        {
          composition: { Li: 1, O: 1, Na: 1 },
          energy: -8,
          e_above_hull: 0.1,
          energy_per_atom: -8 / 3,
        },
      ] as PhaseEntry[],
      expected: {
        total: 5,
        unary: 2,
        binary: 2,
        ternary: 1,
        quaternary: 0,
        elements: 3,
        system: `Na-Li-O`,
      },
    },
    {
      name: `quaternary stats counts quaternary entries`,
      elements: [`A`, `B`, `C`, `D`] as unknown as string[],
      max_arity: 4 as const,
      entries: [
        { composition: { A: 1 }, energy: 0, e_above_hull: 0, energy_per_atom: 0 },
        {
          composition: { A: 1, B: 1, C: 1, D: 1 },
          energy: -4,
          e_above_hull: 0.2,
          energy_per_atom: -1,
        },
      ] as PhaseEntry[],
      expected: {
        total: 2,
        unary: 1,
        binary: 0,
        ternary: 0,
        quaternary: 1,
        elements: 4,
        system: `A-D-B-C`,
      },
    },
  ])(`get_phase_diagram_stats: $name`, ({ elements, max_arity, entries, expected }) => {
    const stats = get_phase_diagram_stats(entries, elements, max_arity)
    expect(stats).not.toBeNull()
    if (!stats) return
    expect(stats.total).toBe(expected.total)
    expect(stats.unary).toBe(expected.unary)
    expect(stats.binary).toBe(expected.binary)
    expect(stats.ternary).toBe(expected.ternary)
    expect(stats.quaternary).toBe(expected.quaternary)
    expect(stats.elements).toBe(expected.elements)
    expect(stats.chemical_system).toBe(expected.system)
    expect(stats.energy_range.max).toBeGreaterThanOrEqual(stats.energy_range.min)
    expect(stats.hull_distance.max).toBeGreaterThanOrEqual(stats.hull_distance.avg)
  })
})

describe(`helpers: mouse hit testing`, () => {
  test(`find_pd_entry_at_mouse returns null when no canvas`, () => {
    const hit = find_pd_entry_at_mouse(
      undefined as unknown as HTMLCanvasElement,
      { clientX: 0, clientY: 0 } as unknown as MouseEvent,
      [],
      (x: number, y: number, _z: number) => ({ x, y }),
    )
    expect(hit).toBeNull()
  })

  test(`find_pd_entry_at_mouse detects nearby entry`, () => {
    // Fake canvas with size and client rect
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      clientWidth: 600,
      clientHeight: 600,
    } as unknown as HTMLCanvasElement
    const plot_entries: Array<{ x: number; y: number; z: number; visible: boolean }> = [{
      x: 100,
      y: 100,
      z: 0,
      visible: true,
    }]
    const project = (x: number, y: number) => ({ x, y })
    const hit = find_pd_entry_at_mouse(
      canvas,
      { clientX: 102, clientY: 102 } as unknown as MouseEvent,
      plot_entries,
      project,
    )
    expect(hit).toBe(plot_entries[0])
  })
})
