<script lang="ts">
  import {
    composite_colors,
    is_concrete_color,
    is_opaque_color,
    pick_contrast_color,
    resolve_backdrop,
  } from '$lib/colors'
  import type { NucleonPaint, SymbolPaint } from '$lib/element'
  import type { SVGAttributes } from 'svelte/elements'

  const DEFAULT_PROTON_PAINT = { fill: `cornflowerblue`, label: ` P` }
  const DEFAULT_NEUTRON_PAINT = { fill: `orange`, label: ` N` }

  let {
    protons,
    neutrons,
    size = 100,
    radius = $bindable(size / 2),
    proton: proton_paint = {},
    neutron: neutron_paint = {},
    symbol_paint = {},
    stroke = ``,
    symbol = ``,
    backdrop: backdrop_color = undefined,
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
    // Opaque surface behind the nucleus, used to resolve translucent nucleon fills.
    backdrop?: string
  } = $props()

  let node = $state<SVGSVGElement>()
  const backdrop = resolve_backdrop(() => node, { override: () => backdrop_color })
  const proton = $derived({
    fill: proton_paint.fill ?? DEFAULT_PROTON_PAINT.fill,
    label: proton_paint.label ?? DEFAULT_PROTON_PAINT.label,
    text: proton_paint.text,
  })
  const neutron = $derived({
    fill: neutron_paint.fill ?? DEFAULT_NEUTRON_PAINT.fill,
    label: neutron_paint.label ?? DEFAULT_NEUTRON_PAINT.label,
    text: neutron_paint.text,
  })

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

  const paint_text_color = (paint: NucleonPaint & { fill: string }): string =>
    paint.text ?? pick_contrast_color({ background: paint.fill, backdrop: backdrop.current })
  const symbol_color = $derived(
    symbol_paint.text ??
      pick_contrast_color({ background: neutron.fill, backdrop: backdrop.current }),
  )
  const neutron_surface = $derived(
    is_opaque_color(neutron.fill)
      ? neutron.fill
      : composite_colors(neutron.fill, backdrop.current),
  )
  const symbol_outline = $derived.by(() => {
    const { outline } = symbol_paint
    if (outline === `none`) return undefined
    if (outline) return outline
    return is_concrete_color(symbol_color)
      ? pick_contrast_color({ background: symbol_color, backdrop: neutron_surface })
      : undefined
  })
</script>

<svg bind:this={node} width="100%" height="100%" viewBox="0 0 {size} {size}" {...rest}>
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
          fill={paint_text_color(paint)}
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
