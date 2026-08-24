<script lang="ts">
  // Colour legend shared by ChemPotDiagram2D and ChemPotDiagram3D: a colour bar for the
  // continuous modes, one swatch per element count for arity mode, nothing for `none`.
  // The caller positions it (absolute) through `style`.
  import type { D3InterpolateName } from '$lib/colors'
  import { ColorBar } from '$lib/plot'
  import type { HTMLAttributes } from 'svelte/elements'
  import {
    ARITY_COLORS,
    arity_legend_labels,
    type ChemPotColorRange,
    get_chempot_interpolator,
  } from './color'
  import type { ChemPotColorMode } from './types'

  let {
    color_mode,
    color_scale,
    reverse_color_scale,
    color_range,
    formulas,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    color_mode: ChemPotColorMode
    color_scale: D3InterpolateName
    reverse_color_scale: boolean
    color_range: ChemPotColorRange | null
    formulas: string[] // drawn domains; their element counts set the arity rows
  } = $props()
</script>

{#if color_range}
  <div {...rest} class={[`chempot-legend`, rest.class]}>
    <ColorBar
      title={color_range.label}
      range={[color_range.min, color_range.max]}
      scale={{ interpolator: get_chempot_interpolator(color_scale, reverse_color_scale) }}
      wrapper_style="width: 200px"
      bar_style="height: 12px"
      title_style="margin-bottom: 4px"
    />
  </div>
{:else if color_mode === `arity`}
  <div {...rest} class={[`chempot-legend`, `arity-legend`, rest.class]}>
    {#each arity_legend_labels(formulas) as label, idx (label)}
      <span><span style:background={ARITY_COLORS[idx]}></span>{label}</span>
    {/each}
  </div>
{/if}

<style>
  .chempot-legend {
    position: absolute;
    z-index: 10;
    pointer-events: none;
  }
  .arity-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    max-width: calc(100% - 2em);
    font-size: 12px;
    & > span {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    & > span > span {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
  }
</style>
