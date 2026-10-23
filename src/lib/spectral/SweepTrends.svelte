<script lang="ts">
  // One descriptor of a sweep against its axis, a line per series: clicking a point selects
  // that frame (marked by the vertical line), unstable frames are hollow and grey, a
  // descriptor's range draws as error bars and its threshold as a dashed line. Frames whose
  // value is unknown yet (data not loaded) are left out until it is.
  import { chain_callbacks } from '#lib/plot/core/interactions.js'
  import { ScatterPlot } from '#lib/plot/index.js'
  import type { DataSeries, PointStyle, RefLine } from '#lib/plot/index.js'
  import type { ComponentProps } from 'svelte'
  import { descriptor_value } from './sweep'
  import type { DescriptorSpec, Sweep, SweepFrame, SweepSeries } from './sweep'

  type PointMeta = { series_id: string; frame_idx: number }

  let {
    sweep,
    frame_of,
    series_id,
    frame_idx,
    descriptor = $bindable(),
    on_frame_select,
    ...rest
  }: Partial<ComponentProps<typeof ScatterPlot>> & {
    sweep: Sweep
    frame_of: (series: SweepSeries, idx: number) => SweepFrame // with loaded data merged
    series_id: string // the selected frame's series and index
    frame_idx: number
    descriptor?: string // the key of the plotted descriptor (default: the first)
    on_frame_select: (series_id: string, frame_idx: number) => void
  } = $props()

  const specs = $derived(sweep.descriptors ?? [])
  const spec = $derived<DescriptorSpec | undefined>(
    specs.find(({ key }) => key === descriptor) ?? specs[0],
  )
  const with_unit = (label: string, unit?: string) => (unit ? `${label} (${unit})` : label)

  // each series' plotted points, apart from the selection so selecting recomputes no values
  const points = $derived.by(() => {
    const current = spec
    if (!current) return []
    return sweep.series.map((entry) =>
      entry.frames.flatMap((_frame, idx) => {
        const frame = frame_of(entry, idx)
        const value = descriptor_value(frame, current)
        if (typeof value !== `number` || !Number.isFinite(value)) return []
        const [lower, upper] = (current.range ?? []).map(
          (range_key) => frame.scalars?.[range_key],
        )
        return [{ frame, idx, value, lower, upper }]
      }),
    )
  })
  const series = $derived(
    points.map((series_points, series_idx): DataSeries<PointMeta> => {
      const { id, label } = sweep.series[series_idx]
      const selected = id === series_id
      const point_style = series_points.map(({ frame, idx }): PointStyle => {
        const unstable = frame.status?.unstable
        const radius = selected && idx === frame_idx ? 7 : 4.5
        return unstable
          ? {
              radius,
              fill: `transparent`,
              stroke: `gray`,
              stroke_width: 1.5,
              cursor: `pointer`,
            }
          : { radius, cursor: `pointer` }
      })
      const ranged = series_points.some(({ lower, upper }) => lower != null || upper != null)
      return {
        id,
        label: label ?? id,
        x: series_points.map(({ frame }) => frame.value),
        y: series_points.map(({ value }) => value),
        markers: `line+points`,
        metadata: series_points.map(({ idx }) => ({ series_id: id, frame_idx: idx })),
        point_style,
        ...(ranged && {
          y_error: {
            lower: series_points.map(({ value, lower }) =>
              lower == null ? 0 : value - lower,
            ),
            upper: series_points.map(({ value, upper }) =>
              upper == null ? 0 : upper - value,
            ),
          },
        }),
      }
    }),
  )
  const has_values = $derived(points.some((series_points) => series_points.length > 0))
  // the axis spans every frame, loaded or not, so it holds still while values arrive
  const x_range = $derived.by((): [number, number] => {
    const values = sweep.series.flatMap(({ frames }) => frames.map(({ value }) => value))
    const [min, max] = [Math.min(...values), Math.max(...values)]
    const pad = (max - min) * 0.05 || 1
    return [min - pad, max + pad]
  })
  const selected_frame = $derived.by(() => {
    const selected = sweep.series.find(({ id }) => id === series_id)
    return selected?.frames[frame_idx]
  })
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
    show_legend={sweep.series.length > 1}
    {...rest}
    {series}
    {ref_lines}
    x_axis={{
      label: with_unit(sweep.axis.label, sweep.axis.unit),
      range: x_range,
      ...rest.x_axis,
    }}
    y_axis={{ label: with_unit(spec.label, spec.unit), ...rest.y_axis }}
    current_x_value={selected_frame?.value ?? null}
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
            <option value={key}>{with_unit(label, unit)}</option>
          {/each}
        </select>
      {/if}
    {/snippet}
    {#snippet children(ctx)}
      {@render rest.children?.(ctx)}
      {#if !has_values}
        <p class="no-values" style:width="{ctx.width}px" style:height="{ctx.height}px">
          No {spec.label} values yet
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
