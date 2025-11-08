<script lang="ts">
  import type { CompositionType, ElementSymbol } from '$lib'
  import { element_data, format_num } from '$lib'
  import { contrast_color, default_element_colors } from '$lib/colors'
  import { colors } from '$lib/state.svelte'
  import type {
    AtomColorConfig,
    AtomPropertyColors,
  } from '$lib/structure/atom-properties'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'

  let {
    atom_color_config = { mode: `element`, scale: ``, scale_type: `continuous` },
    property_colors = null,
    elements,
    elem_color_picker_title = `Double click to reset color`,
    labels = $bindable([]),
    amount_format = `.3~f`,
    show_amounts = true,
    get_element_label,
    hidden_elements = $bindable(new Set()),
    title = ``,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    atom_color_config?: Partial<AtomColorConfig>
    property_colors?: AtomPropertyColors | null
    elements?: CompositionType
    elem_color_picker_title?: string
    labels?: HTMLLabelElement[]
    amount_format?: string // Float formatting for element amounts (default: 3 significant digits)
    show_amounts?: boolean // Whether to show element amounts
    get_element_label?: (element: string, amount: number) => string // Custom label function
    hidden_elements?: Set<ElementSymbol>
    title?: string
  } = $props()

  const titles = {
    coordination: `Coordination Number`,
    wyckoff: `Wyckoff Position`,
  }

  let show_element_legend = $derived(
    atom_color_config.mode === `element` && elements &&
      Object.keys(elements).length > 0,
  )
  let show_property_legend = $derived(
    atom_color_config.mode !== `element` && property_colors?.colors.length,
  )
  let legend_title = $derived(
    title || titles[atom_color_config.mode as keyof typeof titles] || ``,
  )
  // Format display values based on mode
  let format_value = (val: number | string): string => {
    if (typeof val === `number`) return format_num(val, `.3~f`)
    // Format Wyckoff orbit IDs (e.g., "e|Fe" -> "Fe (e)")
    if (typeof val === `string` && val.includes(`|`)) {
      const [wyckoff, element] = val.split(`|`, 2)
      return `${element} (${wyckoff})`
    }
    return String(val)
  }

  // Map from property value to color (computed once, reused in categorical legend)
  let color_map = $derived(
    new Map(
      property_colors?.values.map((v, i) => [v, property_colors.colors[i]]) ?? [],
    ),
  )

  // CSS gradient for continuous scales
  let gradient_css = $derived.by(() => {
    const { unique_values } = property_colors || {}
    if (!unique_values?.length || atom_color_config.scale_type !== `continuous`) {
      return ``
    }

    // Handle single-value case to avoid division by zero
    if (unique_values.length === 1) {
      const color = color_map.get(unique_values[0])
      return `linear-gradient(to right, ${color}, ${color})`
    }

    const stops = unique_values
      .map((v, i) => {
        const pct = (i / (unique_values.length - 1)) * 100
        return `${color_map.get(v)} ${pct}%`
      })
      .join(`, `)

    return `linear-gradient(to right, ${stops})`
  })

  function toggle_element_visibility(element: ElementSymbol, event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    const new_hidden = new SvelteSet(hidden_elements)
    if (new_hidden.has(element)) new_hidden.delete(element)
    else new_hidden.add(element)
    hidden_elements = new_hidden
  }
</script>

