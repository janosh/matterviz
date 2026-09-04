// Headless viewer state over a borrowed structure: the display pipeline (normalize → bonds →
// cell transform → supercell → element map + image atoms), site selection validated against
// what is on screen, edit-atoms and edit-bonds state with undo/redo, and the multi-pane camera
// bookkeeping. No DOM, so it is unit-testable on its own; Structure.svelte renders what it
// exposes and StructureViewport binds the scene to it.
import type { ElementSymbol } from '$lib/element'
import { coerce_elem_symbol } from '$lib/element'
import { format_num, plural } from '$lib/labels'
import type { Vec3 } from '$lib/math'
import { create_cart_to_frac, create_frac_to_cart } from '$lib/math'
import type { CellType, SymmetryDataset, WyckoffPos } from '$lib/symmetry'
import {
  map_wyckoff_to_all_atoms,
  transform_cell,
  wyckoff_positions_from_moyo,
} from '$lib/symmetry'
import { to_error } from '$lib/utils'
import { untrack } from 'svelte'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import type { AtomColorConfig, AtomPropertyColors } from './atom-properties'
import { get_property_colors } from './atom-properties'
import type { BondingStrategy } from './bonding'
import { merge_bond_edits, remap_bonds_after_deletion } from './bonding'
import type {
  AnyStructure,
  BondEditMode,
  BondOrder,
  Crystal,
  MeasureMode,
  Site,
  StructureBond,
} from './index'
import { normalize_fractional_coords } from './parse'
import { capitalize_symbol } from './parsers/shared'
import { get_pbc_image_sites, wrap_to_unit_cell } from './pbc'
import { get_image_source_idx, get_orig_site_idx, is_image_site } from './site'
import { make_supercell, parse_supercell_scaling } from './supercell'

// State the component owns as (bindable) props, read and written through these accessors so
// a caller-bound prop and the session never hold two copies
export interface StructureSessionInputs {
  structure: () => AnyStructure | undefined
  set_structure: (value: AnyStructure | undefined) => void
  bonds: () => StructureBond[] | undefined
  set_bonds: (value: StructureBond[] | undefined) => void
  // Stable identity for coordinate-only updates (trajectory frames)
  series_key: () => unknown
  selected_sites: () => number[]
  set_selected_sites: (value: number[]) => void
  measured_sites: () => number[]
  set_measured_sites: (value: number[]) => void
  highlighted_sites: () => number[]
  set_highlighted_sites: (value: number[]) => void
  hovered_site_idx: () => number | null
  set_hovered_site_idx: (value: number | null) => void
  measure_mode: () => MeasureMode
  set_measure_mode: (value: MeasureMode) => void
  bond_edit_mode: () => BondEditMode
  set_bond_edit_mode: (value: BondEditMode) => void
  bond_edit_order: () => BondOrder
  set_bond_edit_order: (value: BondOrder) => void
  supercell_scaling: () => string
  apply_supercell_scaling: () => boolean
  show_image_atoms: () => boolean
  cell_type: () => CellType
  set_cell_type: (value: CellType) => void
  sym_data: () => SymmetryDataset | null
  // Atom coloring inputs; property colors are derived once here for the scene and the legend
  atom_color_config: () => AtomColorConfig
  bonding_strategy: () => BondingStrategy
  // Transient user-facing notices ("Deleted 2 sites", supercell failures)
  on_notice?: (message: string) => void
}

export type EditSnapshot = { structure: AnyStructure; bonds: StructureBond[] | undefined }
type BondEditSnapshot = {
  added_bonds: StructureBond[]
  removed_bonds: StructureBond[]
  bond_order_overrides: StructureBond[]
  bond_edit_mode: BondEditMode
  bond_edit_order: BondOrder
}
type SupercellJob = { base: Crystal; scaling: string }
type SupercellBuild = { structure: AnyStructure | undefined; applied: boolean; error?: string }

export const MAX_HISTORY = 20
// Supercells past this many sites (or tiles) build off the current task so the spinner gets a
// frame to show in
const ASYNC_SUPERCELL_SITES = 1000
const ASYNC_SUPERCELL_TILES = 8

// Normalize "fe" → "Fe"; null for unknown symbols
const normalize_element = (input: string): ElementSymbol | null =>
  coerce_elem_symbol(capitalize_symbol(input)) ?? null
