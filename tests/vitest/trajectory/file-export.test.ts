import type { Matrix3x3, Vec3 } from '$lib/math'
import { calc_lattice_params } from '$lib/math'
import type { AnyStructure } from '$lib/structure'
import { parse_poscar, parse_xyz } from '$lib/structure/parse'
import type { TrajectoryFrame } from '$lib/trajectory'
import {
  create_poscar_frame_range_zip,
  poscar_frame_filename,
  serialize_extxyz_frame_range,
  trajectory_export_basename,
  trajectory_frame_to_extxyz_str,
} from '$lib/trajectory/file-export'
import { parse_xyz_trajectory } from '$lib/trajectory/parse/xyz'
import { unzipSync } from 'fflate'
import { describe, expect, test, vi } from 'vitest'

// oxfmt-ignore
const cube = (len: number): Matrix3x3 => [[len, 0, 0], [0, len, 0], [0, 0, len]]

const make_frame = (
  step: number,
  positions: Vec3[],
  metadata: Record<string, unknown> = {},
): TrajectoryFrame => {
  const matrix = cube(5)
  const structure = {
    sites: positions.map((xyz, idx) => ({
      species: [{ element: idx === 0 ? `Si` : `O`, occu: 1, oxidation_state: 0 }],
      xyz,
      abc: xyz.map((coord) => coord / 5) as Vec3,
      label: `${idx === 0 ? `Si` : `O`}${idx + 1}`,
      properties: {},
    })),
    lattice: { matrix, pbc: [true, true, true], ...calc_lattice_params(matrix) },
  } as AnyStructure
  return { structure, step, metadata }
}

// oxfmt-ignore
const two_sites: Vec3[] = [[0, 0, 0], [1, 1, 1]]
// oxfmt-ignore
const frames = [
  make_frame(0, two_sites, { energy: -10.5, force_max: 0.25 }),
  make_frame(5, [[0.1, 0, 0], [1.1, 1, 1]], { energy: -11.25, force_max: 0.1 }),
  make_frame(9, [[0.2, 0, 0], [1.2, 1, 1]], { energy: -11.5, force_max: 0.01 }),
]
const resolver = (idx: number) => frames[idx] ?? null

describe(`trajectory_export_basename`, () => {
  test.each([
    [`run.extxyz`, `run`],
    [`run.xyz.gz`, `run`],
    [`/data/md/traj.h5`, `traj`],
    [`XDATCAR`, `XDATCAR`],
    [`weird name (1).traj`, `weird_name_1`],
    [``, `trajectory`],
    [`.gz`, `trajectory`],
  ])(`%s -> %s`, (input, expected) => {
    expect(trajectory_export_basename(input)).toBe(expected)
  })
})

describe(`poscar_frame_filename`, () => {
  test.each([
    [7, 10, `run_frame_0007.vasp`],
    [7, 100_000, `run_frame_00007.vasp`], // widens past the 4-digit floor (max index 99999)
    [0, 1, `run_frame_0000.vasp`],
  ])(`frame %i of %i`, (frame_idx, total, expected) => {
    expect(poscar_frame_filename(`run.extxyz`, frame_idx, total)).toBe(expected)
  })
})

describe(`trajectory_frame_to_extxyz_str`, () => {
  test(`keeps energy and step, which live on the frame not the structure`, () => {
    const text = trajectory_frame_to_extxyz_str(frames[1])
    const comment = text.split(`\n`)[1]
    expect(comment).toContain(`step=5`)
    expect(comment).toContain(`energy=-11.25`)
    expect(comment).toContain(`force_max=0.1`)
    expect(comment).toContain(`Properties=species:S:1:pos:R:3`)
  })

  // XYZ parsing stores per-atom forces on frame.metadata, which the single-structure
  // exporter never sees; without folding them onto the sites they vanish on export.
  test(`recovers per-atom forces from frame metadata`, () => {
    // oxfmt-ignore
    const frame = make_frame(0, two_sites, { forces: [[0.1, 0.2, 0.3], [-0.1, -0.2, -0.3]] })
    const text = trajectory_frame_to_extxyz_str(frame)
    expect(text).toContain(`forces:R:3`)
    const reparsed = parse_xyz(text)
    expect(reparsed?.sites[0].properties.force).toEqual([0.1, 0.2, 0.3])
    expect(reparsed?.sites[1].properties.force).toEqual([-0.1, -0.2, -0.3])
  })

  // Anything less than a full set drops the column: exporting the usable ones and zeroing the
  // rest would report converged atoms on no evidence.
  // oxfmt-ignore
  test.each([
    [`a length mismatch`, [[0.1, 0.2, 0.3]]],
    [`a short entry`, [[0.1, 0.2, 0.3], [0.1, 0.2]]],
    [`a non-finite component`, [[0.1, 0.2, 0.3], [0.1, Number.NaN, 0.3]]],
    [`a null entry`, [[0.1, 0.2, 0.3], null]],
  ])(`ignores forces with %s`, (_name, forces) => {
    expect(trajectory_frame_to_extxyz_str(make_frame(0, two_sites, { forces })))
      .not.toContain(`forces:R:3`)
  })

  test(`skips non-finite scalars rather than emitting energy=NaN`, () => {
    const frame = make_frame(0, two_sites, {
      energy: Number.NaN,
      pressure: Number.POSITIVE_INFINITY,
      temperature: 300,
    })
    const comment = trajectory_frame_to_extxyz_str(frame).split(`\n`)[1]
    expect(comment).toContain(`temperature=300`)
    expect(comment).not.toMatch(/NaN|Infinity/)
  })

  test(`carries extra scalar metadata but not arrays`, () => {
    const frame = make_frame(
      0,
      [
        [0, 0, 0],
        [1, 1, 1],
      ],
      {
        temperature: 300,
        converged: true,
        stress: [1, 2, 3, 4, 5, 6],
        label: `some string`,
      },
    )
    const comment = trajectory_frame_to_extxyz_str(frame).split(`\n`)[1]
    expect(comment).toContain(`temperature=300`)
    expect(comment).toContain(`converged=true`)
    expect(comment).not.toContain(`stress`)
    expect(comment).not.toContain(`some string`)
  })
})

