// Parser for VASP vaspwave.h5 charge density: charge/charge on charge/grid
// plus the embedded structure under structure/positions (dataset paths follow
// py4vasp's VASP 6.x schema). Full files are hundreds of MB, so embedding hosts
// are expected to prune them server-side first; this parser sees only
// charge/{charge,grid} + structure/positions.
//
// Prototype scope: charge (+ magnetization) isosurfaces only — wavefunctions
// are out of scope. The "charge density RMS per SCF step" convergence signal
// is already covered by OSZICAR's rms(c) column in the vaspout.h5 parser
// (scf_charge_rms frame metadata); diffing charge grids between live reloads
// is explicitly out of scope here.
import { HDF5_EXT_REGEX } from '$lib/constants'
import { calc_lattice_params, create_frac_to_cart, type Vec3 } from '$lib/math'
import type { Crystal, Site } from '$lib/structure'
import { wrap_to_unit_cell } from '$lib/structure/pbc'
import { make_site } from '$lib/structure/site'
import type * as h5wasm from 'h5wasm'
import { expand_ion_types } from '$lib/trajectory/helpers'
import {
  is_hdf5_dataset,
  read_dataset,
  read_scaled_lattice,
  to_number_array,
  to_string_array,
  with_h5_file,
} from '$lib/trajectory/parse/h5-utils'
import { transpose_x_fastest } from './grid'
import { make_volume, type VolumetricData, type VolumetricFileData } from './types'

const CHARGE_PATH = `charge/charge`
const CHARGE_GRID_PATH = `charge/grid`
const STRUCTURE_PREFIX = `structure/positions`

// vaspwave carries charge density/wavefunctions, never a trajectory — used by
// file-open routing to divert from the HDF5 trajectory dispatcher.
export const is_vaspwave_filename = (filename: string): boolean => {
  const basename = filename.split(`/`).pop() ?? filename
  return /vaspwave/i.test(basename) && HDF5_EXT_REGEX.test(basename)
}

const read_embedded_structure = (h5_file: h5wasm.File): Crystal => {
  // read_scaled_lattice squeezes the optional leading singleton step axis ([1, 3, 3]) some
  // VASP versions write, which the raw read rejected even though the trajectory reader opens it
  const lattice = read_scaled_lattice(
    h5_file,
    `${STRUCTURE_PREFIX}/lattice_vectors`,
    `${STRUCTURE_PREFIX}/scale`,
  )
  if (!lattice) {
    throw new Error(
      `vaspwave.h5 has no embedded structure (${STRUCTURE_PREFIX}/lattice_vectors) — ` +
        `cannot place the charge grid in a lattice`,
    )
  }

  // Sites are optional for rendering (the isosurface needs only the lattice),
  // so a pruned/torn file missing ion data still opens with an empty cell.
  const sites: Site[] = []
  const ion_types = to_string_array(read_dataset(h5_file, `${STRUCTURE_PREFIX}/ion_types`))
  const ion_counts = to_number_array(
    read_dataset(h5_file, `${STRUCTURE_PREFIX}/number_ion_types`),
  )
  const frac_positions = read_dataset(h5_file, `${STRUCTURE_PREFIX}/position_ions`) as
    | number[][]
    | null
  if (ion_types && ion_counts && frac_positions && ion_types.length === ion_counts.length) {
    const elements = expand_ion_types(ion_types, ion_counts)
    const frac_to_cart = create_frac_to_cart(lattice)
    for (const [site_idx, element] of elements.entries()) {
      const frac = frac_positions[site_idx]
      if (!Array.isArray(frac) || frac.length < 3) break // torn positions: keep what parsed
      const abc = wrap_to_unit_cell(frac.slice(0, 3) as Vec3)
      sites.push(make_site(element, abc, frac_to_cart(abc), `${element}${site_idx + 1}`))
    }
  }

  return {
    sites,
    lattice: { matrix: lattice, pbc: [true, true, true], ...calc_lattice_params(lattice) },
  }
}

