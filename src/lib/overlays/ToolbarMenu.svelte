<script lang="ts">
  // Toolbar dropdown shared by the Structure and Trajectory viewers (view layout, measure/edit,
  // display mode, analysis): an icon toggle anchoring a menu that floats below it and closes
  // on outside press. Callers render the options as `<button class="view-mode-option">`
  // children; the class names are stable hooks for tests and host CSS (--view-mode-* vars).
  // Menu colors fall back to app.css's --menu-* tokens and then to literal light-dark values,
  // so hosts that skip app.css still get a styled, positioned menu.
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { click_outside, tooltip } from 'svelte-widgets/attachments'

  let {
    open = $bindable(false),
    label,
    active,
    button_class = `view-mode-button`,
    menu_class,
    button,
    trailing,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    open?: boolean
    label: string // aria-label and tooltip of the toggle
    active?: boolean // highlights the toggle; defaults to open (Trajectory also lights it while a pane is open)
    button_class?: string // tests target `.view-mode-button`; the analysis menu uses `analysis-button`
    menu_class?: string // extra class on the floating menu (e.g. `analysis-dropdown`)
    button: Snippet // toggle content (icons)
    trailing?: Snippet // extra wrapper children after the toggle: inline buttons, anchored panes
    children: Snippet // the `.view-mode-option` buttons
  } = $props()
</script>

<div
  {...rest}
  class={[`view-mode-control`, rest.class]}
  {@attach click_outside({ callback: () => (open = false) })}
>
  <button
    type="button"
    class={[button_class, { active: active ?? open }]}
    aria-label={label}
    title={label}
    aria-expanded={open}
    onclick={() => (open = !open)}
    {@attach tooltip()}
  >
    {@render button()}
  </button>
  {@render trailing?.()}
  {#if open}
    <div class={[`view-mode-dropdown`, menu_class]}>
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .view-mode-control {
    display: flex;
    position: relative;
    align-items: center;
    height: fit-content;
    place-self: center;
    z-index: var(--view-mode-z-index, 20);
    > :global(button) {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1pt;
      background: transparent;
      padding: var(--view-mode-button-padding, 1px 2px);
      font-size: var(--ctrl-btn-icon-size, inherit);
    }
    > button.active {
      color: var(--accent-color, #4a9eff);
    }
  }
  .view-mode-dropdown {
    position: absolute;
    top: 115%;
    right: 0;
    z-index: var(--view-mode-dropdown-z-index, 30);
    min-width: max-content;
    display: flex;
    flex-direction: column;
    background: var(--view-mode-bg, var(--menu-bg, light-dark(#fff, #2f3137)));
    color: var(--view-mode-color, var(--menu-color, light-dark(#1a1a1a, #eee)));
    border: 1px solid var(--view-mode-border, var(--menu-border, light-dark(#d0d0d4, #44474f)));
    border-radius: var(--view-mode-border-radius, 4px);
    box-shadow:
      0 8px 16px -4px rgba(0, 0, 0, 0.3),
      0 4px 8px -2px rgba(0, 0, 0, 0.1);
    pointer-events: auto;
    > :global(.view-mode-option) {
      display: flex;
      align-items: center;
      gap: 1ex;
      width: 100%;
      padding: var(--view-mode-option-padding, 5pt);
      box-sizing: border-box;
      background: transparent;
      color: inherit;
      border-radius: 0;
      text-align: left;
      transition: background-color 0.15s ease;
    }
    > :global(.view-mode-option:is(:hover, :focus-visible)) {
      color: var(--accent-color, #4a9eff);
      background: var(
        --view-mode-option-hover-bg,
        var(--menu-option-hover-bg, light-dark(#ececef, #3a3d45))
      );
    }
    > :global(.view-mode-option:first-child) {
      border-top-left-radius: 3px;
      border-top-right-radius: 3px;
    }
    > :global(.view-mode-option.selected) {
      color: var(
        --accent-color,
        var(--menu-option-selected-color, light-dark(#2563eb, #6ea8ff))
      );
    }
    > :global(.view-mode-option span) {
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
  }
</style>