// Pure, so it can run inside a derived
const build_supercell = (base: Crystal, scaling: string): SupercellBuild => {
  try {
    return { structure: make_supercell(base, scaling), applied: true }
  } catch (error) {
    console.error(`Failed to create supercell:`, error)
    return { structure: base, applied: false, error: to_error(error).message }
  }
}

// Undo/redo stacks, replaced rather than mutated. $state.raw: entries hold whole structures
// and deep-proxying them would route every restored site read through proxy traps.
class History<Entry> {
  undo_stack = $state.raw<Entry[]>([])
  redo_stack = $state.raw<Entry[]>([])
  // Record an edit: push onto undo (capped at MAX_HISTORY entries) and invalidate redo
  push(entry: Entry): void {
    const kept = this.undo_stack.slice(Math.max(0, this.undo_stack.length - MAX_HISTORY + 1))
    this.undo_stack = [...kept, entry]
    this.redo_stack = []
  }
  // Restore the top of `direction`'s stack, moving `current()` (read lazily, snapshots are
  // expensive) to the opposite one; undefined when there is nothing to step to
  step(direction: `undo` | `redo`, current: () => Entry): Entry | undefined {
    const undo = direction === `undo`
    const source = undo ? this.undo_stack : this.redo_stack
    const restored = source.at(-1)
    if (restored === undefined) return undefined
    const remaining = source.slice(0, -1)
    const opposite = [...(undo ? this.redo_stack : this.undo_stack), current()]
    ;[this.undo_stack, this.redo_stack] = undo ? [remaining, opposite] : [opposite, remaining]
    return restored
  }
  clear(): void {
    if (this.undo_stack.length > 0 || this.redo_stack.length > 0) {
      ;[this.undo_stack, this.redo_stack] = [[], []]
    }
  }
}

// Joins per-site signature entries; a control character cannot occur in a label or element
const SITE_SEPARATOR = `\u0001`

// Whether two site lists describe the same atoms in the same order. Plain loops, no
// closures: this runs over every site of every trajectory frame
function same_topology(sites: readonly Site[], last: readonly Site[]): boolean {
  if (sites.length !== last.length) return false
  for (let idx = 0; idx < sites.length; idx++) {
    const { label, species } = sites[idx]
    const previous = last[idx]
    if (label !== previous.label) return false
    if (species === previous.species) continue
    if (species.length !== previous.species.length) return false
    for (let entry_idx = 0; entry_idx < species.length; entry_idx++) {
      const entry = species[entry_idx]
      const previous_entry = previous.species[entry_idx]
      if (
        entry.element !== previous_entry.element ||
        entry.occu !== previous_entry.occu ||
        entry.oxidation_state !== previous_entry.oxidation_state
      )
        return false
    }
  }
  return true
}

// Per-key change detection for the invalidation effect: true when `value` differs from the
// value last seen under `key` (never on the first sight). A plain Map on purpose: it is read
// and written inside the effect it serves.
function create_change_tracker() {
  const previous = new Map<string, unknown>()
  return (key: string, value: unknown): boolean => {
    const changed = previous.has(key) && previous.get(key) !== value
    previous.set(key, value)
    return changed
  }
}

