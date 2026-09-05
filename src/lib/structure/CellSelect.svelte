<script lang="ts">
  import { Icon, Spinner } from 'svelte-widgets'
  import { Check } from 'svelte-widgets/icons'
  import { is_valid_supercell_input } from '$lib/structure/supercell'
  import type { CellType, SymmetryDataset } from '$lib/symmetry'
  import { click_outside, tooltip } from 'svelte-widgets/attachments'
  import { fade } from 'svelte/transition'

  let {
    supercell_scaling = $bindable(`1x1x1`),
    cell_type = $bindable(`original`),
    sym_data = null,
    loading = false,
    direction = `down`,
    suppress_hover = false,
  }: {
    supercell_scaling: string
    cell_type?: CellType
    sym_data?: SymmetryDataset | null
    loading?: boolean
    direction?: `up` | `down`
    suppress_hover?: boolean // don't auto-open the menu on hover/focus (e.g. while a sibling popover is open)
  } = $props()

  let menu_open = $state(false)
  // Writable derived: follows the applied scaling until the user starts typing
  let input_value = $derived(supercell_scaling)
  let input_valid = $derived(is_valid_supercell_input(input_value))

  // Hover-intent gate: opening instantly on mouseenter made the menu pop open
  // when merely scrubbing the pointer across compact embeds (gallery cards).
  // Deliberate hovers still open it; keyboard focus and clicks open instantly.
  const hover_open_delay_ms = 200
  let hover_timer: ReturnType<typeof setTimeout> | undefined

  const schedule_hover_open = () => {
    if (suppress_hover) return
    clearTimeout(hover_timer)
    // re-check suppression at fire time: a sibling popover may have opened meanwhile
    hover_timer = setTimeout(() => (menu_open = !suppress_hover), hover_open_delay_ms)
  }

  const close_menu = () => {
    clearTimeout(hover_timer)
    menu_open = false
  }

  // A press focuses the button (focusin) before its click fires. Opening on that focusin
  // and then toggling on the click closed the menu again on every tap, so pointer-caused
  // focus leaves the decision to the click; keyboard focus still opens instantly.
  let pointer_press_pending = false

  $effect(() => () => clearTimeout(hover_timer))

  const supercell_presets = [`1x1x1`, `2x2x2`, `3x3x3`, `2x2x1`, `3x3x1`, `2x1x1`]

  // Always show all 3 cell types - Prim/Conv disabled without sym_data
  const cell_types: CellType[] = [`original`, `primitive`, `conventional`]
  const cell_labels: Record<CellType, string> = {
    original: `Orig`,
    primitive: `Prim`,
    conventional: `Conv`,
  }
  const cell_tooltips: Record<CellType, string> = {
    original: `Original unit cell (as provided)`,
    primitive: `Primitive cell (smallest repeating unit)`,
    conventional: `Conventional cell (standardized representation)`,
  }
  const hair_space = `\u200A`

  const format_supercell_label = (supercell_value: string): string =>
    supercell_value.replaceAll(`x`, `${hair_space}x${hair_space}`)

  function apply_preset(preset: string) {
    supercell_scaling = preset
    close_menu()
  }

  function handle_input_submit() {
    if (input_valid && input_value !== supercell_scaling) {
      supercell_scaling = input_value
      close_menu()
    }
  }

  function handle_focus_out(event: FocusEvent) {
    const next_target = event.relatedTarget
    const current_target = event.currentTarget
    if (
      !(current_target instanceof Node) ||
      !(next_target instanceof Node) ||
      !current_target.contains(next_target)
    )
      close_menu()
  }

  function handle_key_down(event: KeyboardEvent, submit_on_enter: boolean = false) {
    if (event.key === `Escape`) close_menu()
    if (submit_on_enter && event.key === `Enter`) handle_input_submit()
  }

  // Close + keep closed while suppressed so the menu can't obscure a sibling popover
  // (e.g. the atom color-mode dropdown) the user is actively interacting with
  $effect(() => {
    if (suppress_hover) close_menu()
  })
