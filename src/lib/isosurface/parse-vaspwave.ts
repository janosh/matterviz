// Parser for VASP vaspwave.h5 charge (+ magnetization) density: charge/{charge,grid} plus the
// structure under structure/positions (py4vasp's VASP 6.x schema). Full files run to hundreds
// of MB, so hosts prune them to these datasets first. Wavefunctions are out of scope.
import { calc_lattice_params, create_frac_to_cart, type Vec3 } from '#lib/math.js'
import type { Crystal, Site } from '#lib/structure/index.js'
import { wrap_to_unit_cell } from '#lib/structure/pbc.js'
import { make_site } from '#lib/structure/site.js'
import type * as h5wasm from 'h5wasm'
import { expand_ion_types } from '#lib/trajectory/helpers.js'
import {
  is_hdf5_dataset,
  read_dataset,
  read_scaled_lattice,
  squeeze_leading_axis,
  to_number_array,
  to_string_array,
  with_h5_file,
} from '#lib/trajectory/parse/h5-utils.js'
import { transpose_x_fastest } from './grid'
import { VASP_BLOCK_LABELS } from './parse'
import { make_volume, type VolumetricData, type VolumetricFileData } from './types'

export { is_vaspwave_filename } from '#lib/constants.js'

const CHARGE_PATH = `charge/charge`
const CHARGE_GRID_PATH = `charge/grid`
const STRUCTURE_PREFIX = `structure/positions`

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

  // Missing ions give an empty cell (the isosurface needs only the lattice), torn ones throw
  const sites: Site[] = []
  const ion_types = to_string_array(read_dataset(h5_file, `${STRUCTURE_PREFIX}/ion_types`))
  const ion_counts = to_number_array(
    read_dataset(h5_file, `${STRUCTURE_PREFIX}/number_ion_types`),
  )
  // [1, n, 3] carries the leading step axis read_scaled_lattice squeezes off the lattice too
  const positions_path = `${STRUCTURE_PREFIX}/position_ions`
  const frac_positions = squeeze_leading_axis(read_dataset(h5_file, positions_path)) as
    | number[][]
    | null
  if (ion_types && ion_counts && frac_positions) {
    const elements = expand_ion_types(ion_types, ion_counts)
    if (frac_positions.length !== elements.length) {
      throw new Error(
        `${positions_path} holds ${frac_positions.length} positions for ${elements.length} ions`,
      )
    }
    const frac_to_cart = create_frac_to_cart(lattice)
    for (const [site_idx, element] of elements.entries()) {
      const frac = frac_positions[site_idx]
      if (!Array.isArray(frac) || frac.length < 3) {
        throw new Error(`${positions_path} row ${site_idx + 1} is not an xyz position`)
      }
      const abc = wrap_to_unit_cell(frac.slice(0, 3) as Vec3)
      sites.push(make_site(element, abc, frac_to_cart(abc), `${element}${site_idx + 1}`))
    }
  }

  return {
    sites,
    lattice: { matrix: lattice, pbc: [true, true, true], ...calc_lattice_params(lattice) },
  }
}

// VASP writes C-order [components, nz, ny, nx]; the grid dataset [nx, ny, nz] disambiguates
// (when nx == nz both layouts match, so default to the canonical zyx)
const charge_axis_order = (spatial_shape: number[], grid_dims: number[]): `zyx` | `xyz` => {
  const [size_x, size_y, size_z] = grid_dims
  const matches = (dims: number[]) => dims.every((dim, idx) => dim === spatial_shape[idx])
  if (matches([size_z, size_y, size_x])) return `zyx`
  if (matches([size_x, size_y, size_z])) return `xyz`
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
  // Only the rank here; charge_axis_order resolves the spatial axis order
  if (shape.length !== 4) {
    throw new Error(`${CHARGE_PATH} must have 4 dimensions, got [${shape}]`)
  }
  // charge, then magnetization: one component (collinear spin) or m_x, m_y, m_z (noncollinear)
  const n_components = shape[0]
  const component_labels = VASP_BLOCK_LABELS.density[n_components]
  if (!component_labels) {
    throw new Error(
      `${CHARGE_PATH} has unsupported component count ${n_components}; expected 1 ` +
        `(non-spin-polarized), 2 (total + magnetization) or 4 (noncollinear)`,
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
  // Shape and decoded data can disagree in torn files: fail instead of dropping components
  if (charge_data.length !== n_components * points_per_component) {
    throw new Error(
      `${CHARGE_PATH} decoded ${charge_data.length} values but its shape [${shape}] claims ${n_components * points_per_component}`,
    )
  }

  // vaspwave.h5 stores the same rho * V_cell grid VASP writes to CHGCAR, so divide by
  // the cell volume (|det|) to get e/A^3 like parse_chgcar does
  const cell_volume = structure.lattice.volume
  if (!(cell_volume > 0))
    throw new Error(`vaspwave.h5 lattice has no volume; cannot normalize ${CHARGE_PATH}`)

  const volumes: VolumetricData[] = Array.from(
    { length: n_components },
    (_, component_idx) => {
      const base = component_idx * points_per_component
      const component = charge_data.subarray(base, base + points_per_component)
      // zyx in C order is x fastest, the same layout CHGCAR uses
      const values =
        axis_order === `xyz`
          ? Float64Array.from(component, (val) => val / cell_volume)
          : transpose_x_fastest(component, dims, cell_volume)
      return make_volume(values, dims, {
        id: component_labels[component_idx],
        lattice,
        origin: [0, 0, 0],
        periodic: true,
        label: component_labels[component_idx],
      })
    },
  )

  return { structure, volumes }
}

export const parse_vaspwave_charge = async (
  buffer: ArrayBuffer,
  filename?: string,
): Promise<VolumetricFileData> => with_h5_file(buffer, filename, parse_vaspwave_charge_file)
