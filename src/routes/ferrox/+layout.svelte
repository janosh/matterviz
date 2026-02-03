<script lang="ts">
  import type { Snippet } from 'svelte'
  import { Toc } from 'svelte-toc'

  let { children }: { children: Snippet } = $props()
</script>

<div class="ferrox-layout">
  <div class="ferrox-docs">
    {@render children()}
  </div>

  <Toc
    headingSelector=".ferrox-docs :where(h2, h3)"
    breakpoint={1200}
    open_button_style="display: flex; padding: 3px;"
    --toc-mobile-bg="var(--bg-color, #fff)"
    --toc-padding="1em"
  />
</div>

<style>
  .ferrox-docs {
    max-width: 900px;
    margin: 0 auto;
    padding: 0 1rem;
    :global(h1) {
      margin: 1.5rem 0 0.5rem;
    }
    :global(h2) {
      margin: 1.2rem 0 0.4rem;
      padding-top: 0.8rem;
      border-top: 1px solid var(--border-color, #e0e0e0);
    }
    :global(h3) {
      margin: 0.8rem 0 0.3rem;
    }
    :global(:where(h4, h5, h6)) {
      margin: 0.5rem 0 0.2rem;
    }
    :global(:where(p, blockquote)) {
      margin: 0.4rem 0;
    }
    :global(:where(ul, ol)) {
      margin: 0.3rem 0;
      padding-left: 1.5rem;
    }
    :global(li) {
      margin: 0.15rem 0;
    }
    :global(pre) {
      margin: 0.4rem 0;
      padding: 0.5rem 0.75rem;
      font-size: 0.85rem;
      overflow-x: auto;
    }
    :global(code) {
      font-size: 0.85em;
    }
    :global(table) {
      margin: 0.4rem 0;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    :global(:where(th, td)) {
      padding: 0.25rem 0.5rem;
      border: 1px solid var(--border-color, #e0e0e0);
    }
    :global(a[id]:empty) {
      display: none;
    }
    :global(:where(h5, h6) + pre) {
      margin-top: 0.2rem;
    }
    :global(blockquote) {
      padding: 0.3rem 0.75rem;
    }
  }
  .ferrox-layout {
    :global(aside.toc) {
      font-size: 0.75rem;
    }
    :global(aside.toc.desktop) {
      position: fixed;
      top: 6rem;
      left: calc(50% + 480px);
      max-width: 13rem;
      max-height: 75vh;
      overflow-y: auto;
    }
    :global(aside.toc nav) {
      padding: 0.5rem;
    }
    :global(aside.toc li) {
      margin: 0.2rem 0;
    }
  }
</style>
