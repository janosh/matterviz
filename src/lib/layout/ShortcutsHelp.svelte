<script lang="ts">
  import { host } from '#lib/host.js'
  import { anchored_popover, close_before_removal } from '#lib/overlays/anchored-popover.js'
  import {
    format_shortcut_keys,
    SHORTCUT_SCOPES_ATTR,
    SHORTCUTS,
    shortcut_attrs,
    type ShortcutScope,
    shortcuts_for,
    viewer_keys,
  } from '#lib/shortcuts.js'
  import Icon from 'svelte-widgets/Icon.svelte'
  import { Keyboard } from 'svelte-widgets/icons'
  import { tooltip } from 'svelte-widgets/attachments'

  // Header button and `?` key listing the keyboard shortcuts of the viewers under the pointer,
  // generated from the SHORTCUTS registry. Like FullscreenButton's `f`, the outermost viewer
  // owns `?`: a nested viewer (a Structure inside a Trajectory) defers, and the outer one lists
  // the scopes of every marked viewer that is hovered or focused inside it.
  let {
    scopes,
    wrapper,
  }: {
    scopes: readonly ShortcutScope[] // this viewer's shortcuts, marked on its root
    wrapper?: HTMLElement // the viewer root
  } = $props()

  let open = $state(false)
  let button = $state<HTMLButtonElement>()
  let listed_scopes = $state<ShortcutScope[]>([])

  const active_scopes = (root: HTMLElement): ShortcutScope[] => {
    const marked = [root, ...root.querySelectorAll<HTMLElement>(`[${SHORTCUT_SCOPES_ATTR}]`)]
    const active = marked.filter(
      (element) =>
        element === root ||
        element.matches(`:hover`) ||
        element.contains(element.ownerDocument.activeElement),
    )
    return active.flatMap(
      (element) =>
        (element.getAttribute(SHORTCUT_SCOPES_ATTR) ?? ``).split(` `) as ShortcutScope[],
    )
  }
  const toggle = (root: HTMLElement): void => {
    if (!open) listed_scopes = active_scopes(root)
    open = !open
  }
  const shortcuts = $derived(
    shortcuts_for(listed_scopes).filter(
      (shortcut) => host.fullscreen || shortcut !== SHORTCUTS.fullscreen,
    ),
  )

  $effect(() => {
    const root = wrapper
    if (!root) return
    root.setAttribute(SHORTCUT_SCOPES_ATTR, scopes.join(` `))
    const detach = viewer_keys(() =>
      root.parentElement?.closest(`[${SHORTCUT_SCOPES_ATTR}]`)
        ? {}
        : { '?': () => toggle(root) },
    )(root)
    return () => {
      root.removeAttribute(SHORTCUT_SCOPES_ATTR)
      detach()
    }
  })
</script>

<button
  bind:this={button}
  type="button"
  class="shortcuts-btn"
  aria-expanded={open}
  aria-label="Keyboard shortcuts"
  {...shortcut_attrs(`help`)}
  onclick={() => wrapper && toggle(wrapper)}
  {@attach tooltip()}
>
  <Icon icon={Keyboard} />
</button>
{#if open}
  <div
    class="shortcuts-list"
    role="dialog"
    aria-label="Keyboard shortcuts"
    out:close_before_removal
    {@attach anchored_popover({ anchor: button, on_close: () => (open = false) })}
  >
    <dl>
      {#each shortcuts as shortcut (shortcut)}
        <dt><kbd>{format_shortcut_keys(shortcut)}</kbd></dt>
        <dd>{shortcut.description}</dd>
      {/each}
    </dl>
  </div>
{/if}

<style>
  .shortcuts-list {
    padding: 6pt 9pt;
    font-size: 0.85rem;
    background: var(--menu-bg, light-dark(#fff, #2f3137));
    color: var(--menu-color, light-dark(#1a1a1a, #eee));
    border: 1px solid var(--menu-border, light-dark(#d0d0d4, #44474f));
    border-radius: 4px;
    box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.3);
    max-height: 70vh;
    overflow-y: auto;
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 3pt 1em;
      margin: 0;
    }
    dt {
      text-align: right;
      white-space: nowrap;
    }
    dd {
      margin: 0;
    }
    kbd {
      font-family: monospace;
      padding: 0 3pt;
      border: 1px solid currentColor;
      border-radius: 3pt;
      opacity: 0.85;
    }
  }
</style>