export class StructureSession {
  // === display pipeline ===
  // Periodic fractional coordinates wrap into the cell; non-periodic axes keep out-of-cell
  // values (unwrapped trajectories)
  normalized_structure = $derived.by(() => {
    const structure = this.inputs.structure()
    return structure && normalize_fractional_coords(structure)
  })
  private readonly structure_with_bonds = $derived.by((): AnyStructure | undefined => {
    const bonds = this.inputs.bonds()
    const struct = this.normalized_structure
    if (!struct || bonds === undefined) return struct
    return { ...struct, properties: { ...struct.properties, bonds } }
  })
  // Conventional/primitive cell needs symmetry data; until it arrives the original cell shows
  base_structure = $derived.by((): AnyStructure | undefined => {
    const [cell_type, sym_data] = [this.inputs.cell_type(), this.inputs.sym_data()]
    const struct = this.structure_with_bonds
    if (!struct || !(`lattice` in struct) || cell_type === `original` || !sym_data) {
      return struct
    }
    try {
      return transform_cell(struct, cell_type, sym_data)
    } catch (error) {
      console.error(`Failed to transform cell to ${cell_type}:`, error)
      return struct
    }
  })
  private readonly supercell_factors = $derived.by((): Vec3 | undefined => {
    try {
      return parse_supercell_scaling(this.inputs.supercell_scaling())
    } catch {
      return undefined
    }
  })
  private readonly has_scaled_cell = $derived(
    this.supercell_factors?.some((factor) => factor !== 1) ?? false,
  )
  has_supercell = $derived.by(
    () => this.inputs.apply_supercell_scaling() && this.has_scaled_cell,
  )
  private readonly supercell_job = $derived.by((): SupercellJob | undefined => {
    const base = this.base_structure
    if (!base || !(`lattice` in base) || !this.has_supercell) return undefined
    return { base, scaling: this.inputs.supercell_scaling() }
  })
  private readonly supercell_is_large = $derived.by(() => {
    const job = this.supercell_job
    if (!job) return false
    const tiles = (this.supercell_factors ?? [1, 1, 1]).reduce((prod, factor) => prod * factor)
    return (
      job.base.sites.length * tiles > ASYNC_SUPERCELL_SITES || tiles > ASYNC_SUPERCELL_TILES
    )
  })
  // $state.raw: supercells hold thousands of sites and every downstream read (bonding, PBC
  // images, instancing) would otherwise traverse proxy traps
  private async_supercell = $state.raw<(SupercellJob & SupercellBuild) | undefined>(undefined)
  private readonly supercell = $derived.by((): SupercellBuild & { loading: boolean } => {
    const job = this.supercell_job
    if (!job) return { structure: this.base_structure, applied: false, loading: false }
    if (!this.supercell_is_large)
      return { ...build_supercell(job.base, job.scaling), loading: false }
    const ready = this.async_supercell
    if (ready && ready.base === job.base && ready.scaling === job.scaling) {
      return { structure: ready.structure, applied: ready.applied, loading: false }
    }
    // Keep the previous build on screen while the next one computes (trajectory frames)
    return { structure: ready?.structure ?? job.base, applied: false, loading: true }
  })
  supercell_structure = $derived(this.supercell.structure)
  supercell_loading = $derived(this.supercell.loading)
  scaled_cell_displayed = $derived.by(
    () =>
      this.has_scaled_cell &&
      (!this.inputs.apply_supercell_scaling() || this.supercell.applied),
  )
  // Tiling factors for the drawn cell and isosurface geometry; held at 1 until the supercell
  // structure lands so cell tiles, surfaces and atoms update in the same frame
  supercell_tiling = $derived.by((): Vec3 => {
    if (!this.has_supercell || !this.supercell.applied || this.supercell.loading)
      return [1, 1, 1]
    return this.supercell_factors ?? [1, 1, 1]
  })
  bond_edits_enabled = $derived.by(
    () =>
      this.inputs.cell_type() === `original` &&
      !this.scaled_cell_displayed &&
      !this.supercell_loading,
  )
  // Remap element symbols for display (LAMMPS type placeholders → real elements)
  element_mapping = $state<Partial<Record<ElementSymbol, ElementSymbol>> | undefined>()
  dragging_atoms = $state(false)
  // Element-mapped + PBC image atoms. Images are skipped during drags (doubled site count
  // drops frames) and return on release.
  displayed_structure = $derived.by((): AnyStructure | undefined => {
    let struct = this.supercell_structure
    const mapping = this.element_mapping
    if (struct && mapping && Object.keys(mapping).length > 0) {
      struct = {
        ...struct,
        sites: struct.sites.map((site) => ({
          ...site,
          species: site.species.map((species) => ({
            ...species,
            element: mapping[species.element] ?? species.element,
          })),
          label: mapping[site.label as ElementSymbol] ?? site.label,
        })),
      }
    }
    return !this.dragging_atoms &&
      this.inputs.show_image_atoms() &&
      struct &&
      `lattice` in struct
      ? get_pbc_image_sites(struct)
      : struct
  })
  private readonly displayed_site_count = $derived(this.displayed_structure?.sites.length ?? 0)
  // True while the rendered cell is the analyzed (moyo input) cell, i.e. no conventional/
  // primitive transform applies. Overlays expressed in the input frame (symmetry elements) are
  // only placed correctly then; a supercell of the input cell still qualifies.
  shows_input_frame = $derived(this.base_structure === this.structure_with_bonds)
  // Wyckoff rows of the analyzed cell with site_indices re-expressed onto the displayed
  // structure (conventional/primitive cell, supercell, image atoms), so the table and the
  // Wyckoff coloring address the atoms actually on screen rather than the analyzed cell's
  // indices, which only coincide for the untransformed 1x1x1 view
  wyckoff_rows = $derived.by((): WyckoffPos[] => {
    const sym_data = this.inputs.sym_data()
    const rows = wyckoff_positions_from_moyo(sym_data)
    const displayed = this.displayed_structure
    const original = this.normalized_structure
    if (rows.length === 0 || !displayed || !original) return rows
    if (!(`lattice` in displayed) || !(`lattice` in original)) return rows
    return map_wyckoff_to_all_atoms(rows, displayed, original, sym_data)
  })
  // Per-displayed-site colors for the active coloring mode (null in element mode). Computed once
  // for every pane and the legend. Coordination colouring intentionally uses the file's own
  // species: `base` is upstream of element_mapping, so remapped elements do not change the CN.
  property_colors = $derived.by((): AtomPropertyColors | null => {
    const config = this.inputs.atom_color_config()
    if (config.mode === `element`) return null
    return get_property_colors(this.displayed_structure, config, {
      base: this.base_structure,
      to_base_idx: this.to_base_site_idx,
      bonding_strategy: this.inputs.bonding_strategy(),
      wyckoff_rows: config.mode === `wyckoff` ? this.wyckoff_rows : [],
    })
  })
  // Site-indexed UI state is only valid while atom count, order and species are unchanged.
  // Trajectory frames almost always keep the topology, so compare against the previous sites
  // field by field first: that is an order of magnitude cheaper than rebuilding the string
  // for every site, which parsers that allocate fresh species arrays per frame would force.
  private last_topology: { sites: readonly Site[]; signature: string } | undefined
  private readonly topology_signature = $derived.by((): string => {
    const sites = this.inputs.structure()?.sites
    if (!Array.isArray(sites)) return ``
    const last = this.last_topology
    if (last && same_topology(sites, last.sites)) return last.signature
    const signature = sites
      .map(
        ({ label, species }) =>
          `${label}\0${species
            .map(({ element, occu, oxidation_state }) =>
              [element, occu, oxidation_state ?? ``].join(`:`),
            )
            .join(`,`)}`,
      )
      .join(SITE_SEPARATOR)
    this.last_topology = { sites, signature }
    return signature
  })

