<script lang="ts">
  import {
    resolve_plot_title,
    type PlotTitleBlockLayout,
    type PlotTitleConfig,
  } from '$lib/plot/core/plot-title'
  import { invalidate_text_metrics_after_fonts_ready } from '$lib/plot/core/text-metrics'
  import { onMount } from 'svelte'

  let {
    config,
    width,
    x = 0,
    y = 0,
  }: {
    config?: PlotTitleConfig | null
    width: number
    x?: number
    y?: number
  } = $props()

  let font_metrics_revision = $state(0)
  onMount(() => {
    let mounted = true
    // Fonts that never resolve keep the fallback measurements, which is fine
    void invalidate_text_metrics_after_fonts_ready().then(
      (revision) => {
        if (mounted) font_metrics_revision = revision
      },
      () => {},
    )
    return () => {
      mounted = false
    }
  })

  // Re-measured when geometry changes or a metrics revision (fonts ready) invalidates the cache
  const layout = $derived(
    resolve_plot_title(config, { width, x, y, metrics_revision: font_metrics_revision }),
  )
</script>

{#snippet title_block(block: PlotTitleBlockLayout)}
  {@const is_title = block.kind === `title`}
  <text
    class="plot-{block.kind}-text"
    x={block.x}
    text-anchor={layout.align}
    font-family={block.font.font_family}
    font-size={block.font.font_size}
    font-style={block.font.font_style}
    font-variant={block.font.font_variant}
    font-weight={block.font.font_weight}
    font-stretch={block.font.font_stretch}
    fill="currentColor"
    pointer-events="none"
    role={is_title ? `heading` : `note`}
    aria-level={is_title ? 2 : undefined}
    aria-label={block.label}
  >
    {#each block.lines as line}
      <tspan x={line.x} y={line.y} aria-hidden="true">{line.text}</tspan>
    {/each}
  </text>
{/snippet}

{#if layout.title || layout.subtitle}
  <g class="plot-title">
    {#if layout.title}
      {@render title_block(layout.title)}
    {/if}
    {#if layout.subtitle}
      {@render title_block(layout.subtitle)}
    {/if}
  </g>
{/if}
