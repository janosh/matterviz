import type { AnyStructure, ElementCategory, ElementSymbol, Vec3 } from '$lib'
import type { PhaseData } from '$lib/convex-hull/types'
import type { FermiIsosurface, FermiSurfaceData } from '$lib/fermi-surface/types'
import { flatten_grid } from '$lib/isosurface/grid'
import type { VolumetricData } from '$lib/isosurface/types'
import { make_volume as make_volume_from_values } from '$lib/isosurface/types'
import * as math from '$lib/math'
import type { Crystal, Molecule, Pbc, Site } from '$lib/structure'
import type {
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryPositionStream,
} from '$lib/trajectory'
import { TrajectoryProperties, type TrajectoryRun } from '$lib/trajectory/run'
import { type MemoryRunExtras, trajectory_from_frames } from '$lib/trajectory/runs/memory'
import type { SymmetryDataset } from '$lib/symmetry'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'

// Load symmetry code only for tests that use it, then initialize WASM from its local binary.
let moyo_initialized = false
export async function init_moyo_for_tests(): Promise<void> {
  if (moyo_initialized) return
  const { ensure_moyo_wasm_ready } = await import(`$lib/symmetry/analyze`)
  await ensure_moyo_wasm_ready(
    readFileSync(
      resolve(import.meta.dirname, `../../node_modules/@spglib/moyo-wasm/moyo_wasm_bg.wasm`),
    ),
  )
  moyo_initialized = true
}

export const make_grid = (
  size_x: number,
  size_y: number,
  size_z: number,
  fill: number | ((idx_x: number, idx_y: number, idx_z: number) => number) = 1,
): number[][][] =>
  Array.from({ length: size_x }, (_x_row, idx_x) =>
    Array.from({ length: size_y }, (_y_row, idx_y) =>
      Array.from({ length: size_z }, (_z_row, idx_z) =>
        typeof fill === `function` ? fill(idx_x, idx_y, idx_z) : fill,
      ),
    ),
  )

// Minimal VolumetricData fixture from a nested [x][y][z] grid; values are flattened
// z-fastest, data_range is computed from them, and overrides win over every default
export const make_volume = (
  grid: number[][][],
  overrides: Partial<VolumetricData> = {},
): VolumetricData => {
  const flat = flatten_grid(grid)
  return {
    ...make_volume_from_values(flat.values, flat.dims, {
      id: overrides.id ?? `0`,
      lattice: [
        [5, 0, 0],
        [0, 5, 0],
        [0, 0, 5],
      ],
      origin: [0, 0, 0],
      periodic: true,
    }),
    ...overrides,
  }
}

// Number of elements per category in element_data
export const CATEGORY_COUNTS: Record<ElementCategory, number> = {
  actinide: 15,
  'alkali metal': 6,
  'alkaline earth metal': 6,
  'diatomic nonmetal': 7,
  lanthanide: 15,
  metalloid: 8,
  'noble gas': 7,
  'polyatomic nonmetal': 4,
  'post-transition metal': 12,
  'transition metal': 38,
}

// Value at grid point (ix, iy, iz) of a flat volume
export const grid_value = (
  volume: Pick<VolumetricData, `values` | `dims`>,
  idx_x: number,
  idx_y: number,
  idx_z: number,
): number => volume.values[(idx_x * volume.dims[1] + idx_y) * volume.dims[2] + idx_z]

// Linear fractional field; trilinear interpolation reproduces it exactly.
export const make_linear_volume = (
  n_pts: number,
  lattice: math.Matrix3x3,
  periodic: boolean,
  origin: Vec3 = [0, 0, 0],
): VolumetricData => {
  const divisor = periodic ? n_pts : n_pts - 1
  const grid = make_grid(
    n_pts,
    n_pts,
    n_pts,
    (x_idx, y_idx, z_idx) => (x_idx + 2 * y_idx + 4 * z_idx) / divisor,
  )
  return make_volume(grid, { lattice, origin, periodic })
}

