<script lang="ts">
  import type { ShowControlsState } from '$lib/controls'
  // Shared control-buttons row (filename chip + fullscreen toggle + snippet buttons/panes) that
  // viewers render as a direct child of their root; themed via neutral --viewer-* CSS vars.
  // Full-width sequence viewers use SequenceControlBar instead.
  import type { Snippet } from 'svelte'
  import { createAttachmentKey } from 'svelte/attachments'
  import { tooltip } from 'svelte-widgets/attachments'
  import FullscreenButton from './FullscreenButton.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    controls_config,
    filename,
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    fullscreen_bg_css_var = `--fullscreen-bg`,
    on_fullscreen_change,
    wrapper,
    children,
    ...rest
  }: HTMLAttributes<HTMLElement> & {
    controls_config: ShowControlsState
    filename?: string
    fullscreen?: boolean
    fullscreen_toggle?: boolean
    fullscreen_bg_css_var?: string
    on_fullscreen_change?: (fullscreen: boolean) => void
    wrapper?: HTMLDivElement
    children?: Snippet // rendered after the fullscreen toggle (panes, controls, ...)
  } = $props()

  // Styled tooltip (reads the button's title attr), forwarded as a spreadable attachment
  const tooltip_attachment = { [createAttachmentKey()]: tooltip() }
</script>

<section
  {...rest}
  class={[`control-buttons`, controls_config.class, rest.class]}
  style={[rest.style, controls_config.style].filter(Boolean).join(`; `)}
>
  {#if controls_config.mode !== `never`}
    {#if filename && controls_config.visible(`filename`)}
      <span class="filename">{filename}</span>
    {/if}

    {#if fullscreen_toggle && controls_config.visible(`fullscreen`)}
      <FullscreenButton
        bind:fullscreen
        {wrapper}
        bg_css_var={fullscreen_bg_css_var}
        on_change={on_fullscreen_change}
        {...tooltip_attachment}
      />
    {/if}

    {@render children?.()}
  {/if}
</section>

<style>
  section.control-buttons {
    position: absolute;
    display: flex;
    top: var(--viewer-buttons-top, var(--ctrl-btn-top, 1ex));
    right: var(--viewer-buttons-right, var(--ctrl-btn-right, 1ex));
    gap: var(--viewer-buttons-gap, clamp(6pt, 1cqmin, 9pt));
    z-index: var(--viewer-buttons-z-index, var(--z-index-overlay-controls, 100000000));
    /* own compositing layer, or WKWebView paints the canvas over this (see app.css) */
    will-change: transform;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    align-items: var(--viewer-buttons-align, center);
    /* always: visible; hover: visible while the parent viewer is hovered/focused; never: hidden */
    &.always-visible,
    :global(:is(:hover, :focus-within)) > &.hover-visible {
      opacity: 1;
      pointer-events: auto;
    }
    /* Fingers need ~32px targets; the icons keep their size, only the hit area grows.
       The filename gives way first so the row never pushes past the viewer edge. */
    @media (pointer: coarse) {
      > :global(button) {
        min-width: 32px;
        min-height: 32px;
      }
    }
    > :global(button) {
      background-color: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--viewer-buttons-btn-padding, 4px);
      border-radius: var(--border-radius, 3pt);
      font-size: var(--ctrl-btn-icon-size, clamp(0.7rem, 2cqmin, 0.85rem));
    }
    > :global(.fullscreen-btn) {
      --icon-size: 1.3em;
    }
    :global(button:hover) {
      background-color: var(
        --viewer-buttons-hover-bg,
        color-mix(in srgb, currentColor 8%, transparent)
      );
      color: var(--viewer-buttons-hover-color, currentColor);
    }
  }
  .filename {
    font-family: monospace;
    font-size: 0.9em;
    background: var(--code-bg, rgba(0, 0, 0, 0.1));
    padding: 3pt 6pt;
    border-radius: 3pt;
    max-width: 200px;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
