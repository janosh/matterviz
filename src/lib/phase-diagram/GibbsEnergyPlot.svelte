<script lang="ts">
  // Gibbs energy of mixing of every phase at one temperature with the lower convex hull and
  // its common tangents (the tie lines of the phase diagram at that T). Bind the diagram's
  // cursor to follow its hovered temperature and composition (and to move it from here), and
  // its x_frame to share its composition axis.
  import { hsl } from 'd3-color'
  import { format_num } from '#lib/labels.js'
  import type { Vec2 } from '#lib/math.js'
  import { sanitize_formula } from '#lib/sanitize.js'
  import { scaleLinear } from 'd3-scale'
  import type { HTMLAttributes } from 'svelte/elements'
  import { common_tangents, gibbs_curves, lower_hull } from './analysis'
  import { phase_colors } from './diagram'
  import type {
    BinaryPhaseDiagram,
    CompUnit,
    DiagramCursor,
    DiagramXFrame,
    TempUnit,
  } from './types'
  import { format_composition, format_temperature, generate_boundary_path } from './utils'

  let {
    data,
    cursor = $bindable(null),
    temperature = null,
    x_frame = null,
    phase_color_keys = [],
    temp_unit = `K`,
    comp_unit = `at%`,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    data: BinaryPhaseDiagram // needs data.gibbs_energy
    // Shared (x, T) cursor: its T picks the curves and its x is read out. Hovering this plot
    // sets it at the shown T, so a diagram bound to the same cursor marks the composition.
    cursor?: DiagramCursor | null
    // T shown before any cursor (default: the middle of the Gibbs grid); afterwards the last
    // cursor T inside the grid stays, so the plot doesn't jump when the pointer moves into it
    temperature?: number | null
    // A stacked diagram's composition axis (its x_frame) to align with, else [0, 1] edge to
    // edge. Its pixel range assumes this plot shares the diagram's left edge and width.
    x_frame?: DiagramXFrame | null
    phase_color_keys?: readonly string[]
    temp_unit?: TempUnit
    comp_unit?: CompUnit
  } = $props()

  let width = $state(0)
  let height = $state(0)
  let header_height = $state(0)
  const pad = { r: 12, b: 22, l: 52 }
  const uid = $props.id()
  const clip_id = `gibbs-clip-${uid}`

  const grid = $derived(data.gibbs_energy)
  const [component_a, component_b] = $derived(data.components)
  // Per model phase: its first composition set's pastel fill, darkened to read as a line,
  // and its label (the model phase's name where several composition sets share it)
  const style_of = $derived.by(() => {
    const fills = phase_colors(data.phases, phase_color_keys)
    const groups = Map.groupBy(data.phases, ({ model_phase }) => model_phase)
    return new Map(
      [...groups].map(([model_phase, [first, ...others]]) => {
        const fill = fills.get(first.id)
        if (!fill) throw new Error(`No color for phase "${first.id}"`)
        const color = hsl(fill).darker(0.9).formatHex()
        return [model_phase, { color, label: others.length ? model_phase : first.label }]
      }),
    )
  })
  // grid phases are validated to name model phases of this diagram, so a miss is a bug
  const style_at = (id: string) => {
    const style = style_of.get(id)
    if (!style) throw new Error(`Gibbs grid phase "${id}" is not a model phase`)
    return style
  }

  const t_range = $derived(
    grid && [grid.temperatures[0], grid.temperatures[grid.temperatures.length - 1]],
  )
  const in_grid = (t_val: number) =>
    t_range !== undefined && t_val >= t_range[0] && t_val <= t_range[1]
  // The last cursor T inside the grid outlives the cursor, so leaving the diagram doesn't
  // blank this plot. Written as a side effect of this derived, which every render reads.
  let last_cursor_t: number | null = null
  const t_value = $derived.by(() => {
    if (cursor && in_grid(cursor.temperature)) last_cursor_t = cursor.temperature
    if (!t_range) return null
    return cursor?.temperature ?? last_cursor_t ?? temperature ?? (t_range[0] + t_range[1]) / 2
  })

  // Why nothing is drawn, null when the view below is
  const empty_message = $derived.by(() => {
    if (t_value === null) return `No Gibbs energies in this diagram`
    if (!in_grid(t_value)) {
      return `${format_temperature(t_value, temp_unit)} is outside the Gibbs energy grid`
    }
    return null
  })

  // Linear interpolation along a polyline sorted by x, null outside its x span
  const value_at = (points: readonly Vec2[], x_val: number): number | null => {
    const end_idx = points.findIndex(([x_pt]) => x_pt >= x_val)
    if (end_idx === -1) return null
    if (end_idx === 0) return points[0][0] === x_val ? points[0][1] : null
    const [[x_0, g_0], [x_1, g_1]] = [points[end_idx - 1], points[end_idx]]
    return g_0 + ((g_1 - g_0) * (x_val - x_0)) / (x_1 - x_0)
  }

  // Curves relative to the line joining the hull's ends at x = 0 and 1 (energy of mixing), in
  // kJ/mol so the wells and tangents share one scale. A hull short of either edge (no phase
  // defined there at this T) has no such reference line, so nothing is drawn.
  const view = $derived.by(() => {
    if (!grid || t_value === null || empty_message) return null
    const curves = gibbs_curves(grid, t_value).filter(({ points }) => points.length)
    const hull = lower_hull(curves)
    if (hull.length < 2) return null
    const [[x_0, g_0], [x_1, g_1]] = [hull[0].point, hull[hull.length - 1].point]
    if (x_0 !== 0 || x_1 !== 1) return null
    const slope = (g_1 - g_0) / (x_1 - x_0)
    const mix = ([x_val, g_val]: Vec2): Vec2 => [
      x_val,
      (g_val - g_0 - slope * (x_val - x_0)) / 1000,
    ]
    const mixed = curves.map(({ id, points }) => ({ id, points: points.map(mix) }))
    const hull_min = Math.min(...hull.map(({ point }) => mix(point)[1]))
    const g_max = Math.max(...mixed.flatMap(({ points }) => points.map(([, g_val]) => g_val)))
    // the window tops out a few hull depths (at least 2 kJ/mol) above the hull's minimum, so
    // the wells and tangents stay readable when a curve shoots up far from its stable range;
    // at least 1 kJ/mol tall when every curve sits on the hull
    const g_cap = hull_min + Math.max(4 * Math.abs(hull_min), 2)
    const g_top = Math.max(hull_min + 1, Math.min(g_max, g_cap))
    const margin = 0.08 * (g_top - hull_min)
    return {
      t_value,
      curves: mixed,
      hull: hull.map(({ point }) => mix(point)),
      tangents: common_tangents(hull).map(
        ({ start, end }) => [mix(start.point), mix(end.point)] as const,
      ),
      domain: [hull_min - margin, g_top + margin] as Vec2,
    }
  })

  // At the cursor's composition: each curve's value (null outside its range), and the hull's
  // tangent there (a common tangent in a two-phase field), whose ends at x = 0 and 1 are the
  // components' chemical potentials relative to the pure references. The hull spans [0, 1].
  const readout = $derived.by(() => {
    if (!view || !cursor) return null
    const { composition } = cursor
    const seg_idx = Math.max(
      1,
      view.hull.findIndex(([x_val]) => x_val >= composition),
    )
    const [[x_0, g_0], [x_1, g_1]] = [view.hull[seg_idx - 1], view.hull[seg_idx]]
    const slope = (g_1 - g_0) / (x_1 - x_0)
    const mu_a = g_0 - slope * x_0
    return {
      composition,
      hull_g: mu_a + slope * composition,
      tangent: [mu_a, mu_a + slope] as Vec2,
      values: view.curves.map(({ points }) => value_at(points, composition)),
    }
  })

  const x_scale = $derived(
    scaleLinear()
      .domain(x_frame?.domain ?? [0, 1])
      .range(x_frame?.range ?? [pad.l, width - pad.r]),
  )
  // the header row (title, legend) may wrap, so the plot starts below its measured height
  const plot_top = $derived(Math.max(26, header_height + 6))
  const plot_bottom = $derived(height - pad.b)
  const y_scale = $derived(
    scaleLinear()
      .domain(view?.domain ?? [-1, 1])
      .range([plot_bottom, plot_top]),
  )
  const [plot_left, plot_right] = $derived(x_scale.range())
  const x_ticks = $derived(x_scale.ticks(5))
  const y_ticks = $derived(y_scale.ticks(4))
  const path_of = (points: readonly Vec2[]) =>
    generate_boundary_path(
      points.map(([x_val, g_val]): Vec2 => [x_scale(x_val), y_scale(g_val)]),
    )
  const fmt_g = (g_val: number) => format_num(g_val, `.2f`)
  const clamp = (val: number, lo: number, hi: number) => Math.min(Math.max(val, lo), hi)

  // Hovering moves the shared cursor along this plot's composition axis at the shown T
  const on_pointermove = (event: PointerEvent) => {
    if (!view) return
    const svg = event.currentTarget as SVGSVGElement
    const px = event.clientX - svg.getBoundingClientRect().left
    if (px < plot_left || px > plot_right) return on_pointerleave()
    const composition = clamp(x_scale.invert(px), 0, 1)
    cursor = { composition, temperature: view.t_value, source: uid }
  }
  const on_pointerleave = () => {
    if (cursor?.source === uid) cursor = null
  }
