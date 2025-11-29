<script lang="ts">
  import type { ColorSchemeName, ElementSymbol } from '$lib'
  import { ELEMENT_COLOR_SCHEMES, luminance } from '$lib/colors'
  import { element_data } from '$lib/element'
  import ElementTile from '$lib/element/ElementTile.svelte'
  import { format_num } from '$lib/labels'
  import type { HTMLAttributes } from 'svelte/elements'
  import {
    format_oxi_state,
    sort_by_electronegativity,
    sort_by_hill_notation,
  } from './format'
  import {
    type ElementWithOxidation,
    oxi_composition_to_elements,
    type OxiComposition,
    parse_formula_with_oxidation,
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
    formula: string | OxiComposition
    color_scheme?: ColorSchemeName
    ordering?: FormulaOrdering
    as?: string
    amount_format?: string
    tooltip_side?: TooltipSide
    tooltip_offset?: number
    on_click?: (element: ElementSymbol, event: MouseEvent | KeyboardEvent) => void
  } = $props()

  const parsed_elements = $derived.by(() => {
    try {
      return typeof formula === `string`
        ? parse_formula_with_oxidation(formula)
        : oxi_composition_to_elements(formula)
    } catch (error) {
      console.error(`Failed to parse formula:`, error)
      return []
    }
  })

  const COMPARATORS: Record<
    FormulaOrdering,
    (el1: ElementWithOxidation, el2: ElementWithOxidation) => number
  > = {
    alphabetical: (el1, el2) => el1.element.localeCompare(el2.element),
    original: (el1, el2) => el1.orig_idx - el2.orig_idx,
    electronegativity: (el1, el2) => {
      const sorted = sort_by_electronegativity([el1.element, el2.element])
      return sorted[0] === el1.element ? -1 : 1
    },
    hill: (el1, el2) => {
      const sorted = sort_by_hill_notation([el1.element, el2.element])
      return sorted[0] === el1.element ? -1 : 1
    },
  }
  const sorted_elements = $derived(
    [...parsed_elements].sort(COMPARATORS[ordering]),
  )

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
    {@const color = ELEMENT_COLOR_SCHEMES[color_scheme]?.[element] ?? `#666666`}
    {@const lum = luminance(color)}
    {@const has_oxidation = oxidation_state !== undefined && oxidation_state !== 0}
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
          on_click?.(element, event)
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
      <span class="script-wrapper">{#if has_oxidation}
          <sup class="oxi">{format_oxi_state(oxidation_state)}</sup>
        {/if}
        {#if amount !== 1}
          <sub class="amt" class:no-sup={!has_oxidation}>{
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
    font-size: var(--formula-font-size);
  }
  .element-group {
    display: inline-block;
    white-space: nowrap;
    padding: var(--formula-padding, 0.1em);
    margin: var(--formula-margin, -0.1em 0.1em -0.1em -0.1em);
  }
  .element-symbol {
    font-weight: var(--formula-font-weight, 500);
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
    gap: var(--formula-tooltip-gap, 5pt);
    padding: var(--formula-tooltip-padding, 3pt 4pt);
    background: var(--formula-tooltip-bg, rgba(0, 0, 0, 0.9));
    border-radius: var(--formula-tooltip-border-radius, var(--border-radius, 3pt));
    box-shadow: var(--formula-tooltip-box-shadow, 0 4px 12px rgba(0, 0, 0, 0.3));
    z-index: var(--tooltip-z-index, 2);
  }
  .script-wrapper {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    margin-left: var(--formula-script-margin-left, -0.15em);
    line-height: var(--formula-script-line-height, 0.6);
  }
  .script-wrapper:empty {
    display: none;
  }
  .amt, .oxi {
    font-size: var(--formula-script-font-size, 0.7em);
    line-height: var(--formula-script-inner-line-height, 1);
  }
  .amt {
    order: 2;
    transform: translateY(var(--formula-subscript-offset, -0.15em));
  }
  .amt.no-sup {
    transform: translateY(var(--formula-subscript-offset-no-sup, 0.3em));
  }
  .oxi {
    order: 1;
    transform: translateY(var(--formula-superscript-offset, -0.65em));
  }
</style>
