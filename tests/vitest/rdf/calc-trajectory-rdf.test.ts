import { collect_trajectory_rdf, rdf_shell } from '$lib/rdf'
import type { Crystal } from '$lib/structure'
import { trajectory_from_frames } from '$lib/trajectory'
import { describe, expect, test } from 'vitest'
import { FCC_LATTICE_CONST, make_fcc } from '../structure-id/lattices'
import { make_crystal } from '../setup'

const run_of = (structures: Crystal[]) =>
  trajectory_from_frames(structures.map((structure, step) => ({ step, structure })))

// Rocksalt NaCl in a conventional cell: every Na has 6 Cl at a/2 and 12 Na at a/√2
const NACL_A = 5.64
const rocksalt = (a_len = NACL_A): Crystal =>
  make_crystal(a_len, [
    [`Na`, [0, 0, 0]],
    [`Na`, [0.5, 0.5, 0]],
    [`Na`, [0.5, 0, 0.5]],
    [`Na`, [0, 0.5, 0.5]],
    [`Cl`, [0.5, 0, 0]],
    [`Cl`, [0, 0.5, 0]],
    [`Cl`, [0, 0, 0.5]],
    [`Cl`, [0.5, 0.5, 0.5]],
  ])

describe(`collect_trajectory_rdf`, () => {
  test(`averages every element pair over the sampled frames and reads off the shells`, async () => {
    const seen: number[] = []
    const result = await collect_trajectory_rdf(run_of(Array.from({ length: 10 }, rocksalt)), {
      max_frames: 4,
      cutoff: 6,
      n_bins: 120,
      on_progress: (done) => seen.push(done),
    })
    expect(seen).toEqual([1, 2, 3, 4])
    expect(result.frame_numbers).toEqual([0, 3, 6, 9])
    expect(result).toMatchObject({ frame_stride: 3, n_atoms: 8, cutoff: 6, n_bins: 120 })
    expect(result.mean_volume).toBeCloseTo(NACL_A ** 3, 6)
    expect(result.curves.map((curve) => curve.label)).toEqual([`Cl-Cl`, `Cl-Na`, `Na-Na`])
    const cl_na = result.curves[1]
    // a perfect crystal's g(r) is identical in every frame, so the mean is one frame's histogram
    expect(cl_na.shell.first_peak_r).toBeCloseTo(NACL_A / 2, 1)
    expect(cl_na.shell.coordination).toBeCloseTo(6, 6)
    expect(cl_na.coordination_reverse).toBeCloseTo(6, 6)
    const na_na = result.curves[2]
    expect(na_na.shell.first_peak_r).toBeCloseTo(NACL_A / Math.SQRT2, 1)
    expect(na_na.shell.coordination).toBeCloseTo(12, 6)
    expect(result.r).toHaveLength(120)
    expect(cl_na.g_r).toHaveLength(120)
  })

  test.each([
    {
      label: `expanded FCC`,
      structures: [make_fcc([2, 2, 2]), make_fcc([2, 2, 2], FCC_LATTICE_CONST * 1.01)],
      coordination: 12,
      volume: ((2 * FCC_LATTICE_CONST) ** 3 * (1 + 1.01 ** 3)) / 2,
    },
    {
      label: `fixed dimer in changing volume`,
      structures: [10, 20].map((cell) =>
        make_crystal(cell, [
          [`Na`, [0, 0, 0]],
          [`Na`, [1 / cell, 0, 0]],
        ]),
      ),
      coordination: 1,
      volume: 4500,
    },
  ])(
    `weights $label by each frame's own density`,
    async ({ structures, coordination, volume }) => {
      const result = await collect_trajectory_rdf(run_of(structures), {
        cutoff: 5,
        n_bins: 100,
      })
      expect(result.curves).toHaveLength(1)
      // Both frames contain the entire first shell; the count is independent of cell volume.
      expect(result.curves[0].shell.coordination).toBeCloseTo(coordination, 9)
      expect(result.curves[0].coordination_reverse).toBeCloseTo(coordination, 9)
      expect(result.mean_volume).toBeCloseTo(volume, 6)
    },
  )

  test(`keeps every species of a mixed-occupancy site, weighted by occupancy`, async () => {
    // Na0.5K0.5 on every cation site: K-Cl and Na-Cl see the same 6 Cl neighbours, and with
    // 2 K-equivalents per 4 Cl each Cl sees 3 K (CN(A|B) = CN(B|A) · N_a / N_b = 6 · 2 / 4)
    const mixed = rocksalt()
    mixed.sites = mixed.sites.map((site) =>
      site.species[0].element === `Na`
        ? {
            ...site,
            species: [
              { element: `Na`, occu: 0.5, oxidation_state: 0 },
              { element: `K`, occu: 0.5, oxidation_state: 0 },
            ],
          }
        : site,
    )
    const result = await collect_trajectory_rdf(run_of([mixed, mixed]), {
      cutoff: 6,
      n_bins: 120,
    })
    expect(result.curves.map((curve) => curve.label)).toEqual([
      `Cl-Cl`,
      `Cl-K`,
      `Cl-Na`,
      `K-K`,
      `K-Na`,
      `Na-Na`,
    ])
    const cl_k = result.curves[1]
    expect(cl_k.shell.coordination).toBeCloseTo(3, 6)
    expect(cl_k.coordination_reverse).toBeCloseTo(6, 6)
    // a frame whose minority species differs is a different composition, majority or not
    const shifted = { ...mixed, sites: mixed.sites.map((site) => ({ ...site })) }
    shifted.sites[0].species = [
      { element: `Na`, occu: 0.6, oxidation_state: 0 },
      { element: `K`, occu: 0.4, oxidation_state: 0 },
    ]
    await expect(
      collect_trajectory_rdf(run_of([mixed, shifted]), { n_bins: 20 }),
    ).rejects.toThrow(/different composition/)
  })

  test.each([
    [
      `a lattice-less frame`,
      () => run_of([{ sites: rocksalt().sites } as unknown as Crystal]),
      /needs a periodic cell/,
    ],
    [
      `a composition change`,
      () => {
        const swapped = rocksalt()
        swapped.sites[0] = {
          ...swapped.sites[0],
          species: [{ element: `K`, occu: 1, oxidation_state: 0 }],
        }
        return run_of([rocksalt(), swapped])
      },
      /different composition or atom order/,
    ],
  ])(`rejects %s`, async (_label, make_run, pattern) => {
    await expect(collect_trajectory_rdf(make_run(), { n_bins: 20 })).rejects.toThrow(pattern)
  })

  test(`stops between frames once aborted`, async () => {
    const controller = new AbortController()
    const sweep = collect_trajectory_rdf(run_of(Array.from({ length: 6 }, rocksalt)), {
      n_bins: 20,
      signal: controller.signal,
      on_progress: (done) => {
        if (done === 2) controller.abort(new Error(`pane closed`))
      },
    })
    await expect(sweep).rejects.toThrow(`pane closed`)
  })
})

