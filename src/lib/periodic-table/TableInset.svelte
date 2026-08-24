<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    as = `aside`,
    children,
    ...rest
  }: HTMLAttributes<HTMLElementTagNameMap[`aside`]> & {
    as?: keyof HTMLElementTagNameMap
    children?: Snippet
  } = $props()
</script>

<svelte:element this={as} {...rest} class={[`table-inset`, rest.class]}>
  {@render children?.()}
</svelte:element>

<style>
  .table-inset {
    display: grid;
    box-sizing: border-box;
    grid-row: var(--ptable-inset-row, 1 / span 3);
    grid-column: var(--ptable-inset-col, 3 / span 10);
    /* Fill the grid area without contributing to track sizing. `height: 0; min-height: 100%`
       still sized auto rows from content on the first pass, then collapsed — a visible jump. */
    position: absolute;
    inset: 0;
    min-height: 0;
    z-index: 1;
    container-type: inline-size;
    container-name: table-inset;
    overflow: visible;
    padding: var(--ptable-inset-padding);
    /* An inset plot sits inside the table, so it should not also paint the tint that makes a
       standalone plot read as its own panel. */
    --plot-bg: var(--ptable-inset-plot-bg, transparent);
    --scatter-fullscreen-bg: var(--ptable-inset-fullscreen-bg, var(--page-bg, Canvas));
    /* Axis titles use this directly and tick labels take 0.8em of it, so one value shrinks
       both. The inset is a fraction of a full plot, where the 16px default titles dwarf it. */
    --scatter-font-size: var(--ptable-inset-font-size, 12px);
    --scatter-fullscreen-font-size: var(--ptable-inset-fullscreen-font-size, 16px);
  }
  /* On phone-width tables the inset area is ~200px wide by ~60px tall, so controls, stats
     and headings spill over the tiles. Drop custom insets into their own full-width row below
     the table instead (.periodic-table is the inline-size container). The built-in colorbar
     is compact enough to stay put. 380px catches 360-393px phones (table = 94vw) while the
     384px tables of a two-column grid in a 50em main column keep their inset. */
  @container (max-width: 380px) {
    .table-inset:not(.auto-colorbar-inset) {
      position: static;
      grid-row: 11;
      grid-column: 1 / -1;
      margin-top: 1em;
    }
  }
</style>
