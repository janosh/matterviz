<script lang="ts">
  import { value_key } from '#lib/utils.js'
  import { format_num } from '#lib/labels.js'
  import type { Vec2 } from '#lib/math.js'
  import type { StructurePlotProps } from '#lib/plot/bar/index.js'
  import StructureBarPlot from '#lib/plot/bar/StructureBarPlot.svelte'
  import { to_structure_entries } from '#lib/plot/core/structure-input.js'
  import type { StructureEntry, StructureInput } from '#lib/plot/core/structure-input.js'
  import type { BarHandlerProps, BarSeries, UserContentProps } from '#lib/plot/core/types.js'
  import { use_async_result } from '#lib/trajectory/async-result.svelte.js'
  import { is_drag, series_hover_props } from '#lib/plot/core/interactions.js'
  import { calc_structure_id_async } from './async-compute.svelte'
  import type { CnaTypeName } from './calc-cna'
  import { CNA_TYPE_COLORS, CNA_TYPE_LABELS, CNA_TYPE_NAMES } from './calc-cna'
  import type { StructureIdOptions, StructureIdResult } from './calc-structure-id'
  import type { AnyStructure } from '#lib/structure/index.js'

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
    show_controls,
    controls_open = $bindable(false),
    current_frame = null,
    on_frame_click,
    on_type_hover,
    // Includes the shared `x_axis`/`y_axis` overrides, which StructureBarPlot merges over the
    // layout's primary/value axis defaults below (so callers can set label, range or format)
    ...rest
    // No on_sites_hover: id_results may come without structures and over_frames draws lines,
    // so bars do not map to sites; on_type_hover reports the hovered type instead
  }: Omit<StructurePlotProps, `structures` | `strategy` | `on_sites_hover`> & {
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
    current_frame?: number | null // `over_frames` only: x value marked with the playhead
    // `over_frames` only: the analysed frame nearest a click on the plot area or a point
    on_frame_click?: (frame: number) => void
    // Type of the line or legend entry under the pointer; null once it leaves
    on_type_hover?: (type: CnaTypeName | null) => void
  } = $props()

  let dropped_entries = $state<StructureEntry[]>([])
  const entries = $derived([...to_structure_entries(structures), ...dropped_entries])
  // Labels of the entries id_results are computed from (use_async_result drops results that
  // outlive their entries); empty when the results came in through the prop instead
  const computed_labels = $derived(entries.map(({ label }) => label))

  // Last result per structure (stored once resolved), so dropping one more file computes
  // only that file instead of re-posting every structure to the worker. Structures are
  // snapshots, as for every identity-keyed structure cache: an edit passes a new object.
  const id_cache = new WeakMap<AnyStructure, { key: string; result: StructureIdResult }>()
  use_async_result({
    input: () => (entries.length > 0 ? entries : undefined),
    options: () => id_options,
    compute: (inputs, options, signal) => {
      const key = value_key(options)
      return Promise.all(
        inputs.map(async ({ structure }) => {
          const cached = id_cache.get(structure)
          if (cached?.key === key) return cached.result
          const result = await calc_structure_id_async(structure, options, { signal })
          id_cache.set(structure, { key, result })
          return result
        }),
      )
    },
    set_result: (value) => (id_results = value ?? []),
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

  // Numeric frame x values the playhead and click-to-seek work in; empty for string labels
  const frame_xs = $derived(
    layout === `over_frames` && x_ticks.every((tick) => typeof tick === `number`)
      ? (x_ticks as number[])
      : [],
  )
  // Analysed frame nearest `pixel_x`, snapped in pixel space (no inverse scale needed, so it
  // holds under zoom). frame_xs is non-empty whenever the seek area calling this renders.
  const nearest_frame = (scale: (value: number) => number, pixel_x: number): number =>
    frame_xs.reduce((best, frame) =>
      Math.abs(scale(frame) - pixel_x) < Math.abs(scale(best) - pixel_x) ? frame : best,
    )
  // Where the last press on the seek area started (plain memory, read only by its click)
  let press_xy: Vec2 | null = null
  const type_hover = $derived(
    on_type_hover &&
      ((series_idx: number | null) =>
        on_type_hover(series_idx === null ? null : (live_types[series_idx] ?? null))),
  )

  const value_label = $derived(normalize ? `Fraction of atoms` : `Atoms`)
  const primary_axis = $derived({ label: layout === `over_frames` ? `Frame` : `Structure` })
  const value_axis = $derived({
    label: value_label,
    range: [0, null] as [number, null],
    ...(normalize ? {} : { format: `d` }),
  })
</script>

{#snippet frame_overlay(ctx: UserContentProps)}
  {@const { width, height, pad, x_scale_fn } = ctx}
  {@const playhead_x = current_frame == null ? NaN : x_scale_fn(current_frame)}
  {#if frame_xs.length > 0 && on_frame_click}
    <!-- Below the lines and points (user content renders first), so it only takes clicks on
    the empty plot area; points seek through on_point_click -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <rect
      class="frame-seek-area"
      x={pad.l}
      y={pad.t}
      width={Math.max(0, width - pad.l - pad.r)}
      height={Math.max(0, height - pad.t - pad.b)}
      fill="transparent"
      style:cursor="pointer"
      onmousedown={(event) => (press_xy = [event.clientX, event.clientY])}
      onclick={(event) => {
        const svg = event.currentTarget.ownerSVGElement
        // the click that ends a drag (zoom rectangle, pan) is not a seek
        if (!svg || (press_xy && is_drag(press_xy, event))) return
        on_frame_click(
          nearest_frame(x_scale_fn, event.clientX - svg.getBoundingClientRect().left),
        )
      }}
    />
  {/if}
  {#if frame_xs.length > 0 && playhead_x >= pad.l && playhead_x <= width - pad.r}
    <line
      class="current-frame-guide"
      x1={playhead_x}
      x2={playhead_x}
      y1={pad.t}
      y2={height - pad.b}
      stroke="var(--scatter-current-frame-color, #ff6b35)"
      stroke-opacity="0.6"
      stroke-dasharray="8 4"
      pointer-events="none"
    />
  {/if}
  {@render rest.user_content?.(ctx)}
{/snippet}

{#snippet structure_type_tooltip(info: BarHandlerProps<PlotMetadata>)}
  {info.x}
  <br />
  {value_label}: {format_num(info.y, normalize ? `.3~f` : `d`)}
{/snippet}

<StructureBarPlot
  {...rest}
  {...series_hover_props(type_hover, rest)}
  tooltip={rest.tooltip ?? structure_type_tooltip}
  user_content={layout === `over_frames` ? frame_overlay : rest.user_content}
  on_point_click={on_frame_click
    ? (event) => {
        if (frame_xs.includes(event.x)) on_frame_click(event.x)
        rest.on_point_click?.(event)
      }
    : rest.on_point_click}
  {show_controls}
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
/>