{#if show_element_legend}
  <div {...rest} class="atom-legend element-legend {rest.class ?? ``}">
    {#each Object.entries(elements!) as [elem, amt], idx (elem + amt)}
      {@const is_hidden = hidden_elements.has(elem as ElementSymbol)}
      <div class="legend-item">
        <label
          bind:this={labels[idx]}
          title={element_data.find((el) => el.symbol == elem)?.name}
          {@attach tooltip()}
          style:background-color={colors.element[elem]}
          class:hidden={is_hidden}
          ondblclick={(event) => {
            event.preventDefault()
            colors.element[elem] = default_element_colors[elem]
          }}
          {@attach contrast_color()}
        >
          {#if get_element_label}
            {get_element_label(elem, amt)}
          {:else}
            {elem}
            {#if show_amounts}
              <sub>{format_num(amt, amount_format)}</sub>
            {/if}
          {/if}
          <input
            type="color"
            bind:value={colors.element[elem]}
            title={elem_color_picker_title}
          />
        </label>
        <button
          class="toggle-visibility"
          class:visible={is_hidden}
          onclick={(event) => toggle_element_visibility(elem as ElementSymbol, event)}
          title={is_hidden ? `Show ${elem} atoms` : `Hide ${elem} atoms`}
          {@attach tooltip({ placement: `top` })}
          type="button"
        >
          ×
        </button>
      </div>
    {/each}
  </div>
{:else if show_property_legend}
  <div class="atom-legend property-legend atom-color-legend" {...rest}>
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
          {@const color = color_map.get(value)}
          <div class="legend-item">
            <span
              class="category-label color-swatch"
              style:background-color={color}
              {@attach contrast_color()}
            >
              {format_value(value)}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .atom-legend {
    position: absolute;
    z-index: var(--legend-z-index, 1);
    pointer-events: auto;
    visibility: visible;
  }

  /* Element Legend Styles */
  .element-legend {
    display: flex;
    bottom: var(--struct-legend-bottom, clamp(4pt, 3cqmin, 8pt));
    right: var(--struct-legend-right, clamp(4pt, 3cqmin, 8pt));
    gap: var(--struct-legend-gap, clamp(3pt, 2cqmin, 7pt));
    font-size: var(--struct-legend-font, clamp(8pt, 3cqmin, 14pt));
    filter: var(--legend-filter, grayscale(10%) brightness(0.95) saturate(0.9));
  }
  .element-legend .legend-item {
    position: relative;
    display: inline-block;
  }
  .element-legend label {
    padding: var(--struct-legend-padding, 0 4pt);
    border-radius: var(--struct-legend-radius, 3pt);
    line-height: var(--struct-legend-line-height, 1.3);
    display: inline-block;
    cursor: pointer;
    visibility: visible;
    white-space: nowrap;
    transition: opacity 0.2s ease;
  }
  .element-legend label.hidden {
    opacity: 0.4;
  }
  .element-legend label input[type='color'] {
    z-index: var(--struct-legend-input-z, 1);
    opacity: 0;
    position: absolute;
    visibility: hidden;
    top: 7pt;
    left: 0;
  }
  .element-legend button.toggle-visibility {
    position: absolute;
    top: -3px;
    right: -7px;
    width: 1em;
    height: 1em;
    padding: 0;
    margin: 0;
    border: none;
    background: rgba(0, 0, 0, 0.5);
    color: white;
    border-radius: 50%;
    font-size: 0.9em;
    line-height: 0.9;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s ease, background 0.2s ease, transform 0.1s ease;
    z-index: 2;
    pointer-events: auto;
  }
  .element-legend button.toggle-visibility.visible,
  .element-legend .legend-item:hover button.toggle-visibility {
    opacity: 1;
  }
  .element-legend button.toggle-visibility:hover {
    background: rgba(0, 0, 0, 0.8);
    transform: scale(1.15);
  }
  .element-legend sub {
    font-size: 0.85em;
    margin: 0 0 0 -4px;
  }

  /* Property Legend Styles */
  .property-legend {
    bottom: var(--struct-legend-bottom, clamp(2pt, 1.5cqmin, 4pt));
    right: var(--struct-legend-right, clamp(2pt, 1.5cqmin, 4pt));
    font-size: var(--struct-legend-font, clamp(7pt, 2.5cqmin, 12pt));
  }
  .property-legend h4 {
    margin: 0 0 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    opacity: 0.85;
    text-align: center;
  }
  .gradient-bar {
    height: 10px;
    width: 150px;
    border-radius: 2px;
    margin-bottom: 0.2rem;
  }
  .gradient-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.7rem;
    opacity: 0.75;
  }
  .categorical-legend {
    display: flex;
    flex-direction: row;
    gap: clamp(3pt, 2cqmin, 7pt);
    flex-wrap: wrap;
  }
  .categorical-legend .legend-item {
    display: inline-block;
  }
  .category-label {
    padding: var(--struct-legend-padding, 0 4pt);
    border-radius: var(--struct-legend-radius, 3pt);
    line-height: var(--struct-legend-line-height, 1.3);
    display: inline-block;
    white-space: nowrap;
    font-size: var(--struct-legend-font, clamp(8pt, 3cqmin, 14pt));
  }
</style>