describe(`rdf_shell`, () => {
  const r = Array.from({ length: 50 }, (_unused, idx) => (idx + 0.5) * 0.1)
  const gaussian = (center: number, height: number, width = 0.2) =>
    r.map((rad) => height * Math.exp(-(((rad - center) / width) ** 2)))

  test(`finds the first peak, the minimum after it and integrates the shell`, () => {
    const g_r = gaussian(2.05, 4).map((val, idx) => val + gaussian(4.05, 2)[idx])
    const shell = rdf_shell(r, g_r, 0.05)
    expect(shell.first_peak_r).toBeCloseTo(2.05, 6)
    expect(shell.first_peak_height).toBeCloseTo(4, 6)
    // the curve bottoms out between the two Gaussians
    expect(shell.first_min_r).toBeGreaterThan(2.5)
    expect(shell.first_min_r).toBeLessThan(3.5)
    // 4π ρ ∫ g r² dr over the first Gaussian: ∫ h·exp(-((r-c)/w)²) r² dr = h·w·√π·(c² + w²/2)
    const analytic = 4 * Math.PI * 0.05 * 4 * 0.2 * Math.sqrt(Math.PI) * (2.05 ** 2 + 0.02)
    expect(shell.coordination).toBeCloseTo(analytic, 1)
  })

  test.each<[string, number[], Partial<ReturnType<typeof rdf_shell>>]>([
    [`a flat g(r) = 1`, r.map(() => 1), { first_peak_r: null, coordination: null }],
    // still falling at the cutoff: the peak is reported, the shell is not closed
    [
      `a peak near the cutoff`,
      gaussian(4.55, 3, 0.3),
      { first_peak_r: 4.55, first_min_r: null, coordination: null },
    ],
    // still rising at the cutoff: no peak, nothing to report
    [`a peak beyond the cutoff`, gaussian(5.5, 3, 0.5), { first_peak_r: null }],
    // a crystal's gap between shells runs to the cutoff: the shell still closes at the gap
    [
      `a shell followed by zeros`,
      r.map((rad) => (Math.abs(rad - 2.05) < 0.08 ? 5 : 0)),
      { first_peak_r: expect.closeTo(2.05, 6), first_min_r: expect.closeTo(2.25, 6) },
    ],
    [`too few bins`, [1, 2], { first_peak_r: null }],
  ])(`handles %s`, (_label, g_r, expected) => {
    expect(rdf_shell(r.slice(0, g_r.length), g_r, 0.1)).toMatchObject(expected)
  })
})