// VASP writes volumetric data C-order [components, nz, ny, nx]; the grid
// dataset [nx, ny, nz] disambiguates (when nx == nz both layouts match, so
// default to the canonical zyx order).
const charge_axis_order = (spatial_shape: number[], grid_dims: number[]): `zyx` | `xyz` => {
  const [nx, ny, nz] = grid_dims
  const matches = (dims: number[]) => dims.every((dim, idx) => dim === spatial_shape[idx])
  if (matches([nz, ny, nx])) return `zyx`
  if (matches([nx, ny, nz])) return `xyz`
  throw new Error(
    `vaspwave.h5 ${CHARGE_GRID_PATH} [${grid_dims}] is incompatible with ` +
      `${CHARGE_PATH} spatial shape [${spatial_shape}]`,
  )
}

// Any numeric typed array (h5wasm decodes float and integer datasets into one)
type NumericArray = ArrayLike<number> & {
  subarray(begin: number, end: number): ArrayLike<number>
}
const is_numeric_array = (value: unknown): value is NumericArray =>
  ArrayBuffer.isView(value) && !(value instanceof DataView)

function parse_vaspwave_charge_file(h5_file: h5wasm.File): VolumetricFileData {
  const charge_entity = h5_file.get(CHARGE_PATH)
  if (!is_hdf5_dataset(charge_entity) || !charge_entity.shape) {
    throw new Error(`vaspwave.h5 file has no charge density (missing ${CHARGE_PATH})`)
  }
  const shape = charge_entity.shape
  // Only the dimension count is checked here — the spatial axis order (zyx vs
  // xyz) is disambiguated later by charge_axis_order against CHARGE_GRID_PATH.
  if (shape.length !== 4) {
    throw new Error(`${CHARGE_PATH} must have 4 dimensions, got [${shape}]`)
  }
  const n_components = shape[0]
  if (n_components < 1 || n_components > 2) {
    throw new Error(
      `${CHARGE_PATH} has unsupported component count ${n_components}; expected 1 ` +
        `(non-spin-polarized) or 2 (total + magnetization)`,
    )
  }
  const grid_dims = to_number_array(read_dataset(h5_file, CHARGE_GRID_PATH))
  if (grid_dims?.length !== 3) {
    throw new Error(
      `vaspwave.h5 is missing ${CHARGE_GRID_PATH}; cannot determine the axis order of ${CHARGE_PATH}`,
    )
  }
  const axis_order = charge_axis_order(shape.slice(1), grid_dims)
  const dims: Vec3 = [grid_dims[0], grid_dims[1], grid_dims[2]]
  const points_per_component = dims[0] * dims[1] * dims[2]

  const structure = read_embedded_structure(h5_file)
  const lattice = structure.lattice.matrix

  // The flat dataset buffer, C order [component][axis0][axis1][axis2]
  const charge_data = charge_entity.value
  if (!is_numeric_array(charge_data)) throw new Error(`Failed to read ${CHARGE_PATH} data`)
  // Metadata shape and decoded data can disagree in torn/corrupt files — fail
  // loudly instead of silently rendering fewer components than the file claims
  if (charge_data.length !== n_components * points_per_component) {
    throw new Error(
      `${CHARGE_PATH} decoded ${charge_data.length} values but its shape [${shape}] claims ${n_components * points_per_component}`,
    )
  }

  // vaspwave.h5 stores the same rho * V_cell grid VASP writes to CHGCAR, so divide by
  // the cell volume to get e/A^3 like parse_chgcar does
  const cell_volume = Math.abs(structure.lattice.volume)
  const divisor = cell_volume > 1e-30 ? cell_volume : 1

  const component_labels = [`charge density`, `magnetization density`]
  const volumes: VolumetricData[] = Array.from(
    { length: n_components },
    (_, component_idx) => {
      const base = component_idx * points_per_component
      const component = charge_data.subarray(base, base + points_per_component)
      // zyx in C order is x fastest, the same layout CHGCAR uses
      const values =
        axis_order === `xyz`
          ? Float64Array.from(component, (val) => val / divisor)
          : transpose_x_fastest(component, dims, divisor)
      return make_volume(values, dims, {
        lattice,
        origin: [0, 0, 0],
        periodic: true,
        label: component_labels[component_idx],
      })
    },
  )

  return { structure, volumes }
}

export async function parse_vaspwave_charge(
  buffer: ArrayBuffer,
  filename?: string,
): Promise<VolumetricFileData> {
  return with_h5_file(buffer, filename, parse_vaspwave_charge_file)
}
