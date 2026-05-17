<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let { title, on_close, children, ...rest }: HTMLAttributes<HTMLDivElement> & {
    title: string
    on_close: () => void
    children: Snippet
  } = $props()
</script>

<div {...rest} class="pinned-inspector {rest.class ?? ``}">
  <div class="pinned-header">
    <strong>{title}</strong>
    <button type="button" aria-label="Close pinned inspector" onclick={on_close}>
      x
    </button>
  </div>
  {@render children()}
</div>

<style>
  .pinned-inspector {
    position: absolute;
    left: var(--pinned-inspector-left, 1em);
    top: var(--pinned-inspector-top, 1em);
    z-index: var(--pinned-inspector-z-index, 10001);
    max-width: min(24em, calc(100% - 2em));
    padding: 0.5em 0.7em;
    border-radius: var(--border-radius, 3pt);
    background: color-mix(in srgb, var(--pinned-inspector-bg, Canvas) 92%, currentColor);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    backdrop-filter: blur(4px);
    font-size: var(--pinned-inspector-font-size, inherit);
  }
  .pinned-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1em;
    margin-bottom: 0.25em;
  }
  .pinned-header button {
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 1.2em;
    line-height: 1;
    padding: 0;
  }
</style>
