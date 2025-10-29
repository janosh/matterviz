<script lang="ts">
  import type { ColorSchemeName, ElementSymbol } from '$lib'
  import { element_color_schemes, luminance } from '$lib/colors'
  import { element_data } from '$lib/element'
  import ElementTile from '$lib/element/ElementTile.svelte'
  import { format_num } from '$lib/labels'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { CompositionWithOxidation, ElementWithOxidation } from './parse'
  import {
    composition_with_oxidation_to_elements,
    format_oxi_state,
    parse_formula_with_oxidation,
    sort_by_electronegativity,
    sort_by_hill_notation,
  } from './parse'

  type FormulaOrdering = `electronegativity` | `alphabetical` | `original` | `hill`
  type TooltipSide = `top` | `bottom` | `left` | `right`
  let {
    formula,
    color_scheme = `Vesta`,
    ordering = `original`,
    as = `span`,
    amount_format = `.3~s`,
    tooltip_side = `bottom`,
    tooltip_offset = 5,
    on_click,
    ...rest
  }: HTMLAttributes<HTMLElement> & {
    formula: string | CompositionWithOxidation
    color_scheme?: ColorSchemeName
    ordering?: FormulaOrdering
    as?: string
    amount_format?: string
    tooltip_side?: TooltipSide
    tooltip_offset?: number
    on_click?: (element: ElementSymbol, event: MouseEvent) => void
  } = $props()

  const parsed_elements = $derived.by((): ElementWithOxidation[] => {
    try {
      return typeof formula === `string`
        ? parse_formula_with_oxidation(formula)
        : composition_with_oxidation_to_elements(formula)
    } catch (error) {
      console.error(`Failed to parse formula:`, error)
      return []
    }
  })

  const sorted_elements = $derived.by((): ElementWithOxidation[] => {
    const elements = [...parsed_elements]
    if (ordering === `alphabetical`) {
      return elements.sort((el_a, el_b) => el_a.element.localeCompare(el_b.element))
    }
    if (ordering === `electronegativity`) {
      const sorted = sort_by_electronegativity(elements.map((el) => el.element))
      return sorted.map((sym: ElementSymbol) =>
        elements.find((el) => el.element === sym)!
      )
    }
    if (ordering === `hill`) {
      return sort_by_hill_notation(elements.map((el) => el.element)).map((
        sym: ElementSymbol,
      ) => elements.find((el) => el.element === sym)!)
    }
    return elements.sort((el_a, el_b) => el_a.original_index - el_b.original_index)
  })

  let hovered_element = $state<ElementSymbol | null>(null)
  let tooltip_pos = $state({ x: 0, y: 0 })

  const hovered_elem_data = $derived(
    hovered_element ? element_data.find((el) => el.symbol === hovered_element) : null,
  )

  function show_tooltip(element: ElementSymbol, event: MouseEvent) {
    const { left, width, top, bottom, right, height } = (event.target as HTMLElement)
      .getBoundingClientRect()
    hovered_element = element

    const positions = {
      top: [left + width / 2, top - tooltip_offset],
      bottom: [left + width / 2, bottom + tooltip_offset],
      left: [left - tooltip_offset, top + height / 2],
      right: [right + tooltip_offset, top + height / 2],
    }
    const [x, y] = positions[tooltip_side]
    tooltip_pos = { x, y }
  }
</script>

<svelte:element this={as} {...rest} class="formula {rest.class ?? ``}">
  {#each sorted_elements as { element, amount, oxidation_state } (element)}
    {@const has_both = amount !== 1 && oxidation_state !== undefined &&
      oxidation_state !== 0}
    {@const has_oxi = oxidation_state !== undefined && oxidation_state !== 0}
    {@const color = element_color_schemes[color_scheme]?.[element] ?? `#666666`}
    {@const lum = luminance(color)}
    <span
      class="element-group"
      role="button"
      tabindex="0"
      onmouseenter={(event) => show_tooltip(element, event)}
      onmouseleave={() => (hovered_element = null)}
      onclick={(event) => on_click?.(element, event)}
      onkeydown={(event) => {
        if (event.key === `Enter` || event.key === ` `) {
          event.preventDefault()
          on_click?.(element, event as unknown as MouseEvent)
        }
      }}
    >
      <span
        class="element-symbol"
        class:dark-border={lum > 0.7}
        class:light-border={lum < 0.15}
        style:color
      >
        {element}</span>
      <span class="script-wrapper">{#if has_oxi}
          <sup class="oxi" class:with-sub={has_both}>{
            format_oxi_state(oxidation_state)
          }</sup>
        {/if}
        {#if amount !== 1}
          <sub class="amt" class:no-sup={!has_oxi}>{
            format_num(amount, amount_format)
          }</sub>
        {/if}
      </span>
    </span>
  {/each}
</svelte:element>

{#if hovered_elem_data}
  {@const { x, y } = tooltip_pos}
  {@const transforms = {
    top: `translate(-50%, -100%)`,
    bottom: `translateX(-50%)`,
    left: `translate(-100%, -50%)`,
    right: `translateY(-50%)`,
  }}
  <div
    class="tooltip"
    style:left="{x}px"
    style:top="{y}px"
    style:transform={transforms[tooltip_side]}
  >
    <ElementTile
      element={hovered_elem_data}
      show_name={false}
      value={hovered_elem_data.atomic_mass}
      style="width: 50px; height: 50px"
    />
    {hovered_elem_data.name}
  </div>
{/if}

<style>
  .formula {
    display: inline;
  }
  .element-group {
    display: inline-block;
    white-space: nowrap;
    padding: 0.2em;
    margin: -0.2em 0.1em -0.2em -0.2em;
    cursor: pointer;
  }
  .element-symbol {
    font-weight: 500;
    transition: transform 0.2s;
  }
  .element-symbol.dark-border {
    text-shadow:
      -0.3px -0.3px 0 #0008,
      0.3px -0.3px 0 #0008,
      -0.3px 0.3px 0 #0008,
      0.3px 0.3px 0 #0008;
  }
  .element-symbol.light-border {
    text-shadow:
      -0.3px -0.3px 0 #fffc,
      0.3px -0.3px 0 #fffc,
      -0.3px 0.3px 0 #fffc,
      0.3px 0.3px 0 #fffc;
  }
  .tooltip {
    position: fixed;
    display: flex;
    align-items: center;
    gap: 5pt;
    padding: 3pt 4pt;
    background: var(--tooltip-bg, rgba(0, 0, 0, 0.9));
    border-radius: 3pt;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: var(--tooltip-z-index, 2);
  }
  .element-name {
    color: var(--tooltip-text);
    white-space: nowrap;
  }
  .script-wrapper {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    margin-left: -0.15em;
    line-height: 0.6;
  }
  .script-wrapper:empty {
    display: none;
  }
  .amt, .oxi {
    font-size: 0.7em;
    line-height: 1;
  }
  .amt {
    order: 2;
    transform: translateY(-0.15em);
  }
  .amt.no-sup {
    transform: translateY(0.3em);
  }
  .oxi {
    order: 1;
    transform: translateY(-0.65em);
  }
</style>
