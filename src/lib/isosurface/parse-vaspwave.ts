// Parser for VASP vaspwave.h5 charge density: charge/charge on charge/grid
// plus the embedded structure under structure/positions (dataset paths follow
// ferrox's VASPWAVE_* constants / py4vasp's VASP 6.x schema). Full files are
// hundreds of MB, so embedding hosts are expected to prune them server-side
// first; this parser sees only charge/{charge,grid} + structure/positions.
//
// Prototype scope: charge (+ magnetization) isosurfaces only — wavefunctions
// are out of scope. The "charge density RMS per SCF step" convergence signal
// is already covered by OSZICAR's rms(c) column in the vaspout.h5 parser
// (scf_charge_rms frame metadata); diffing charge grids between live reloads
// is explicitly out of scope here.
import { calc_lattice_params, create_frac_to_cart, type Vec3 } from '$lib/math'
import type { Site } from '$lib/structure'
import type { ParsedStructure } from '$lib/structure/parse'
import { wrap_to_unit_cell } from '$lib/structure/pbc'
import { make_site } from '$lib/structure/site'
import type * as h5wasm from 'h5wasm'
import { validate_3x3_matrix } from '$lib/trajectory/helpers'
import {
  expand_ion_types,
  is_hdf5_dataset,
  read_dataset,
  scale_matrix,
  to_number_array,
  to_scalar_number,
  to_string_array,
  with_h5_file,
} from '$lib/trajectory/parse/h5-utils'
import { grid_data_range } from './types'
import type { VolumetricData, VolumetricFileData } from './types'

const CHARGE_PATH = `charge/charge`
const CHARGE_GRID_PATH = `charge/grid`
const STRUCTURE_PREFIX = `structure/positions`

// vaspwave carries charge density/wavefunctions, never a trajectory — used by
// file-open routing to divert from the HDF5 trajectory dispatcher.
export const is_vaspwave_filename = (filename: string): boolean => {
  const basename = filename.split(`/`).pop() ?? filename
  return /vaspwave.*\.(?:h5|hdf5)$/i.test(basename)
}

const dataset_shape = (h5_file: h5wasm.File, path: string): number[] | null => {
  const entity = h5_file.get(path)
  return is_hdf5_dataset(entity) ? (entity.shape ?? null) : null
}

const read_embedded_structure = (
  h5_file: h5wasm.File,
): ParsedStructure & { lattice: NonNullable<ParsedStructure[`lattice`]> } => {
  const lattice_data = read_dataset(h5_file, `${STRUCTURE_PREFIX}/lattice_vectors`)
  if (!lattice_data) {
    throw new Error(
      `vaspwave.h5 has no embedded structure (${STRUCTURE_PREFIX}/lattice_vectors) — ` +
        `cannot place the charge grid in a lattice`,
    )
  }
  const scale = to_scalar_number(read_dataset(h5_file, `${STRUCTURE_PREFIX}/scale`)) ?? 1
  const lattice = scale_matrix(validate_3x3_matrix(lattice_data), scale)

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
// dataset [nx, ny, nz] disambiguates (same logic as ferrox's
// volumetric_grid_shape_and_order — when nx == nz both layouts match, so
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

function parse_vaspwave_charge_file(h5_file: h5wasm.File): VolumetricFileData {
  const shape = dataset_shape(h5_file, CHARGE_PATH)
  if (!shape) {
    throw new Error(`vaspwave.h5 file has no charge density (missing ${CHARGE_PATH})`)
  }
  if (shape.length !== 4) {
    throw new Error(`${CHARGE_PATH} must have shape [components, nx, ny, nz], got [${shape}]`)
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
  const [nx, ny, nz] = grid_dims

  const structure = read_embedded_structure(h5_file)
  const lattice = structure.lattice.matrix

  const charge_data = read_dataset(h5_file, CHARGE_PATH) as number[][][][] | null
  if (!charge_data) throw new Error(`Failed to read ${CHARGE_PATH} data`)

  const component_labels = [`charge density`, `magnetization density`]
  const volumes: VolumetricData[] = charge_data
    .slice(0, n_components)
    .map((component, component_idx) => {
      const grid: number[][][] = Array(nx)
      for (let x_idx = 0; x_idx < nx; x_idx++) {
        const plane: number[][] = Array(ny)
        for (let y_idx = 0; y_idx < ny; y_idx++) {
          const row: number[] = Array(nz)
          for (let z_idx = 0; z_idx < nz; z_idx++) {
            row[z_idx] =
              axis_order === `zyx`
                ? component[z_idx][y_idx][x_idx]
                : component[x_idx][y_idx][z_idx]
          }
          plane[y_idx] = row
        }
        grid[x_idx] = plane
      }
      return {
        grid,
        grid_dims: [nx, ny, nz] as Vec3,
        lattice,
        origin: [0, 0, 0] as Vec3,
        data_range: grid_data_range(grid),
        data_order: `x_fastest` as const,
        periodic: true,
        label: component_labels[component_idx],
      }
    })

  return { structure, volumes }
}

export async function parse_vaspwave_charge(
  buffer: ArrayBuffer,
  filename?: string,
): Promise<VolumetricFileData> {
  return with_h5_file(buffer, filename, parse_vaspwave_charge_file)
}
