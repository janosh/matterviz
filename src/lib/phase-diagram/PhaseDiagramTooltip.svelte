<script lang="ts">
  import { element_by_symbol, type ElementSymbol } from '$lib/element'
  import { format_num, humanize } from '$lib/labels'
  import { sanitize_formula, sanitize_html } from '$lib/sanitize'
  import { TooltipContent } from '$lib/tooltip'
  import type {
    CompUnit,
    PhaseBoundary,
    PhaseDiagramTooltipProp,
    PhaseHoverInfo,
    TempUnit,
  } from './types'
  import { format_label_html } from '$lib/composition/format'
  import {
    convert_temp,
    format_composition,
    format_temperature,
    get_phase_color,
    get_phase_stability_range,
    lever_rule_rows,
  } from './utils'

  let {
    hover_info,
    temperature_unit = `K`,
    data_temperature_unit,
    composition_unit = `at%`,
    component_a = `A`,
    component_b = `B`,
    boundaries = [],
    use_subscripts = true,
    tooltip,
  }: {
    hover_info: PhaseHoverInfo
    temperature_unit?: TempUnit
    // Original unit of hover_info.temperature (defaults to temperature_unit)
    data_temperature_unit?: TempUnit
    composition_unit?: CompUnit
    component_a?: string
    component_b?: string
    boundaries?: PhaseBoundary[]
    use_subscripts?: boolean
    tooltip?: PhaseDiagramTooltipProp
  } = $props()

  // The unit that hover_info.temperature is actually in
  const data_unit = $derived(data_temperature_unit ?? temperature_unit)

  const safe_formula = (comp: string) => sanitize_formula(comp, use_subscripts)

  // Convert a temperature from data unit to display unit
  const to_display = (temp: number): number => convert_temp(temp, data_unit, temperature_unit)

  // The complementary measure: hover_info.composition is a weight fraction under wt% and an
  // atomic fraction otherwise, so each case converts the other way. Null without atomic masses.
  //   wt_B = (x_B M_B) / (x_A M_A + x_B M_B),  x_B = (w_B / M_B) / (w_A / M_A + w_B / M_B)
  const alt_composition = $derived.by(() => {
    const mass_a = element_by_symbol.get(component_a as ElementSymbol)?.atomic_mass
    const mass_b = element_by_symbol.get(component_b as ElementSymbol)?.atomic_mass
    if (!mass_a || !mass_b) return null
    const { composition: frac_b } = hover_info
    const weighted_a =
      composition_unit === `wt%` ? (1 - frac_b) / mass_a : (1 - frac_b) * mass_a
    const weighted_b = composition_unit === `wt%` ? frac_b / mass_b : frac_b * mass_b
    const denom = weighted_a + weighted_b
    if (!(denom > 0)) return null
    return {
      label: composition_unit === `wt%` ? `Atomic` : `Weight`,
      fraction_b: weighted_b / denom,
    }
  })

  const stability = $derived(get_phase_stability_range(hover_info.region))

  // Format special point type for display (e.g., "peritectic" → "Peritectic")
  // For melting points and congruent points at composition edges, show element-specific info
  const special_point_info = $derived.by(() => {
    if (!hover_info.special_point) return null
    const { type, position } = hover_info.special_point
    const [x_pos, temp_raw] = position
    const temp = format_temperature(to_display(temp_raw), temperature_unit)

    // Melting/congruent points at a composition edge belong to one pure component
    const is_at_edge = x_pos <= 0.01 || x_pos >= 0.99
    if ((type === `melting_point` || type === `congruent`) && is_at_edge) {
      const element = x_pos <= 0.01 ? component_a : component_b
      return { badge: `Melting Point`, description: `${element} melts at ${temp}` }
    }
    const type_descriptions: Record<string, string> = {
      eutectic: `Liquid → two solid phases at ${temp}`,
      peritectic: `Liquid + solid → different solid at ${temp}`,
      eutectoid: `Solid → two solid phases at ${temp}`,
      peritectoid: `Two solids → different solid at ${temp}`,
      congruent: `Congruent phase change at ${temp}`,
    }
    const badge = humanize(type)
    return { badge, description: type_descriptions[type] ?? null }
  })

  // Calculate distance to nearest phase boundary (liquidus/solidus)
  const boundary_distance = $derived.by(() => {
    if (boundaries.length === 0) return null
    const { composition, temperature } = hover_info
    let min_dist: { type: string; delta_t: number } | null = null

    for (const boundary of boundaries) {
      if (![`liquidus`, `solidus`, `solvus`].includes(boundary.type)) continue
      // Find the boundary point closest in composition
      for (const [bx, bt] of boundary.points) {
        if (Math.abs(bx - composition) < 0.02) {
          // Within 2% composition
          const delta = temperature - bt
          if (!min_dist || Math.abs(delta) < Math.abs(min_dist.delta_t)) {
            min_dist = { type: boundary.type, delta_t: delta }
          }
        }
      }
    }
    return min_dist
  })

  // Lever rule: one [phase, fraction, composition] row per tie-line end
  const lever_rows = $derived(lever_rule_rows(hover_info, composition_unit))
