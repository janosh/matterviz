<script lang="ts">
  interface Props {
    protons: number
    neutrons: number
    radius?: number
    size?: number
    proton_color?: string
    neutron_color?: string
    stroke?: string
    proton_label?: string
    neutron_label?: string
    text_color?: string
    symbol?: string
  }
  let {
    protons,
    neutrons,
    size = 100,
    radius = $bindable(size / 2),
    proton_color = `cornflowerblue`,
    neutron_color = `orange`,
    stroke = ``,
    proton_label = ` P`,
    neutron_label = ` N`,
    text_color = `white`,
    symbol = ``,
  }: Props = $props()

  $effect(() => {
    radius = size / 2
  })
  let proton_frac = $derived(protons / (protons + neutrons))
  let neutron_frac = $derived(1 - proton_frac)
  let proton_circ = $derived(Math.PI * radius * proton_frac)
  let dash_array = $derived(`0 ${Math.PI * radius - proton_circ} ${proton_circ}`)
  let text = $derived({
    'dominant-baseline': `middle`,
    'text-anchor': `middle`,
    fill: text_color,
  })
</script>

<svg width="100%" height="100%" viewBox="0 0 {size} {size}">
  <circle r={radius} cx={radius} cy={radius} fill={neutron_color} {stroke}>
    <title>Neutrons: {neutrons}</title>
  </circle>

  <circle
    r={radius / 2}
    cx={radius}
    cy={radius}
    fill={neutron_color}
    stroke={proton_color}
    stroke-width={radius}
    stroke-dasharray={dash_array}
  >
    <title>Protons: {protons}</title>
  </circle>

  <text
    x={radius + (radius / 2) * Math.cos(Math.PI * -proton_frac)}
    y={radius + (radius / 2) * Math.sin(Math.PI * -proton_frac)}
    {...text}
  >
    {protons} {proton_label}
  </text>

  <text
    x={radius + (radius / 2) * Math.cos(Math.PI * neutron_frac)}
    y={radius + (radius / 2) * Math.sin(Math.PI * neutron_frac)}
    {...text}
  >
    {neutrons} {neutron_label}
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
