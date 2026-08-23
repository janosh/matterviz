<script lang="ts">
  import { format_num } from '$lib/labels'
  import type { StructurePlotProps } from '$lib/plot/bar'
  import StructureBarPlot from '$lib/plot/bar/StructureBarPlot.svelte'
  import { to_structure_entries } from '$lib/plot/core/structure-input'
  import type { StructureEntry, StructureInput } from '$lib/plot/core/structure-input'
  import type { BarHandlerProps, BarSeries } from '$lib/plot/core/types'
  import { to_error } from '$lib/utils'
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
  const id_options_snapshot = $derived(JSON.stringify(id_options))
  // Labels of the entries the current id_results were computed from; empty when the
  // results came in through the prop instead
  let computed_labels = $state<string[]>([])

  // Async compute can't be a $derived; a request id drops results of superseded inputs. The
  // cleanup also aborts them so the worker stops on a superseded input or unmount, and bumps
  // the id so the abort rejection of an unmounted plot never lands in error_msg.
  let request_id = 0
  // Whether the previous run had inputs to compute. Only then does a run without inputs reset
  // loading/error_msg: in results-only mode (id_results from the parent, no `structures`) those
  // are the parent's one-way props and must not be clobbered
  let owns_status = false
  $effect(() => {
    const inputs = entries
    const options: StructureIdOptions = JSON.parse(id_options_snapshot)
    const this_request = ++request_id
    if (inputs.length === 0) {
      computed_labels = []
      // A failure of the previous inputs must not outlive them: clear so an empty `structures`
      // after a failed compute shows the empty state, not the stale error
      if (owns_status) {
        loading = false
        error_msg = undefined
      }
      owns_status = false
      return
    }
    owns_status = true
    loading = true
    error_msg = undefined
    const controller = new AbortController()
    const { signal } = controller
    Promise.all(
      inputs.map(({ structure }) => calc_structure_id_async(structure, options, { signal })),
    )
      .then((computed) => {
        if (this_request !== request_id) return
        id_results = computed
        computed_labels = inputs.map(({ label }) => label)
      })
      .catch((err) => {
        if (this_request !== request_id) return
        // drop the stale populations, else `series` stays non-empty and the plot keeps
        // showing the previous inputs next to the error
        id_results = []
        computed_labels = []
        error_msg = to_error(err).message
      })
      .finally(() => {
        if (this_request === request_id) loading = false
      })
    return () => {
      request_id++
      controller.abort()
    }
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
