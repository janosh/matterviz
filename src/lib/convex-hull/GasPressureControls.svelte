<script lang="ts">
  import type { GasSpecies, GasThermodynamicsConfig } from '$lib/convex-hull/types'
  import { clamp } from '$lib/math'
  import { sanitize_html } from '$lib/sanitize'
  import type { HTMLAttributes } from 'svelte/elements'
  import {
    compute_gas_chemical_potential,
    format_chemical_potential,
    get_default_gas_provider,
    get_effective_pressures,
  } from './gas-thermodynamics'
  import VerticalSlider from './VerticalSlider.svelte'

  let {
    config,
    pressures = $bindable({}),
    temperature,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    config: GasThermodynamicsConfig
    pressures: Partial<Record<GasSpecies, number>>
    temperature: number
  } = $props()

  // Log scale range for pressure slider: 10^-10 to 10^2 bar
  const LOG_P_MIN = -10
  const LOG_P_MAX = 2
  const LOG_P_RANGE = LOG_P_MAX - LOG_P_MIN
  const MIN_PRESSURE = 1e-15 // Safe minimum to avoid log(0) or NaN

  const provider = $derived(config.provider ?? get_default_gas_provider())
  const enabled_gases = $derived(config.enabled_gases ?? [])
  // Effective pressures including defaults
  const effective_pressures = $derived(get_effective_pressures(config))

  // Committed pressure for a gas, else the config/default pressure
  function get_pressure(gas: GasSpecies): number {
    const pressure = pressures[gas] ?? effective_pressures[gas]
    return Number.isFinite(pressure) && pressure > 0 ? pressure : MIN_PRESSURE
  }

  // Chemical potential μ(T,P) for a gas at current temperature and pressure
  const get_mu = (gas: GasSpecies): number =>
    compute_gas_chemical_potential(provider, gas, temperature, get_pressure(gas))

  // Pressure <-> log scale slider position (0-100)
  const pressure_to_slider = (pressure: number): number =>
    ((clamp(Math.log10(pressure), LOG_P_MIN, LOG_P_MAX) - LOG_P_MIN) / LOG_P_RANGE) * 100
  const slider_to_pressure = (value: number): number =>
    10 ** (LOG_P_MIN + (value / 100) * LOG_P_RANGE)

  // Format pressure as plain text (no HTML) for the number input
  function format_pressure(pressure: number): string {
    const log_pressure = Math.log10(pressure)
    const exponent = Math.round(log_pressure)
    if (Math.abs(log_pressure - exponent) < 0.1) return `1e${exponent}`
    if (pressure >= 0.01 && pressure < 100) return pressure.toPrecision(2)
    return pressure.toExponential(1)
  }

  const set_pressure = (gas: GasSpecies, pressure: number): void => {
    pressures = { ...pressures, [gas]: pressure }
  }

  function set_pressure_direct(gas: GasSpecies, value: number): void {
    set_pressure(gas, clamp(value, 10 ** LOG_P_MIN, 10 ** LOG_P_MAX))
  }
</script>

{#if enabled_gases.length > 0}
  <div {...rest} class={[`pressure-controls`, rest.class]}>
    {#each enabled_gases as gas (gas)}
      {@const mu = get_mu(gas)}
      <VerticalSlider
        class="pressure-slider"
        bind:value={
          () => pressure_to_slider(get_pressure(gas)),
          (position) => set_pressure(gas, slider_to_pressure(position))
        }
        min={0}
        max={100}
        step={0.5}
        aria_label="{gas} partial pressure"
        tooltip_content={`${gas} partial pressure for μ(T,P)\nμ = ${format_chemical_potential(mu, 3)}`}
      >
        {#snippet header(position)}
          {@const pressure = slider_to_pressure(position)}
          <input
            type="text"
            class="pressure-input"
            value={format_pressure(pressure)}
            onchange={(evt) => {
              const val = Number(evt.currentTarget.value)
              if (Number.isFinite(val) && val > 0) set_pressure_direct(gas, val)
              else evt.currentTarget.value = format_pressure(pressure)
            }}
            aria-label="{gas} pressure (bar)"
          />
          <!-- subscript the stoichiometric digits in the gas formula -->
          <span class="gas-name"
            >{@html sanitize_html(gas.replaceAll(/(?<digits>\d+)/g, `<sub>$1</sub>`))}</span
          >
        {/snippet}
        {#snippet range_label()}
          10<sup>{LOG_P_MIN}</sup>–10<sup>{LOG_P_MAX}</sup>
        {/snippet}
      </VerticalSlider>
      <span class="sr-only" aria-live="polite">
        {gas} chemical potential: {format_chemical_potential(mu, 2)}
      </span>
    {/each}
  </div>
{/if}

<style>
  .pressure-controls {
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
  .pressure-input {
    width: 5.5ch;
  }
  .gas-name {
    font-size: 0.9em;
  }
  .gas-name :global(sub) {
    font-size: 0.7em;
    vertical-align: sub;
  }
</style>
