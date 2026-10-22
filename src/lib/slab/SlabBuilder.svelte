<script lang="ts">
  // Controls for cutting a surface slab out of a bulk crystal: Miller indices, thickness,
  // vacuum, termination and cell options. The built slab is exposed through `bind:slab`
  // so the caller decides how to render it (typically a second <Structure>).
  import { format_num } from '#lib/labels.js'
  import { KeyValueList } from '#lib/layout/index.js'
  import type { Vec3 } from '#lib/math.js'
  import MillerIndexInput from '#lib/MillerIndexInput.svelte'
  import type { Crystal } from '#lib/structure/index.js'
  import { to_error } from 'svelte-widgets/utils'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { make_slab } from './make-slab'
  import type { Slab } from './types'
  import { SLAB_DEFAULT_THICKNESS, SLAB_DEFAULT_VACUUM } from './types'

  let {
    structure,
    miller_indices = $bindable([1, 1, 1]),
    min_slab_thickness = $bindable(SLAB_DEFAULT_THICKNESS),
    min_vacuum_thickness = $bindable(SLAB_DEFAULT_VACUUM),
    termination_idx = $bindable(0),
    primitive_in_plane = $bindable(true),
    center_slab = $bindable(true),
    reorient_lattice = $bindable(true),
    slab = $bindable(null),
    error = $bindable(null),
    show_info = true,
    show_cell_options = true,
    children,
    ...rest
  }: {
    structure: Crystal
    miller_indices?: Vec3
    min_slab_thickness?: number
    min_vacuum_thickness?: number
    termination_idx?: number
    primitive_in_plane?: boolean
    center_slab?: boolean
    reorient_lattice?: boolean
    // The most recently built slab, or null while the current inputs fail
    slab?: Slab | null
    error?: string | null
    // Render the summary table (d_hkl, layers, thickness, ...) below the controls
    show_info?: boolean
    // Vacuum, centering and z-alignment shape only the slab's own cell. A heterostructure
    // (InterfaceBuilder) restacks the atoms by height and ignores them, so it hides these.
    show_cell_options?: boolean
    // Extra controls rendered at the start of the controls row, e.g. a bulk-structure picker
    children?: Snippet
  } & HTMLAttributes<HTMLDivElement> = $props()

  // The termination list belongs to one (structure, hkl, mesh) combination; a stale index
  // from the previous surface would be out of range or point at a different layer. hkl and
  // the mesh flag are compared as a string so a parent reassigning an equal miller_indices
  // array does not reset the pick; the structure is compared by identity.
  const surface_key = $derived(`${miller_indices.join(`,`)}|${primitive_in_plane}`)
  let last_structure: Crystal | null = null
  let last_surface_key = ``
  $effect.pre(() => {
    if (
      last_structure !== null &&
      (structure !== last_structure || surface_key !== last_surface_key)
    ) {
      termination_idx = 0
    }
    last_structure = structure
    last_surface_key = surface_key
  })

  // the slab carries the full termination list, so one pass covers the dropdown too
  const result = $derived.by((): { slab: Slab | null; error: string | null } => {
    try {
      const built = make_slab(structure, miller_indices, {
        min_slab_thickness,
        min_vacuum_thickness,
        termination_idx,
        primitive_in_plane,
        center_slab,
        reorient_lattice,
      })
      return { slab: built, error: null }
    } catch (err) {
      return { slab: null, error: to_error(err).message }
    }
  })
  $effect(() => {
    ;({ slab, error } = result)
  })
  const info = $derived(result.slab?.slab_info)
  const rows = $derived.by((): [string, string][] => {
    if (!result.slab || !info) return []
    const { lattice, sites } = result.slab
    const spacings = info.layer_spacings.map((val) => format_num(val, `.3~f`)).join(`, `)
    return [
      [`Miller indices`, `(${info.miller_indices.join(` `)})`],
      [`Interplanar spacing d`, `${format_num(info.d_hkl, `.4~f`)} Å`],
      [`Layers`, `${info.n_layers} in ${info.n_repeats} repeat(s)`],
      [`Layer spacings`, `${spacings} Å`],
      [`Min layer gap`, `${format_num(info.min_layer_gap, `.3~f`)} Å`],
      [`Slab thickness`, `${format_num(info.slab_thickness, `.3~f`)} Å`],
      [`Vacuum`, `${format_num(info.vacuum_thickness, `.3~f`)} Å`],
      [`Surface area`, `${format_num(info.surface_area, `.4~f`)} Å²`],
      [
        `Surface mesh`,
        `${format_num(lattice.a, `.4~f`)} × ${format_num(lattice.b, `.4~f`)} Å, ${format_num(lattice.gamma, `.4~f`)}°`,
      ],
      [`Atoms`, `${sites.length} (bulk cell: ${structure.sites.length})`],
      [
        `Terminations`,
        `${info.terminations.length} distinct, showing ${info.termination.formula || `empty`}`,
      ],
    ]
  })
</script>

<div {...rest} class={[`slab-builder`, rest.class]}>
  <div class="controls">
    {@render children?.()}
    <MillerIndexInput bind:value={miller_indices} />
    <label>
      Slab <input type="range" min="2" max="30" step="0.5" bind:value={min_slab_thickness} />
      <span class="value">{format_num(min_slab_thickness, `.3~f`)} Å</span>
    </label>
    {#if show_cell_options}
      <label>
        Vacuum <input
          type="range"
          min="0"
          max="30"
          step="0.5"
          bind:value={min_vacuum_thickness}
        />
        <span class="value">{format_num(min_vacuum_thickness, `.3~f`)} Å</span>
      </label>
    {/if}
    <!-- only a choice when the cut can end on more than one layer -->
    {#if info && info.terminations.length > 1}
      <label>
        Termination
        <select bind:value={termination_idx}>
          {#each info.terminations as termination, idx (idx)}
            <option value={idx}>
              {idx + 1}. {termination.formula || `vacuum`}
              ({format_num(termination.gap, `.3~f`)} Å gap)
            </option>
          {/each}
        </select>
      </label>
    {/if}
    <label><input type="checkbox" bind:checked={primitive_in_plane} /> primitive mesh</label>
    {#if show_cell_options}
      <label><input type="checkbox" bind:checked={center_slab} /> center slab</label>
      <label><input type="checkbox" bind:checked={reorient_lattice} /> normal along z</label>
    {/if}
  </div>
  {#if result.error}
    <p class="error">{result.error}</p>
  {/if}
  {#if show_info && rows.length > 0}
    <KeyValueList
      {rows}
      style="grid-template-columns: repeat(auto-fill, minmax(min(100%, 26em), 1fr)); margin-block: 1em"
    />
  {/if}
</div>

<style>
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1ex 1em;
    label {
      display: flex;
      align-items: center;
      gap: 0.5em;
    }
    .value {
      display: inline-block;
      min-width: 6ch;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  }
  .error {
    color: var(--error-color, tomato);
    font-family: monospace;
    white-space: pre-wrap;
  }
</style>
