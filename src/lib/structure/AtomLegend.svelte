<script lang="ts">
  import type { CompositionType, ElementSymbol } from '$lib'
  import { element_data, format_num, Icon } from '$lib'
  import { contrast_color, default_element_colors } from '$lib/colors'
  import { SETTINGS_CONFIG } from '$lib/settings'
  import { colors } from '$lib/state.svelte'
  import type {
    AtomColorConfig,
    AtomPropertyColors,
  } from '$lib/structure/atom-properties'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import type { Snippet } from 'svelte'
  import { click_outside, tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'

  let {
    atom_color_config = $bindable({
      mode: `element`,
      scale: ``,
      scale_type: `continuous`,
    }),
    property_colors = null,
    elements,
    elem_color_picker_title = `Double click to reset color`,
    labels = $bindable([]),
    amount_format = `.3~f`,
    show_amounts = true,
    get_element_label,
    hidden_elements = $bindable(new Set()),
    hidden_prop_vals = $bindable(new Set<number | string>()),
    title = ``,
    sym_data = null,
    children,
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
    hidden_prop_vals?: Set<number | string> // Track hidden property values (e.g., Wyckoff positions, coordination numbers)
    title?: string
    sym_data?: MoyoDataset | null
    children?: Snippet<[{ mode_menu_open: boolean }]>
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

  // Dropdown state
  let mode_menu_open = $state(false)

  // Clear hidden property values when switching modes (since they may not be valid)
  let previous_mode = $state(atom_color_config.mode)
  $effect(() => {
    if (atom_color_config.mode !== previous_mode) {
      hidden_prop_vals = new Set()
      previous_mode = atom_color_config.mode
    }
  })
  // Format display values based on mode
  let format_value = (val: number | string): string => {
    if (typeof val === `number`) return format_num(val, `.3~f`)

    if (typeof val === `string` && val.includes(`|`)) { // Format Wyckoff orbit IDs
      const [wyckoff, element] = val.split(`|`, 2)
      // Count how many sites have this wyckoff+element combination
      const count = property_colors?.values.filter((v) => v === val).length ?? 0
      return `${element}:${count}${wyckoff}`
    }
    return String(val)
  }

  // Map from property value to color (computed once, reused in categorical legend)
  let color_map = $derived(
    new Map(
      // Use unique_values instead of values to avoid undefined colors from duplicates
      property_colors?.unique_values?.map((val) => {
        const first_site_idx = property_colors.values.indexOf(val)
        return [val, property_colors.colors[first_site_idx]]
      }) ?? [],
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

  function toggle_visibility<T>(
    set: Set<T>,
    value: T,
    event: MouseEvent,
  ): Set<T> {
    event.preventDefault()
    event.stopPropagation()
    const new_set = new SvelteSet(set)
    if (new_set.has(value)) new_set.delete(value)
    else new_set.add(value)
    return new_set
  }
</script>

{#snippet mode_selector_snippet()}
  <div
    class="mode-selector"
    {@attach click_outside({ callback: () => mode_menu_open = false })}
  >
    <button
      class="mode-toggle"
      onclick={() => (mode_menu_open = !mode_menu_open)}
      title="Change atom coloring mode"
      aria-expanded={mode_menu_open}
      {@attach tooltip()}
    >
      <Icon icon={mode_menu_open ? `Collapse` : `Expand`} />
    </button>
    {#if mode_menu_open}
      <div class="mode-dropdown">
        {#each Object.entries(SETTINGS_CONFIG.structure.atom_color_mode.enum || {}) as
          [value, label]
          (value)
        }
          <button
            class="mode-option"
            class:selected={atom_color_config.mode === value}
            class:disabled={value === `wyckoff` && !sym_data}
            disabled={value === `wyckoff` && !sym_data}
            onclick={() => {
              atom_color_config.mode = value as AtomColorConfig[`mode`]
              mode_menu_open = false
            }}
          >
            <span>{label}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

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
          onclick={(
            event,
          ) => (hidden_elements = toggle_visibility(
            hidden_elements,
            elem as ElementSymbol,
            event,
          ))}
          title={is_hidden ? `Show ${elem} atoms` : `Hide ${elem} atoms`}
          {@attach tooltip({ placement: `top` })}
          type="button"
        >
          ×
        </button>
      </div>
    {/each}
    {@render children?.({ mode_menu_open })}
    {@render mode_selector_snippet()}
  </div>
{:else if show_property_legend}
  <div
    class="atom-legend property-legend atom-color-legend"
    class:categorical-legend={atom_color_config.scale_type === `categorical`}
    {...rest}
  >
    {#if legend_title}
      <div class="legend-header">
        <h4>{legend_title}</h4>
      </div>
    {/if}
    {#if atom_color_config.scale_type === `continuous` && property_colors}
      <div
        class="gradient-container"
        title={legend_title}
        {@attach tooltip({ placement: `top` })}
      >
        <div class="gradient-bar" style:background={gradient_css}></div>
        <div class="gradient-labels">
          <span>{format_value(property_colors.min_value ?? 0)}</span>
          <span>{format_value(property_colors.max_value ?? 0)}</span>
        </div>
      </div>
    {:else if atom_color_config.scale_type === `categorical` && property_colors}
      {#each property_colors.unique_values || [] as
        value
        (`${atom_color_config.mode}-${value}`)
      }
        {@const color = color_map.get(value)}
        {@const is_hidden = hidden_prop_vals.has(value)}
        <div class="legend-item">
          <span
            class="category-label color-swatch"
            class:hidden={is_hidden}
            style:background-color={color}
            {@attach contrast_color()}
          >
            {format_value(value)}
          </span>
          <button
            class="toggle-visibility"
            class:visible={is_hidden}
            onclick={(
              event,
            ) => (hidden_prop_vals = toggle_visibility(
              hidden_prop_vals,
              value,
              event,
            ))}
            title={is_hidden ? `Show ${format_value(value)}` : `Hide ${format_value(value)}`}
            {@attach tooltip({ placement: `top` })}
            type="button"
          >
            ×
          </button>
        </div>
      {/each}
    {/if}
    {@render children?.({ mode_menu_open })}
    {@render mode_selector_snippet()}
  </div>
{/if}

<style>
  .atom-legend {
    position: absolute;
    z-index: var(--legend-z-index, 1);
    pointer-events: auto;
    visibility: visible;
    filter: var(--legend-filter, grayscale(10%) brightness(0.95) saturate(0.8));
  }
  /* Element Legend Styles */
  .element-legend {
    display: flex;
    bottom: var(--struct-legend-bottom, clamp(4pt, 3cqmin, 8pt));
    right: var(--struct-legend-right, clamp(4pt, 3cqmin, 8pt));
    gap: var(--struct-legend-gap, clamp(3pt, 2cqmin, 7pt));
    font-size: var(--struct-legend-font, clamp(8pt, 3cqmin, 14pt));
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
    display: flex;
    bottom: var(--struct-legend-bottom, clamp(4pt, 3cqmin, 8pt));
    right: var(--struct-legend-right, clamp(4pt, 3cqmin, 8pt));
    gap: var(--struct-legend-gap, clamp(3pt, 2cqmin, 7pt));
    font-size: var(--struct-legend-font, clamp(8pt, 3cqmin, 14pt));
    align-items: center;
  }
  .gradient-container {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .mode-selector {
    position: relative;
    display: flex;
    align-items: center;
  }
  .mode-toggle {
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    font-size: 0.9em;
    opacity: 0.7;
    transition: opacity 0.2s ease;
  }
  .mode-toggle:hover {
    opacity: 1;
  }
  .mode-dropdown {
    position: absolute;
    bottom: 100%;
    right: 0;
    margin-bottom: 0.25rem;
    background: var(--surface-bg);
    border-radius: 4px;
    box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.3), 0 4px 8px -2px rgba(0, 0, 0, 0.1);
    display: flex;
    flex-direction: column;
    z-index: 10;
    min-width: 150px;
  }
  .mode-option {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 0.4rem 0.6rem;
    box-sizing: border-box;
    background: transparent;
    border: none;
    border-radius: 0;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s ease;
    font-size: 0.85rem;
  }
  .mode-option:first-child {
    border-top-left-radius: 4px;
    border-top-right-radius: 4px;
  }
  .mode-option:last-child {
    border-bottom-left-radius: 4px;
    border-bottom-right-radius: 4px;
  }
  .mode-option:hover:not(.disabled) {
    background: var(--pane-btn-bg-hover, rgba(128, 128, 128, 0.1));
  }
  .mode-option.selected {
    color: var(--accent-color);
    font-weight: 500;
  }
  .mode-option.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .mode-option span {
    white-space: nowrap;
  }
  .gradient-bar {
    height: 10px;
    width: 100px;
    border-radius: 2px;
  }
  .gradient-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.65rem;
    opacity: 0.75;
    line-height: 1;
  }
  .property-legend .legend-item {
    position: relative;
    display: inline-block;
  }
  .category-label {
    padding: var(--struct-legend-padding, 0 4pt);
    border-radius: var(--struct-legend-radius, 3pt);
    line-height: var(--struct-legend-line-height, 1.3);
    display: inline-block;
    white-space: nowrap;
    transition: opacity 0.2s ease;
  }
  .category-label.hidden {
    opacity: 0.4;
  }
  .property-legend button.toggle-visibility {
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
  .property-legend button.toggle-visibility.visible,
  .property-legend .legend-item:hover button.toggle-visibility {
    opacity: 1;
  }
  .property-legend button.toggle-visibility:hover {
    background: rgba(0, 0, 0, 0.8);
    transform: scale(1.15);
  }
</style>
