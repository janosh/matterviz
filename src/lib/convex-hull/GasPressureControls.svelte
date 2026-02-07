<script lang="ts">
  import type {
    GasControlPosition,
    GasSpecies,
    GasThermodynamicsConfig,
  } from '$lib/convex-hull/types'
  import { tooltip } from 'svelte-multiselect'
  import {
    compute_gas_chemical_potential,
    format_chemical_potential,
    get_default_gas_provider,
    get_effective_pressures,
  } from './gas-thermodynamics'

  let {
    config,
    pressures = $bindable({}),
    temperature,
    position = `top-right`,
  }: {
    config: GasThermodynamicsConfig
    pressures: Partial<Record<GasSpecies, number>>
    temperature: number
    position?: GasControlPosition
  } = $props()

  // Log scale range for pressure slider: 10^-10 to 10^2 bar
  const LOG_P_MIN = -10
  const LOG_P_MAX = 2
  const LOG_P_RANGE = LOG_P_MAX - LOG_P_MIN
  const MIN_PRESSURE = 1e-15 // Safe minimum to avoid log(0) or NaN

  // Get provider for chemical potential calculations
  const provider = $derived(config.provider ?? get_default_gas_provider())

  // Get enabled gases from config
  const enabled_gases = $derived(config.enabled_gases ?? [])

  // Effective pressures including defaults
  const effective_pressures = $derived(get_effective_pressures(config))

  // Get current pressure for a gas (user-set or default), clamped to safe value
  function get_pressure(gas: GasSpecies): number {
    const P = pressures[gas] ?? effective_pressures[gas]
    return Number.isFinite(P) && P > 0 ? P : MIN_PRESSURE
  }

  // Compute chemical potential μ(T,P) for a gas at current temperature and pressure
  function get_mu(gas: GasSpecies): number {
    return compute_gas_chemical_potential(
      provider,
      gas,
      temperature,
      get_pressure(gas),
    )
  }

  // Convert pressure to log scale slider position (0-100)
  function pressure_to_slider(P: number): number {
    const log_P = Math.log10(P) // P is already normalized from get_pressure
    return ((Math.max(LOG_P_MIN, Math.min(LOG_P_MAX, log_P)) - LOG_P_MIN) /
      LOG_P_RANGE) * 100
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

  // Format pressure with HTML - exponent notation for powers of 10, decimal otherwise
  function format_pressure_html(P: number): string {
    const log_P = Math.log10(P), exp = Math.round(log_P) // P already normalized
    if (Math.abs(log_P - exp) < 0.1) return `10<sup>${exp}</sup>`
    return P >= 0.01 && P < 100 ? `${P.toPrecision(2)}` : `${P.toExponential(1)}`
  }

  function set_pressure(gas: GasSpecies, value: number): void {
    pressures = { ...pressures, [gas]: slider_to_pressure(value) }
  }
</script>

{#if enabled_gases.length > 0}
  <div class="pressure-controls {position}">
    {#each enabled_gases as gas (gas)}
      {@const P = get_pressure(gas)}
      {@const mu = get_mu(gas)}
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
            value={pressure_to_slider(P)}
            oninput={(evt) => set_pressure(gas, +evt.currentTarget.value)}
            aria-label="{gas} partial pressure"
          />
        </div>
        <span class="sr-only" aria-live="polite">
          {gas} chemical potential: {format_chemical_potential(mu, 2)}
        </span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .pressure-controls {
    position: absolute;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .pressure-controls.top-left {
    top: calc(1ex + 50px);
    left: calc(1ex + 10px);
  }
  .pressure-controls.top-right {
    top: calc(1ex + 50px);
    right: calc(1ex + 75px);
  }
  .pressure-controls.bottom-left {
    bottom: calc(1ex + 50px);
    left: calc(1ex + 10px);
  }
  .pressure-controls.bottom-right {
    bottom: calc(1ex + 50px);
    right: calc(1ex + 75px);
  }
  .pressure-slider {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    background: color-mix(in srgb, var(--hull-bg, transparent) 80%, transparent);
    padding: 3px 5px;
    border-radius: var(--border-radius, 6pt);
    backdrop-filter: blur(2px);
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
