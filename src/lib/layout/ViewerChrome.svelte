<script lang="ts">
  import type { FullscreenToggleProp } from './fullscreen'
  import type { ShowControlsState } from '$lib/controls'
  // Shared control-buttons row (filename chip + fullscreen toggle + snippet buttons/panes) for BrillouinZone/FermiSurface/Structure viewers; themed via neutral --viewer-* CSS vars
  // TODO Trajectory.svelte still has its own control-buttons variant — migrate it here.
  import type { Snippet } from 'svelte'
  import { createAttachmentKey } from 'svelte/attachments'
  import { tooltip } from 'svelte-multiselect/attachments'
  import FullscreenButton from './FullscreenButton.svelte'

  let {
    controls_config,
    filename = undefined,
    fullscreen = false,
    fullscreen_toggle = true,
    fullscreen_btn_style = undefined,
    wrapper = undefined,
    style = undefined,
    before = undefined,
    children = undefined,
  }: {
    controls_config: ShowControlsState
    filename?: string
    fullscreen?: boolean
    fullscreen_toggle?: FullscreenToggleProp
    fullscreen_btn_style?: string
    wrapper?: HTMLDivElement
    style?: string // extra styles/CSS vars for the section (user config style wins)
    before?: Snippet // rendered before filename/fullscreen (e.g. reset-camera button)
    children?: Snippet // rendered after the fullscreen toggle (panes, controls, ...)
  } = $props()

  // Styled tooltip (reads the button's title attr), forwarded as a spreadable attachment
  const tooltip_attachment = { [createAttachmentKey()]: tooltip() }
</script>

<section
  class="control-buttons {controls_config.class}"
  style={[style, controls_config.style].filter(Boolean).join(`; `)}
>
  {#if controls_config.mode !== `never`}
    {@render before?.()}

    {#if filename && controls_config.visible(`filename`)}
      <span class="filename">{filename}</span>
    {/if}

    {#if fullscreen_toggle && controls_config.visible(`fullscreen`)}
      <FullscreenButton
        {fullscreen}
        toggle={fullscreen_toggle}
        {wrapper}
        class="fullscreen-toggle"
        style={fullscreen_btn_style}
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
    z-index: var(
      --viewer-buttons-z-index,
      var(--z-index-overlay-controls, 100000000)
    );
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease;
    align-items: var(--viewer-buttons-align, center);
  }
  /* Mode: always - controls always visible */
  section.control-buttons.always-visible {
    opacity: 1;
    pointer-events: auto;
  }
  /* Mode: hover - controls visible while the parent viewer is hovered/focused */
  :global(:hover) > section.control-buttons.hover-visible,
  :global(:focus-within) > section.control-buttons.hover-visible {
    opacity: 1;
    pointer-events: auto;
  }
  /* Mode: never - stays hidden (default state, no additional CSS needed) */
  section.control-buttons > :global(button) {
    background-color: transparent;
    display: flex;
    padding: var(--viewer-buttons-btn-padding, 4px);
    border-radius: var(--border-radius, 3pt);
    font-size: clamp(0.85em, 2cqmin, 1.3em);
  }
  section.control-buttons :global(button:hover) {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
  .filename {
    font-family: monospace;
    font-size: 0.9em;
    background: var(--code-bg, rgba(0, 0, 0, 0.1));
    padding: 3pt 6pt;
    border-radius: 3pt;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
