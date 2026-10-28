<script lang="ts">
  import type { ColorSchemeName } from '#lib/colors/index.js'
  import { ELEMENT_COLOR_SCHEMES, perceived_brightness } from '#lib/colors/index.js'
  import type { ElementSymbol } from '#lib/element/index.js'
  import { element_by_symbol } from '#lib/element/index.js'
  import ElementTile from '#lib/element/ElementTile.svelte'
  import PlotTooltip from '#lib/plot/core/components/PlotTooltip.svelte'
  import type { TooltipSide } from '#lib/plot/core/decorations/tooltip.js'
  import { beside_rect } from '#lib/plot/core/decorations/tooltip.js'
  import type { Rect } from '#lib/plot/core/layout.js'
  import type { HTMLAttributes } from 'svelte/elements'
  import {
    AMOUNT_FORMAT,
    format_amount,
    format_oxi_state,
    sort_by_electronegativity,
    sort_by_hill_notation,
  } from './format'
  import type { FormulaSpecies, OxiComposition } from './parse'
  import { parse_formula_with_oxidation } from './parse'

  type FormulaOrdering = `electronegativity` | `alphabetical` | `original` | `hill`
  let {
    formula,
    color_scheme = `Vesta`,
    ordering = `original`,
    as: asymmetry = `span`,
    amount_format = AMOUNT_FORMAT,
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
    tooltip_side?: TooltipSide // preferred side; flips to the opposite one at the viewport edge
    tooltip_offset?: number // gap between the hovered symbol and the tooltip in px
    on_click?: (element: ElementSymbol, event: MouseEvent | KeyboardEvent) => void
  } = $props()

  const parsed_elements = $derived.by((): FormulaSpecies[] => {
    if (typeof formula !== `string`) {
      return Object.entries(formula).flatMap(([element, species]) =>
        species ? [{ element: element as ElementSymbol, ...species }] : [],
      )
    }
    try {
      return parse_formula_with_oxidation(formula)
    } catch (error) {
      console.error(`Failed to parse formula:`, error)
      return []
    }
  })

  // symbol sorters for the non-original orderings; tokens are ranked by their element
  const SORTERS: Record<
    Exclude<FormulaOrdering, `original`>,
    (symbols: ElementSymbol[]) => ElementSymbol[]
  > = {
    alphabetical: (symbols) => symbols.toSorted(),
    electronegativity: sort_by_electronegativity,
    hill: sort_by_hill_notation,
  }
  const sorted_elements = $derived.by(() => {
    if (ordering === `original`) return parsed_elements
    const symbols = [...new Set(parsed_elements.map((token) => token.element))]
    const rank = new Map(SORTERS[ordering](symbols).map((symbol, idx) => [symbol, idx]))
    return parsed_elements.toSorted(
      (tok_a, tok_b) => (rank.get(tok_a.element) ?? 0) - (rank.get(tok_b.element) ?? 0),
    )
  })

  let hovered = $state<{ element: ElementSymbol; rect: Rect } | null>(null)

  const hovered_elem_data = $derived(
    hovered ? (element_by_symbol.get(hovered.element) ?? null) : null,
  )
  const element_color = (element: ElementSymbol): string =>
    ELEMENT_COLOR_SCHEMES[color_scheme]?.[element] ?? `#666666`

  // Use parseable bracket charges on the clipboard: "Li2 O" or "Fe[+3]2 O[-2]3".
  const plain_text_formula = $derived(
    sorted_elements
      .map(({ element, amount, oxidation_state }) => {
        const oxi = format_oxi_state(oxidation_state)
        return `${element}${oxi && `[${oxi}]`}${amount === 1 ? `` : format_amount(amount, `.12~g`)}`
      })
      .join(` `),
  )

  function handle_copy(event: ClipboardEvent & { currentTarget: HTMLElement }) {
    const selection = window.getSelection()
    const formula_el = event.currentTarget
    // Only intercept a selection fully within this formula; otherwise the browser copies
    if (
      !selection ||
      selection.isCollapsed ||
      !formula_el.contains(selection.anchorNode) ||
      !formula_el.contains(selection.focusNode)
    )
      return
    event.preventDefault()
    event.clipboardData?.setData(`text/plain`, plain_text_formula)
  }

  function show_tooltip(
    element: ElementSymbol,
    event: (MouseEvent | FocusEvent) & { currentTarget: HTMLElement },
  ) {
    const { left, top, width, height } = event.currentTarget.getBoundingClientRect()
    hovered = { element, rect: { x: left, y: top, width, height } }
  }
</script>

<svelte:element
  this={asymmetry}
  {...rest}
  class={[`formula`, rest.class]}
  oncopy={handle_copy}
>
  {#each sorted_elements as { element, amount, oxidation_state }, idx (idx)}
    {@const color = element_color(element)}
    {@const brightness = perceived_brightness(color)}
    {@const oxi = format_oxi_state(oxidation_state)}
    <!-- a button only when clicking does something; keyboard focus shows the tooltip too -->
    <span
      class="element-group"
      {...on_click ? { role: `button`, tabindex: 0 } : {}}
      onmouseenter={(event) => show_tooltip(element, event)}
      onmouseleave={() => (hovered = null)}
      onfocus={(event) => show_tooltip(element, event)}
      onblur={() => (hovered = null)}
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
        class:dark-border={brightness > 0.7}
        class:light-border={brightness < 0.15}
        style:color
      >
        {element}</span
      >
      {#if oxi || amount !== 1}
        <span class="script-wrapper"
          >{#if oxi}
            <sup class="oxi">{oxi}</sup>
          {/if}
          {#if amount !== 1}
            <sub class="amt" class:no-sup={!oxi}>{format_amount(amount, amount_format)}</sub>
          {/if}
        </span>
      {/if}
    </span>
  {/each}
</svelte:element>

{#if hovered && hovered_elem_data}
  {@const tile_color = element_color(hovered_elem_data.symbol)}
  <PlotTooltip {...beside_rect(hovered.rect, tooltip_side, tooltip_offset)} fixed>
    <span class="tooltip-content">
      <ElementTile
        element={hovered_elem_data}
        show_name={false}
        segments={[{ color: tile_color, value: hovered_elem_data.atomic_mass }]}
        style="width: var(--formula-tooltip-tile-size, 30px); height: var(--formula-tooltip-tile-size, 30px)"
      />
      {hovered_elem_data.name}
    </span>
  </PlotTooltip>
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
  .tooltip-content {
    display: flex;
    align-items: center;
    gap: var(--formula-tooltip-gap, 4pt);
  }
  .script-wrapper {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    margin-left: var(--formula-script-margin-left, -0.15em);
    line-height: var(--formula-script-line-height, 0.6);
  }
  .amt,
  .oxi {
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
