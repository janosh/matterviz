<script lang="ts">
  // Edit-bonds context menu anchored at a bond: set its order, remove it, or close
  import type { Vec3 } from '#lib/math.js'
  import { SceneLabel } from '#lib/scene/index.js'
  import type { BondOrder } from '#lib/structure/index.js'
  import { BOND_ORDER_OPTIONS } from './bonding'

  let {
    position,
    current_order,
    on_set_order,
    on_remove,
    on_close,
  }: {
    position: Vec3 // in the parent's (structure) space
    current_order?: BondOrder
    on_set_order: (order: BondOrder) => void
    on_remove: () => void
    on_close: () => void
  } = $props()

  // Act on pointerdown (a pointer's click would arrive after orbit-controls' start handler
  // already closed the menu), else on the click that keyboard and assistive-tech activation
  // send (detail 0: a screen reader's activate never presses a key or pointer)
  const action_props = (action: () => void) => {
    const run = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      action()
    }
    return {
      onpointerdown: run,
      onclick: (event: MouseEvent) => {
        if (event.detail === 0) run(event)
      },
      // the key's click acts; the key itself must not reach the viewer's shortcuts
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === `Enter` || event.key === ` `) event.stopPropagation()
      },
    }
  }
</script>

<SceneLabel interactive autoRender={false} {position}>
  <div class="bond-context-menu">
    <strong>Bond Order ({current_order ?? 1})</strong>
    {#each BOND_ORDER_OPTIONS as { order, label } (label)}
      <button type="button" {...action_props(() => on_set_order(order))}>
        {label}
      </button>
    {/each}
    <button type="button" class="remove" {...action_props(on_remove)}>Remove</button>
    <button type="button" {...action_props(on_close)}>Close</button>
  </div>
</SceneLabel>

<style>
  .bond-context-menu {
    display: grid;
    min-width: 8rem;
    gap: 2pt;
    padding: 3pt 5pt;
    border-radius: var(--border-radius, 3pt);
    /* Pair with light-dark so a dark host's --text-color can't bleach a light menu. */
    background: var(--surface-bg, var(--menu-bg));
    color: var(--struct-context-menu-color, var(--menu-color));
    border: 1px solid var(--struct-context-menu-border, var(--menu-border));
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    strong {
      font-size: 0.85em;
      padding: 0 2pt 2pt;
      white-space: nowrap;
    }
    button {
      border: none;
      border-radius: var(--border-radius, 3pt);
      background: transparent;
      color: inherit;
      cursor: pointer;
      padding: 2pt 5pt;
      text-align: left;
    }
    button:hover {
      background: color-mix(in srgb, currentColor 10%, transparent);
    }
    button.remove {
      color: var(--error-color, #f44336);
    }
  }
</style>
