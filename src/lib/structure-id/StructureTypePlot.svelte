<script lang="ts">
  import { format_num } from '$lib/labels'
  import type { StructurePlotProps } from '$lib/plot/bar'
  import StructureBarPlot from '$lib/plot/bar/StructureBarPlot.svelte'
  import { to_structure_entries } from '$lib/plot/core/structure-input'
  import type { StructureEntry, StructureInput } from '$lib/plot/core/structure-input'
  import type { BarHandlerProps, BarSeries } from '$lib/plot/core/types'
  import { use_async_result } from '$lib/trajectory/async-result.svelte'
  import { calc_structure_id_async } from './async-compute.svelte'
  import type { CnaTypeName } from './calc-cna'
  import { CNA_TYPE_COLORS, CNA_TYPE_LABELS, CNA_TYPE_NAMES } from './calc-cna'
  import type { StructureIdOptions, StructureIdResult } from './calc-structure-id'

  type PlotMetadata = Record<string, unknown>

  let {
    id_results = $bindable([]),
    structures,
    id_options = {},
    // One series per CNA type in both layouts. `by_structure` puts the structures on the x
    // axis as grouped bars — the view for comparing a handful of structures. `over_frames`
    // puts the frame index on the x axis and draws one line per type, which is how a phase
    // transition shows up in a trajectory.
    layout = `by_structure`,
    normalize = false,
    frame_labels,
    mode = $bindable(`grouped`),
    loading = $bindable(false),
    error_msg = $bindable(),
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    // Includes the shared `x_axis`/`y_axis` overrides, which StructureBarPlot merges over the
    // layout's primary/value axis defaults below (so callers can set label, range or format)
    ...rest
  }: Omit<StructurePlotProps, `structures` | `strategy`> & {
    // Precomputed per-frame results. Bindable so a parent can read back what `structures` produced.
    id_results?: StructureIdResult[]
    // Supply structures instead of `id_results` to have this component compute (in a worker).
    // Same shapes as CoordinationBarPlot/BondAnglePlot: one structure, a label -> structure
    // record, or an entry array.
    structures?: StructureInput
    id_options?: StructureIdOptions
    layout?: `by_structure` | `over_frames`
    // Plot the fraction of atoms rather than the raw count
    normalize?: boolean
    // x tick labels; defaults to the entry labels of `structures`, else the result index
    frame_labels?: (number | string)[]
  } = $props()

  let dropped_entries = $state<StructureEntry[]>([])
  const entries = $derived([...to_structure_entries(structures), ...dropped_entries])
  // Labels of the entries the current id_results were computed from; empty when the
  // results came in through the prop instead
  let computed_labels = $state<string[]>([])

  // Without entries this is results-only mode: id_results/loading/error_msg are the parent's
  // one-way props. Once entries are withdrawn, their results and failure go with them.
  use_async_result({
    input: () => (entries.length > 0 ? entries : undefined),
    options: () => id_options,
    compute: async (inputs, options, signal) => ({
      results: await Promise.all(
        inputs.map(({ structure }) => calc_structure_id_async(structure, options, { signal })),
      ),
      labels: inputs.map(({ label }) => label),
    }),
    set_result: (value) => {
      id_results = value?.results ?? []
      computed_labels = value?.labels ?? []
    },
    set_loading: (value) => (loading = value),
    set_error: (message) => (error_msg = message),
    clear_error_on_withdraw: true,
  })

  const value_of = (result: StructureIdResult, name: CnaTypeName) =>
    normalize ? result.populations[name] / result.n_atoms : result.populations[name]

  // Types absent from every result would draw five empty bars, so only populated ones survive.
  // `other` is always kept: a run where nothing matches a reference structure is a real result.
  const live_types = $derived(
    CNA_TYPE_NAMES.filter(
      (name) => name === `other` || id_results.some((result) => result.populations[name] > 0),
    ),
  )
  const x_ticks = $derived(
    frame_labels ??
      (computed_labels.length === id_results.length
        ? computed_labels
        : id_results.map((_result, idx) => idx)),
  )

  // `cna_type` is string metadata, which StructureBarPlot turns into the tooltip prefix
  const series = $derived<BarSeries<PlotMetadata>[]>(
    id_results.length === 0
      ? []
      : live_types.map((name) => ({
          x: x_ticks,
          y: id_results.map((result) => value_of(result, name)),
          label: CNA_TYPE_LABELS[name],
          color: CNA_TYPE_COLORS[name],
          visible: true,
          metadata: { cna_type: CNA_TYPE_LABELS[name] },
          ...(layout === `over_frames`
            ? { render_mode: `line` as const, markers: `line+points` as const }
            : { bar_width: 0.8 }),
        })),
  )

  const value_label = $derived(normalize ? `Fraction of atoms` : `Atoms`)
  const primary_axis = $derived({ label: layout === `over_frames` ? `Frame` : `Structure` })
  const value_axis = $derived({
    label: value_label,
    range: [0, null] as [number, null],
    ...(normalize ? {} : { format: `d` }),
  })
</script>

<StructureBarPlot
  {...rest}
  bind:show_controls
  bind:controls_open
  {series}
  {primary_axis}
  {value_axis}
  subject="structure types"
  empty_subject="structure-type data"
  loading_message="Identifying structure types…"
  bind:dropped_entries
  bind:mode
  bind:loading
  bind:error_msg
  style={rest.style ?? `height: 300px;`}
>
  {#snippet tooltip(info: BarHandlerProps<PlotMetadata>)}
    {info.x}
    <br />
    {value_label}: {format_num(info.y, normalize ? `.3~f` : `d`)}
  {/snippet}
</StructureBarPlot>
