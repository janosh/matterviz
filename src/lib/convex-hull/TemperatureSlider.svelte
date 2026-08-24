<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import VerticalSlider from './VerticalSlider.svelte'

  let {
    available_temperatures,
    temperature = $bindable(),
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    available_temperatures: number[]
    temperature: number
  } = $props()

  // The slider runs over indices into the tabulated temperatures
  const temp_index = $derived(Math.max(0, available_temperatures.indexOf(temperature)))

  function set_closest_temp(value: number): void {
    temperature = available_temperatures.reduce(
      (prev, curr) => (Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev),
      temperature,
    )
  }
</script>

<VerticalSlider
  {...rest}
  class={[`temperature-slider`, rest.class]}
  bind:value={
    () => temp_index, (idx) => (temperature = available_temperatures[idx] ?? temperature)
  }
  min={0}
  max={available_temperatures.length - 1}
  aria_label="Temperature (Kelvin)"
  tooltip_content="Temperature for G(T) free energies"
>
  {#snippet header(index)}
    <input
      type="number"
      value={available_temperatures[index] ?? temperature}
      min={available_temperatures[0] ?? 0}
      max={available_temperatures.at(-1) ?? 1000}
      onchange={(evt) => set_closest_temp(+evt.currentTarget.value)}
      aria-label="Temperature (Kelvin)"
    />
    <span>K</span>
  {/snippet}
  {#snippet range_label()}
    {available_temperatures[0]}–{available_temperatures.at(-1)} K
  {/snippet}
</VerticalSlider>
