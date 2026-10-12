<script lang="ts">
  import { format_num } from '#lib/labels.js'
  import type { StructurePlotProps } from '#lib/plot/bar/index.js'
  import StructureBarPlot from '#lib/plot/bar/StructureBarPlot.svelte'
  import {
    compute_structure_entries,
    to_structure_entries,
  } from '#lib/plot/core/structure-input.js'
  import type {
    StructureEntry,
    StructureSiteHighlight,
  } from '#lib/plot/core/structure-input.js'
  import type { BarHandlerProps } from '#lib/plot/core/types.js'
  import { to_error } from '#lib/utils.js'
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
    structures,
    strategy = `electroneg_ratio`,
    split_mode = `by_triplet`,
    normalize = `counts`,
    bin_width = BOND_ANGLE_DEFAULT_BIN_WIDTH,
    center_elements,
    neighbor_elements,
    mode = $bindable(`grouped`),
    loading = $bindable(false),
    error_msg = $bindable(),
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    on_sites_hover,
    ...rest
  }: StructurePlotProps & {
    split_mode?: BondAngleSplitMode
    normalize?: BondAngleNormalizeMode
    bin_width?: number
    center_elements?: readonly string[]
    neighbor_elements?: readonly string[]
    // Per structure behind the hovered bar: its angles' centre atoms (site_indices) and
    // bonded outer atoms (neighbor_indices); null once the pointer leaves
    on_sites_hover?: (highlights: StructureSiteHighlight[] | null) => void
  } = $props()

  let dropped_entries = $state<StructureEntry[]>([])

  // Geometry and binning are separate deriveds so dragging the bin-width slider re-bins an
  // unchanged triplet list instead of re-running the whole periodic bond search. A structure
  // the neighbor search rejects is reported, not thrown through the render.
  const opts = $derived({ strategy, center_elements, neighbor_elements })
  const computed = $derived(
    compute_structure_entries(
      [...to_structure_entries(structures), ...dropped_entries],
      (structure) => calc_bond_angles(structure, opts),
    ),
  )

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

  // BarPlot reports a hover on every pointer move: recompute only for a different bar.
  // bar_idx is the angle bin: every series shares the bin_width binning on one x axis.
  let hovered_bar: string | null = null
  const handle_bar_hover: StructurePlotProps[`on_bar_hover`] = (bar) => {
    rest.on_bar_hover?.(bar)
    const bar_key = bar && `${bar.series_idx}:${bar.bar_idx}`
    if (bar_key === hovered_bar) return
    hovered_bar = bar_key
    const { structure_label, triplet } = bar?.metadata ?? {}
    on_sites_hover?.(
      bar &&
        computed.entries
          .filter(
            ({ label }) => typeof structure_label !== `string` || label === structure_label,
          )
          .map(({ label, structure, data }) => ({
            label,
            structure,
            ...bond_angle_bin_sites(data, {
              bin_width,
              bin_idx: bar.bar_idx,
              triplet: typeof triplet === `string` ? triplet : undefined,
            }),
          })),
    )
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

<StructureBarPlot
  {...rest}
  bind:show_controls
  bind:controls_open
  series={bar_series}
  primary_axis={angle_axis}
  {value_axis}
  subject="bond angles"
  bind:dropped_entries
  bind:mode
  bind:loading
  bind:error_msg
  on_bar_hover={on_sites_hover ? handle_bar_hover : rest.on_bar_hover}
>
  {#snippet tooltip(info: BarHandlerProps<BondAngleMetadata>)}
    {@const half_width = (info.metadata?.bin_width ?? bin_width) / 2}
    {format_num(info.x - half_width, `.1f`)}–{format_num(info.x + half_width, `.1f`)}
    <small>°</small>
    <br />
    {normalize === `density` ? `Density` : `Angles`}: {format_num(
      info.y,
      normalize === `density` ? `.4~f` : `.0f`,
    )}
  {/snippet}
</StructureBarPlot>