  // === selection, validated against the displayed structure ===
  // The scene only ever receives indices below the displayed site count, computed in the same
  // pass as the structure itself, so no overlay can index a site that is no longer there
  selected_sites = $derived.by(() => this.in_range(this.inputs.selected_sites()))
  measured_sites = $derived.by(() => this.in_range(this.inputs.measured_sites()))
  highlighted_sites = $derived.by(() => this.in_range(this.inputs.highlighted_sites()))
  hovered_site_idx = $derived.by((): number | null => {
    const idx = this.inputs.hovered_site_idx()
    return idx !== null && idx >= 0 && idx < this.displayed_site_count ? idx : null
  })
  // Legend overrides; per-site ones are invalidated with the selection
  site_radius_overrides = $state.raw(new SvelteMap<number, number>())
  element_radius_overrides = $state<Partial<Record<ElementSymbol, number>>>({})
  hidden_prop_vals = $state.raw(new SvelteSet<number | string>())

  // === edit-atoms ===
  add_atom_mode = $state(false)
  add_element = $state<ElementSymbol>(`C`)
  change_element_mode = $state(false)
  history = new History<EditSnapshot>()
  // Set before every internal structure write so the invalidation effect keeps history and
  // selection for the session's own edits (external loads/frames clear both)
  private is_internal_edit = false

  // === edit-bonds ===
  added_bonds = $state<StructureBond[]>([])
  removed_bonds = $state<StructureBond[]>([])
  bond_order_overrides = $state<StructureBond[]>([])
  bond_history = new History<BondEditSnapshot>()
  // Source bonds captured when the first edit begins; edits merge onto these. Wrapped so an
  // undefined source still counts as captured.
  private bond_edit_base = $state.raw<{ bonds: StructureBond[] | undefined } | undefined>()
  // What this session last wrote to the bonds binding, read back so a proxied binding
  // compares equal; anything else in the binding is a caller-supplied source
  private emitted_bonds: StructureBond[] | undefined
  has_bond_edits = $derived(
    this.added_bonds.length > 0 ||
      this.removed_bonds.length > 0 ||
      this.bond_order_overrides.length > 0,
  )
  private readonly edited_bonds = $derived.by(() => {
    const base = this.bond_edit_base
    if (!base || !this.has_bond_edits) return undefined
    return merge_bond_edits(
      base.bonds ?? [],
      this.added_bonds,
      this.removed_bonds,
      this.bond_order_overrides,
    )
  })