</script>

<div
  class="cell-select hover-visible"
  role="group"
  {@attach click_outside({ callback: close_menu })}
  onmouseenter={schedule_hover_open}
  onmouseleave={close_menu}
  onfocusin={() => {
    if (!pointer_press_pending) menu_open = !suppress_hover
  }}
  onfocusout={handle_focus_out}
>
  <button
    type="button"
    onpointerdown={() => (pointer_press_pending = true)}
    onclick={() => {
      clearTimeout(hover_timer)
      pointer_press_pending = false
      menu_open = !suppress_hover && !menu_open
    }}
    onkeydown={handle_key_down}
    class={['toggle-btn', { active: menu_open }]}
    aria-expanded={menu_open}
    {@attach tooltip({ content: `Cell type & supercell` })}
  >
    {#if loading}
      <Spinner
        style="--spinner-border-width: 2px; --spinner-size: 1em; --spinner-margin: 0; display: inline-block; vertical-align: middle"
      />
    {:else}
      {cell_type !== `original` ? `${cell_labels[cell_type]} ` : ``}{format_supercell_label(
        supercell_scaling,
      )}
    {/if}
  </button>

  {#if menu_open}
    <div
      class={['dropdown', { 'open-up': direction === `up` }]}
      transition:fade={{ duration: 100 }}
    >
      <div class="cell-type-row">
        {#each cell_types as type (type)}
          {@const disabled = type !== `original` && !sym_data}
          {@const label = cell_labels[type]}
          {@const tooltip_text = disabled
            ? `${cell_tooltips[type]} - requires symmetry data`
            : cell_tooltips[type]}
          <button
            class={['cell-type-btn', { selected: cell_type === type, disabled }]}
            {disabled}
            onclick={() => (cell_type = type)}
            title={tooltip_text}
            aria-label={tooltip_text}
            {@attach tooltip({ content: tooltip_text })}
          >
            {label}
          </button>
        {/each}
      </div>

      <div class="supercell-grid">
        {#each supercell_presets as preset (preset)}
          <button
            class={['preset-btn', { selected: supercell_scaling === preset }]}
            onclick={() => apply_preset(preset)}
          >
            {format_supercell_label(preset)}
          </button>
        {/each}
      </div>

      <div class="custom-input-row">
        <input
          type="text"
          bind:value={input_value}
          placeholder="e.g. 2x2x2"
          class:invalid={!input_valid}
          onkeydown={(event) => handle_key_down(event, true)}
        />
        <button
          class="apply-btn"
          disabled={!input_valid || input_value === supercell_scaling}
          onclick={handle_input_submit}
          title="Apply"
        >
          <Icon icon={Check} />
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .cell-select {
    position: relative;
    font-size: inherit;
    align-self: center;
    --cell-select-accent: var(--accent-color, light-dark(#2563eb, #60a5fa));
    --cell-select-surface: var(
      --struct-cell-select-bg,
      var(--menu-bg, light-dark(#fff, #2f3137))
    );
    --cell-select-color: var(
      --struct-cell-select-color,
      var(--menu-color, light-dark(#1a1a1a, #eee))
    );
    /* Mix ink into the opaque resting surface so hover never becomes a translucent
       wash over the 3D canvas (e.g. host --btn-bg-hover / --menu-option-hover-bg). */
    --cell-select-hover-surface: var(
      --struct-cell-select-hover-bg,
      color-mix(in srgb, var(--cell-select-color) 12%, var(--cell-select-surface))
    );
    --cell-select-border: var(
      --border-color,
      light-dark(rgba(0, 0, 0, 0.2), rgba(255, 255, 255, 0.25))
    );
  }
  .toggle-btn {
    font: inherit;
    padding: var(--struct-legend-padding, 0 4pt);
    line-height: var(--struct-legend-line-height, 1.3);
    vertical-align: middle;
    color: var(--cell-select-color);
    /* background-color (not shorthand) so a host `button:hover { background: … }`
       can't wipe the opaque fill via the shorthand reset. */
    background-color: var(--cell-select-surface);
    border: 1px solid var(--cell-select-border);
    border-radius: var(--border-radius, 3pt);
    transition: background-color 0.15s ease;
  }
  @media (hover: hover) {
    .toggle-btn:hover,
    .toggle-btn:focus-visible {
      background-color: var(--cell-select-hover-surface);
    }
  }
  .dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 2px;
    /* Pair ink with the light-dark surface so a dark host's --text-color can't bleach the menu. */
    background: var(--surface-bg, light-dark(rgba(255, 255, 255, 0.96), #222));
    color: var(--cell-select-color);
    padding: 4px;
    border-radius: var(--struct-cell-select-border-radius, 4px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    gap: 5px;
    z-index: var(--z-index-viewer-dropdown, 100);
    /* own compositing layer, or WKWebView paints the canvas over this (see app.css) */
    will-change: transform;
    font-size: var(--struct-cell-select-dropdown-font, max(10px, 1em));
    min-width: 118px;
  }
  .dropdown button,
  .custom-input-row input {
    color: inherit;
    font-family: inherit;
    font-size: inherit;
  }
  /* Invisible bridge to prevent menu closing when moving mouse from toggle to dropdown */
  .dropdown::before {
    content: '';
    position: absolute;
    top: -10px;
    left: 0;
    right: 0;
    height: 10px;
  }
  .dropdown.open-up {
    top: auto;
    bottom: 100%;
    margin-top: 0;
    margin-bottom: 2px;
  }
  .dropdown.open-up::before {
    top: auto;
    bottom: -10px;
  }

  .cell-type-row {
    display: flex;
    gap: 3px;
    padding-bottom: 5px;
    border-bottom: 1px solid var(--border-color, rgba(128, 128, 128, 0.3));
  }
  .cell-type-btn {
    flex: 1;
    padding: 1px 3px;
    background: var(--btn-bg, light-dark(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.1)));
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius, 3pt);
    transition: background 0.15s ease;
    white-space: nowrap;
  }
  @media (hover: hover) {
    .cell-type-btn:hover:not(.disabled) {
      background: var(
        --btn-bg-hover,
        light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.15))
      );
    }
  }
  .cell-type-btn.selected {
    color: var(--cell-select-accent);
    background: color-mix(in srgb, var(--cell-select-accent) 18%, var(--cell-select-surface));
    border-color: color-mix(in srgb, var(--cell-select-accent) 45%, var(--cell-select-border));
  }
  .cell-type-btn.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .supercell-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px;
  }
  .preset-btn {
    padding: 1px;
    background: var(--btn-bg, light-dark(rgba(0, 0, 0, 0.08), rgba(255, 255, 255, 0.1)));
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius, 3pt);
  }
  @media (hover: hover) {
    .preset-btn:hover {
      background: var(
        --btn-bg-hover,
        light-dark(rgba(0, 0, 0, 0.12), rgba(255, 255, 255, 0.15))
      );
    }
  }
  .preset-btn.selected {
    color: var(--cell-select-accent);
    background: color-mix(in srgb, var(--cell-select-accent) 18%, var(--cell-select-surface));
    border-color: color-mix(in srgb, var(--cell-select-accent) 45%, var(--cell-select-border));
  }

  .custom-input-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .custom-input-row input {
    max-width: 60px;
    min-height: 0;
    padding: 1px 4px;
  }
  .custom-input-row input.invalid {
    border-color: rgba(255, 100, 100, 0.6);
  }
  .apply-btn {
    display: grid;
    place-items: center;
    padding: 2px 4px;
  }
  .apply-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