export function read_binary_test_file(
  filename: string,
  directory = `src/site/trajectories`,
): ArrayBuffer {
  const file_path = resolve(process.cwd(), directory, filename)
  const buffer = readFileSync(file_path)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

// Read a (possibly gzipped) text file as utf-8, decompressing when the path ends in `.gz`.
export function read_maybe_gz(file_path: string): string {
  const buffer = readFileSync(file_path)
  return file_path.endsWith(`.gz`)
    ? gunzipSync(buffer).toString(`utf8`)
    : buffer.toString(`utf8`)
}

// Convex-hull/chempot PhaseData fixture: total `energy` derives from `energy_per_atom` ×
// atom count (so e_form, hull distances and chempot planes all agree); `overrides` wins.
export const make_phase = (
  composition: Record<string, number>,
  energy_per_atom = 0,
  overrides: Partial<PhaseData> = {},
): PhaseData => {
  const atoms = Object.values(composition).reduce((sum, amt) => sum + amt, 0)
  return { composition, energy_per_atom, energy: energy_per_atom * atoms, ...overrides }
}

// Read and JSON.parse a (possibly gzipped) JSON file. Cast the result at the call site.
// Generic param is a typed-load convenience for call sites (load_json<Foo>(path)),
// not used for inference, hence the single-use type parameter is intentional.
// oxlint-disable-next-line typescript-eslint/no-unnecessary-type-parameters
export const load_json = <T = unknown>(file_path: string): T =>
  JSON.parse(read_maybe_gz(file_path)) as T

// Gzip a string to the ArrayBuffer a File/fetch response would carry.
export const gzip_bytes = (content: string): Promise<ArrayBuffer> =>
  new Response(
    new Blob([content]).stream().pipeThrough(new CompressionStream(`gzip`)),
  ).arrayBuffer()

// Two-frame XYZ, the smallest input that exercises multi-frame parsing
export const MULTI_FRAME_XYZ = `2\nStep 1\nH 0.0 0.0 0.0\nH 0.0 0.0 0.74
2\nStep 2\nH 0.0 0.0 0.0\nH 0.0 0.0 0.78`

// Factory for a trajectory frame with `site_count` hydrogen atoms along x.
// Pass `lattice_params` to attach a diagonal lattice (defaults: lengths 1, angles 90, volume 1).
export const make_trajectory_frame = (
  step: number,
  site_count = 3,
  metadata: Record<string, unknown> = {},
  lattice_params?: Record<string, number>,
): TrajectoryFrame => ({
  step,
  metadata,
  structure: {
    charge: 0,
    sites: Array.from({ length: site_count }, (_, idx) => ({
      species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
      xyz: [idx, 0, 0] as Vec3,
      abc: [idx / 10, 0, 0] as Vec3,
      label: `H${idx + 1}`,
      properties: {},
    })),
    ...(lattice_params && {
      lattice: {
        matrix: [
          [lattice_params.a || 1, 0, 0],
          [0, lattice_params.b || 1, 0],
          [0, 0, lattice_params.c || 1],
        ] as math.Matrix3x3,
        pbc: [true, true, true] as Pbc,
        a: lattice_params.a || 1,
        b: lattice_params.b || 1,
        c: lattice_params.c || 1,
        alpha: lattice_params.alpha || 90,
        beta: lattice_params.beta || 90,
        gamma: lattice_params.gamma || 90,
        volume: lattice_params.volume || 1,
      },
    }),
  },
})

// In-memory TrajectoryRun over make_trajectory_frame frames: `steps` is a step list or a frame
// count (steps 0..n-1); `frame_metadata(frame_idx)` fills each frame's metadata; the remaining
// options are forwarded to trajectory_from_frames (provenance, time_step, warnings, ...).
export const make_run = (
  steps: number | readonly number[] = 3,
  {
    site_count = 2,
    lattice_params,
    frame_metadata = () => ({}),
    ...extras
  }: MemoryRunExtras & {
    site_count?: number
    lattice_params?: Record<string, number>
    frame_metadata?: (frame_idx: number) => Record<string, unknown>
  } = {},
): TrajectoryRun => {
  const step_list =
    typeof steps === `number` ? Array.from({ length: steps }, (_unused, idx) => idx) : steps
  return trajectory_from_frames(
    step_list.map((step, frame_idx) =>
      make_trajectory_frame(step, site_count, frame_metadata(frame_idx), lattice_params),
    ),
    extras,
  )
}

// The same run with its plot rows replaced (and optionally a different frame_count), for
// panes that read sampled/progressive property rows rather than the frames
export const with_property_rows = (
  run: TrajectoryRun,
  rows: TrajectoryMetadata[],
  frame_count = run.frame_count,
): TrajectoryRun => ({ ...run, frame_count, properties: new TrajectoryProperties(rows, true) })

// Test data factory for creating mock structures. Site coords are deliberately
// inconsistent (abc all-zero, xyz spaced along x) and the default lattice is
// degenerate (all params 0) — tests only need distinguishable dummy objects.
export const get_dummy_structure = (
  element: ElementSymbol = `H`,
  atoms = 3,
  with_lattice = false,
): Crystal => ({
  sites: Array.from({ length: atoms }, (_, idx) => ({
    species: [{ element, occu: 1, oxidation_state: 0 }],
    abc: [0, 0, 0] as Vec3,
    xyz: [idx, 0, 0] as Vec3,
    label: `${element}${idx + 1}`,
    properties: {},
  })),
  lattice: {
    matrix: cubic_matrix(5),
    ...(with_lattice
      ? {
          pbc: [true, true, true] as Pbc,
          a: 5,
          b: 5,
          c: 5,
          volume: 125,
          alpha: 90,
          beta: 90,
          gamma: 90,
        }
      : {
          pbc: [false, false, false] as Pbc,
          a: 0,
          b: 0,
          c: 0,
          volume: 0,
          alpha: 0,
          beta: 0,
          gamma: 0,
        }),
  },
  charge: 0,
})

// Simplified site input for make_crystal helper
// Object notation: { element: `Li`, abc: [0, 0, 0], oxidation_state: 1 }
type SimpleSiteObject = {
  element: string // usually ElementSymbol but any string is allowed
  abc?: Vec3
  xyz?: Vec3
  occu?: number
  oxidation_state?: number
  label?: string
  properties?: Record<string, unknown>
}

// Tuple shorthand: [`Li`, [0, 0, 0]] or [`Li`, [0, 0, 0], 1] (with oxidation state)
export type SimpleSite = SimpleSiteObject | [string, Vec3, number?]

// Normalize tuple or object site input to object form
const normalize_site_input = (input: SimpleSite): SimpleSiteObject => {
  if (Array.isArray(input)) {
    const [element, abc, oxidation_state] = input
    return { element, abc, oxidation_state }
  }
  return input
}

// Flexible helper to create test structures with minimal boilerplate
// Handles auto-calculation of abc↔xyz, lattice params, and site defaults
export function make_crystal(
  lattice_input: number | math.Matrix3x3,
  site_inputs: SimpleSite[],
  options: { pbc?: Pbc; charge?: number } = {},
): Crystal {
  const lattice_matrix: math.Matrix3x3 =
    typeof lattice_input === `number` ? cubic_matrix(lattice_input) : lattice_input

  // Use standard pymatgen convention for frac↔cart conversion:
  // xyz = transpose(lattice) · abc, abc = inv(transpose(lattice)) · xyz
  // cart_to_frac inverts the matrix eagerly, so create it lazily to support
  // degenerate (singular) lattices as long as all sites pass abc coords
  const frac_to_cart = math.create_frac_to_cart(lattice_matrix)
  let cart_to_frac: ((vec: Vec3) => Vec3) | undefined
  const {
    a: lattice_a,
    b: lattice_b,
    c: lattice_c,
    alpha,
    beta,
    gamma,
    volume,
  } = math.calc_lattice_params(lattice_matrix)
  const pbc = options.pbc ?? [true, true, true]

  const sites: Site[] = site_inputs.map((raw_input, idx) => {
    const input = normalize_site_input(raw_input)
    const element = input.element as ElementSymbol
    // Calculate coordinates - abc takes precedence to ensure consistency
    let abc: Vec3
    let xyz: Vec3
    if (input.abc) {
      abc = input.abc
      xyz = frac_to_cart(abc)
    } else if (input.xyz) {
      xyz = input.xyz
      abc = (cart_to_frac ??= math.create_cart_to_frac(lattice_matrix))(xyz)
    } else {
      throw new Error(`Site ${idx} must have either abc or xyz coordinates`)
    }

    return {
      species: [
        {
          element,
          occu: input.occu ?? 1,
          oxidation_state: input.oxidation_state ?? 0,
        },
      ],
      abc,
      xyz,
      label: input.label ?? `${element}${idx}`,
      properties: input.properties ?? {},
    }
  })

  return {
    lattice: {
      matrix: lattice_matrix,
      pbc,
      a: lattice_a,
      b: lattice_b,
      c: lattice_c,
      alpha,
      beta,
      gamma,
      volume,
    },
    sites,
    ...(options.charge !== undefined && { charge: options.charge }),
  }
}

// Cubic crystal from xyz-only sites (element defaults to C, label to the element symbol)
export const make_struct = (
  sites: { xyz: Vec3; element?: ElementSymbol }[],
  lattice_const = 10,
): Crystal =>
  make_crystal(
    lattice_const,
    sites.map(({ xyz, element = `C` }) => ({ element, xyz, label: element })),
  )

// Lattice-free structure from [element, xyz] pairs; abc is meaningless without a cell
export const make_molecule = (atoms: [string, Vec3][]): Molecule => ({
  sites: atoms.map(([element, xyz], idx) => ({
    species: [{ element: element as ElementSymbol, occu: 1, oxidation_state: 0 }],
    abc: [0, 0, 0] as Vec3,
    xyz,
    label: `${element}${idx}`,
    properties: {},
  })),
})

// Conventional rocksalt NaCl cell (4 Na + 4 Cl): every ion octahedrally coordinated by 6
// counter-ions, only 3 of which sit inside the box (the rest are periodic images)
export const make_rocksalt = (lattice_const = 5.64): Crystal =>
  make_crystal(lattice_const, [
    [`Na`, [0, 0, 0]],
    [`Na`, [0.5, 0.5, 0]],
    [`Na`, [0.5, 0, 0.5]],
    [`Na`, [0, 0.5, 0.5]],
    [`Cl`, [0.5, 0, 0]],
    [`Cl`, [0, 0.5, 0]],
    [`Cl`, [0, 0, 0.5]],
    [`Cl`, [0.5, 0.5, 0.5]],
  ])

// Trajectory frame with sites at explicit Cartesian coordinates. With `box_length` the
// structure is a cubic crystal (abc derived); without one it is a molecule, so there is no
// lattice to unwrap against. Per-site `velocities` land in site.properties.velocity.
export const make_frame = (
  step: number,
  xyz_list: number[][],
  options: {
    elements?: ElementSymbol[]
    box_length?: number
    coords_unwrapped?: boolean
    velocities?: (number[] | undefined)[]
  } = {},
): TrajectoryFrame => {
  const { box_length, coords_unwrapped, elements, velocities } = options
  const crystal = make_crystal(
    box_length ?? 1,
    xyz_list.map((xyz, idx) => ({
      element: elements?.[idx] ?? `H`,
      xyz: xyz as Vec3,
      ...(velocities?.[idx] && { properties: { velocity: velocities[idx] } }),
    })),
    { charge: 0 },
  )
  return {
    step,
    structure: box_length ? crystal : { charge: 0, sites: crystal.sites },
    ...(coords_unwrapped === undefined ? {} : { metadata: { coords_unwrapped } }),
  }
}

// Position stream laid out frame-major: positions[(frame * n_atoms + atom) * 3 + axis].
// Defaults to a 10 A cubic cell per frame with full pbc and wrapped coords.
export const make_position_stream = (
  frames: number[][][], // [frame][atom][axis]
  elements: ElementSymbol[],
  overrides: Partial<TrajectoryPositionStream> = {},
): TrajectoryPositionStream => {
  const n_frames = frames.length
  const n_atoms = elements.length
  const positions = new Float64Array(n_frames * n_atoms * 3)
  for (const [frame_idx, frame] of frames.entries()) {
    for (const [atom_idx, xyz] of frame.entries()) {
      positions.set(xyz, (frame_idx * n_atoms + atom_idx) * 3)
    }
  }
  return {
    positions,
    n_frames,
    n_atoms,
    elements,
    lattice_matrices: Array.from({ length: n_frames }, () => cubic_matrix(10)),
    pbc: [true, true, true],
    coords_unwrapped: false,
    frame_stride: 1,
    steps: Array.from({ length: n_frames }, (_, idx) => idx),
    ...overrides,
  }
}

// Shared 3x3 matrix fixtures
export const IDENTITY_MATRIX3: math.Matrix3x3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

// Diagonal cubic lattice matrix with edge length `a`
export const cubic_matrix = (lattice_a: number): math.Matrix3x3 => [
  [lattice_a, 0, 0],
  [0, lattice_a, 0],
  [0, 0, lattice_a],
]

// Primitive fcc cell of the conventional cubic cell with edge `a` (the 1-atom Cu / 2-atom
// diamond input that moyo standardizes to the 4-/8-atom conventional cell)
export const fcc_primitive_matrix = (value_a: number): math.Matrix3x3 => [
  [0, value_a / 2, value_a / 2],
  [value_a / 2, 0, value_a / 2],
  [value_a / 2, value_a / 2, 0],
]

// === Fermi surface fixtures ===
// Typed-array FermiIsosurface from plain vertex rows and N-gon faces (fan-triangulated like
// the JSON parser); normals all point +z
export const make_fermi_isosurface = (
  vertices: Vec3[],
  faces: number[][],
  extra: Partial<FermiIsosurface> = {},
): FermiIsosurface => ({
  positions: Float32Array.from(vertices.flat()),
  indices: Uint32Array.from(
    faces.flatMap((face) =>
      Array.from({ length: Math.max(face.length - 2, 0) }, (_, fan) => [
        face[0],
        face[fan + 1],
        face[fan + 2],
      ]).flat(),
    ),
  ),
  normals: Float32Array.from(vertices.flatMap(() => [0, 0, 1])),
  band_index: 0,
  spin: null,
  ...extra,
})

// FermiSurfaceData around `isosurfaces` with an identity k-lattice
export const make_fermi_surface = (
  isosurfaces: FermiIsosurface[],
  extra: Partial<FermiSurfaceData> = {},
): FermiSurfaceData => ({
  isosurfaces,
  k_lattice: IDENTITY_MATRIX3,
  fermi_energy: 0,
  reciprocal_cell: `wigner_seitz`,
  metadata: {
    n_bands: new Set(isosurfaces.map((iso) => iso.band_index)).size,
    n_surfaces: isosurfaces.length,
  },
  ...extra,
})

// Thin box: a unit square sheet at z=0 extruded to z=0.1, as 12 triangles
export const BOX_VERTICES: Vec3[] = [
  [-0.5, -0.5, 0],
  [0.5, -0.5, 0],
  [0.5, 0.5, 0],
  [-0.5, 0.5, 0],
  [-0.5, -0.5, 0.1],
  [0.5, -0.5, 0.1],
  [0.5, 0.5, 0.1],
  [-0.5, 0.5, 0.1],
]
// oxfmt-ignore
export const BOX_TRI_FACES = [
  [0, 1, 2], [0, 2, 3], // bottom
  [4, 6, 5], [4, 7, 6], // top
  [0, 4, 5], [0, 5, 1], // front
  [2, 6, 7], [2, 7, 3], // back
  [0, 3, 7], [0, 7, 4], // left
  [1, 5, 6], [1, 6, 2], // right
]

// 3×3×3 single-band BXSF grid on an identity reciprocal lattice; the centre point is the 8.0
// maximum and the `# Fermi energy` header comment carries `fermi_energy`
export const make_bxsf = (fermi_energy = 7) =>
  `# Sample BXSF file\n# Fermi energy: ${fermi_energy} eV\n\nBEGIN_BLOCK_BANDGRID_3D\n  band_energies\n  BEGIN_BANDGRID_3D\n    1\n    3 3 3\n    0.0 0.0 0.0\n    1.0 0.0 0.0\n    0.0 1.0 0.0\n    0.0 0.0 1.0\n    BAND:   1\n    5.0 6.0 5.0\n    6.0 7.0 6.0\n    5.0 6.0 5.0\n    6.0 7.0 6.0\n    7.0 8.0 7.0\n    6.0 7.0 6.0\n    5.0 6.0 5.0\n    6.0 7.0 6.0\n    5.0 6.0 5.0\n  END_BANDGRID_3D\nEND_BLOCK_BANDGRID_3D\n`

// Encode a 3x3 matrix as a flat 9-array in COLUMN-major order — how moyo/nalgebra serialize
// rotation matrices on the wire (inverse of mat3_from_flat_col_major in symmetry-elements).
export const col_major = (mat: math.Matrix3x3): number[] => {
  const [
    [value_a_1, value_a_2, value_a_3],
    [value_a_4, value_a_5, value_a_6],
    [value_a_7, value_a_8, value_a_9],
  ] = mat
  return [
    value_a_1,
    value_a_4,
    value_a_7,
    value_a_2,
    value_a_5,
    value_a_8,
    value_a_3,
    value_a_6,
    value_a_9,
  ]
}

// Build an orbit-path SymmetryDataset mock from std-cell-aligned fields. The input cell is
// taken to equal the std cell (identity std_linear) and sites are grouped into orbits by
// shared Wyckoff letter + element — the same grouping the production orbit path applies, so
// these mocks exercise wyckoff_rows_from_input_orbits with hand-computed expectations.
export const make_wyckoff_dataset = (
  positions: number[][],
  numbers: number[],
  wyckoffs: (string | null)[],
  orig_site_indices_by_input_idx?: number[][],
): SymmetryDataset => {
  const letter = (idx: number) => /[a-z]+$/.exec(wyckoffs[idx] ?? ``)?.[0] ?? null
  // Orbit representative = first site sharing this letter + element (null letter ⇒ own orbit)
  const orbits = wyckoffs.map((_unused_width_value, idx) =>
    letter(idx) === null
      ? idx
      : wyckoffs.findIndex(
          (_unused_value, jdx) => letter(jdx) === letter(idx) && numbers[jdx] === numbers[idx],
        ),
  )
  return {
    std_cell: { positions, numbers },
    input_cell: { positions, numbers },
    wyckoffs: wyckoffs.map((wyckoff) => wyckoff ?? ``),
    orbits,
    std_linear: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    orig_site_indices_by_input_idx:
      orig_site_indices_by_input_idx ?? positions.map((_pos, idx) => [idx]),
  } as unknown as SymmetryDataset
}

// Test structure fixtures
export const simple_structure: AnyStructure = {
  id: `test_h2o`,
  sites: [
    {
      species: [{ element: `H`, occu: 1, oxidation_state: 1 }],
      xyz: [0.757, 0.586, 0.0],
      abc: [0.0757, 0.0586, 0.0],
      label: `H`,
      properties: {},
    },
    {
      species: [{ element: `O`, occu: 1, oxidation_state: -2 }],
      xyz: [0.0, 0.0, 0.0],
      abc: [0.0, 0.0, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{ element: `H`, occu: 1, oxidation_state: 1 }],
      xyz: [-0.757, 0.586, 0.0],
      abc: [-0.0757, 0.0586, 0.0],
      label: `H`,
      properties: {},
    },
  ],
  lattice: {
    matrix: [
      [10.0, 0.0, 0.0],
      [0.0, 10.0, 0.0],
      [0.0, 0.0, 10.0],
    ],
    pbc: [true, true, true],
    a: 10.0,
    b: 10.0,
    c: 10.0,
    alpha: 90.0,
    beta: 90.0,
    gamma: 90.0,
    volume: 1000.0,
  },
}

export const complex_structure: AnyStructure = {
  id: `test_complex`,
  sites: [
    {
      species: [{ element: `Li`, occu: 1, oxidation_state: 1 }],
      xyz: [0.0, 0.0, 0.0],
      abc: [0.0, 0.0, 0.0],
      label: `Li`,
      properties: {},
    },
    {
      species: [{ element: `Fe`, occu: 1, oxidation_state: 2 }],
      xyz: [2.5, 0.0, 0.0],
      abc: [0.5, 0.0, 0.0],
      label: `Fe`,
      properties: {},
    },
    {
      species: [{ element: `P`, occu: 1, oxidation_state: 5 }],
      xyz: [0.0, 2.5, 0.0],
      abc: [0.0, 0.5, 0.0],
      label: `P`,
      properties: {},
    },
    {
      species: [{ element: `O`, occu: 1, oxidation_state: -2 }],
      xyz: [1.25, 1.25, 0.0],
      abc: [0.25, 0.25, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{ element: `O`, occu: 1, oxidation_state: -2 }],
      xyz: [3.75, 1.25, 0.0],
      abc: [0.75, 0.25, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{ element: `O`, occu: 1, oxidation_state: -2 }],
      xyz: [1.25, 3.75, 0.0],
      abc: [0.25, 0.75, 0.0],
      label: `O`,
      properties: {},
    },
    {
      species: [{ element: `O`, occu: 1, oxidation_state: -2 }],
      xyz: [3.75, 3.75, 0.0],
      abc: [0.75, 0.75, 0.0],
      label: `O`,
      properties: {},
    },
  ],
  lattice: {
    matrix: [
      [5.0, 0.0, 0.0],
      [0.0, 5.0, 0.0],
      [0.0, 0.0, 5.0],
    ],
    pbc: [true, true, true],
    a: 5.0,
    b: 5.0,
    c: 5.0,
    alpha: 90.0,
    beta: 90.0,
    gamma: 90.0,
    volume: 125.0,
  },
}
