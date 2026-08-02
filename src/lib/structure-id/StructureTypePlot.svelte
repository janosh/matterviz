<script lang="ts">
  import { StatusMessage } from '$lib/feedback'
  import { format_num } from '$lib/labels'
  import { BarPlot } from '$lib/plot'
  import type { BarHandlerProps, BarSeries } from '$lib/plot/core/types'
  import type { AnyStructure } from '$lib/structure'
  import { to_error } from '$lib/utils'
  import type { ComponentProps } from 'svelte'
  import { compute_structure_id_async } from './async-compute.svelte'
  import type { CnaTypeName } from './calc-cna'
  import { CNA_TYPE_COLORS, CNA_TYPE_LABELS, CNA_TYPE_NAMES } from './calc-cna'
  import type { StructureIdOptions, StructureIdResult } from './index'

  type PlotMetadata = Record<string, unknown>

  let {
    id_results = $bindable([]),
    structures,
    id_options = {},
    // `by_type` puts the five CNA types on the x axis, one bar series per result — the view
    // for comparing a handful of structures. `over_frames` puts the frame index on the x axis
    // and draws one line per type, which is how a phase transition shows up in a trajectory.
    layout = `by_type`,
    normalize = false,
    frame_labels,
    loading = $bindable(false),
    error_msg = $bindable(),
    x_axis = {},
    y_axis = {},
    ...rest
  }: {
    // Precomputed per-frame results. Bindable so a parent can read back what `structures` produced.
    id_results?: StructureIdResult[]
    // Supply structures instead of `id_results` to have this component compute (in a worker)
    structures?: AnyStructure[]
    id_options?: StructureIdOptions
    layout?: `by_type` | `over_frames`
    // Plot the fraction of atoms rather than the raw count
    normalize?: boolean
    // x tick labels in `over_frames` layout; defaults to the result index
    frame_labels?: (number | string)[]
    loading?: boolean
    error_msg?: string
    x_axis?: ComponentProps<typeof BarPlot>[`x_axis`]
    y_axis?: ComponentProps<typeof BarPlot>[`y_axis`]
  } & ComponentProps<typeof BarPlot> = $props()

  const id_options_snapshot = $derived(JSON.stringify(id_options))

  // Async compute can't be a $derived; a request id drops results of superseded inputs
  let request_id = 0
  $effect(() => {
    const inputs = structures
    const options: StructureIdOptions = JSON.parse(id_options_snapshot)
    if (!inputs?.length) return
    const this_request = ++request_id
    loading = true
    error_msg = undefined
    Promise.all(inputs.map((structure) => compute_structure_id_async(structure, options)))
      .then((computed) => {
        if (this_request !== request_id) return
        id_results = computed
      })
      .catch((err) => {
        if (this_request !== request_id) return
        // drop the stale populations, else `series` stays non-empty and the empty-state
        // StatusMessage that owns the error display never renders
        id_results = []
        error_msg = to_error(err).message
      })
      .finally(() => {
        if (this_request === request_id) loading = false
      })
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
  const type_labels = $derived(live_types.map((name) => CNA_TYPE_LABELS[name]))
  const frame_ticks = $derived(frame_labels ?? id_results.map((_result, idx) => idx))

  const series = $derived.by<BarSeries<PlotMetadata>[]>(() => {
    if (id_results.length === 0) return []
    if (layout === `by_type`) {
      return id_results.map((result, idx) => ({
        x: type_labels,
        y: live_types.map((name) => value_of(result, name)),
        label:
          id_results.length === 1
            ? `${result.n_atoms} atoms`
            : String(frame_ticks[idx] ?? idx),
        // A single series is colored per type via the bars themselves; with several results the
        // series need distinguishing, so fall back to the type palette cycled by index.
        color:
          id_results.length === 1
            ? undefined
            : CNA_TYPE_COLORS[CNA_TYPE_NAMES[idx % CNA_TYPE_NAMES.length]],
        bar_width: 0.8,
        visible: true,
        metadata: live_types.map((name) => ({ cna_type: CNA_TYPE_LABELS[name] })),
      }))
    }
    return live_types.map((name) => ({
      x: frame_ticks,
      y: id_results.map((result) => value_of(result, name)),
      label: CNA_TYPE_LABELS[name],
      color: CNA_TYPE_COLORS[name],
      render_mode: `line` as const,
      markers: `line+points` as const,
      visible: true,
      metadata: id_results.map(() => ({ cna_type: CNA_TYPE_LABELS[name] })),
    }))
  })

  const value_label = $derived(normalize ? `Fraction of atoms` : `Atoms`)
  const resolved_x_axis = $derived({
    label: layout === `by_type` ? `Structure type` : `Frame`,
    ...x_axis,
  })
  const resolved_y_axis = $derived({
    label: value_label,
    range: [0, null] as [number, null],
    ...(normalize ? {} : { format: `d` }),
    ...y_axis,
  })
</script>

{#if series.length === 0}
  <!-- Single owner of the message area: an error replaces the empty state rather than
  stacking a second StatusMessage above it -->
  <StatusMessage
    message={error_msg ??
      (loading ? `Identifying structure types…` : `No structure-type data to display`)}
    type={error_msg ? `error` : `info`}
    style={error_msg ? `` : `border: none`}
  />
{:else}
  <BarPlot
    {...rest}
    {series}
    x_axis={resolved_x_axis}
    y_axis={resolved_y_axis}
    mode={id_results.length > 1 && layout === `by_type` ? `grouped` : `overlay`}
    style={rest.style ?? `height: 300px;`}
  >
    {#snippet tooltip(info: BarHandlerProps<PlotMetadata>)}
      {info.metadata?.cna_type ?? info.x}
      <br />
      {value_label}: {format_num(info.y, normalize ? `.3~f` : `d`)}
    {/snippet}
  </BarPlot>
{/if}