describe(`serialize_extxyz_frame_range`, () => {
  test(`round-trips through the trajectory parser`, async () => {
    const text = await serialize_extxyz_frame_range(0, 2, resolver)
    const reparsed = parse_xyz_trajectory(text)
    expect(reparsed.frames).toHaveLength(3)
    expect(reparsed.frames.map((frame) => frame.step)).toEqual([0, 5, 9])
    expect(reparsed.frames.map((frame) => frame.metadata?.energy)).toEqual([
      -10.5, -11.25, -11.5,
    ])
    expect(reparsed.frames[2].structure.sites[0].xyz[0]).toBeCloseTo(0.2, 6)
  })

  test(`exports only the requested sub-range`, async () => {
    const text = await serialize_extxyz_frame_range(1, 2, resolver)
    const reparsed = parse_xyz_trajectory(text)
    expect(reparsed.frames.map((frame) => frame.step)).toEqual([5, 9])
  })

  test(`reports progress once per frame`, async () => {
    const on_progress = vi.fn()
    await serialize_extxyz_frame_range(0, 2, resolver, on_progress)
    expect(on_progress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  // An indexed trajectory holds only a few frames in memory; the rest arrive from a loader.
  test(`awaits an async resolver rather than reading a frames array`, async () => {
    const async_resolver = vi.fn((idx: number) => Promise.resolve(frames[idx] ?? null))
    const text = await serialize_extxyz_frame_range(0, 2, async_resolver)
    expect(async_resolver).toHaveBeenCalledTimes(3)
    expect(parse_xyz_trajectory(text).frames).toHaveLength(3)
  })

  test.each([
    [-1, 1],
    [2, 1],
    [0.5, 1],
    [0, Number.NaN],
  ])(`rejects the range %s-%s`, async (start, end) => {
    await expect(serialize_extxyz_frame_range(start, end, resolver)).rejects.toThrow(
      `Invalid trajectory frame range`,
    )
  })

  // Silently emitting a short file would look like a successful export of a shorter run
  test(`throws when a frame cannot be resolved`, async () => {
    await expect(serialize_extxyz_frame_range(0, 5, resolver)).rejects.toThrow(
      `Trajectory frame 3 is not available for export`,
    )
  })
})

describe(`create_poscar_frame_range_zip`, () => {
  const read_zip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()))

  test(`writes one numbered POSCAR per frame, each holding that frame's geometry`, async () => {
    const blob = await create_poscar_frame_range_zip(0, 2, resolver, `run.extxyz`, 3)
    expect(blob.type).toBe(`application/zip`)
    const files = await read_zip(blob)
    expect(Object.keys(files).toSorted()).toEqual([
      `run_frame_0000.vasp`,
      `run_frame_0001.vasp`,
      `run_frame_0002.vasp`,
    ])
    const first = new TextDecoder().decode(files[`run_frame_0000.vasp`])
    expect(first.split(`\n`)[1]).toBe(`1.0`) // POSCAR scale line
    expect(first).toContain(`Si O`)
    expect(first.endsWith(`\n`)).toBe(true)
    // filenames alone can't catch frames written in the wrong order or with stale coordinates
    for (const [frame_idx, expected_x] of [
      [0, 0],
      [1, 0.1],
      [2, 0.2],
    ] as const) {
      const text = new TextDecoder().decode(files[`run_frame_000${frame_idx}.vasp`])
      const parsed = parse_poscar(text)
      expect(parsed?.sites[0].xyz[0]).toBeCloseTo(expected_x, 6)
    }
  })

  test(`names the frame a serializer choked on`, async () => {
    // POSCAR needs a lattice; the raw error would name neither the frame nor the range
    const lattice_less = { structure: { sites: frames[0].structure.sites }, step: 0 }
    await expect(
      create_poscar_frame_range_zip(0, 0, () => lattice_less as TrajectoryFrame, `run`, 1),
    ).rejects.toThrow(`Failed to serialize trajectory frame 0`)
  })

  test(`names files by absolute frame index, not position in the range`, async () => {
    const blob = await create_poscar_frame_range_zip(1, 2, resolver, `run.extxyz`, 3)
    expect(Object.keys(await read_zip(blob)).toSorted()).toEqual([
      `run_frame_0001.vasp`,
      `run_frame_0002.vasp`,
    ])
  })

  test(`throws when a frame cannot be resolved`, async () => {
    await expect(
      create_poscar_frame_range_zip(0, 4, resolver, `run.extxyz`, 5),
    ).rejects.toThrow(`Trajectory frame 3 is not available for export`)
  })
})
