<script lang="ts">
  import { format_num } from '$lib/labels'
  import type {
    AtomColorConfig,
    AtomPropertyColors,
  } from '$lib/structure/atom-properties'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    atom_color_config = { mode: `element`, scale: ``, scale_type: `continuous` },
    property_colors = null,
    title = ``,
    ...rest
  }: {
    atom_color_config?: Partial<AtomColorConfig>
    property_colors?: AtomPropertyColors | null
    title?: string
  } & HTMLAttributes<HTMLDivElement> = $props()

  const titles = {
    coordination: `Coordination Number`,
    wyckoff: `Wyckoff Position`,
    custom: `Custom Property`,
  }

  let show_legend = $derived(
    atom_color_config.mode !== `element` && property_colors?.colors.length,
  )
  let legend_title = $derived(
    title || titles[atom_color_config.mode as keyof typeof titles] || ``,
  )
  let format_value = (val: number | string) =>
    typeof val === `number` ? format_num(val, `.3~f`) : String(val)

  let gradient_css = $derived.by(() => {
    const { unique_values, colors, values } = property_colors || {}
    if (!unique_values?.length || atom_color_config.scale_type !== `continuous`) {
      return ``
    }

    const color_map = new Map(values!.map((v, i) => [v, colors![i]]))
    const stops = unique_values.map((v, i) => {
      const pct = (i / (unique_values.length - 1)) * 100
      return `${color_map.get(v)} ${pct}%`
    }).join(`, `)

    return `linear-gradient(to right, ${stops})`
  })
</script>

{#if show_legend}
  <div class="atom-color-legend" {...rest}>
    <h4>{legend_title}</h4>

    {#if atom_color_config.scale_type === `continuous` && property_colors}
      <div class="gradient-bar" style:background={gradient_css}></div>
      <div class="gradient-labels">
        <span>{format_value(property_colors.min_value ?? 0)}</span>
        <span>{format_value(property_colors.max_value ?? 0)}</span>
      </div>
    {:else if atom_color_config.scale_type === `categorical` && property_colors}
      <div class="categorical-legend">
        {#each property_colors.unique_values || [] as value (value)}
          {@const color = property_colors.colors[property_colors.values.indexOf(value)]}
          <div class="legend-item">
            <div class="color-swatch" style:background={color}></div>
            <span>{format_value(value)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .atom-color-legend {
    position: absolute;
    bottom: 1rem;
    left: 1rem;
    background: var(--pane-bg, rgba(0, 0, 0, 0.8));
    padding: 0.75rem 1rem;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: var(--legend-z-index, 10);
    max-width: min(90%, 250px);
    font-size: 0.9rem;
    backdrop-filter: blur(8px);
  }
  .atom-color-legend h4 {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
    font-weight: 600;
    opacity: 0.9;
  }
  .gradient-bar {
    height: 12px;
    width: 100%;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    margin-bottom: 0.25rem;
  }
  .gradient-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    opacity: 0.8;
  }
  .categorical-legend {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .color-swatch {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    flex-shrink: 0;
  }
  .legend-item span {
    font-size: 0.8rem;
  }
</style>
