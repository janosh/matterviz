<script lang="ts">
  // Colour legend shared by ChemPotDiagram2D and ChemPotDiagram3D: a colour bar for the
  // continuous modes, one swatch per element count for arity mode, nothing for `none`.
  // The caller positions it (absolute) through `style`.
  import { ColorBar } from '#lib/plot/index.js'
  import type { HTMLAttributes } from 'svelte/elements'
  import { ARITY_COLORS, arity_legend_labels } from './color'
  import type { ChemPotColorMode, ChemPotDiagramConfig } from './types'

  let {
    color_mode,
    color_bar,
    formulas,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    color_mode: ChemPotColorMode
    // the active numeric mode's ColorBar props (title, color scale, the user's), null hides it
    color_bar: ChemPotDiagramConfig[`color_bar`]
    formulas: string[] // drawn domains; their element counts set the arity rows
  } = $props()
</script>

<!-- color_bar is null in the categorical modes, so a hidden bar never falls through to arity -->
{#if color_bar}
  <div {...rest} class={[`chempot-legend`, rest.class]}>
    <ColorBar
      wrapper_style="width: 200px"
      bar_style="height: 12px"
      title_style="margin-bottom: 4px"
      {...color_bar}
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
