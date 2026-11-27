<script lang="ts">
  import type { Snippet } from 'svelte'

  // Top-center column for a viewer's warnings and non-fatal errors (StatusMessage children):
  // floats over a still-usable view, above plot legends and below the corner controls its side
  // inset clears, stacks instead of overlapping, and passes clicks through between cards.
  // Needs a positioned ancestor. Errors that replace the view use ViewerError instead.
  let { children }: { children: Snippet } = $props()
</script>

<div class="viewer-notices">{@render children()}</div>

<style>
  .viewer-notices {
    position: absolute;
    top: 0.5em;
    left: 50%;
    transform: translateX(-50%);
    width: max-content;
    max-width: min(calc(100% - 8em), 36em);
    display: flex;
    flex-direction: column;
    gap: 4pt;
    z-index: 5;
    pointer-events: none;
    overflow-wrap: anywhere;
    --status-message-font-size: 0.8rem;
    --status-message-padding: 0.3rem 0.6rem;
    /* descendant, not child: each card sits in StatusMessage's display: contents live region */
    :global(.status-message) {
      pointer-events: auto;
    }
  }
</style>
