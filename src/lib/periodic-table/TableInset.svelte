<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let { children, ...rest }: HTMLAttributes<HTMLElement> & { children?: Snippet } = $props()
</script>

<aside {...rest} class={[`table-inset`, rest.class]}>
  {@render children?.()}
</aside>

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
    /* An inset plot sits inside the table: no tint marking it as its own panel */
    --plot-bg: var(--ptable-inset-plot-bg, transparent);
    --scatter-fullscreen-bg: var(--ptable-inset-fullscreen-bg, var(--page-bg, Canvas));
    /* Axis titles use this directly and tick labels take 0.8em of it, so one value shrinks
       both. The inset is a fraction of a full plot, where the 16px default titles dwarf it. */
    --scatter-font-size: var(--ptable-inset-font-size, 12px);
    --scatter-fullscreen-font-size: var(--ptable-inset-fullscreen-font-size, 16px);
  }
  /* On phone-width tables the inset area is ~200x60px, so custom insets drop into their own
     full-width row below the table (the compact colorbar stays). 380px catches 360-393px
     phones (table = 94vw) while 384px tables in a two-column 50em grid keep their inset. */
  @container (max-width: 380px) {
    .table-inset:not(.auto-colorbar-inset) {
      grid-row: 11;
      grid-column: 1 / -1;
      margin-top: 1em;
      /* The table pans sideways at this width, so size the row to the visible table and stick
         it to the left edge while the tiles scroll underneath. */
      position: sticky;
      inset: auto auto auto 0;
      width: 100cqw;
      justify-self: start;
    }
  }
</style>
