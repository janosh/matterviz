<script lang="ts">
  import { tooltip } from 'svelte-multiselect'

  let {
    available_temperatures,
    temperature = $bindable(),
  }: {
    available_temperatures: number[]
    temperature: number
  } = $props()

  // Local preview state for smooth slider interaction without causing full re-renders
  let preview_index = $state<number | null>(null)
  let last_update_time = 0
  const THROTTLE_MS = 100

  const temp_index = $derived(
    Math.max(0, available_temperatures.indexOf(temperature)),
  )
  const display_index = $derived(preview_index ?? temp_index)
  const display_temp = $derived(available_temperatures[display_index] ?? temperature)

  function handle_slider_input(event: Event): void {
    const new_index = +(event.currentTarget as HTMLInputElement).value
    preview_index = new_index
    // Throttle parent updates during drag to prevent scene flashing
    const now = Date.now()
    if (now - last_update_time >= THROTTLE_MS) {
      last_update_time = now
      temperature = available_temperatures[new_index] ?? temperature
    }
  }

  function handle_slider_end(event: Event): void {
    const new_temp =
      available_temperatures[+(event.currentTarget as HTMLInputElement).value]
    if (new_temp !== undefined) temperature = new_temp
    preview_index = null
  }

  function set_closest_temp(value: number): void {
    temperature = available_temperatures.reduce(
      (prev, curr) => (Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev),
      temperature,
    )
  }
</script>

<div
  class="temperature-slider"
  {@attach tooltip({ content: `Temperature for G(T) free energies` })}
>
  <label class="temp-label">
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
  {#if available_temperatures.length > 0}
    <div class="slider-wrapper">
      <span class="temp-range">
        {available_temperatures[0]}–{available_temperatures.at(-1)} K
      </span>
      <input
        type="range"
        min="0"
        max={available_temperatures.length - 1}
        value={display_index}
        oninput={handle_slider_input}
        onchange={handle_slider_end}
        onmouseup={handle_slider_end}
        ontouchend={handle_slider_end}
        aria-label="Temperature (Kelvin)"
      />
    </div>
  {/if}
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
  .temp-label {
    display: flex;
    align-items: center;
    gap: 2px;
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
