import {
  build_lower_hull_model,
  compute_e_above_hull_for_points,
  e_hull_at_xy,
  process_pd_entries,
} from '$lib/phase-diagram/energies'
import type { ConvexHullTriangle, PhaseEntry } from '$lib/phase-diagram/types'
import { describe, expect, test } from 'vitest'

describe(`energies: hull model and e_above_hull evaluation`, () => {
  test(`build_lower_hull_model and e_hull evaluation for a simple plane`, () => {
    const face: ConvexHullTriangle = {
      vertices: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ],
      normal: { x: 0, y: 0, z: -1 },
      centroid: { x: 1 / 3, y: 1 / 3, z: 0 },
    }
    const models = build_lower_hull_model([face])
    expect(models.length).toBe(1)
    const z0 = e_hull_at_xy(models, 0.2, 0.2)
    expect(Number((z0 ?? NaN).toFixed(9))).toBe(0)
    const e = compute_e_above_hull_for_points([{ x: 0.2, y: 0.2, z: 0.1 }], models)
    expect(Number(e[0].toFixed(9))).toBe(0.1)
  })
})

describe(`energies: process_pd_entries categorization and element extraction`, () => {
  test(`splits stable/unstable and extracts elements + el_refs`, () => {
    const entries: PhaseEntry[] = [
      { composition: { A: 1 }, energy: 0, e_above_hull: 0 },
      { composition: { B: 2 }, energy: 0, e_above_hull: 0 },
      { composition: { A: 1, B: 1 }, energy: -1, e_above_hull: 0.05 },
      { composition: { A: 1, B: 2 }, energy: -2, e_above_hull: 0 },
    ]
    const out = process_pd_entries(entries)
    expect(out.elements.sort()).toEqual([`A`, `B`])
    expect(out.stable_entries.length).toBe(3)
    expect(out.unstable_entries.length).toBe(1)
    expect(Object.keys(out.el_refs).sort()).toEqual([`A`, `B`])
  })
})
