<script lang="ts">
  import { tooltip } from 'svelte-multiselect'

  let {
    available_temperatures,
    temperature = $bindable(),
  }: {
    available_temperatures: number[]
    temperature: number
  } = $props()

  const temp_index = $derived(
    Math.max(0, available_temperatures.indexOf(temperature)),
  )
  const display_temp = $derived(available_temperatures[temp_index] ?? temperature)

  // Find closest available temperature to input value
  function set_closest_temp(value: number): void {
    temperature = available_temperatures.reduce(
      (prev, curr) => (Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev),
      temperature, // fallback to current if array is empty
    )
  }
</script>

<div
  class="temperature-slider"
  {@attach tooltip({ content: `Temperature for G(T) free energies` })}
>
  <label>
    <input
      type="number"
      class="temp-input"
      value={display_temp}
      min={available_temperatures[0] ?? 0}
      max={available_temperatures.at(-1) ?? 1000}
      onchange={(evt) => set_closest_temp(+evt.currentTarget.value)}
      aria-label="Temperature (Kelvin)"
    />
    <span>K</span>
  </label>
  <div class="slider-wrapper">
    {#if available_temperatures.length > 0}
      <span class="temp-range">
        {available_temperatures[0]}–{available_temperatures.at(-1)} K
      </span>
    {/if}
    <input
      type="range"
      min="0"
      max={available_temperatures.length - 1}
      value={temp_index}
      oninput={(evt) => temperature = available_temperatures[+evt.currentTarget.value]}
      aria-label="Temperature (Kelvin)"
    />
  </div>
</div>

<style>
  .temperature-slider {
    position: absolute;
    top: calc(1ex + 50px);
    right: 1ex;
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
  .temperature-slider input[type='range'] {
    writing-mode: vertical-lr;
    direction: rtl;
  }
  .temp-input {
    border: 1px solid color-mix(in srgb, currentColor 5%, transparent);
    border-radius: 3px;
    background: transparent;
    text-align: center;
  }
  .temp-input::-webkit-outer-spin-button,
  .temp-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  .temp-range {
    font-size: 0.7em;
    opacity: 0.7;
    white-space: nowrap;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
  }
</style>
