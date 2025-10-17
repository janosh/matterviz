<script lang="ts">
  import type { CompositionType, ElementSymbol } from '$lib'
  import { element_data, format_num } from '$lib'
  import { contrast_color, default_element_colors } from '$lib/colors'
  import { colors } from '$lib/state.svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteSet } from 'svelte/reactivity'

  let {
    elements,
    elem_color_picker_title = `Double click to reset color`,
    labels = $bindable([]),
    amount_format = `.3~f`,
    show_amounts = true,
    get_element_label,
    hidden_elements = $bindable(new Set()),
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    elements: CompositionType
    elem_color_picker_title?: string
    labels?: HTMLLabelElement[]
    amount_format?: string // Float formatting for element amounts (default: 3 significant digits)
    show_amounts?: boolean // Whether to show element amounts
    get_element_label?: (element: string, amount: number) => string // Custom label function
    hidden_elements?: Set<ElementSymbol>
  } = $props()

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

<div {...rest} class="structure-legend {rest.class ?? ``}">
  {#each Object.entries(elements) as [elem, amt], idx (elem + amt)}
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

<style>
  .structure-legend {
    display: flex;
    position: absolute;
    bottom: var(--struct-legend-bottom, clamp(4pt, 3cqmin, 8pt));
    right: var(--struct-legend-right, clamp(4pt, 3cqmin, 8pt));
    gap: var(--struct-legend-gap, clamp(3pt, 2cqmin, 7pt));
    font-size: var(--struct-legend-font, clamp(8pt, 3cqmin, 14pt));
    filter: var(--legend-filter, grayscale(10%) brightness(0.95) saturate(0.9));
    z-index: var(--struct-legend-z-index, 1);
    pointer-events: auto;
    visibility: visible;
  }
  .structure-legend .legend-item {
    position: relative;
    display: inline-block;
  }
  .structure-legend label {
    padding: var(--struct-legend-padding, 0 4pt);
    border-radius: var(--struct-legend-radius, 3pt);
    line-height: var(--struct-legend-line-height, 1.3);
    display: inline-block;
    cursor: pointer;
    visibility: visible;
    white-space: nowrap;
    transition: opacity 0.2s ease;
  }
  .structure-legend label.hidden {
    opacity: 0.4;
  }
  .structure-legend label input[type='color'] {
    z-index: var(--struct-legend-input-z, 1);
    opacity: 0;
    position: absolute;
    visibility: hidden;
    top: 7pt;
    left: 0;
  }
  .structure-legend button.toggle-visibility {
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
  .structure-legend button.toggle-visibility.visible,
  .structure-legend .legend-item:hover button.toggle-visibility {
    opacity: 1;
  }
  .structure-legend button.toggle-visibility:hover {
    background: rgba(0, 0, 0, 0.8);
    transform: scale(1.15);
  }
  .structure-legend sub {
    font-size: 0.85em;
    margin: 0 0 0 -4px;
  }
</style>
