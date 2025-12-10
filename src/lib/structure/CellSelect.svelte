<script lang="ts">
  import { Icon } from '$lib'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import { is_valid_supercell_input } from '$lib/structure/supercell'
  import type { CellType } from '$lib/symmetry'
  import type { MoyoDataset } from '@spglib/moyo-wasm'
  import { click_outside, tooltip } from 'svelte-multiselect/attachments'
  import { fade } from 'svelte/transition'

  let {
    supercell_scaling = $bindable(`1x1x1`),
    cell_type = $bindable<CellType>(`original`),
    sym_data = null,
    loading = false,
    direction = `down`,
    align = `right`,
  }: {
    supercell_scaling: string
    cell_type?: CellType
    sym_data?: MoyoDataset | null
    loading?: boolean
    direction?: `up` | `down`
    align?: `left` | `right`
  } = $props()

  let menu_open = $state(false)
  let input_value = $state(supercell_scaling)
  let input_valid = $derived(is_valid_supercell_input(input_value))

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

  function apply_preset(preset: string) {
    supercell_scaling = preset
    input_value = preset
    menu_open = false
  }

  function handle_input_submit() {
    if (input_valid && input_value !== supercell_scaling) {
      supercell_scaling = input_value
      menu_open = false
    }
  }

  // Sync input value when external prop changes
  $effect(() => {
    if (!menu_open && supercell_scaling && supercell_scaling !== input_value) {
      input_value = supercell_scaling
    }
  })
</script>

<div
  class="cell-select"
  role="group"
  {@attach click_outside({ callback: () => (menu_open = false) })}
  onmouseenter={() => (menu_open = true)}
  onmouseleave={() => (menu_open = false)}
  onfocusin={() => (menu_open = true)}
>
  <button
    type="button"
    onclick={() => (menu_open = !menu_open)}
    class="toggle-btn"
    class:active={menu_open}
    aria-expanded={menu_open}
    {@attach tooltip({ content: `Cell type & supercell` })}
  >
    {#if loading}
      <Spinner
        style="--spinner-border-width: 2px; --spinner-size: 1em; --spinner-margin: 0; display: inline-block; vertical-align: middle"
      />
    {:else}
      {cell_type !== `original` ? `${cell_labels[cell_type]} ` : ``}{supercell_scaling}
    {/if}
  </button>

  {#if menu_open}
    <div
      class="dropdown"
      class:open-up={direction === `up`}
      class:align-left={align === `left`}
      transition:fade={{ duration: 100 }}
    >
      <!-- Cell type selector -->
      <div class="cell-type-row">
        {#each cell_types as type (type)}
          {@const disabled = type !== `original` && !sym_data}
          {@const label = cell_labels[type]}
          {@const tooltip_text = disabled
          ? `${cell_tooltips[type]} - requires symmetry data`
          : cell_tooltips[type]}
          <button
            class="cell-type-btn"
            class:selected={cell_type === type}
            class:disabled
            {disabled}
            onclick={() => (cell_type = type)}
            title={tooltip_text}
            {@attach tooltip({ content: tooltip_text })}
          >
            {label}
          </button>
        {/each}
      </div>

      <!-- Supercell presets -->
      <div class="supercell-grid">
        {#each supercell_presets as preset (preset)}
          <button
            class="preset-btn"
            class:selected={supercell_scaling === preset}
            onclick={() => apply_preset(preset)}
          >
            {preset}
          </button>
        {/each}
      </div>

      <!-- Custom input -->
      <div class="custom-input-row">
        <input
          type="text"
          bind:value={input_value}
          placeholder="e.g. 2x2x2"
          class:invalid={!input_valid}
          onkeydown={(event) => event.key === `Enter` && handle_input_submit()}
        />
        <button
          class="apply-btn"
          disabled={!input_valid || input_value === supercell_scaling}
          onclick={handle_input_submit}
          title="Apply"
        >
          <Icon icon="Check" />
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .cell-select {
    position: relative;
  }
  .toggle-btn {
    padding: var(--struct-legend-padding, 0 4pt);
    line-height: var(--struct-legend-line-height, 1.3);
    vertical-align: middle;
  }
  .dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 2px;
    background: var(--surface-bg, #222);
    padding: 5px;
    border-radius: var(--struct-border-radius, var(--border-radius, 3pt));
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 100;
    min-width: 95px;
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
  .dropdown.align-left {
    right: auto;
    left: 0;
  }

  /* Cell type row - compact buttons with minimal padding */
  .cell-type-row {
    display: flex;
    gap: 1px;
    padding-bottom: 3px;
    border-bottom: 1px solid rgba(128, 128, 128, 0.3);
  }
  .cell-type-btn {
    flex: 1;
    padding: 1px 0;
    font-size: 0.9em;
    border-radius: var(--border-radius, 3pt);
    transition: background 0.15s ease;
    white-space: nowrap;
  }
  @media (hover: hover) {
    .cell-type-btn:hover:not(.disabled) {
      background: rgba(255, 255, 255, 0.15);
    }
  }
  .cell-type-btn.selected {
    background: rgba(0, 255, 255, 0.4);
    border-color: rgba(0, 255, 255, 0.5);
  }
  .cell-type-btn.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Supercell grid */
  .supercell-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
  }
  .preset-btn {
    padding: 2px 4px;
    font-size: 0.9em;
    border-radius: var(--border-radius, 3pt);
  }
  @media (hover: hover) {
    .preset-btn:hover {
      background: rgba(255, 255, 255, 0.15);
    }
  }
  .preset-btn.selected {
    border-color: rgba(0, 255, 255, 0.5);
    background: rgba(0, 255, 255, 0.4);
  }

  /* Custom input row */
  .custom-input-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .custom-input-row input {
    max-width: 50px;
    padding: 2px 4px;
    margin-inline: 6px 0;
    font-size: 0.9em;
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
