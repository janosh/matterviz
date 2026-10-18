<script lang="ts">
  import type { BarPlotOptions } from '#lib/plot/index.js'
  // Shell shared by the bar plots that histogram one-or-many structures (#lib/bond-angles,
  // #lib/coordination): file-drop wiring, the empty state and the orientation-dependent axis
  // merge. Callers own the maths and hand back finished series plus a tooltip snippet.
  import StatusMessage from 'svelte-widgets/StatusMessage.svelte'
  import ViewerNotices from '#lib/layout/ViewerNotices.svelte'
  import type { FileLoadCallback } from '#lib/io/index.js'
  import type {
    AxisConfig,
    BarHandlerProps,
    BarSeries,
    Orientation,
  } from '#lib/plot/core/types.js'
  import { on_change } from '#lib/plot/core/interactions.js'
  import { structure_drop_zone } from '#lib/plot/core/structure-input.js'
  import type {
    StructureEntry,
    StructureSiteHighlight,
  } from '#lib/plot/core/structure-input.js'
  import type { Snippet } from 'svelte'
  import type { TooltipProp } from '#lib/tooltip/index.js'
  import BarPlot from './BarPlot.svelte'

  let {
    series,
    primary_axis,
    value_axis,
    subject,
    empty_subject = subject,
    tooltip,
    dropped_entries = $bindable([]),
    mode = $bindable(`grouped`),
    orientation = $bindable(`vertical` as Orientation),
    x_axis = {},
    y_axis = {},
    allow_file_drop = true,
    on_file_drop,
    loading = $bindable(false),
    loading_message = `Reading dropped file…`,
    error_msg = $bindable(),
    show_controls,
    controls_open = $bindable(false),
    on_bar_change,
    bar_sites,
    on_sites_hover,
    ...rest
  }: Omit<BarPlotOptions, `tooltip`> & {
    // Not generic over the metadata type: BarPlot's snippet prop is invariant in it, so a
    // narrower Metadata here fails to satisfy Snippet<[BarHandlerProps<Record<string, unknown>>]>.
    // Callers keep their metadata fields optional, which makes both directions assignable.
    series: BarSeries<Record<string, unknown>>[]
    // The quantity being histogrammed (bond angle, coordination number) and the count axis.
    // Which one lands on x and which on y follows `orientation`.
    primary_axis: AxisConfig
    value_axis: AxisConfig
    // Fills `Drag and drop structure files here to compute ${subject}` and, unless
    // `empty_subject` overrides it, `No ${subject} to display`
    subject: string
    empty_subject?: string
    // Rendered after the series identity: every STRING-valued metadata field of the hovered
    // bar is emitted as a `value —` prefix, in insertion order, so both callers stop repeating
    // the same {#if element}/{#if structure_label} pair. Numeric metadata (bin_width) is left
    // to the caller. false hides the tooltip.
    tooltip?: TooltipProp<BarHandlerProps<Record<string, unknown>>>
    // Structures parsed out of dropped files, prepended as they arrive. Callers bind this and
    // fold it into their own series maths.
    dropped_entries?: StructureEntry[]
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    allow_file_drop?: boolean
    on_file_drop?: FileLoadCallback
    loading?: boolean
    // Empty-state text while `loading`; wrappers that compute asynchronously name their job
    loading_message?: string
    error_msg?: string
    // on_bar_hover, but only when the hovered bar changes (BarPlot reports every pointer move)
    on_bar_change?: BarPlotOptions[`on_bar_hover`]
    // The sites a bar counts, per structure it draws from. Wrappers supply it to back
    // on_sites_hover, which fires alongside on_bar_change with null once the pointer leaves
    bar_sites?: (bar: BarHover) => StructureSiteHighlight[]
    on_sites_hover?: (highlights: StructureSiteHighlight[] | null) => void
  } = $props()
  type BarHover = NonNullable<Parameters<NonNullable<BarPlotOptions[`on_bar_hover`]>>[0]>

  let dragover = $state(false)
  const is_horizontal = $derived(orientation === `horizontal`)
  let display = $derived({ x_zero_line: is_horizontal, y_zero_line: !is_horizontal })

  // The latest drop's recoverable parse warnings, one dismissible notice
  let parse_warning_msg = $state<string>()
  const drop_zone = structure_drop_zone({
    allow: () => allow_file_drop,
    on_file_drop: () => on_file_drop,
    on_structure: (structure, label) => {
      if (!structure.sites.length) throw new Error(`no sites, nothing to plot`)
      dropped_entries = [{ label, structure }, ...dropped_entries]
    },
    on_error: (msg) => (error_msg = msg),
    on_warning: (msg) => (parse_warning_msg = msg),
    set_loading: (val) => (loading = val),
    on_dragover: (over) => (dragover = over),
  })
  const report_bar_change = on_change(
    (bar: BarHover | null) => bar && `${bar.series_idx}:${bar.bar_idx}`,
    (bar) => {
      on_bar_change?.(bar)
      if (bar_sites) on_sites_hover?.(bar && bar_sites(bar))
    },
  )
</script>

{#snippet labelled_tooltip(info: BarHandlerProps<Record<string, unknown>>)}
  {#each Object.values(info.metadata ?? {}) as value, idx (idx)}
    {#if typeof value === `string`}{value} —{/if}
  {/each}
  {#if tooltip}{@render tooltip(info)}{/if}
{/snippet}

<!-- one positioned root: the error floats over the plot instead of taking a grid cell
     or pushing it down -->
<div style="position: relative; height: 100%">
  {#if series.length === 0}
    <StatusMessage
      message={loading
        ? loading_message
        : allow_file_drop
          ? `Drag and drop structure files here to compute ${subject}`
          : `No ${empty_subject} to display`}
      {@attach drop_zone}
    />
  {:else}
    <BarPlot
      {...rest}
      {show_controls}
      bind:controls_open
      {series}
      bind:orientation
      bind:mode
      x_axis={{
        ...(is_horizontal ? value_axis : primary_axis),
        ...x_axis,
        label_shift: (is_horizontal ? y_axis : x_axis).label_shift,
      }}
      y_axis={{
        ...(is_horizontal ? primary_axis : value_axis),
        ...y_axis,
        label_shift: { x: 2, ...(is_horizontal ? x_axis : y_axis).label_shift },
      }}
      bind:display
      tooltip={tooltip === false ? false : labelled_tooltip}
      on_bar_hover={on_bar_change
        ? (bar) => {
            rest.on_bar_hover?.(bar)
            report_bar_change(bar)
          }
        : rest.on_bar_hover}
      {@attach drop_zone}
      class={[rest.class, dragover && `dragover`]}
    />
  {/if}
  <ViewerNotices>
    <StatusMessage bind:message={error_msg} type="error" dismissible />
    <StatusMessage bind:message={parse_warning_msg} type="warning" dismissible />
  </ViewerNotices>
</div>
