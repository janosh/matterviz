<script lang="ts">
  export let protons: number
  export let neutrons: number
  export let radius: number = 4
  export let size: number = 100
  export let proton_color: string = `cornflowerblue`
  export let neutron_color: string = `orange`
  export let stroke: string = ``
  export let proton_label: string = ` P`
  export let neutron_label: string = ` N`
  export let text_color: string = `white`
  export let symbol: string = ``

  $: radius = size / 2
  $: proton_frac = protons / (protons + neutrons)
  $: neutron_frac = 1 - proton_frac
  $: proton_circ = Math.PI * radius * proton_frac
  $: dash_array = `0 ${Math.PI * radius - proton_circ} ${proton_circ}`
  $: text = { 'dominant-baseline': `middle`, 'text-anchor': `middle`, fill: text_color }
</script>

<svg width={size} height={size} viewBox="0 0 {size} {size}">
  <circle r={radius} cx={radius} cy={radius} fill={neutron_color} {stroke} />
  <circle
    r={radius / 2}
    cx={radius}
    cy={radius}
    fill={neutron_color}
    stroke={proton_color}
    stroke-width={radius}
    stroke-dasharray={dash_array}
  />

  <text
    x={radius + (radius / 2) * Math.cos(Math.PI * -proton_frac)}
    y={radius + (radius / 2) * Math.sin(Math.PI * -proton_frac)}
    {...text}
  >
    {protons}
    {proton_label}
  </text>

  <text
    x={radius + (radius / 2) * Math.cos(Math.PI * neutron_frac)}
    y={radius + (radius / 2) * Math.sin(Math.PI * neutron_frac)}
    {...text}
  >
    {neutrons}
    {neutron_label}
  </text>

  {#if symbol}
    <text class="symbol" x={radius} y={radius} {...text}>
      {symbol}
    </text>
  {/if}
</svg>

<style>
  text {
    font-size: 11pt;
  }
  text.symbol {
    font-size: 15pt;
  }
</style>