  // === camera bookkeeping across panes (pane 0 = primary) ===
  reset_token = $state(0)
  active_pane_idx = $state(0)
  fly_to_request = $state<Vec3 | undefined>(undefined)
  private readonly moved_panes = new SvelteSet<number>()
  any_camera_moved = $derived(this.moved_panes.size > 0)

  // A parameter property so TypeScript sees `inputs` assigned before the field initializers
  // above; the $derived fields only read it lazily anyway
  constructor(readonly inputs: StructureSessionInputs) {
    $effect(() => {
      const job = this.supercell_job
      if (!job || !this.supercell_is_large) return undefined
      const timer = setTimeout(() => {
        this.async_supercell = { ...job, ...build_supercell(job.base, job.scaling) }
      }, 10)
      return () => clearTimeout(timer)
    })

    // Publish merged bonds through the binding; once the last edit is undone the captured
    // source bonds go back out and the edit layer forgets its base
    $effect(() => {
      const edited = this.edited_bonds
      untrack(() => {
        if (edited) return this.emit_bonds(edited)
        if (!this.bond_edit_base) return
        this.emit_bonds(this.bond_edit_base.bonds)
        this.bond_edit_base = undefined
      })
    })

    // One pre-effect resets site-indexed state before the scene renders. A post-render effect
    // would let the scene draw a stale selection against a shrunken site list first; a throw
    // there aborts the whole flush, dropping the pending clear with it.
    const changed = create_change_tracker()
    let previous_supercell_error: string | undefined
    $effect.pre(() => {
      // Read every dependency up front; the guards below must not make tracking conditional
      const structure_changed = changed(`structure`, inputs.structure())
      const topology_changed = changed(`topology`, this.topology_signature)
      const transform_changed = [
        changed(`supercell_scaling`, inputs.supercell_scaling()),
        changed(`show_image_atoms`, inputs.show_image_atoms()),
        changed(`series_key`, inputs.series_key()),
        changed(`cell_type`, inputs.cell_type()),
      ].includes(true)
      const measure_mode = inputs.measure_mode()
      const mode_changed = changed(`measure_mode`, measure_mode)
      const bond_mode_changed = changed(`bond_edit_mode`, inputs.bond_edit_mode())
      const bonds_replaced = inputs.bonds() !== this.emitted_bonds
      const bonds_unavailable = measure_mode === `edit-bonds` && !this.bond_edits_enabled
      // Not via `changed`: a build that already fails at mount must notify too
      const { error: supercell_error } = this.supercell
      const supercell_failed = supercell_error !== previous_supercell_error && supercell_error
      previous_supercell_error = supercell_error
      untrack(() => {
        if (supercell_failed) this.notice(`Failed to create supercell: ${supercell_failed}`)
        const internal = this.is_internal_edit
        this.is_internal_edit = false
        if (structure_changed) {
          // The binding stays undefined until the first edit (source bonds live on the
          // structure); a bound set equal to what we emitted for the previous structure is
          // stale, so hand the new structure's own bonds back out in its place
          if (!bonds_replaced && this.emitted_bonds !== undefined) {
            this.emit_bonds(inputs.structure()?.properties?.bonds)
          }
          this.bond_edit_base = undefined
          this.clear_bond_edits()
          if (!internal) {
            this.history.clear()
            this.singular_lattice_notified = false
            if (inputs.highlighted_sites().length > 0) inputs.set_highlighted_sites([])
            if (measure_mode === `edit-atoms`) {
              this.clear_selection()
              this.site_radius_overrides.clear()
            }
          }
        } else if (
          bonds_replaced &&
          (this.has_bond_edits ||
            this.bond_history.undo_stack.length > 0 ||
            this.bond_history.redo_stack.length > 0)
        ) {
          // Caller swapped the source bonds under the edit layer: the edits — and the history
          // that could redo them onto the wrong source — no longer apply
          this.bond_edit_base = undefined
          this.clear_bond_edits()
        }
        // Coordinate-only frames keep the selection; a changed topology means the indices
        // point at different atoms. The session's own edits manage their selection.
        if (topology_changed && !internal) {
          this.clear_selection()
          if (inputs.highlighted_sites().length > 0) inputs.set_highlighted_sites([])
          if (inputs.hovered_site_idx() !== null) inputs.set_hovered_site_idx(null)
          this.site_radius_overrides.clear()
        }
        // Supercell/image/cell changes renumber scene sites. In edit-atoms mode they are the
        // user's own transforms and the selection stays so TransformControls remains attached.
        if (transform_changed) {
          if (this.bond_edit_base) {
            this.emit_bonds(this.bond_edit_base.bonds)
            this.bond_edit_base = undefined
          }
          this.clear_bond_edits()
          if (measure_mode !== `edit-atoms`) {
            this.clear_selection()
            this.site_radius_overrides.clear()
          }
        }
        if (mode_changed) {
          this.clear_selection()
          if (measure_mode === `edit-bonds`) inputs.set_bond_edit_mode(`add`)
          if (measure_mode === `edit-atoms`) {
            this.clear_bond_edits()
            // Bake a conventional/primitive view into the structure so edits apply to what is
            // on screen; the original stays one undo away
            const base = this.base_structure
            if (inputs.cell_type() !== `original` && base && inputs.structure()) {
              this.push_undo()
              this.write_structure($state.snapshot(base))
              inputs.set_cell_type(`original`)
            }
          }
        } else if (bond_mode_changed && measure_mode === `edit-bonds`) this.clear_selection()
        if (bonds_unavailable) {
          this.clear_selection()
          this.clear_bond_edits()
          inputs.set_measure_mode(`distance`)
          this.notice(`Bond editing is only available for the original 1x1x1 cell`)
        }
      })
    })
  }

