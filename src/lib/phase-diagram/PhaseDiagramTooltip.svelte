<script lang="ts">
  import { element_by_symbol, type ElementSymbol } from '#lib/element/index.js'
  import { format_num, humanize } from '#lib/labels.js'
  import { array_extent } from '#lib/math.js'
  import { sanitize_formula, sanitize_html } from '#lib/sanitize.js'
  import { TooltipContent, TooltipValue } from '#lib/tooltip/index.js'
  import type {
    BinaryPhaseDiagram,
    CompUnit,
    DiagramBoundary,
    PhaseDiagramTooltipProp,
    PhaseHoverInfo,
    TempUnit,
  } from './types'
  import { format_label_html } from '#lib/composition/format.js'
  import {
    boundary_description,
    diagram_hit,
    lever_rule_rows,
    phase_colors,
    phase_labeler,
    point_badge,
    provenance_caption,
    region_label,
    status_color,
  } from './diagram'
  import { convert_temp, format_composition, temp_delta } from './utils'

  let {
    hover_info,
    data,
    overlay = null,
    phase_color_keys = [],
    temp_unit = `K`,
    comp_unit = `at%`,
    tooltip,
  }: {
    hover_info: PhaseHoverInfo
    data: BinaryPhaseDiagram
    // Overlay diagram whose phase set at the hovered (x, T) is listed too
    overlay?: BinaryPhaseDiagram | null
    // Color keys of the diagram (see IsobaricBinaryPhaseDiagram), so swatches match its fills
    phase_color_keys?: readonly string[]
    temp_unit?: TempUnit
    comp_unit?: CompUnit
    tooltip?: PhaseDiagramTooltipProp
  } = $props()

  const colors = $derived(phase_colors(data.phases, phase_color_keys))
  const [component_a, component_b] = $derived(data.components)
  const label_of = $derived(phase_labeler(data))
  const overlay_hit = $derived(
    overlay && diagram_hit(overlay, hover_info.composition, hover_info.temperature),
  )
  const html_label = (label: string) => sanitize_html(format_label_html(label, true))
  const safe_formula = (comp: string) => sanitize_formula(comp, true)

  // Temperatures arrive in K; shown in the display unit (or `unit`)
  const fmt_temp = (kelvin: number, unit: TempUnit = temp_unit): string =>
    format_num(convert_temp(kelvin, `K`, unit), `.0f`)
  const fmt_comp = (value: number) => format_composition(value, comp_unit, false)
  // TooltipValue unit of a composition (bare fractions have none)
  const comp_unit_label = $derived(comp_unit === `fraction` ? `` : comp_unit)

  // Weight fraction of components[1] from its mole fraction; null without atomic masses
  //   w_B = (x_B M_B) / (x_A M_A + x_B M_B)
  const weight_fraction = $derived.by(() => {
    const mass_a = element_by_symbol.get(component_a as ElementSymbol)?.atomic_mass
    const mass_b = element_by_symbol.get(component_b as ElementSymbol)?.atomic_mass
    if (!mass_a || !mass_b) return null
    const { composition: frac_b } = hover_info
    const denom = (1 - frac_b) * mass_a + frac_b * mass_b
    return denom > 0 ? (frac_b * mass_b) / denom : null
  })

  // Temperature span of the hovered region: its lowest and highest vertex temperatures
  const stability = $derived(
    hover_info.region && array_extent(hover_info.region.vertices.map(([, temp]) => temp)),
  )

  // Temperatures where a boundary crosses `composition`: interpolated on each segment that
  // spans it (vertices are often far apart)
  const boundary_temps_at = (points: DiagramBoundary[`points`], composition: number) =>
    points.slice(1).flatMap(([x_end, t_end], idx) => {
      const [x_start, t_start] = points[idx]
      if (x_start === x_end) return []
      const frac = (composition - x_start) / (x_end - x_start)
      return frac >= 0 && frac <= 1 ? [t_start + frac * (t_end - t_start)] : []
    })

  // Distance in temperature to the nearest liquidus/solidus/solvus at the cursor's composition
  const boundary_distance = $derived.by(() => {
    const { composition, temperature } = hover_info
    let nearest: { boundary: DiagramBoundary; delta_t: number } | null = null
    for (const boundary of data.boundaries) {
      if (![`liquidus`, `solidus`, `solvus`].includes(boundary.kind)) continue
      for (const boundary_temp of boundary_temps_at(boundary.points, composition)) {
        const delta_t = temperature - boundary_temp
        if (!nearest || Math.abs(delta_t) < Math.abs(nearest.delta_t)) {
          nearest = { boundary, delta_t }
        }
      }
    }
    return nearest && { ...nearest, text: boundary_description(nearest.boundary, label_of) }
  })

  const lever_rows = $derived(
    hover_info.lever_rule && lever_rule_rows(hover_info.lever_rule, label_of),
  )
  const overlay_lever_rows = $derived(
    overlay &&
      overlay_hit?.lever_rule &&
      lever_rule_rows(overlay_hit.lever_rule, phase_labeler(overlay)),
  )
  const lever_colors = $derived(
    hover_info.lever_rule
      ? [hover_info.lever_rule.left_phase, hover_info.lever_rule.right_phase].map(
          (id) => colors.get(id) ?? `#b4b4b4`,
        )
      : [],
  )

  const observation = $derived(hover_info.observation)
