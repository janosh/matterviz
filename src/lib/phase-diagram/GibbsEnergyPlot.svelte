<script lang="ts">
  // Gibbs energy of mixing of every phase at one temperature with the lower convex hull and
  // its common tangents (the tie lines of the phase diagram at that T). Bind the diagram's
  // cursor to follow its hovered temperature and composition.
  import { hsl } from 'd3-color'
  import { format_num } from '#lib/labels.js'
  import type { Vec2 } from '#lib/math.js'
  import { scaleLinear } from 'd3-scale'
  import type { HTMLAttributes } from 'svelte/elements'
  import { common_tangents, gibbs_curves, lower_hull } from './analysis'
  import { phase_colors } from './diagram'
  import type { BinaryPhaseDiagram, CompUnit, DiagramCursor, TempUnit } from './types'
  import { format_composition, format_temperature, generate_boundary_path } from './utils'

  const {
    data,
    cursor = null,
    temperature = null,
    phase_color_keys = [],
    temp_unit = `K`,
    comp_unit = `at%`,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    data: BinaryPhaseDiagram // needs data.gibbs_energy
    // Hovered (x, T) of a bound diagram; its T picks the curves, its x is marked
    cursor?: DiagramCursor | null
    temperature?: number | null // used while there is no cursor
    phase_color_keys?: readonly string[]
    temp_unit?: TempUnit
    comp_unit?: CompUnit
  } = $props()

  let width = $state(0)
  let height = $state(0)
  const pad = { t: 22, r: 12, b: 34, l: 52 }

  const grid = $derived(data.gibbs_energy)
  // Per model phase: its first composition set's pastel fill, darkened to read as a line,
  // and its label (the model phase's name where several composition sets share it)
  const style_of = $derived.by(() => {
    const fills = phase_colors(data.phases, phase_color_keys)
    const groups = Map.groupBy(data.phases, ({ model_phase }) => model_phase)
    return new Map(
      [...groups].map(([model_phase, [first, ...others]]) => [
        model_phase,
        {
          color: hsl(fills.get(first.id) ?? ``)
            .darker(0.9)
            .formatHex(),
          label: others.length ? model_phase : first.label,
        },
      ]),
    )
  })
  const t_value = $derived(cursor?.temperature ?? temperature)

  // Why nothing is drawn, null when the view below is
  const empty_message = $derived.by(() => {
    if (!grid) return `No Gibbs energies in this diagram`
    if (t_value === null) return `Hover the phase diagram to see G(x)`
    const [t_min, t_max] = [grid.temperatures[0], grid.temperatures.at(-1) ?? 0]
    if (t_value < t_min || t_value > t_max) {
      return `${format_temperature(t_value, temp_unit)} is outside the Gibbs energy grid`
    }
    return null
  })

  // Curves relative to the line joining the hull's ends at x = 0 and 1 (energy of mixing; the
  // grid is validated to span both), in kJ/mol so the wells and tangents share one scale
  const view = $derived.by(() => {
    if (!grid || t_value === null || empty_message) return null
    const curves = gibbs_curves(grid, t_value).filter(({ points }) => points.length)
    const hull = lower_hull(curves)
    if (hull.length < 2) return null
    const [[x_0, g_0], [x_1, g_1]] = [hull[0].point, hull[hull.length - 1].point]
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
  const x_scale = $derived(
    scaleLinear()
      .domain([0, 1])
      .range([pad.l, width - pad.r]),
  )
  const y_scale = $derived(
    scaleLinear()
      .domain(view?.domain ?? [-1, 1])
      .range([height - pad.b, pad.t]),
  )
  const path_of = (points: readonly Vec2[]) =>
    generate_boundary_path(
      points.map(([x_val, g_val]): Vec2 => [x_scale(x_val), y_scale(g_val)]),
    )
  const uid = $props.id()
  const clip_id = `gibbs-clip-${uid}`
</script>

<div
  {...rest}
  class={[`gibbs-energy-plot`, rest.class]}
  bind:clientWidth={width}
  bind:clientHeight={height}
>
  {#if empty_message}
    <p class="empty">{empty_message}</p>
  {:else if !view}
    <p class="empty">Fewer than two Gibbs energies defined at this temperature</p>
  {:else if width > 0 && height > 0}
    {@const shown_t = format_temperature(view.t_value, temp_unit)}
    <svg {width} {height} role="img" aria-label="Gibbs energy of mixing at {shown_t}">
      <defs>
        <clipPath id={clip_id}>
          <rect
            x={pad.l}
            y={pad.t}
            width={width - pad.l - pad.r}
            height={height - pad.t - pad.b}
          />
        </clipPath>
      </defs>
      <text x={pad.l} y={14} class="title">
        ΔG<tspan baseline-shift="sub" font-size="0.7em">mix</tspan> at {shown_t}
      </text>
      <g clip-path="url(#{clip_id})">
        <line x1={pad.l} x2={width - pad.r} y1={y_scale(0)} y2={y_scale(0)} class="zero" />
        {#each view.curves as { id, points } (id)}
          {@const { color, label } = style_of.get(id) ?? { color: ``, label: id }}
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
        {#if cursor}
          <line
            x1={x_scale(cursor.composition)}
            x2={x_scale(cursor.composition)}
            y1={pad.t}
            y2={height - pad.b}
            class="cursor"
          />
        {/if}
      </g>
      <g class="axis">
        {#each x_scale.ticks(5) as tick (tick)}
          <text x={x_scale(tick)} y={height - pad.b + 14} text-anchor="middle">
            {format_composition(tick, comp_unit, false)}
          </text>
        {/each}
        {#each y_scale.ticks(4) as tick (tick)}
          <text x={pad.l - 6} y={y_scale(tick)} text-anchor="end" dominant-baseline="middle">
            {format_num(tick, `.3~`)}
          </text>
        {/each}
        <text
          x={14}
          y={(pad.t + height - pad.b) / 2}
          transform="rotate(-90 14 {(pad.t + height - pad.b) / 2})"
          text-anchor="middle">kJ/mol</text
        >
      </g>
      <g class="legend">
        {#each view.curves as { id }, idx (id)}
          {@const y_val = pad.t + 10 + idx * 14}
          <rect
            x={width - pad.r - 12}
            y={y_val - 4}
            width="12"
            height="3"
            fill={style_of.get(id)?.color}
          />
          <text x={width - pad.r - 16} y={y_val} text-anchor="end" dominant-baseline="middle">
            {style_of.get(id)?.label}
          </text>
        {/each}
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
    svg {
      display: block;
      overflow: visible;
    }
    text {
      fill: var(--text-color, #333);
    }
    .legend text {
      font-weight: 600;
      paint-order: stroke;
      stroke: var(--page-bg, white);
      stroke-width: 3px;
    }
    .title {
      font-size: 12px;
      font-weight: 600;
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
  .zero {
    stroke: rgba(128, 128, 128, 0.4);
  }
  .cursor {
    stroke: #ff6b6b;
    stroke-dasharray: 4, 3;
  }
</style>
