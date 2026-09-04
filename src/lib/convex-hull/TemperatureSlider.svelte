<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import VerticalSlider from './VerticalSlider.svelte'

  let {
    available_temperatures,
    interpolate_temperature = true,
    temperature = $bindable(),
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    available_temperatures: number[]
    interpolate_temperature?: boolean
    temperature: number
  } = $props()

  const min_temp = $derived(available_temperatures[0])
  const max_temp = $derived(available_temperatures[available_temperatures.length - 1])
  const slider_value = $derived(
    interpolate_temperature
      ? temperature
      : Math.max(0, available_temperatures.indexOf(temperature)),
  )
  const from_slider = (value: number) =>
    interpolate_temperature ? value : available_temperatures[value]

  function set_closest_temp(value: number): void {
    if (!Number.isFinite(value)) return
    temperature = interpolate_temperature
      ? Math.max(min_temp, Math.min(max_temp, value))
      : available_temperatures.reduce((prev, curr) =>
          Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev,
        )
  }
</script>

<VerticalSlider
  {...rest}
  class={[`temperature-slider`, rest.class]}
  bind:value={() => slider_value, (value) => (temperature = from_slider(value))}
  min={interpolate_temperature ? min_temp : 0}
  max={interpolate_temperature ? max_temp : available_temperatures.length - 1}
  aria_label="Temperature (Kelvin)"
  tooltip_content="Temperature for G(T) free energies"
>
  {#snippet header(value)}
    <input
      type="number"
      value={from_slider(value)}
      min={min_temp}
      max={max_temp}
      onchange={(evt) => set_closest_temp(evt.currentTarget.valueAsNumber)}
      aria-label="Temperature (Kelvin)"
    />
    <span>K</span>
  {/snippet}
  {#snippet range_label()}
    {available_temperatures[0]}–{available_temperatures.at(-1)} K
  {/snippet}
</VerticalSlider>
