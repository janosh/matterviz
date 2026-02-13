<script lang="ts">
  import { ATOMIC_WEIGHTS } from '$lib/composition/parse'
  import type { ElementSymbol } from '$lib/element'
  import { format_num } from '$lib/labels'
  import { TooltipContent } from '$lib/tooltip'
  import type {
    LeverRuleMode,
    PhaseBoundary,
    PhaseDiagramTooltipProp,
    PhaseHoverInfo,
    TempUnit,
  } from './types'
  import {
    convert_temp,
    format_composition,
    format_formula_html,
    format_label_html,
    format_temperature,
    get_phase_stability_range,
  } from './utils'

  let {
    hover_info,
    temperature_unit = `K`,
    data_temperature_unit,
    composition_unit = `at%`,
    component_a = `A`,
    component_b = `B`,
    boundaries = [],
    lever_rule_mode = `horizontal`,
    use_subscripts = true,
    tooltip,
  }: {
    hover_info: PhaseHoverInfo
    temperature_unit?: TempUnit
    // Original unit of hover_info.temperature (defaults to temperature_unit)
    data_temperature_unit?: TempUnit
    composition_unit?: string
    component_a?: string
    component_b?: string
    boundaries?: PhaseBoundary[]
    lever_rule_mode?: LeverRuleMode
    use_subscripts?: boolean
    tooltip?: PhaseDiagramTooltipProp
  } = $props()

  // The unit that hover_info.temperature is actually in
  const data_unit = $derived(data_temperature_unit ?? temperature_unit)

  // Convert a temperature from data unit to display unit
  function to_display(temp: number): number {
    return convert_temp(temp, data_unit, temperature_unit)
  }

  // Convert atomic fraction to weight fraction: wt_B = (x_B * M_B) / (x_A * M_A + x_B * M_B)
  const wt_fraction_b = $derived.by(() => {
    const mass_a = ATOMIC_WEIGHTS.get(component_a as ElementSymbol)
    const mass_b = ATOMIC_WEIGHTS.get(component_b as ElementSymbol)
    if (!mass_a || !mass_b) return null
    const { composition: x_b } = hover_info
    const denom = (1 - x_b) * mass_a + x_b * mass_b
    return denom > 0 ? (x_b * mass_b) / denom : null
  })

  const stability = $derived(get_phase_stability_range(hover_info.region))

  // Format special point type for display (e.g., "peritectic" → "Peritectic")
  // For melting points and congruent points at composition edges, show element-specific info
  const special_point_info = $derived.by(() => {
    const point = hover_info.special_point
    if (!point) return null

    const type = point.type
    const position = point.position
    const temp = format_temperature(to_display(position[1]), temperature_unit)

    // Check if this is a melting point (at composition edge)
    const is_at_edge = position[0] <= 0.01 || position[0] >= 0.99
    const is_melting = type === `melting_point` || type === `congruent`

    if (is_melting && is_at_edge) {
      const element = position[0] <= 0.01 ? component_a : component_b
      return {
        badge: `Melting Point`,
        description: `${element} melts at ${temp}`,
      }
    }

    // Handle other special point types with descriptive info
    const type_descriptions: Record<string, string> = {
      eutectic: `Liquid → two solid phases at ${temp}`,
      peritectic: `Liquid + solid → different solid at ${temp}`,
      eutectoid: `Solid → two solid phases at ${temp}`,
      peritectoid: `Two solids → different solid at ${temp}`,
      congruent: `Congruent phase change at ${temp}`,
    }

    const badge = type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ` `)
    return {
      badge,
      description: type_descriptions[type] ?? null,
    }
  })

  // Calculate distance to nearest phase boundary (liquidus/solidus)
  const boundary_distance = $derived.by(() => {
    if (!boundaries.length) return null
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

  // Normalized lever rule display data (unifies horizontal and vertical modes)
  const lever_display = $derived.by(() => {
    if (lever_rule_mode === `vertical` && hover_info.vertical_lever_rule) {
      const vlr = hover_info.vertical_lever_rule
      return {
        label: `Lever Rule (vertical)`,
        phase_a: vlr.bottom_phase,
        phase_b: vlr.top_phase,
        fraction_a: vlr.fraction_bottom,
        fraction_b: vlr.fraction_top,
        detail_a: format_temperature(
          to_display(vlr.bottom_temperature),
          temperature_unit,
        ),
        detail_b: format_temperature(
          to_display(vlr.top_temperature),
          temperature_unit,
        ),
      }
    }
    if (hover_info.lever_rule) {
      const lr = hover_info.lever_rule
      return {
        label: `Lever Rule`,
        phase_a: lr.left_phase,
        phase_b: lr.right_phase,
        fraction_a: lr.fraction_left,
        fraction_b: lr.fraction_right,
        detail_a: format_composition(lr.left_composition, composition_unit),
        detail_b: format_composition(lr.right_composition, composition_unit),
      }
    }
    return null
  })
</script>

<TooltipContent data={hover_info} snippet_arg={hover_info} {tooltip}>
  <div class="phase-diagram-tooltip">
    <!-- Note: {@html} is safe here because region/phase names come from trusted JSON data files -->
    <header>
      <strong>{@html format_label_html(hover_info.region.name, use_subscripts)}</strong>
      {#if special_point_info}<span class="special-point-badge">{
          special_point_info.badge
        }</span>{/if}
    </header>

    {#if special_point_info?.description}
      <div class="special-point-description">{special_point_info.description}</div>
    {/if}

    <dl>
      <dt>Temperature</dt>
      <dd>
        {
          format_temperature(
            to_display(hover_info.temperature),
            temperature_unit,
          )
        }
        {#if temperature_unit !== `°C`}
          <small>({
              format_temperature(
                convert_temp(hover_info.temperature, data_unit, `°C`),
                `°C`,
              )
            })</small>
        {/if}
      </dd>
      <dt>Composition</dt>
      <dd>
        {format_composition(hover_info.composition, composition_unit)}
        {@html format_formula_html(component_b, use_subscripts)}
        <small>({format_composition(1 - hover_info.composition, composition_unit)}
          {@html format_formula_html(component_a, use_subscripts)})</small>
      </dd>
      {#if wt_fraction_b !== null}
        <dt>Weight</dt>
        <dd>
          {format_num(wt_fraction_b * 100, `.1f`)}%
          {@html format_formula_html(component_b, use_subscripts)}
          <small>({format_num((1 - wt_fraction_b) * 100, `.1f`)}%
            {@html format_formula_html(component_a, use_subscripts)})</small>
        </dd>
      {/if}
      {#if stability}
        <dt>Stable</dt><dd>
          {format_num(to_display(stability.t_min), `.0f`)} – {
            format_num(to_display(stability.t_max), `.0f`)
          } {temperature_unit}
          {#if temperature_unit !== `°C`}
            <small>({
                format_num(
                  convert_temp(stability.t_min, data_unit, `°C`),
                  `.0f`,
                )
              } – {
                format_num(
                  convert_temp(stability.t_max, data_unit, `°C`),
                  `.0f`,
                )
              } °C)</small>
          {/if}
        </dd>
      {/if}
    </dl>

    {#if lever_display}
      {@const ld = lever_display}
      <div class="lever">
        <span>{ld.label}</span>
        <div class="bar">
          <div
            style:width="{ld.fraction_a * 100}%"
            title="{ld.phase_a}: {format_num(ld.fraction_a * 100, `.1f`)}%"
          >
          </div>
          <div
            style:width="{ld.fraction_b * 100}%"
            title="{ld.phase_b}: {format_num(ld.fraction_b * 100, `.1f`)}%"
          >
          </div>
          <i style:left="{ld.fraction_a * 100}%"></i>
        </div>
        <div class="phase-info">
          <span>{@html format_formula_html(ld.phase_a, use_subscripts)}: {
              format_num(ld.fraction_a * 100, `.0f`)
            }% <small>at {ld.detail_a}</small></span>
          <span>{@html format_formula_html(ld.phase_b, use_subscripts)}: {
              format_num(ld.fraction_b * 100, `.0f`)
            }% <small>at {ld.detail_b}</small></span>
        </div>
      </div>
    {/if}

    {#if boundary_distance}
      {@const { type, delta_t } = boundary_distance}
      {@const label = delta_t > 0 ? `above` : `below`}
      {@const display_delta = Math.abs(
        to_display(hover_info.temperature) -
          to_display(hover_info.temperature - delta_t),
      )}
      <div class="boundary-info">
        {Math.round(display_delta)} {temperature_unit} {label} {type}
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
    & > div:first-child {
      height: 100%;
      background: rgba(144, 238, 144, 0.8);
    }
    & > div:nth-child(2) {
      height: 100%;
      background: rgba(255, 182, 193, 0.8);
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