  private notice(message: string): void {
    this.inputs.on_notice?.(message)
  }
  private in_range(indices: number[]): number[] {
    const count = this.displayed_site_count
    return indices.every((idx) => idx >= 0 && idx < count)
      ? indices
      : indices.filter((idx) => idx >= 0 && idx < count)
  }
  clear_selection = (): void => {
    const { inputs } = this
    if (inputs.selected_sites().length > 0) inputs.set_selected_sites([])
    if (inputs.measured_sites().length > 0) inputs.set_measured_sites([])
    this.dragging_atoms = false
  }

  // === edit-bonds ===
  private emit_bonds(bonds: StructureBond[] | undefined): void {
    this.inputs.set_bonds(bonds)
    this.emitted_bonds = this.inputs.bonds()
  }
  // $state.snapshot: the edit arrays are deep proxies; history keeps plain copies
  private snapshot_bond_edits(): BondEditSnapshot {
    const { added_bonds, removed_bonds, bond_order_overrides } = this
    return $state.snapshot({
      added_bonds,
      removed_bonds,
      bond_order_overrides,
      bond_edit_mode: this.inputs.bond_edit_mode(),
      bond_edit_order: this.inputs.bond_edit_order(),
    })
  }
  clear_bond_edits = (): void => {
    if (this.has_bond_edits) {
      ;[this.added_bonds, this.removed_bonds, this.bond_order_overrides] = [[], [], []]
    }
    this.bond_history.clear()
  }
  // Undoing the last edit hands the source back out and forgets it; the next edit (or a redo
  // of the undone one) captures whatever is bound — the source again — as its new base
  private capture_bond_edit_base(): void {
    this.bond_edit_base ??= {
      bonds: this.inputs.bonds() ?? this.inputs.structure()?.properties?.bonds,
    }
  }
  // Called by the scene before each bond edit
  push_bond_undo = (): void => {
    this.capture_bond_edit_base()
    this.bond_history.push(this.snapshot_bond_edits())
  }
  private step_bond_history(direction: `undo` | `redo`): boolean {
    const restored = this.bond_history.step(direction, () => this.snapshot_bond_edits())
    if (!restored) return false
    this.capture_bond_edit_base()
    // Popped entries are no longer shared with a stack, so they need no further copy
    this.added_bonds = restored.added_bonds
    this.removed_bonds = restored.removed_bonds
    this.bond_order_overrides = restored.bond_order_overrides
    this.inputs.set_bond_edit_mode(restored.bond_edit_mode)
    this.inputs.set_bond_edit_order(restored.bond_edit_order)
    this.clear_selection()
    return true
  }
  undo_bond_edit = (): boolean => this.step_bond_history(`undo`)
  redo_bond_edit = (): boolean => this.step_bond_history(`redo`)

