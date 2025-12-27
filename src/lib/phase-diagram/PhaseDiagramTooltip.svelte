<script lang="ts">
  import { format_num } from '$lib'
  import type { PhaseHoverInfo } from './types'
  import { format_composition, format_temperature } from './utils'

  let {
    hover_info,
    temperature_unit = `K`,
    composition_unit = `at%`,
    component_a = `A`,
    component_b = `B`,
  }: {
    hover_info: PhaseHoverInfo
    temperature_unit?: string
    composition_unit?: string
    component_a?: string
    component_b?: string
  } = $props()
</script>

<div class="phase-diagram-tooltip">
  <div class="tooltip-header">
    <strong>{hover_info.region.name}</strong>
  </div>

  <div class="tooltip-content">
    <div class="tooltip-row">
      <span class="label">Temperature:</span>
      <span class="value">{
        format_temperature(hover_info.temperature, temperature_unit)
      }</span>
    </div>

    <div class="tooltip-row">
      <span class="label">Composition:</span>
      <span class="value">
        {format_composition(hover_info.composition, composition_unit)} {component_b}
      </span>
    </div>

    <div class="tooltip-row secondary">
      <span class="value">
        ({format_composition(1 - hover_info.composition, composition_unit)} {component_a})
      </span>
    </div>

    {#if hover_info.lever_rule}
      {@const lr = hover_info.lever_rule}
      <div class="lever-rule-section">
        <div class="lever-rule-header">Lever Rule</div>
        <div class="lever-rule-bar">
          <div
            class="lever-rule-left"
            style:width="{lr.fraction_left * 100}%"
            title="{lr.left_phase}: {format_num(lr.fraction_left * 100, `.1f`)}%"
          >
          </div>
          <div
            class="lever-rule-right"
            style:width="{lr.fraction_right * 100}%"
            title="{lr.right_phase}: {format_num(lr.fraction_right * 100, `.1f`)}%"
          >
          </div>
          <div
            class="lever-rule-marker"
            style:left="{lr.fraction_left * 100}%"
          >
          </div>
        </div>
        <div class="lever-rule-labels">
          <span class="lever-label-left" title={lr.left_phase}>
            {lr.left_phase}: {format_num(lr.fraction_left * 100, `.0f`)}%
          </span>
          <span class="lever-label-right" title={lr.right_phase}>
            {lr.right_phase}: {format_num(lr.fraction_right * 100, `.0f`)}%
          </span>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .phase-diagram-tooltip {
    --tooltip-border: light-dark(rgba(0, 0, 0, 0.15), rgba(255, 255, 255, 0.2));
    --phase-alpha: rgba(144, 238, 144, 0.8);
    --phase-beta: rgba(255, 182, 193, 0.8);
    background: light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.9));
    color: light-dark(#1a1a1a, white);
    padding: 8px 12px;
    border-radius: var(--border-radius, 4px);
    font-size: 13px;
    min-width: 140px;
    box-shadow: light-dark(0 2px 8px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.3));
    border: light-dark(1px solid rgba(0, 0, 0, 0.1), none);
    pointer-events: none;
  }
  .tooltip-header {
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--tooltip-border);
    font-size: 14px;
  }
  .tooltip-content {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .tooltip-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .tooltip-row.secondary {
    justify-content: flex-end;
    opacity: 0.7;
    font-size: 12px;
  }
  .label {
    opacity: 0.8;
  }
  .value {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .lever-rule-section {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--tooltip-border);
  }
  .lever-rule-header {
    font-size: 11px;
    opacity: 0.7;
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .lever-rule-bar {
    position: relative;
    height: 12px;
    border-radius: 3px;
    overflow: hidden;
    display: flex;
    background: light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.15));
  }
  .lever-rule-left {
    height: 100%;
    background: var(--phase-alpha);
    transition: width 0.1s ease;
  }
  .lever-rule-right {
    height: 100%;
    background: var(--phase-beta);
    transition: width 0.1s ease;
  }
  .lever-rule-marker {
    position: absolute;
    top: -2px;
    width: 2px;
    height: 16px;
    background: light-dark(#1a1a1a, white);
    transform: translateX(-50%);
    border-radius: 1px;
  }
  .lever-rule-labels {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-size: 11px;
  }
  .lever-label-left,
  .lever-label-right {
    opacity: 0.85;
    font-variant-numeric: tabular-nums;
  }
</style>
