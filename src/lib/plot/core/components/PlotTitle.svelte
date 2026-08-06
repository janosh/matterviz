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
    metrics_revision = 0,
  }: {
    config?: PlotTitleConfig | null
    width: number
    x?: number
    y?: number
    // Pass get_text_metrics_revision() after cache invalidation to trigger remeasurement.
    metrics_revision?: number
  } = $props()

  let font_metrics_revision = $state(0)
  onMount(() => {
    let mounted = true
    void invalidate_text_metrics_after_fonts_ready().then((revision) => {
      if (mounted) font_metrics_revision = revision
    })
    return () => {
      mounted = false
    }
  })

  // Measurement populates text-metrics' cache, so it cannot run inside $derived. Resolve once
  // during SSR/initialization, then refresh before DOM updates when geometry or metrics change.
  const resolve_layout = () =>
    resolve_plot_title(config, {
      width,
      x,
      y,
      metrics_revision: Math.max(metrics_revision, font_metrics_revision),
    })
  let layout = $state.raw(resolve_layout())
  $effect.pre(() => {
    layout = resolve_layout()
  })
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