  // === edit-atoms history ===
  // $state.snapshot: a caller-bound structure may be a deep proxy; history keeps plain copies
  private snapshot_edit_state(structure: AnyStructure): EditSnapshot {
    const bonds = this.inputs.bonds()
    return { structure: $state.snapshot(structure), bonds: bonds && $state.snapshot(bonds) }
  }
  push_undo = (): void => {
    const structure = this.inputs.structure()
    if (structure) this.history.push(this.snapshot_edit_state(structure))
  }
  private step_history(direction: `undo` | `redo`): boolean {
    const structure = this.inputs.structure()
    if (!structure) return false
    const restored = this.history.step(direction, () => this.snapshot_edit_state(structure))
    if (!restored) return false
    this.write_structure(restored.structure)
    this.inputs.set_bonds(restored.bonds)
    this.clear_selection()
    return true
  }
  undo = (): boolean => this.step_history(`undo`)
  redo = (): boolean => this.step_history(`redo`)
  private write_structure(next: AnyStructure): void {
    this.is_internal_edit = true
    this.inputs.set_structure(next)
  }

  // Index into base_structure of a displayed site: image atoms name the site they mirror and
  // sites of a session-built supercell name the base site they tile. A caller-supplied structure
  // may itself carry orig_unit_cell_idx from a supercell built outside the viewer (phonon mode
  // supercells); those index a cell that is not displayed, so they are only followed while the
  // session's own supercell is on screen.
  private readonly to_base_site_idx = (site: Site, site_idx: number): number => {
    if (this.supercell_structure !== this.base_structure) {
      return get_orig_site_idx(site, site_idx)
    }
    return get_image_source_idx(site, site_idx)
  }

  // === edit-atoms operations ===
  // Map scene indices (into displayed_structure) back to raw structure indices through the
  // supercell and image-atom provenance properties
  scene_to_structure_indices(
    scene_indices: number[],
    skip_image_atoms = false,
  ): SvelteSet<number> {
    const result = new SvelteSet<number>()
    for (const scene_idx of scene_indices) {
      const site = this.displayed_structure?.sites[scene_idx]
      if (!site) continue
      if (skip_image_atoms && is_image_site(site)) continue
      result.add(this.to_base_site_idx(site, scene_idx))
    }
    return result
  }
  // Cartesian→fractional converter for the current lattice; undefined for molecules (whose
  // `abc` mirrors `xyz`) and for a singular lattice (extXYZ `Lattice="... 0 0 0"` parses fine
  // but has no inverse). The callers are pointer handlers (drag moves, click-to-add), so the
  // failure is surfaced as a notice and they keep editing `xyz` (each says what it does with
  // `abc`). A drag calls this on every pointer move, so the notice is shown once per externally
  // loaded structure (the flag resets in the invalidation effect).
  private singular_lattice_notified = false
  private cart_to_frac(): ((xyz: Vec3) => Vec3) | undefined {
    const structure = this.inputs.structure()
    if (!structure || !(`lattice` in structure)) return undefined
    try {
      return create_cart_to_frac(structure.lattice.matrix)
    } catch {
      if (!this.singular_lattice_notified) {
        this.notice(`Cannot edit fractional coordinates: lattice is singular`)
      }
      this.singular_lattice_notified = true
      return undefined
    }
  }

  delete_selected = (): boolean => {
    const { inputs } = this
    const structure = inputs.structure()
    const selected = inputs.selected_sites()
    if (selected.length === 0 || !structure?.sites) return false
    this.push_undo()
    const to_delete = this.scene_to_structure_indices(selected, true)
    this.clear_selection()
    // Explicit bonds (the binding and the structure's own) follow the shifted indices
    const bound_bonds = inputs.bonds()
    if (bound_bonds !== undefined) {
      inputs.set_bonds(remap_bonds_after_deletion(bound_bonds, to_delete))
    }
    const old_bonds = structure.properties?.bonds
    this.write_structure({
      ...structure,
      sites: structure.sites.filter((_, idx) => !to_delete.has(idx)),
      ...(old_bonds && {
        properties: {
          ...structure.properties,
          bonds: remap_bonds_after_deletion(old_bonds, to_delete),
        },
      }),
    })
    this.site_radius_overrides.clear()
    this.clear_bond_edits()
    this.notice(`Deleted ${plural(to_delete.size, `site`)}`)
    return true
  }

