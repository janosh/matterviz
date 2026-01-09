<script lang="ts">
  import { contrast_color, default_element_colors } from '$lib/colors'
  import type { CompositionType } from '$lib/composition'
  import type { ElementSymbol } from '$lib/element'
  import { element_data } from '$lib/element'
  import Icon from '$lib/Icon.svelte'
  import { ELEM_SYMBOLS, format_num } from '$lib/labels'
  import { ColorBar } from '$lib/plot'
  import { SETTINGS_CONFIG } from '$lib/settings'
  import { colors } from '$lib/state.svelte'
  import type { AnyStructure } from '$lib/structure'
  import { atomic_radii } from '$lib/structure'
  import type {
    AtomColorConfig,
    AtomPropertyColors,
  } from '$lib/structure/atom-properties'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import type { Snippet } from 'svelte'
  import { click_outside, tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'

  let {
    atom_color_config = $bindable({
      mode: `element`,
      scale: undefined,
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
    // Element remapping: maps original element symbols to new ones
    element_mapping = $bindable(),
    // Per-element and per-site radius overrides
    element_radius_overrides = $bindable<Partial<Record<ElementSymbol, number>>>({}),
    site_radius_overrides = $bindable<SvelteMap<number, number>>(new SvelteMap()),
    selected_sites = [] as number[],
    title = ``,
    sym_data = null,
    structure = undefined,
    children,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `children`> & {
    atom_color_config?: Partial<AtomColorConfig>
    property_colors?: AtomPropertyColors | null
    elements?: CompositionType
    elem_color_picker_title?: string
    labels?: HTMLLabelElement[]
    amount_format?: string // Float formatting for element amounts (default: 3 significant digits)
    show_amounts?: boolean // Whether to show element amounts
    get_element_label?: (element: string, amount: number) => string // Custom label function
    hidden_elements?: Set<ElementSymbol>
    hidden_prop_vals?: Set<number | string> // Track hidden property values (e.g. Wyckoff positions, coordination numbers)
    // Element remapping: maps original element symbols to new ones (e.g. {'H': 'Na', 'He': 'Cl'})
    element_mapping?: Partial<Record<ElementSymbol, ElementSymbol>>
    // Per-element and per-site radius overrides (absolute values in Angstroms)
    element_radius_overrides?: Partial<Record<ElementSymbol, number>>
    site_radius_overrides?: Map<number, number> | SvelteMap<number, number>
    selected_sites?: number[] // Currently selected site indices
    title?: string
    sym_data?: MoyoDataset | null
    structure?: AnyStructure | null
    children?: Snippet<[{ mode_menu_open: boolean; structure?: AnyStructure | null }]>
  } = $props()

  const titles = {
    coordination: `Coordination`,
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

  // Normalize incoming Map to SvelteMap at boundary for reactivity
  // This preserves identity for bindings while ensuring SvelteMap methods work
  $effect(() => {
    if (site_radius_overrides && !(site_radius_overrides instanceof SvelteMap)) {
      site_radius_overrides = new SvelteMap(site_radius_overrides)
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
      property_colors?.unique_values?.flatMap((val) => {
        const idx = property_colors.values.indexOf(val)
        return idx >= 0 ? [[val, property_colors.colors[idx]]] : []
      }) ?? [],
    ),
  )

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

  // Element remapping state
  let remap_menu_open = $state<ElementSymbol | null>(null)
  let remap_search = $state(``)

  // Filtered elements based on search
  let filtered_elements = $derived.by(() => {
    if (!remap_search) return ELEM_SYMBOLS
    const query = remap_search.toLowerCase()
    return ELEM_SYMBOLS.filter((elem) => {
      const data = element_data?.find((el) => el.symbol === elem)
      return elem.toLowerCase().includes(query) ||
        data?.name?.toLowerCase().includes(query)
    })
  })

  function remap_element(from: ElementSymbol, to: ElementSymbol) {
    if (from === to && element_mapping?.[from]) {
      // Remove mapping if mapping back to original element
      const { [from]: _, ...rest } = element_mapping
      element_mapping = Object.keys(rest).length > 0 ? rest : undefined
    } else if (from !== to) {
      element_mapping = { ...element_mapping, [from]: to }
    }
    remap_menu_open = null
    remap_search = ``
  }

  // Radius bounds (Angstroms) - max accommodates largest atomic radii (~2.6Å for Cs)
  const MIN_RADIUS = 0.1
  const MAX_RADIUS = 5

  const parse_radius = (value: string): number | null => {
    const num = parseFloat(value)
    return !isNaN(num) && num >= MIN_RADIUS && num <= MAX_RADIUS ? num : null
  }

  function update_element_radius(elem: ElementSymbol, value: string) {
    const radius = parse_radius(value)
    if (radius !== null) {
      element_radius_overrides = { ...element_radius_overrides, [elem]: radius }
    }
  }

  function clear_element_radius(elem: ElementSymbol) {
    const { [elem]: _, ...rest } = element_radius_overrides ?? {}
    element_radius_overrides = rest
  }

  const get_element_radius = (elem: ElementSymbol): number =>
    element_radius_overrides?.[elem] ?? atomic_radii[elem] ?? 1

  // Mutate in-place to preserve map identity for bindings (aligns with Structure.svelte pattern)
  function update_site_radius(site_idx: number, value: string) {
    const radius = parse_radius(value)
    if (radius === null) return
    site_radius_overrides?.set(site_idx, radius)
  }

  function clear_site_radius(site_idx: number) {
    site_radius_overrides?.delete(site_idx)
  }

  const get_site_radius = (site_idx: number): number => {
    const override = site_radius_overrides?.get(site_idx)
    if (override !== undefined) return override
    const element = structure?.sites?.[site_idx]?.species[0]?.element as
      | ElementSymbol
      | undefined
    return element ? get_element_radius(element) : 1
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
              if (atom_color_config.mode === `wyckoff`) {
                atom_color_config.scale_type = `categorical`
              } else if (atom_color_config.mode === `coordination`) {
                atom_color_config.scale_type = `continuous`
              }
              mode_menu_open = false
            }}
          >
            <span>{titles[value as keyof typeof titles] || label}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

{#snippet site_radius_control_snippet()}
  {#if selected_sites.length === 1}
    {@const site_idx = selected_sites[0]}
    {@const site = structure?.sites?.[site_idx]}
    {@const main_elem = site?.species[0]?.element}
    <div class="site-radius-control">
      <label
        title="Radius for selected site {site_idx}"
        {@attach tooltip({ placement: `top` })}
      >
        <span class="site-label">{main_elem}{site_idx}</span>
        <input
          type="number"
          min={MIN_RADIUS}
          max={MAX_RADIUS}
          step={0.05}
          value={get_site_radius(site_idx)}
          oninput={(event) =>
          update_site_radius(site_idx, (event.target as HTMLInputElement).value)}
        />
        <span class="unit">Å</span>
      </label>
      {#if site_radius_overrides?.has(site_idx)}
        <button
          class="reset-btn"
          onclick={() => clear_site_radius(site_idx)}
          title="Reset to element default"
          {@attach tooltip({ placement: `top` })}
        >
          ↺
        </button>
      {/if}
    </div>
  {/if}
{/snippet}

{#if show_element_legend}
  <div {...rest} class="atom-legend element-legend {rest.class ?? ``}">
    {#each Object.entries(elements!) as [elem, amt], idx (elem + amt)}
      {@const is_hidden = hidden_elements.has(elem as ElementSymbol)}
      {@const displayed_elem = element_mapping?.[elem as ElementSymbol] || elem}
      <div class="legend-item">
        <label
          bind:this={labels[idx]}
          title="{element_data?.find((el) => el.symbol === displayed_elem)?.name ?? ``}{displayed_elem !== elem ? ` (remapped from ${elem})` : ``}"
          {@attach tooltip()}
          style:background-color={colors.element[displayed_elem]}
          class:hidden={is_hidden}
          class:remapped={displayed_elem !== elem}
          ondblclick={(event) => {
            event.preventDefault()
            colors.element[displayed_elem] = default_element_colors[displayed_elem]
          }}
          oncontextmenu={(event) => {
            event.preventDefault()
            remap_menu_open = remap_menu_open === elem ? null : (elem as ElementSymbol)
            remap_search = ``
          }}
          {@attach contrast_color()}
        >
          {#if get_element_label}
            {get_element_label(displayed_elem, amt)}
          {:else}
            {displayed_elem}
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
          class:element-hidden={is_hidden}
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
        {#if remap_menu_open === elem}
          <div
            class="remap-dropdown"
            {@attach click_outside({
              callback: () => {
                remap_menu_open = null
                remap_search = ``
              },
            })}
          >
            <div class="radius-control">
              <label>
                <span>Radius</span>
                <input
                  type="number"
                  min={MIN_RADIUS}
                  max={MAX_RADIUS}
                  step={0.05}
                  value={get_element_radius(elem as ElementSymbol)}
                  oninput={(event) =>
                  update_element_radius(
                    elem as ElementSymbol,
                    (event.target as HTMLInputElement).value,
                  )}
                />
                <span class="unit">Å</span>
              </label>
              {#if element_radius_overrides?.[elem as ElementSymbol] !== undefined}
                <button
                  class="reset-btn"
                  onclick={() => clear_element_radius(elem as ElementSymbol)}
                  title="Reset to default radius"
                  {@attach tooltip({ placement: `top` })}
                >
                  ↺
                </button>
              {/if}
            </div>
            <input
              type="text"
              class="remap-search"
              placeholder="Search elements..."
              bind:value={remap_search}
              onkeydown={(event) => {
                if (event.key === `Escape`) {
                  remap_menu_open = null
                  remap_search = ``
                } else if (event.key === `Enter` && filtered_elements.length > 0) {
                  remap_element(elem as ElementSymbol, filtered_elements[0])
                }
              }}
            />
            <div class="remap-options">
              {#if displayed_elem !== elem}
                <button
                  class="remap-option reset"
                  onclick={() => remap_element(elem as ElementSymbol, elem as ElementSymbol)}
                >
                  <span>Reset to {elem}</span>
                </button>
              {/if}
              {#each filtered_elements as target_elem (target_elem)}
                {@const elem_info = element_data?.find((el) => el.symbol === target_elem)}
                <button
                  class="remap-option"
                  class:selected={displayed_elem === target_elem}
                  onclick={() => remap_element(elem as ElementSymbol, target_elem)}
                  style:background-color={colors.element[target_elem]}
                  {@attach contrast_color()}
                >
                  <small style="opacity: 0.6">{elem_info?.number}</small>
                  <b>{target_elem}</b>
                  {elem_info?.name}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/each}
    {@render site_radius_control_snippet()}
    {@render mode_selector_snippet()}
    {@render children?.({ mode_menu_open, structure })}
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
        title={legend_title}
        {@attach tooltip({ placement: `top` })}
      >
        <ColorBar
          color_scale={atom_color_config.scale}
          range={[property_colors.min_value ?? 0, property_colors.max_value ?? 0]}
          tick_labels={Array.from(
            new Set([property_colors.min_value ?? 0, property_colors.max_value ?? 0]),
          )}
          tick_side="secondary"
          bar_style="height: 10px; width: 100px;"
          wrapper_style="padding: 0; gap: 2px;"
          style="margin-top: 0"
          tick_format=".3~f"
        />
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
            class:element-hidden={is_hidden}
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
    {@render site_radius_control_snippet()}
    {@render mode_selector_snippet()}
    {@render children?.({ mode_menu_open, structure })}
  </div>
{/if}

<style>
  .atom-legend {
    position: absolute;
    z-index: var(--legend-z-index, 1);
    pointer-events: auto;
    visibility: visible;
    filter: var(--legend-filter, grayscale(10%) brightness(0.95) saturate(0.8));
    display: flex;
    align-items: center;
    bottom: var(--struct-legend-bottom, clamp(4pt, 3cqmin, 8pt));
    right: var(--struct-legend-right, clamp(4pt, 3cqmin, 8pt));
    gap: var(--struct-legend-gap, clamp(3pt, 2cqmin, 7pt));
  }
  .element-legend {
    font-size: var(--struct-legend-font, clamp(7pt, 2.5cqmin, 12pt));
  }
  .atom-legend .legend-item {
    position: relative;
    display: inline-block;
  }
  .element-legend label {
    padding: var(--struct-legend-padding, 0 4pt);
    border-radius: var(--struct-legend-radius, var(--border-radius, 3pt));
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
  /* Toggle visibility button - shared between element and property legends */
  .atom-legend button.toggle-visibility {
    position: absolute;
    top: -3px;
    right: -7px;
    width: 1em;
    height: 1em;
    padding: 0;
    margin: 0;
    border: none;
    background: light-dark(rgba(0, 0, 0, 0.5), rgba(255, 255, 255, 0.5));
    color: light-dark(white, black);
    border-radius: 50%;
    font-size: 0.9em;
    line-height: 1;
    cursor: pointer;
    display: grid;
    place-items: center;
    opacity: 0;
    transition: opacity 0.2s ease, background 0.2s ease, transform 0.1s ease;
    z-index: 2;
    pointer-events: auto;
  }
  .atom-legend button.toggle-visibility.element-hidden,
  .atom-legend .legend-item:hover button.toggle-visibility {
    opacity: 1;
  }
  .atom-legend button.toggle-visibility:hover {
    background: light-dark(rgba(0, 0, 0, 0.8), rgba(255, 255, 255, 0.8));
    transform: scale(1.15);
  }
  .element-legend sub {
    font-size: 0.85em;
    margin: 0 0 0 -2pt;
  }
  .element-legend label.remapped {
    outline: 2px dashed var(--accent-color, #4a90d9);
    outline-offset: 1px;
  }
  .remap-dropdown {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: 0.4rem;
    background: var(--surface-bg);
    border-radius: var(--border-radius, 3pt);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.25);
  }
  .remap-search {
    width: 100%;
    padding: 0.25rem 0.4rem;
    border: none;
    box-sizing: border-box;
  }
  .remap-search:focus {
    outline: none;
  }
  .remap-options {
    max-height: 250px;
    overflow-y: auto;
  }
  .remap-option {
    display: flex;
    gap: 3pt;
    place-items: center;
    width: 100%;
    border-radius: 0;
  }
  .remap-option:hover {
    filter: brightness(1.1);
  }
  .remap-option.selected {
    outline: 2px solid var(--accent-color);
    outline-offset: -2px;
  }
  .remap-option.reset {
    background: var(--surface-bg-hover, rgba(128, 128, 128, 0.1));
    font-style: italic;
  }

  /* Radius Control Styles */
  :is(.radius-control, .site-radius-control) {
    display: flex;
    align-items: center;
    gap: 4pt;
    padding: 0.3rem 0.4rem;
    border-bottom: 1px solid light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.1));

    & label {
      display: flex;
      align-items: center;
      gap: 4pt;
      font-size: 0.85em;
      white-space: nowrap;
    }
    & input[type='number'] {
      width: 3.5em;
      padding: 2pt 4pt;
      border: 1px solid light-dark(rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.2));
      border-radius: var(--border-radius, 3pt);
      font-size: 0.9em;
      text-align: center;
      box-sizing: border-box;
      &:focus {
        outline: 1px solid var(--accent-color, #4a90d9);
      }
    }
    & .unit {
      font-size: 0.8em;
      opacity: 0.7;
    }
    & .reset-btn {
      background: transparent;
      border: none;
      padding: 2pt 4pt;
      cursor: pointer;
      font-size: 0.9em;
      opacity: 0.6;
      transition: opacity 0.15s ease;
      &:hover {
        opacity: 1;
      }
    }
  }
  .site-radius-control {
    border-bottom: none;
    padding: 0.2rem 0.4rem;
    background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.05));
    border-radius: var(--border-radius, 3pt);
    & .site-label {
      font-weight: 500;
      min-width: 2em;
    }
  }

  /* Property Legend Styles */
  .property-legend {
    font-size: var(--struct-legend-font, clamp(8pt, 3cqmin, 14pt));
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
    border-radius: var(--border-radius, 3pt);
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
    border-top-left-radius: var(--border-radius, 3pt);
    border-top-right-radius: var(--border-radius, 3pt);
  }
  .mode-option:last-child {
    border-bottom-left-radius: var(--border-radius, 3pt);
    border-bottom-right-radius: var(--border-radius, 3pt);
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
  .category-label {
    padding: var(--struct-legend-padding, 0 4pt);
    border-radius: var(--struct-legend-radius, var(--border-radius, 3pt));
    line-height: var(--struct-legend-line-height, 1.3);
    display: inline-block;
    white-space: nowrap;
    transition: opacity 0.2s ease;
  }
  .category-label.hidden {
    opacity: 0.4;
  }
  .legend-header h4 {
    margin: 0;
    font-size: 1em;
    font-weight: 600;
  }
</style>
