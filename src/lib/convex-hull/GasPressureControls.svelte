<script lang="ts">
  import { tooltip } from 'svelte-multiselect'
  import {
    compute_gas_chemical_potential,
    format_chemical_potential,
    get_default_gas_provider,
    get_effective_pressures,
  } from './gas-thermodynamics'
  import { type GasSpecies, type GasThermodynamicsConfig } from './types'

  let {
    config,
    pressures = $bindable({}),
    temperature,
  }: {
    config: GasThermodynamicsConfig
    pressures: Partial<Record<GasSpecies, number>>
    temperature: number
  } = $props()

  // Log scale range for pressure slider: 10^-10 to 10^2 bar
  const LOG_P_MIN = -10
  const LOG_P_MAX = 2
  const LOG_P_RANGE = LOG_P_MAX - LOG_P_MIN

  // Get provider for chemical potential calculations
  const provider = $derived(config.provider ?? get_default_gas_provider())

  // Get enabled gases from config
  const enabled_gases = $derived(config.enabled_gases ?? [])

  // Effective pressures including defaults
  const effective_pressures = $derived(get_effective_pressures(config))

  // Get current pressure for first enabled gas
  const gas = $derived(enabled_gases[0])
  const P = $derived(gas ? (pressures[gas] ?? effective_pressures[gas]) : 1)
  const mu = $derived(
    gas ? compute_gas_chemical_potential(provider, gas, temperature, P) : 0,
  )

  // Slider value (0-100)
  const slider_value = $derived(pressure_to_slider(P))

  // Convert pressure to log scale slider position (0-100)
  function pressure_to_slider(P: number): number {
    const log_P = Math.log10(Math.max(P, 1e-15))
    const clamped = Math.max(LOG_P_MIN, Math.min(LOG_P_MAX, log_P))
    return ((clamped - LOG_P_MIN) / LOG_P_RANGE) * 100
  }

  // Convert slider position (0-100) to pressure
  function slider_to_pressure(value: number): number {
    const log_P = LOG_P_MIN + (value / 100) * LOG_P_RANGE
    return Math.pow(10, log_P)
  }

  // Format gas name for display (subscript numbers)
  function format_gas_name(gas: GasSpecies): string {
    return gas.replace(/(\d+)/g, `<sub>$1</sub>`)
  }

  // Format pressure exponent with HTML superscript
  function format_pressure_html(P: number): string {
    const exp = Math.round(Math.log10(Math.max(P, 1e-15)))
    return `10<sup>${exp}</sup>`
  }

  function set_pressure(value: number): void {
    if (gas) {
      pressures = { ...pressures, [gas]: slider_to_pressure(value) }
    }
  }
</script>

{#if gas}
  <div
    class="pressure-slider"
    {@attach tooltip({
      content: `${gas} partial pressure for μ(T,P)\nμ = ${
        format_chemical_potential(mu, 3)
      }`,
    })}
  >
    <div class="pressure-label">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <span class="pressure-value">{@html format_pressure_html(P)}</span>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <span class="gas-name">{@html format_gas_name(gas)}</span>
    </div>
    <div class="slider-wrapper">
      <span class="pressure-range">
        10<sup>{LOG_P_MIN}</sup>–10<sup>{LOG_P_MAX}</sup>
      </span>
      <input
        type="range"
        min="0"
        max="100"
        step="0.5"
        value={slider_value}
        oninput={(evt) => set_pressure(+evt.currentTarget.value)}
        aria-label="{gas} partial pressure"
      />
    </div>
  </div>
{/if}

<style>
  .pressure-slider {
    position: absolute;
    top: calc(1ex + 50px);
    right: calc(1ex + 75px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    background: color-mix(in srgb, var(--hull-bg, transparent) 80%, transparent);
    padding: 6px 8px;
    border-radius: var(--border-radius, 3pt);
    backdrop-filter: blur(4px);
  }
  .slider-wrapper {
    display: flex;
    place-items: center;
    line-height: 1;
  }
  .pressure-slider input[type='range'] {
    writing-mode: vertical-lr;
    direction: rtl;
  }
  .pressure-label {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .pressure-value {
    font-size: 0.95em;
  }
  .pressure-value :global(sup) {
    font-size: 0.75em;
  }
  .gas-name {
    font-size: 0.9em;
  }
  .gas-name :global(sub) {
    font-size: 0.7em;
    vertical-align: sub;
  }
  .pressure-range {
    font-size: 0.7em;
    opacity: 0.7;
    white-space: nowrap;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
  }
</style>