</script>

<TooltipContent data={hover_info} snippet_arg={hover_info} {tooltip}>
  <div class="phase-diagram-tooltip">
    <!-- a boundaries-only diagram has no phase set to name in the header -->
    {#if data.regions?.length || hover_info.point}
      <header>
        {#if data.regions?.length}
          <strong>{@html html_label(region_label(hover_info.region, label_of))}</strong>
        {/if}
        {#if hover_info.point}
          <span class="badge">{point_badge(hover_info.point)}</span>
        {/if}
      </header>
    {/if}

    {#if hover_info.point}
      {@const { description, temperature } = hover_info.point}
      <div class="point-description">
        {@html html_label(description)} at
        <TooltipValue value={fmt_temp(temperature)} unit={temp_unit} />
      </div>
    {/if}

    {#if observation}
      {@const { row, phase, composition, temperature } = observation}
      <section class="observation">
        <span class="status" style:background={status_color(row.status)}
          >{humanize(row.status)}</span
        >
        <strong>{row.reaction ?? humanize(row.kind)}</strong>
        <div>
          T = <TooltipValue value={fmt_temp(temperature)} unit={temp_unit} />
          {#if row.sigma_T_K}± {format_num(temp_delta(row.sigma_T_K, temp_unit), `.3~`)}
            {temp_unit}{/if}
        </div>
        {#if phase}
          {@const { name, sigma_x } = phase}
          <div>
            {name}: x = <TooltipValue value={fmt_comp(composition)} unit={comp_unit_label} />
            {#if sigma_x}± {fmt_comp(sigma_x)} {comp_unit_label}{/if}
          </div>
        {/if}
        <cite>
          {row.source.citation}
          {#if row.source.doi}
            <a href="https://doi.org/{row.source.doi}" target="_blank" rel="noreferrer"
              >doi:{row.source.doi}</a
            >
          {/if}
        </cite>
      </section>
    {/if}

    <dl>
      <dt>Temperature</dt>
      <dd>
        <TooltipValue value={fmt_temp(hover_info.temperature)} unit={temp_unit} />
        {#if temp_unit !== `°C`}
          <small
            >(<TooltipValue value={fmt_temp(hover_info.temperature, `°C`)} unit="°C" />)</small
          >
        {/if}
      </dd>
      <dt>Composition</dt>
      <dd>
        <TooltipValue value={fmt_comp(hover_info.composition)} unit={comp_unit_label} />
        {@html safe_formula(component_b)}
        <small
          >(<TooltipValue
            value={fmt_comp(1 - hover_info.composition)}
            unit={comp_unit_label}
          />
          {@html safe_formula(component_a)})</small
        >
      </dd>
      {#if weight_fraction !== null}
        <dt>Weight</dt>
        <dd>
          {format_num(weight_fraction * 100, `.1f`)} <small>%</small>
          {@html safe_formula(component_b)}
        </dd>
      {/if}
      {#if stability}
        <dt>Stable</dt>
        <dd>
          {fmt_temp(stability[0])} – {fmt_temp(stability[1])}
          <small>{temp_unit}</small>
        </dd>
      {/if}
      {#if overlay && overlay_hit}
        <dt>Overlay</dt>
        <dd class="overlay-phase">
          {@html html_label(region_label(overlay_hit.region, phase_labeler(overlay)))}
        </dd>
      {/if}
    </dl>

    {#if lever_rows}
      <div class="lever">
        <span>Lever Rule</span>
        <div class="bar">
          {#each lever_rows as [phase, fraction], idx (idx)}
            <div
              style:width="{fraction * 100}%"
              style:background={lever_colors[idx]}
              title={phase}
            ></div>
          {/each}
          <i style:left="{lever_rows[0][1] * 100}%"></i>
        </div>
        <div class="phase-info">
          {#each lever_rows as [phase, fraction, location], idx (idx)}
            <span
              >{@html html_label(phase)}: {format_num(fraction * 100, `.0f`)}
              <small>%</small>
              <span>at <TooltipValue value={fmt_comp(location)} unit={comp_unit_label} /></span
              ></span
            >
          {/each}
        </div>
      </div>
    {/if}
    {#if overlay_lever_rows}
      <div class="overlay-lever">
        Overlay lever rule:
        {#each overlay_lever_rows as [phase, fraction, location], idx (idx)}
          {idx ? ` / ` : ``}{@html html_label(phase)}
          {format_num(fraction * 100, `.0f`)}% at {format_composition(location, comp_unit)}
        {/each}
      </div>
    {/if}

    {#if boundary_distance}
      {@const { text, delta_t } = boundary_distance}
      {@const display_delta = Math.abs(temp_delta(delta_t, temp_unit))}
      <div class="boundary-info">
        {Math.round(display_delta)}
        <small>{temp_unit}</small>
        {delta_t > 0 ? `above` : `below`}
        {@html html_label(text)}
      </div>
    {/if}

    {#each [data, overlay].filter((diagram) => diagram !== null) as diagram, idx (idx)}
      {@const caption = provenance_caption(diagram)}
      {#if caption}
        <footer class="provenance">
          {#if overlay}<strong>{idx ? `Overlay` : `Main`}:</strong>{/if}
          {caption}
        </footer>
      {/if}
    {/each}
  </div>
</TooltipContent>

<style>
  .phase-diagram-tooltip {
    --border: color-mix(in srgb, currentColor 18%, transparent);
    min-width: 130px;
    max-width: 320px;
  }
  header {
    margin-bottom: 5px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .badge {
    font-size: 10px;
    font-weight: 500;
    background: light-dark(rgba(220, 38, 38, 0.15), rgba(239, 68, 68, 0.25));
    color: light-dark(#b91c1c, #fca5a5);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .point-description {
    font-size: 11px;
    font-style: italic;
    opacity: 0.9;
    margin-bottom: 5px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }
  .observation {
    font-size: 11px;
    margin-bottom: 5px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
    display: grid;
    gap: 2px;
    .status {
      justify-self: start;
      color: white;
      font-size: 10px;
      padding: 0 5px;
      border-radius: 3px;
    }
    cite {
      font-size: 10px;
      opacity: 0.8;
      white-space: normal;
    }
    a {
      color: inherit;
    }
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 8px;
    margin: 0;
  }
  dt {
    opacity: 0.7;
    font-weight: 500;
    &::after {
      content: ':';
    }
  }
  dd {
    margin: 0;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    small {
      opacity: 0.6;
      font-weight: normal;
      margin-left: 4px;
    }
  }
  .lever {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
    & > span {
      font-size: 10px;
      opacity: 0.7;
    }
  }
  .bar {
    position: relative;
    height: 10px;
    border-radius: 3px;
    overflow: hidden;
    display: flex;
    margin-top: 3px;
    background: light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.15));
    & > div {
      height: 100%;
      opacity: 0.8;
    }
    & > i {
      position: absolute;
      top: -1px;
      width: 2px;
      height: 12px;
      background: light-dark(#1a1a1a, white);
      transform: translateX(-50%);
      border-radius: 1px;
    }
  }
  .phase-info {
    display: flex;
    justify-content: space-between;
    margin-top: 3px;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    small {
      opacity: 0.6;
      margin-left: 2px;
    }
  }
  .provenance {
    margin-top: 6px;
    padding-top: 4px;
    border-top: 1px solid var(--border);
    font-size: 9px;
    opacity: 0.7;
  }
  .overlay-lever,
  .boundary-info {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
    font-size: 10px;
    opacity: 0.85;
  }
  .boundary-info {
    font-style: italic;
  }
</style>
