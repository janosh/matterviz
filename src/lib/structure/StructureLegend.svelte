<script lang="ts">
  import type { CompositionType } from '$lib'
  import { choose_bw_for_contrast, element_data, format_num } from '$lib'
  import { default_element_colors } from '$lib/colors'
  import { colors } from '$lib/state.svelte'
  import { Tooltip } from 'svelte-zoo'

  interface Props {
    elements: CompositionType
    elem_color_picker_title?: string
    labels?: HTMLLabelElement[]
    amount_format?: string // Float formatting for element amounts (default: 3 significant digits)
    show_amounts?: boolean // Whether to show element amounts
    get_element_label?: (element: string, amount: number) => string // Custom label function
    [key: string]: unknown
  }
  let {
    elements,
    elem_color_picker_title = `Double click to reset color`,
    labels = $bindable([]),
    amount_format = `.3~f`,
    show_amounts = true,
    get_element_label,
    ...rest
  }: Props = $props()

  // Generate label text for each element
  function get_label_text(element: string, amount: number): string {
    if (get_element_label) return get_element_label(element, amount)
    return show_amounts ? `${element}${format_num(amount, amount_format)}` : element
  }
</script>

<div class="structure-legend" {...rest}>
  {#each Object.entries(elements) as [elem, amt], idx (elem + amt)}
    <Tooltip
      text={element_data.find((el) => el.symbol == elem)?.name}
      --zoo-tooltip-bg="rgba(255, 255, 255, 0.3)"
      tip_style="font-size: initial; padding: 0 5pt;"
    >
      <label
        bind:this={labels[idx]}
        style:background-color={colors.element[elem]}
        ondblclick={(event) => {
          event.preventDefault()
          colors.element[elem] = default_element_colors[elem]
        }}
        style:color={choose_bw_for_contrast(labels[idx], null, 0.55)}
      >
        {get_label_text(elem, amt)}
        <input
          type="color"
          bind:value={colors.element[elem]}
          title={elem_color_picker_title}
        />
      </label>
    </Tooltip>
  {/each}
</div>

<style>
  .structure-legend {
    display: flex;
    position: absolute;
    bottom: var(--struct-legend-bottom, 8pt);
    right: var(--struct-legend-right, 8pt);
    gap: var(--struct-legend-gap, 8pt);
    font-size: var(--struct-legend-font, 14pt);
    filter: var(--legend-filter, grayscale(10%) brightness(0.8) saturate(0.8));
    z-index: var(--struct-legend-z-index, 1);
    pointer-events: auto;
    visibility: visible;
  }
  .structure-legend label {
    padding: var(--struct-legend-pad, 1pt 4pt);
    border-radius: var(--struct-legend-radius, 3pt);
    position: relative;
    display: inline-block;
    cursor: pointer;
    visibility: visible;
  }
  .structure-legend label input[type='color'] {
    z-index: var(--struct-legend-input-z, 1);
    opacity: 0;
    position: absolute;
    visibility: hidden;
    top: 7pt;
    left: 0;
  }
</style>