</script>

<div
  {...rest}
  class={[`gibbs-energy-plot`, rest.class]}
  bind:clientWidth={width}
  bind:clientHeight={height}
>
  {#if t_value === null}
    <!-- nothing to plot at any T, so no plot-sized box -->
    <p class="empty no-data">{empty_message}</p>
  {:else if empty_message}
    <p class="empty">{empty_message}</p>
  {:else if !view}
    <p class="empty">No Gibbs energies spanning both pure components at this temperature</p>
  {:else if width > 0 && height > 0}
    {@const shown_t = format_temperature(view.t_value, temp_unit)}
    <!-- title and legend share one row above the plot, the legend reading out each phase's
    ΔG (and its height above the hull) at the cursor -->
    <header
      style:left="{plot_left}px"
      style:right="{width - plot_right}px"
      bind:clientHeight={header_height}
    >
      <strong class="title">ΔG<sub>mix</sub> at {shown_t}</strong>
      {#if readout}
        <span class="at-x"
          >{format_composition(readout.composition, comp_unit)}
          {@html sanitize_formula(component_b, true)}</span
        >
      {/if}
      <span class="legend">
        {#each view.curves as { id }, idx (id)}
          {@const { color, label } = style_at(id)}
          {@const g_val = readout?.values[idx]}
          <span>
            <i style:background={color}></i>{label}
            {#if g_val != null && readout}
              {@const above = g_val - readout.hull_g}
              <b>{fmt_g(g_val)}</b>
              {#if above > 1e-6}<small>+{fmt_g(above)}</small>{/if}
            {/if}
          </span>
        {/each}
      </span>
    </header>
    <svg
      {width}
      {height}
      role="img"
      aria-label="Gibbs energy of mixing at {shown_t}"
      onpointermove={on_pointermove}
      onpointerleave={on_pointerleave}
      style="touch-action: pan-y"
    >
      <defs>
        <clipPath id={clip_id}>
          <rect
            x={plot_left}
            y={plot_top}
            width={plot_right - plot_left}
            height={plot_bottom - plot_top}
          />
        </clipPath>
      </defs>
      <g class="grid">
        {#each x_ticks as tick (tick)}
          <line x1={x_scale(tick)} x2={x_scale(tick)} y1={plot_top} y2={plot_bottom} />
        {/each}
        {#each y_ticks as tick (tick)}
          <line x1={plot_left} x2={plot_right} y1={y_scale(tick)} y2={y_scale(tick)} />
        {/each}
      </g>
      <g clip-path="url(#{clip_id})">
        <line x1={plot_left} x2={plot_right} y1={y_scale(0)} y2={y_scale(0)} class="zero" />
        {#if readout}
          <line
            x1={x_scale(0)}
            y1={y_scale(readout.tangent[0])}
            x2={x_scale(1)}
            y2={y_scale(readout.tangent[1])}
            class="cursor-tangent"
          />
        {/if}
        {#each view.curves as { id, points } (id)}
          {@const { color, label } = style_at(id)}
          {#if points.length === 1}
            <circle
              cx={x_scale(points[0][0])}
              cy={y_scale(points[0][1])}
              r="3.5"
              fill={color}
            />
          {:else}
            <path d={path_of(points)} stroke={color} class="curve">
              <title>{label}</title>
            </path>
          {/if}
        {/each}
        <path d={path_of(view.hull)} class="hull" />
        {#each view.tangents as [start, end], idx (idx)}
          <line
            x1={x_scale(start[0])}
            y1={y_scale(start[1])}
            x2={x_scale(end[0])}
            y2={y_scale(end[1])}
            class="tangent"
          />
        {/each}
        {#if readout}
          {@const cursor_x = x_scale(readout.composition)}
          <line x1={cursor_x} x2={cursor_x} y1={plot_top} y2={plot_bottom} class="cursor" />
          {#each view.curves as { id }, idx (id)}
            {@const g_val = readout.values[idx]}
            {#if g_val != null}
              <circle
                cx={cursor_x}
                cy={y_scale(g_val)}
                r="3"
                fill={style_at(id).color}
                class="cursor-marker"
              />
            {/if}
          {/each}
        {/if}
      </g>
      {#if readout}
        <!-- the cursor tangent's ends: chemical potentials of A (x = 0) and B (x = 1), each
        shown while its edge is in the (possibly zoomed) composition window -->
        {#each [component_a, component_b] as component, idx (idx)}
          {@const mu = readout.tangent[idx]}
          {@const label_x = x_scale(idx)}
          {@const [g_lo, g_hi] = view.domain}
          <!-- an end off the y window is labelled at the plot's edge, pointing to it -->
          {@const off_scale = mu < g_lo ? ` ↓` : mu > g_hi ? ` ↑` : ``}
          {#if label_x >= plot_left - 0.5 && label_x <= plot_right + 0.5}
            <text
              x={label_x + (idx ? -4 : 4)}
              y={clamp(y_scale(mu) + (mu > 0 ? 12 : -6), plot_top + 10, plot_bottom - 4)}
              text-anchor={idx ? `end` : `start`}
              class="mu"
              >Δμ<tspan baseline-shift="sub" font-size="0.75em">{component}</tspan> = {fmt_g(
                mu,
              )}{off_scale}</text
            >
          {/if}
        {/each}
      {/if}
      <g class="axis">
        {#each x_ticks as tick (tick)}
          <text x={x_scale(tick)} y={plot_bottom + 14} text-anchor="middle">
            {format_composition(tick, comp_unit, false)}
          </text>
        {/each}
        {#each y_ticks as tick (tick)}
          <text
            x={plot_left - 6}
            y={y_scale(tick)}
            text-anchor="end"
            dominant-baseline="middle"
          >
            {format_num(tick, `.3~`)}
          </text>
        {/each}
        <text
          x={plot_left - 38}
          y={(plot_top + plot_bottom) / 2}
          transform="rotate(-90 {plot_left - 38} {(plot_top + plot_bottom) / 2})"
          text-anchor="middle">kJ/mol</text
        >
      </g>
    </svg>
  {/if}
</div>

<style>
  .gibbs-energy-plot {
    position: relative;
    width: 100%;
    height: 220px;
    font-size: 11px;
    &:has(> .no-data) {
      height: auto;
    }
    svg {
      display: block;
      overflow: visible;
    }
    text {
      fill: var(--text-color, #333);
    }
  }
  header {
    position: absolute;
    top: 2px;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    pointer-events: none;
    font-variant-numeric: tabular-nums;
    .title {
      font-size: 12px;
    }
    .at-x {
      opacity: 0.8;
    }
    .legend {
      margin-left: auto;
      display: flex;
      flex-wrap: wrap;
      gap: 2px 10px;
      span {
        display: flex;
        align-items: baseline;
        gap: 4px;
        font-weight: 600;
      }
      i {
        align-self: center;
        width: 12px;
        height: 3px;
      }
      b {
        font-weight: 500;
      }
      small {
        font-weight: normal;
        opacity: 0.65;
      }
    }
  }
  .empty {
    margin: 0;
    padding: 1em;
    text-align: center;
    opacity: 0.7;
  }
  .curve {
    fill: none;
    stroke-width: 2;
  }
  .hull {
    fill: none;
    stroke: var(--text-color, #333);
    stroke-width: 1;
    stroke-dasharray: 3, 3;
  }
  .tangent {
    stroke: #d32f2f;
    stroke-width: 2.5;
  }
  .cursor-tangent {
    stroke: var(--text-color, #333);
    stroke-opacity: 0.55;
    stroke-width: 1;
    stroke-dasharray: 6, 3;
  }
  .cursor-marker {
    stroke: var(--page-bg, white);
    stroke-width: 1;
  }
  .mu {
    font-size: 10px;
    paint-order: stroke;
    stroke: var(--page-bg, white);
    stroke-width: 3px;
  }
  .grid line {
    stroke: rgba(128, 128, 128, 0.18);
    stroke-dasharray: 4, 4;
  }
  .zero {
    stroke: rgba(128, 128, 128, 0.5);
  }
  .cursor {
    stroke: #ff6b6b;
    stroke-dasharray: 4, 3;
  }
</style>
