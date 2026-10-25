<script lang="ts">
  // One descriptor of a sweep against its axis, a line per series: clicking a point selects
  // that frame (marked by the vertical line and a larger point, as is a compared frame), unstable frames are hollow and grey, a
  // descriptor's range draws as error bars and its threshold as a dashed line, the descriptors
  // it overlays as dashed lines on the same axes. Frames whose value is unknown yet (data not
  // loaded) are left out until it is; a value outside its range, or not finite, throws.
  import { chain_callbacks } from '#lib/plot/core/interactions.js'
  import { ScatterPlot } from '#lib/plot/index.js'
  import { html_to_text } from '#lib/utils.js'
  import type { DataSeries, PointStyle, RefLine } from '#lib/plot/index.js'
  import type { ComponentProps } from 'svelte'
  import { descriptor_point } from './sweep'
  import type { DescriptorSpec, Sweep, SweepFrame, SweepSeries } from './sweep'

  type PointMeta = { series_id: string; frame_idx: number }

  let {
    sweep,
    frame_of,
    series_id,
    frame_idx,
    compare,
    descriptor = $bindable(),
    on_frame_select,
    ...rest
  }: Partial<ComponentProps<typeof ScatterPlot>> & {
    sweep: Sweep
    frame_of: (series: SweepSeries, idx: number) => SweepFrame // with loaded data merged
    series_id: string // the selected frame's series and index
    frame_idx: number
    compare?: PointMeta // the frame shown beside the selected one, marked as large
    descriptor?: string // the key of the plotted descriptor (default: the first), else throws
    on_frame_select: (series_id: string, frame_idx: number) => void
  } = $props()

  const specs = $derived(sweep.descriptors ?? [])
  const spec = $derived.by((): DescriptorSpec | undefined => {
    if (descriptor === undefined) return specs[0]
    const match = specs.find(({ key }) => key === descriptor)
    if (match) return match
    const keys = specs.map(({ key }) => key).join(`, `)
    throw new Error(`descriptor "${descriptor}" is not a descriptor of the sweep (${keys})`)
  })
  const with_unit = (label: string, unit?: string) => (unit ? `${label} (${unit})` : label)

  // the plotted descriptor, then those it overlays (same unit, dashed)
  const lines = $derived(
    spec
      ? [
          spec,
          ...(spec.overlay ?? []).flatMap((key) => specs.filter((other) => other.key === key)),
        ]
      : [],
  )
  // each line's points per series (sweeps are a few frames: recomputed on every change),
  // apart from the selection so selecting recomputes no values
  const points = $derived(
    lines.flatMap((line, line_idx) =>
      sweep.series.map((entry) => ({
        entry,
        line,
        line_idx,
        points: entry.frames.flatMap((_frame, idx) => {
          const frame = frame_of(entry, idx)
          const point = descriptor_point(frame, line)
          return point ? [{ frame, idx, ...point }] : []
        }),
      })),
    ),
  )
  const series = $derived(
    points.map(({ entry, line, line_idx, points: line_points }): DataSeries<PointMeta> => {
      const { id, label = id } = entry
      const marked = new Set(
        [{ series_id, frame_idx }, ...(compare ? [compare] : [])].flatMap((point) =>
          point.series_id === id ? [point.frame_idx] : [],
        ),
      )
      const point_style = line_points.map(({ frame, idx }): PointStyle => ({
        radius: marked.has(idx) ? 7 : 4.5,
        cursor: `pointer`,
        ...(frame.status?.unstable && {
          fill: `transparent`,
          stroke: `gray`,
          stroke_width: 1.5,
        }),
      }))
      const ranged = line_points.some(({ lower, upper }) => lower !== null || upper !== null)
      const overlaid = lines.length > 1
      return {
        // NUL keeps overlay ids apart from any series id
        id: line_idx === 0 ? id : `${id}\u0000${line.key}`,
        // overlays name their descriptor, several series also their series
        label: !overlaid
          ? label
          : sweep.series.length > 1
            ? `${label} · ${line.label}`
            : line.label,
        x: line_points.map(({ frame }) => frame.value),
        y: line_points.map(({ value }) => value),
        markers: `line+points`,
        metadata: line_points.map(({ idx }) => ({ series_id: id, frame_idx: idx })),
        point_style,
        ...(line_idx > 0 && { line_style: { line_dash: `6 4` } }),
        ...(ranged && {
          y_error: {
            lower: line_points.map(({ value, lower }) => (lower === null ? 0 : value - lower)),
            upper: line_points.map(({ value, upper }) => (upper === null ? 0 : upper - value)),
          },
        }),
      }
    }),
  )
  const has_values = $derived(points.some((line) => line.points.length > 0))
  // the axis spans every frame, loaded or not, so it holds still while values arrive
  const x_range = $derived.by((): [number, number] => {
    const values = sweep.series.flatMap(({ frames }) => frames.map(({ value }) => value))
    const [min, max] = [Math.min(...values), Math.max(...values)]
    const pad = (max - min) * 0.05 || 1
    return [min - pad, max + pad]
  })
  const selected_value = $derived(
    sweep.series.find(({ id }) => id === series_id)?.frames[frame_idx]?.value ?? null,
  )
  const ref_lines = $derived<RefLine[]>(
    spec?.threshold === undefined
      ? []
      : [
          {
            type: `horizontal`,
            y: spec.threshold,
            style: { dash: `5 4`, opacity: 0.7 },
            annotation: { text: `threshold`, position: `end`, side: `above` },
          },
        ],
  )
</script>

{#if spec}
  <ScatterPlot
    show_legend={series.length > 1}
    {...rest}
    {series}
    {ref_lines}
    x_axis={{
      label: with_unit(sweep.axis.label, sweep.axis.unit),
      range: x_range,
      ...rest.x_axis,
    }}
    y_axis={{ label: with_unit(spec.label, spec.unit), ...rest.y_axis }}
    current_x_value={selected_value}
    on_point_click={chain_callbacks((event) => {
      const meta = event.point.metadata
      if (meta && typeof meta.series_id === `string` && typeof meta.frame_idx === `number`) {
        on_frame_select(meta.series_id, meta.frame_idx)
      }
    }, rest.on_point_click)}
  >
    {#snippet header_controls(dims)}
      {@render rest.header_controls?.(dims)}
      {#if specs.length > 1}
        <select
          class="descriptor-select"
          aria-label="Plotted descriptor"
          value={spec.key}
          onchange={(event) => (descriptor = event.currentTarget.value)}
        >
          {#each specs as { key, label, unit } (key)}
            <option value={key}>{html_to_text(with_unit(label, unit))}</option>
          {/each}
        </select>
      {/if}
    {/snippet}
    {#snippet children(ctx)}
      {@render rest.children?.(ctx)}
      {#if !has_values}
        <p class="no-values" style:width="{ctx.width}px" style:height="{ctx.height}px">
          No {html_to_text(spec.label)} values yet
        </p>
      {/if}
    {/snippet}
  </ScatterPlot>
{/if}

<style>
  .descriptor-select {
    max-width: 14em;
    font-size: 0.85em;
  }
  .no-values {
    position: absolute;
    inset: 0 auto auto 0;
    display: grid;
    place-items: center;
    margin: 0;
    pointer-events: none;
    color: var(--text-muted, currentColor);
    font-size: 0.9em;
  }
</style>