</script>

<TooltipContent data={hover_info} snippet_arg={hover_info} {tooltip}>
  <div class="phase-diagram-tooltip">
    <header>
      <strong
        >{@html sanitize_html(
          format_label_html(hover_info.region.name, use_subscripts),
        )}</strong
      >
      {#if special_point_info}<span class="special-point-badge"
          >{special_point_info.badge}</span
        >{/if}
    </header>

    {#if special_point_info?.description}
      <div class="special-point-description">{special_point_info.description}</div>
    {/if}

    <dl>
      <dt>Temperature</dt>
      <dd>
        {format_temperature(to_display(hover_info.temperature), temperature_unit)}
        {#if temperature_unit !== `°C`}
          <small
            >({format_temperature(
              convert_temp(hover_info.temperature, data_unit, `°C`),
              `°C`,
            )})</small
          >
        {/if}
      </dd>
      <dt>Composition</dt>
      <dd>
        {format_composition(hover_info.composition, composition_unit)}
        {@html safe_formula(component_b)}
        <small
          >({format_composition(1 - hover_info.composition, composition_unit)}
          {@html safe_formula(component_a)})</small
        >
      </dd>
      {#if alt_composition}
        <dt>{alt_composition.label}</dt>
        <dd>
          {format_num(alt_composition.fraction_b * 100, `.1f`)}%
          {@html safe_formula(component_b)}
          <small
            >({format_num((1 - alt_composition.fraction_b) * 100, `.1f`)}%
            {@html safe_formula(component_a)})</small
          >
        </dd>
      {/if}
      {#if stability}
        <dt>Stable</dt>
        <dd>
          {format_num(to_display(stability.t_min), `.0f`)} – {format_num(
            to_display(stability.t_max),
            `.0f`,
          )}
          {temperature_unit}
          {#if temperature_unit !== `°C`}
            <small
              >({format_num(convert_temp(stability.t_min, data_unit, `°C`), `.0f`)} – {format_num(
                convert_temp(stability.t_max, data_unit, `°C`),
                `.0f`,
              )} °C)</small
            >
          {/if}
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
              style:background={get_phase_color(phase, `hex`)}
              title="{phase}: {format_num(fraction * 100, `.1f`)}%"
            ></div>
          {/each}
          <i style:left="{lever_rows[0][1] * 100}%"></i>
        </div>
        <div class="phase-info">
          {#each lever_rows as [phase, fraction, location], idx (idx)}
            <span
              >{@html safe_formula(phase)}: {format_num(fraction * 100, `.0f`)}%
              <small>at {location}</small></span
            >
          {/each}
        </div>
      </div>
    {/if}

    {#if boundary_distance}
      {@const { type, delta_t } = boundary_distance}
      {@const label = delta_t > 0 ? `above` : `below`}
      {@const display_delta = Math.abs(
        to_display(hover_info.temperature) - to_display(hover_info.temperature - delta_t),
      )}
      <div class="boundary-info">
        {Math.round(display_delta)}
        {temperature_unit}
        {label}
        {type}
      </div>
    {/if}
  </div>
</TooltipContent>

<style>
  .phase-diagram-tooltip {
    --border: light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.2));
    background: light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.9));
    color: light-dark(#1a1a1a, white);
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 12px;
    min-width: 130px;
    box-shadow: light-dark(0 2px 8px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.3));
    border: light-dark(1px solid rgba(0, 0, 0, 0.1), none);
    pointer-events: none;
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
  .special-point-badge {
    font-size: 10px;
    font-weight: 500;
    background: light-dark(rgba(220, 38, 38, 0.15), rgba(239, 68, 68, 0.25));
    color: light-dark(#b91c1c, #fca5a5);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .special-point-description {
    font-size: 11px;
    font-style: italic;
    opacity: 0.9;
    margin-bottom: 5px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
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
  .boundary-info {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
    font-size: 10px;
    opacity: 0.85;
    font-style: italic;
  }
</style>
