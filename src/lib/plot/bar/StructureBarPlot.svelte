<script lang="ts">
  // Shell shared by the bar plots that histogram one-or-many structures ($lib/bond-angles,
  // $lib/coordination): file-drop wiring, the empty state and the orientation-dependent axis
  // merge. Callers own the maths and hand back finished series plus a tooltip snippet.
  import { StatusMessage } from 'svelte-widgets'
  import { drag_over_handlers } from '$lib/io'
  import type { FileLoadCallback } from '$lib/io'
  import type {
    AxisConfig,
    BarHandlerProps,
    BarSeries,
    Orientation,
  } from '$lib/plot/core/types'
  import { create_structure_drop_handler } from '$lib/plot/core/structure-input'
  import type { StructureEntry } from '$lib/plot/core/structure-input'
  import type { ComponentProps, Snippet } from 'svelte'
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
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    ...rest
  }: Omit<ComponentProps<typeof BarPlot>, `series` | `tooltip`> & {
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
    // to the caller.
    tooltip?: Snippet<[BarHandlerProps<Record<string, unknown>>]>
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
  } = $props()

  let dragover = $state(false)
  const is_horizontal = $derived(orientation === `horizontal`)
  let display = $derived({ x_zero_line: is_horizontal, y_zero_line: !is_horizontal })

  const handle_file_drop = create_structure_drop_handler({
    allow: () => allow_file_drop,
    on_file_drop: () => on_file_drop,
    on_entry: (entry) => (dropped_entries = [entry, ...dropped_entries]),
    on_error: (msg) => {
      error_msg = msg
    },
    set_loading: (val) => {
      loading = val
      if (val) [error_msg, dragover] = [undefined, false]
    },
  })
</script>

{#snippet labelled_tooltip(info: BarHandlerProps<Record<string, unknown>>)}
  {#each Object.values(info.metadata ?? {}) as value, idx (idx)}
    {#if typeof value === `string`}{value} —{/if}
  {/each}
  {@render tooltip?.(info)}
{/snippet}

<StatusMessage bind:message={error_msg} type="error" dismissible />

{#if series.length === 0}
  <StatusMessage
    message={loading
      ? loading_message
      : allow_file_drop
        ? `Drag and drop structure files here to compute ${subject}`
        : `No ${empty_subject} to display`}
    ondrop={handle_file_drop}
    {...drag_over_handlers({
      allow: () => allow_file_drop,
      set_dragover: (over) => (dragover = over),
    })}
  />
{:else}
  <BarPlot
    {...rest}
    bind:show_controls
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
    tooltip={labelled_tooltip}
    ondrop={handle_file_drop}
    {...drag_over_handlers({
      allow: () => allow_file_drop,
      set_dragover: (over) => (dragover = over),
    })}
    class={[rest.class, dragover && `dragover`]}
  />
{/if}
