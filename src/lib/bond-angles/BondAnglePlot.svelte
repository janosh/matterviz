<script lang="ts">
  import { format_num } from '#lib/labels.js'
  import type { BarSites, StructurePlotProps } from '#lib/plot/bar/index.js'
  import StructureBarPlot from '#lib/plot/bar/StructureBarPlot.svelte'
  import {
    compute_structure_entries,
    to_structure_entries,
  } from '#lib/plot/core/structure-input.js'
  import type { StructureEntry } from '#lib/plot/core/structure-input.js'
  import type { BarHandlerProps } from '#lib/plot/core/types.js'
  import type { AnyStructure } from '#lib/structure/index.js'
  import { memo_by_identity, value_key } from '#lib/utils.js'
  import { to_error } from 'svelte-widgets/utils'
  import {
    bin_bond_angles,
    bond_angle_bin_sites,
    calc_bond_angles,
    BOND_ANGLE_DEFAULT_BIN_WIDTH,
    MAX_BOND_ANGLE,
  } from './calc-bond-angles'
  import type { BondAngleNormalizeMode, BondAngleSplitMode } from './index'
  import { type BondAngleMetadata, to_angle_bar_series } from './series'

  let {
    // Structure(s) to analyze: one, a list or a `{ label: structure }` record. Dropped files are added to these.
    structures,
    // Bonding strategy deciding which atom pairs count as neighbors (`electroneg_ratio` or `explicit_only`).
    strategy = `electroneg_ratio`,
    // Series split: `by_triplet` (neighbor-center-neighbor elements), `by_structure`, or `none` for one combined histogram.
    split_mode = `by_triplet`,
    // `counts` plots raw angle counts, `density` divides by bin width and total so structures of different size compare.
    normalize = `counts`,
    // Histogram bin width in degrees (must be in (0, 180]).
    bin_width = BOND_ANGLE_DEFAULT_BIN_WIDTH,
    // Only these elements may be the central atom of an angle. Unset allows any.
    center_elements,
    // Only these elements may be the two outer atoms of an angle. Unset allows any.
    neighbor_elements,
    mode = $bindable(`grouped`),
    // True while a dropped file is being read; shows the loading message in the empty state.
    loading = $bindable(false),
    // Error text shown in a dismissible notice, e.g. a failed file drop or a structure the neighbor search rejected.
    error_msg = $bindable(),
    show_controls,
    controls_open = $bindable(false),
    ...rest
  }: StructurePlotProps & {
    split_mode?: BondAngleSplitMode
    normalize?: BondAngleNormalizeMode
    bin_width?: number
    center_elements?: readonly string[]
    neighbor_elements?: readonly string[]
  } = $props()

  // Raw: a deep proxy routed every site read of the neighbor search through proxy traps
  // (12x slower on a dropped 20k-atom file); drops replace the list, never mutate it
  let dropped_entries = $state.raw<StructureEntry[]>([])

  // Geometry and binning are separate deriveds so dragging the bin-width slider re-bins an
  // unchanged triplet list instead of re-running the whole periodic bond search. A structure
  // the neighbor search rejects is reported, not thrown through the render. The search is
  // memoized per structure object, so one more dropped file searches that file alone.
  const opts = $derived({ strategy, center_elements, neighbor_elements })
  const angles_of = memo_by_identity<ReturnType<typeof calc_bond_angles>>()
  const computed = $derived.by(() => {
    const opts_key = value_key(opts)
    return compute_structure_entries(
      [...to_structure_entries(structures), ...dropped_entries],
      (structure) => angles_of(structure, opts_key, () => calc_bond_angles(structure, opts)),
    )
  })

  // resolve_angle_bins throws for a bin_width outside (0, 180], and bin_width is public.
  // The failure rides back with the results because writing to a prop from inside a
  // $derived is state_unsafe_mutation.
  const binned = $derived.by(() => {
    try {
      const entries = computed.entries.map((entry) => ({
        ...entry,
        data: bin_bond_angles(entry.data, {
          bin_width,
          split_by_triplet: split_mode === `by_triplet`,
        }),
      }))
      return { entries, failure: undefined }
    } catch (exc) {
      return { entries: [], failure: to_error(exc).message }
    }
  })
  $effect(() => {
    error_msg = computed.error ?? binned.failure
  })

  const bar_series = $derived(to_angle_bar_series(binned.entries, split_mode, normalize))

  // Per structure behind a bar: its angles' centre atoms (site_indices) and bonded outer atoms
  // (neighbor_indices). bar_idx is the angle bin: every series shares one bin_width binning
  const bar_sites: BarSites = (bar) => {
    const { structure_label, triplet } = bar.metadata ?? {}
    return computed.entries
      .filter(({ label }) => typeof structure_label !== `string` || label === structure_label)
      .map(({ label, structure, data }) => ({
        label,
        structure,
        ...bond_angle_bin_sites(data, {
          bin_width,
          bin_idx: bar.bar_idx,
          triplet: typeof triplet === `string` ? triplet : undefined,
        }),
      }))
  }

  const angle_axis = {
    label: `Bond Angle (°)`,
    range: [0, MAX_BOND_ANGLE] as [number, number],
  }
  const value_axis = $derived({
    label: normalize === `density` ? `Density (1/°)` : `Count`,
    range: [0, null] as [number, null],
  })
</script>

{#snippet angle_tooltip(info: BarHandlerProps<BondAngleMetadata>)}
  {@const half_width = (info.metadata?.bin_width ?? bin_width) / 2}
  {format_num(info.x - half_width, `.1f`)}–{format_num(info.x + half_width, `.1f`)}
  <small>°</small>
  <br />
  {normalize === `density` ? `Density` : `Angles`}: {format_num(
    info.y,
    normalize === `density` ? `.4~f` : `.0f`,
  )}
{/snippet}

<StructureBarPlot
  {...rest}
  tooltip={rest.tooltip ?? angle_tooltip}
  {show_controls}
  bind:controls_open
  series={bar_series}
  primary_axis={angle_axis}
  {value_axis}
  subject="bond angles"
  bind:dropped_entries
  bind:mode
  bind:loading
  bind:error_msg
  {bar_sites}
/>
