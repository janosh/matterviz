<script lang="ts">
  import { format_value_or_num } from '#lib/labels.js'
  import { size_legend_layout, type SizeLegendEntry } from '#lib/plot/core/size-legend.js'
  import { DEFAULT_FONT_SPEC, resolve_font_spec } from '#lib/plot/core/text-metrics.js'

  // Reference circles for a bubble chart's size scale (see size-legend.ts). Circles and text
  // take currentColor, so the legend follows the theme's text color.
  let {
    entries,
    title,
    format,
    font_size = 11,
  }: {
    entries: readonly SizeLegendEntry[] // legend values and the marker radii they map to
    title?: string
    format?: string // d3-format spec for the value labels
    font_size?: number
  } = $props()

  // The font the labels actually render in, so columns are sized by real text widths
  const fallback_font = $derived({ ...DEFAULT_FONT_SPEC, font_size })
  let font = $state<ReturnType<typeof resolve_font_spec>>()
  const geometry = $derived(
    size_legend_layout(entries, {
      format_label: (value) => format_value_or_num(value, format),
      font: font ?? fallback_font,
      title,
    }),
  )
</script>

<svg
  class="size-legend"
  width={geometry.width}
  height={geometry.height}
  viewBox="0 0 {geometry.width} {geometry.height}"
  role="img"
  aria-label={`${title ? `${title}: ` : ``}marker size legend, ${geometry.items
    .map(({ text }) => text)
    .join(`, `)}`}
  style:font-size="{font_size}px"
  {@attach (node: SVGSVGElement) => {
    font = resolve_font_spec(node, fallback_font)
  }}
>
  {#if title}
    <text x="0" y={geometry.title_y} class="title">{title}</text>
  {/if}
  {#each geometry.items as { value, radius, cx, cy, text } (value)}
    <circle {cx} {cy} r={radius} />
    <text x={cx} y={geometry.label_y} text-anchor="middle" dominant-baseline="hanging"
      >{text}</text
    >
  {/each}
</svg>

<style>
  .size-legend {
    overflow: visible;
    fill: currentColor;
    circle {
      fill: none;
      stroke: currentColor;
    }
    .title {
      font-weight: 600;
    }
  }
</style>
