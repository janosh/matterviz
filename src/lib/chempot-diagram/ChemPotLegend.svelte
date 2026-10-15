<script lang="ts">
  // Colour legend shared by ChemPotDiagram2D and ChemPotDiagram3D: a colour bar for the
  // continuous modes, one swatch per element count for arity mode, nothing for `none`.
  // The caller positions it (absolute) through `style`.
  import { ColorBar } from '#lib/plot/index.js'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { ChemPotColorBar } from './color'
  import { ARITY_COLORS, arity_legend_labels } from './color'
  import type { ChemPotColorMode, ChemPotDiagramConfig } from './types'

  let {
    color_mode,
    color_bar,
    color_bar_props = {},
    formulas,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    color_mode: ChemPotColorMode
    color_bar: ChemPotColorBar | null // the active numeric mode's title and color scale
    color_bar_props?: ChemPotDiagramConfig[`color_bar`] // user ColorBar props, null hides it
    formulas: string[] // drawn domains; their element counts set the arity rows
  } = $props()
</script>

{#if color_bar}
  {#if color_bar_props}
    <div {...rest} class={[`chempot-legend`, rest.class]}>
      <ColorBar
        {...color_bar}
        wrapper_style="width: 200px"
        bar_style="height: 12px"
        title_style="margin-bottom: 4px"
        {...color_bar_props}
      />
    </div>
  {/if}
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
    flex-wrap: balance;
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
