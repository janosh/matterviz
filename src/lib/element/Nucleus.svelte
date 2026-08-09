<script lang="ts">
  import { is_concrete_color, pick_contrast_color } from '$lib/colors'
  import type { NucleonPaint, SymbolPaint } from '$lib/element'
  import type { SVGAttributes } from 'svelte/elements'

  let {
    protons,
    neutrons,
    size = 100,
    radius = $bindable(size / 2),
    proton = { fill: `cornflowerblue`, label: ` P` },
    neutron = { fill: `orange`, label: ` N` },
    symbol_paint = {},
    stroke = ``,
    symbol = ``,
    ...rest
  }: SVGAttributes<SVGSVGElement> & {
    protons: number
    neutrons: number
    radius?: number
    size?: number
    // Per-part paints. Each nucleon owns its fill, label suffix and label color rather
    // than sharing one flat `text_color` across parts that sit on different backgrounds.
    proton?: NucleonPaint
    neutron?: NucleonPaint
    symbol_paint?: SymbolPaint
    // Outline around the whole nucleus.
    stroke?: string
    symbol?: string
  } = $props()

  $effect(() => {
    radius = size / 2
  })
  let proton_frac = $derived(protons / (protons + neutrons))
  let neutron_frac = $derived(1 - proton_frac)
  let proton_circ = $derived(Math.PI * radius * proton_frac)
  let dash_array = $derived(`0 ${Math.PI * radius - proton_circ} ${proton_circ}`)
  let sector_labels = $derived([
    { count: protons, fraction: -proton_frac, paint: proton },
    { count: neutrons, fraction: neutron_frac, paint: neutron },
  ])

  const symbol_color = $derived(
    symbol_paint.text ?? pick_contrast_color({ background: neutron.fill }),
  )
  const symbol_outline = $derived.by(() => {
    const { outline } = symbol_paint
    if (outline === `none`) return undefined
    if (outline) return outline
    return is_concrete_color(symbol_color)
      ? pick_contrast_color({ background: symbol_color, backdrop: neutron.fill })
      : undefined
  })
</script>

<svg width="100%" height="100%" viewBox="0 0 {size} {size}" {...rest}>
  <circle r={radius} cx={radius} cy={radius} fill={neutron.fill} {stroke}>
    <title>Neutrons: {neutrons}</title>
  </circle>

  <circle
    r={radius / 2}
    cx={radius}
    cy={radius}
    fill={neutron.fill}
    stroke={proton.fill}
    stroke-width={radius}
    stroke-dasharray={dash_array}
  >
    <title>Protons: {protons}</title>
  </circle>

  <g dominant-baseline="middle" text-anchor="middle">
    {#each sector_labels as { count, fraction, paint }}
      {#if count > 0}
        <text
          x={radius + (radius / 2) * Math.cos(Math.PI * fraction)}
          y={radius + (radius / 2) * Math.sin(Math.PI * fraction)}
          fill={paint.text ?? pick_contrast_color({ background: paint.fill })}
        >
          {count}
          {paint.label ?? ``}
        </text>
      {/if}
    {/each}

    {#if symbol}
      <text
        class="symbol"
        x={radius}
        y={radius}
        fill={symbol_color}
        stroke={symbol_outline}
        stroke-width={symbol_paint.outline_width ?? `0.08em`}
        paint-order="stroke">{symbol}</text
      >
    {/if}
  </g>
</svg>
