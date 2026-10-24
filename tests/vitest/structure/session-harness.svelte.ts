// A real StructureSession over one plain $state host, wired the way Structure.svelte binds it:
// tests drive the host's fields and read back what the session writes to them
import type {
  AnyStructure,
  BondEditMode,
  BondOrder,
  MeasureMode,
  StructureBond,
} from '#lib/structure/index.js'
import type { AtomColorConfig } from '#lib/structure/atom-properties.js'
import { DEFAULT_ATOM_COLOR_CONFIG } from '#lib/structure/atom-properties.js'
import type { ImageAtomCompletion } from '#lib/structure/pbc.js'
import type { ResolvedPolyhedraOptions } from '#lib/structure/polyhedra.js'
import { StructureSession } from '#lib/structure/session.svelte.js'
import type { CellType, SymmetryDataset } from '#lib/symmetry/index.js'
import { flushSync } from 'svelte'
import { onTestFinished } from 'vitest'
import { get_dummy_structure, image_options } from '../test-fixtures'

export type SessionHost = {
  structure: AnyStructure | undefined
  bonds: StructureBond[] | undefined
  series_key: unknown
  selected_sites: number[]
  measured_sites: number[]
  highlighted_sites: number[]
  hovered_site_idx: number | null
  measure_mode: MeasureMode
  bond_edit_mode: BondEditMode
  bond_edit_order: BondOrder
  supercell_scaling: string
  apply_supercell_scaling: boolean
  show_image_atoms: boolean
  image_atom_completion: ImageAtomCompletion
  polyhedra_options: Partial<ResolvedPolyhedraOptions>
  cell_type: CellType
  sym_data: SymmetryDataset | null
  atom_color_config: AtomColorConfig
  site_properties?: Record<string, unknown>[]
}

export const crystal = (atoms = 3): AnyStructure => get_dummy_structure(`H`, atoms, true)

export function make_session(
  initial: Partial<SessionHost> = {},
  read_structure?: () => AnyStructure,
): { host: SessionHost; session: StructureSession; notices: string[] } {
  const host = $state<SessionHost>({
    structure: crystal(),
    bonds: undefined,
    series_key: undefined,
    selected_sites: [],
    measured_sites: [],
    highlighted_sites: [],
    hovered_site_idx: null,
    measure_mode: `distance`,
    bond_edit_mode: `add`,
    bond_edit_order: 1,
    supercell_scaling: `1x1x1`,
    apply_supercell_scaling: true,
    show_image_atoms: false,
    image_atom_completion: `polyhedra`,
    polyhedra_options: {},
    cell_type: `original`,
    sym_data: null,
    atom_color_config: DEFAULT_ATOM_COLOR_CONFIG,
    ...initial,
  })
  const notices: string[] = []
  // A block body: an arrow returning `host[key] = value` makes Svelte warn assignment_value_stale
  const set =
    <Key extends keyof SessionHost>(key: Key) =>
    (value: SessionHost[Key]): void => {
      host[key] = value
    }
  let session: StructureSession | undefined
  const destroy = $effect.root(() => {
    session = new StructureSession({
      structure: read_structure ?? (() => host.structure),
      site_properties: () => host.site_properties,
      set_structure: set(`structure`),
      bonds: () => host.bonds,
      set_bonds: set(`bonds`),
      series_key: () => host.series_key ?? host.structure,
      selected_sites: () => host.selected_sites,
      set_selected_sites: set(`selected_sites`),
      measured_sites: () => host.measured_sites,
      set_measured_sites: set(`measured_sites`),
      highlighted_sites: () => host.highlighted_sites,
      set_highlighted_sites: set(`highlighted_sites`),
      hovered_site_idx: () => host.hovered_site_idx,
      set_hovered_site_idx: set(`hovered_site_idx`),
      measure_mode: () => host.measure_mode,
      set_measure_mode: set(`measure_mode`),
      bond_edit_mode: () => host.bond_edit_mode,
      set_bond_edit_mode: set(`bond_edit_mode`),
      bond_edit_order: () => host.bond_edit_order,
      set_bond_edit_order: set(`bond_edit_order`),
      supercell_scaling: () => host.supercell_scaling,
      apply_supercell_scaling: () => host.apply_supercell_scaling,
      show_image_atoms: () => host.show_image_atoms,
      image_atom_options: () =>
        image_options(host.image_atom_completion, host.polyhedra_options),
      cell_type: () => host.cell_type,
      set_cell_type: set(`cell_type`),
      sym_data: () => host.sym_data,
      atom_color_config: () => host.atom_color_config,
      bonding_strategy: () => `electroneg_ratio`,
      on_notice: (message) => notices.push(message),
    })
  })
  onTestFinished(destroy)
  if (!session) throw new Error(`$effect.root did not create the StructureSession`)
  flushSync()
  return { host, session, notices }
}

// Write `patch` onto a $state host and flush, as one host-side change
export const flush_set = <Host extends object>(host: Host, patch: Partial<Host>): void => {
  Object.assign(host, patch)
  flushSync()
}
