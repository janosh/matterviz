<script lang="ts">
  import { is_concrete_color, pick_contrast_color } from '$lib/colors'
  import type { SVGAttributes } from 'svelte/elements'

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
    text_color,
    symbol = ``,
    ...rest
  }: SVGAttributes<SVGSVGElement> & {
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
  } = $props()

  $effect(() => {
    radius = size / 2
  })
  let proton_frac = $derived(protons / (protons + neutrons))
  let neutron_frac = $derived(1 - proton_frac)
  let proton_circ = $derived(Math.PI * radius * proton_frac)
  let dash_array = $derived(`0 ${Math.PI * radius - proton_circ} ${proton_circ}`)
</script>

<svg width="100%" height="100%" viewBox="0 0 {size} {size}" {...rest}>
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

  <g dominant-baseline="middle" text-anchor="middle">
    {#if protons > 0}
      <text
        x={radius + (radius / 2) * Math.cos(Math.PI * -proton_frac)}
        y={radius + (radius / 2) * Math.sin(Math.PI * -proton_frac)}
        fill={text_color ?? pick_contrast_color({ bg_color: proton_color })}
      >
        {protons}
        {proton_label}
      </text>
    {/if}

    {#if neutrons > 0}
      <text
        x={radius + (radius / 2) * Math.cos(Math.PI * neutron_frac)}
        y={radius + (radius / 2) * Math.sin(Math.PI * neutron_frac)}
        fill={text_color ?? pick_contrast_color({ bg_color: neutron_color })}
      >
        {neutrons}
        {neutron_label}
      </text>
    {/if}

    {#if symbol}
      {@const symbol_color = text_color ?? pick_contrast_color({ bg_color: neutron_color })}
      <text
        class="symbol"
        x={radius}
        y={radius}
        fill={symbol_color}
        stroke={is_concrete_color(symbol_color)
          ? pick_contrast_color({ bg_color: symbol_color, backdrop_color: neutron_color })
          : undefined}
        stroke-width="0.08em"
        paint-order="stroke">{symbol}</text
      >
    {/if}
  </g>
</svg>
