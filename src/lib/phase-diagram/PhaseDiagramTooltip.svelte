<script lang="ts">
  import { type ElementSymbol, format_num } from '$lib'
  import { ATOMIC_WEIGHTS } from '$lib/composition/parse'
  import type { PhaseBoundary, PhaseHoverInfo } from './types'
  import {
    format_composition,
    format_temperature,
    get_phase_stability_range,
  } from './utils'

  let {
    hover_info,
    temperature_unit = `K`,
    composition_unit = `at%`,
    component_a = `A`,
    component_b = `B`,
    boundaries = [],
  }: {
    hover_info: PhaseHoverInfo
    temperature_unit?: string
    composition_unit?: string
    component_a?: string
    component_b?: string
    boundaries?: PhaseBoundary[]
  } = $props()

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
</script>

<div class="phase-diagram-tooltip">
  <header><strong>{hover_info.region.name}</strong></header>

  <dl>
    <dt>Temperature</dt>
    <dd>{format_temperature(hover_info.temperature, temperature_unit)}</dd>
    <dt>Composition</dt>
    <dd>
      {format_composition(hover_info.composition, composition_unit)} {component_b}
      <small>({format_composition(1 - hover_info.composition, composition_unit)} {
          component_a
        })</small>
    </dd>
    {#if wt_fraction_b !== null}
      <dt>Weight</dt>
      <dd>
        {format_num(wt_fraction_b * 100, `.1f`)}% {component_b}
        <small>({format_num((1 - wt_fraction_b) * 100, `.1f`)}% {component_a})</small>
      </dd>
    {/if}
    {#if stability}
      <dt>Stable</dt><dd>{stability.t_min} – {stability.t_max} {temperature_unit}</dd>
    {/if}
  </dl>

  {#if hover_info.lever_rule}
    {@const lr = hover_info.lever_rule}
    <div class="lever">
      <span>Lever Rule</span>
      <div class="bar">
        <div
          style:width="{lr.fraction_left * 100}%"
          title="{lr.left_phase}: {format_num(lr.fraction_left * 100, `.1f`)}%"
        >
        </div>
        <div
          style:width="{lr.fraction_right * 100}%"
          title="{lr.right_phase}: {format_num(lr.fraction_right * 100, `.1f`)}%"
        >
        </div>
        <i style:left="{lr.fraction_left * 100}%"></i>
      </div>
      <div class="phase-info">
        <span>{lr.left_phase}: {format_num(lr.fraction_left * 100, `.0f`)}% <small>at {
              format_composition(lr.left_composition, composition_unit)
            }</small></span>
        <span>{lr.right_phase}: {format_num(lr.fraction_right * 100, `.0f`)}% <small>at {
              format_composition(lr.right_composition, composition_unit)
            }</small></span>
      </div>
    </div>
  {/if}

  {#if boundary_distance}
    {@const { type, delta_t } = boundary_distance}
    {@const label = delta_t > 0 ? `above` : `below`}
    <div class="boundary-info">
      {Math.round(Math.abs(delta_t))} {temperature_unit} {label} {type}
    </div>
  {/if}
</div>

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