  // Copies of the selected atoms at a half-Angstrom offset; the copies become the selection
  duplicate_selected = (): boolean => {
    const { inputs } = this
    const structure = inputs.structure()
    const selected = inputs.selected_sites()
    if (selected.length === 0 || !structure?.sites) return false
    this.push_undo()
    const to_copy = this.scene_to_structure_indices(selected)
    const to_frac = this.cart_to_frac()
    const has_lattice = `lattice` in structure
    const copies = structure.sites
      .filter((_, idx) => to_copy.has(idx))
      .map((site) => {
        const xyz: Vec3 = [site.xyz[0] + 0.5, site.xyz[1] + 0.5, site.xyz[2] + 0.5]
        // singular lattice: the copy keeps its source's abc (see cart_to_frac)
        const abc = to_frac?.(xyz) ?? (has_lattice ? site.abc : xyz)
        return { ...site, xyz, abc, properties: { ...site.properties } }
      })
    const first_new_idx = structure.sites.length
    this.write_structure({ ...structure, sites: [...structure.sites, ...copies] })
    const new_indices = copies.map((_, idx) => first_new_idx + idx)
    inputs.set_selected_sites(new_indices)
    inputs.set_measured_sites([...new_indices])
    this.notice(`Duplicated ${plural(copies.length, `site`)}`)
    return true
  }

  change_element = (symbol: string): boolean => {
    const { inputs } = this
    const structure = inputs.structure()
    const element = normalize_element(symbol)
    if (!structure?.sites || inputs.selected_sites().length === 0 || !element) return false
    this.push_undo()
    const targets = this.scene_to_structure_indices(inputs.selected_sites())
    this.write_structure({
      ...structure,
      sites: structure.sites.map((site, idx) =>
        targets.has(idx)
          ? { ...site, species: [{ element, occu: 1, oxidation_state: 0 }], label: element }
          : site,
      ),
    })
    this.change_element_mode = false
    this.notice(`Changed ${plural(targets.size, `site`)} to ${element}`)
    return true
  }

  // Click-to-place from the scene
  add_atom = (xyz: Vec3, symbol: ElementSymbol): void => {
    const structure = this.inputs.structure()
    if (!structure) return
    const element = normalize_element(symbol)
    if (!element) return console.warn(`Invalid element symbol "${symbol}", ignoring add-atom`)
    this.push_undo()
    const site = {
      species: [{ element, occu: 1, oxidation_state: 0 }],
      xyz,
      // molecules mirror xyz; a singular lattice has no fractional frame to offer either
      abc: this.cart_to_frac()?.(xyz) ?? xyz,
      label: element,
      properties: {},
    }
    this.write_structure({ ...structure, sites: [...structure.sites, site] })
    this.notice(
      `Added ${element} at (${xyz.map((coord) => format_num(coord, `.2f`)).join(`, `)})`,
    )
  }

  // Drag moves from TransformControls: apply the Cartesian delta and wrap fractional
  // coordinates inline so normalize_fractional_coords hits its fast path
  move_sites = (scene_indices: number[], delta: Vec3): void => {
    const structure = this.inputs.structure()
    if (!structure?.sites) return
    const targets = this.scene_to_structure_indices(scene_indices)
    const has_lattice = `lattice` in structure
    // non-periodic axes stay unwrapped: a dragged slab atom must not snap back into the box
    const pbc = has_lattice ? structure.lattice.pbc : undefined
    const to_frac = this.cart_to_frac()
    const to_cart =
      to_frac && has_lattice ? create_frac_to_cart(structure.lattice.matrix) : null
    this.write_structure({
      ...structure,
      sites: structure.sites.map((site, idx) => {
        if (!targets.has(idx)) return site
        const xyz: Vec3 = [
          site.xyz[0] + delta[0],
          site.xyz[1] + delta[1],
          site.xyz[2] + delta[2],
        ]
        // molecules mirror xyz into abc; a singular lattice moves xyz and leaves abc alone
        if (!to_frac || !to_cart) return { ...site, xyz, abc: has_lattice ? site.abc : xyz }
        const abc = wrap_to_unit_cell(to_frac(xyz), pbc)
        return { ...site, xyz: to_cart(abc), abc }
      }),
    })
  }

  // === cameras ===
  report_pane_moved = (pane_idx: number, moved: boolean): void => {
    if (moved) this.moved_panes.add(pane_idx)
    else this.moved_panes.delete(pane_idx)
  }
  reset_all_cameras = (): void => {
    this.reset_token += 1
    this.moved_panes.clear()
  }
  clear_moved_panes = (): void => this.moved_panes.clear()
  // Side-pane state is meaningless once the grid collapses to one pane
  collapse_to_primary_pane = (): void => {
    this.active_pane_idx = 0
    for (const pane_idx of this.moved_panes)
      if (pane_idx !== 0) this.moved_panes.delete(pane_idx)
  }
}
