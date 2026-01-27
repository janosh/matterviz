<script lang="ts">
  import { tooltip } from 'svelte-multiselect'

  let {
    available_temperatures,
    temperature = $bindable(),
  }: {
    available_temperatures: number[]
    temperature: number
  } = $props()

  // Guard against -1 when temperature is temporarily out of sync during reactivity
  let temp_index = $derived(Math.max(0, available_temperatures.indexOf(temperature)))
</script>

<div
  class="temperature-slider"
  {@attach tooltip({ content: `Temperature for G(T) free energies` })}
>
  <span class="temp-label">{temperature} K</span>
  <input
    type="range"
    min="0"
    max={available_temperatures.length - 1}
    value={temp_index}
    oninput={(e) => temperature = available_temperatures[+e.currentTarget.value]}
    aria-label="Temperature (Kelvin)"
  />
  <span class="temp-range">
    {available_temperatures[0]}–{
      available_temperatures[available_temperatures.length - 1]
    } K
  </span>
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
  .temperature-slider input[type='range'] {
    writing-mode: vertical-lr;
    direction: rtl;
    height: 100px;
    width: 20px;
    cursor: pointer;
  }
  .temp-label {
    font-size: 0.9em;
    font-weight: 500;
    white-space: nowrap;
  }
  .temp-range {
    font-size: 0.7em;
    opacity: 0.7;
    white-space: nowrap;
  }
</style>
