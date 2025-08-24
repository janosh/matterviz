<script lang="ts">
  import type { CompositionType } from '$lib'
  import { element_data, format_num } from '$lib'
  import { contrast_color, default_element_colors } from '$lib/colors'
  import { colors } from '$lib/state.svelte'
  import { tooltip } from 'svelte-multiselect/attachments'

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
</script>

<div class="structure-legend" {...rest}>
  {#each Object.entries(elements) as [elem, amt], idx (elem + amt)}
    <label
      bind:this={labels[idx]}
      title={element_data.find((el) => el.symbol == elem)?.name}
      {@attach tooltip()}
      style:background-color={colors.element[elem]}
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
  {/each}
</div>

<style>
  .structure-legend {
    display: flex;
    position: absolute;
    bottom: var(--struct-legend-bottom, clamp(4pt, 3cqmin, 8pt));
    right: var(--struct-legend-right, clamp(4pt, 3cqmin, 8pt));
    gap: var(--struct-legend-gap, clamp(2pt, 2cqmin, 5pt));
    font-size: var(--struct-legend-font, clamp(8pt, 3.5cqmin, 14pt));
    filter: var(--legend-filter, grayscale(10%) brightness(0.95) saturate(0.9));
    z-index: var(--struct-legend-z-index, 1);
    pointer-events: auto;
    visibility: visible;
  }
  .structure-legend label {
    padding: var(--struct-legend-padding, 0 4pt);
    border-radius: var(--struct-legend-radius, 3pt);
    position: relative;
    display: inline-block;
    cursor: pointer;
    visibility: visible;
    white-space: nowrap;
  }
  .structure-legend label input[type='color'] {
    z-index: var(--struct-legend-input-z, 1);
    opacity: 0;
    position: absolute;
    visibility: hidden;
    top: 7pt;
    left: 0;
  }
  .structure-legend sub {
    font-size: 0.85em;
    margin: 0 0 0 -4px;
  }
</style>
