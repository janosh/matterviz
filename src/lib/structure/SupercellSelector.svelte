<script lang="ts">
  import { Icon } from '$lib'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import { is_valid_supercell_input } from '$lib/structure/supercell'
  import { click_outside, tooltip } from 'svelte-multiselect/attachments'
  import { fade } from 'svelte/transition'

  let {
    supercell_scaling = $bindable(`1x1x1`),
    loading = false,
    direction = `down`,
    align = `right`,
  }: {
    supercell_scaling: string
    loading?: boolean
    direction?: `up` | `down`
    align?: `left` | `right`
  } = $props()

  let menu_open = $state(false)
  let input_value = $state(supercell_scaling)
  let input_valid = $derived(is_valid_supercell_input(input_value))

  const presets = [`1x1x1`, `2x2x2`, `3x3x3`, `2x2x1`, `3x3x1`, `2x1x1`]

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

  function onkeydown(event: KeyboardEvent) {
    if (event.key === `Enter`) {
      handle_input_submit()
    }
  }

  // Sync input value when external prop changes (but not when menu is open and user is editing)
  $effect(() => {
    if (!menu_open && supercell_scaling && supercell_scaling !== input_value) {
      input_value = supercell_scaling
    }
  })
</script>

<div
  class="supercell-selector"
  {@attach click_outside({ callback: () => (menu_open = false) })}
>
  <button
    type="button"
    onclick={() => (menu_open = !menu_open)}
    title="Supercell scaling"
    class="toggle-btn"
    class:active={menu_open}
    aria-expanded={menu_open}
    {@attach tooltip({ content: `Supercell scaling` })}
  >
    {#if loading}
      <Spinner
        style="--spinner-border-width: 2px; --spinner-size: 1em; --spinner-margin: 0; display: inline-block; vertical-align: middle"
      />
    {:else}
      {supercell_scaling}
    {/if}
  </button>

  {#if menu_open}
    <div
      class="dropdown"
      class:open-up={direction === `up`}
      class:align-left={align === `left`}
      transition:fade={{ duration: 100 }}
    >
      {#each presets as preset (preset)}
        <button
          class="preset-btn"
          class:selected={supercell_scaling === preset}
          onclick={() => apply_preset(preset)}
        >
          {preset}
        </button>
      {/each}

      <input
        type="text"
        bind:value={input_value}
        placeholder="e.g. 2x2x2"
        class:invalid={!input_valid}
        {onkeydown}
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
  {/if}
</div>

<style>
  .supercell-selector {
    position: relative;
  }
  .toggle-btn {
    padding: var(--struct-legend-padding, 0 4pt);
    line-height: var(--struct-legend-line-height, 1.3);
    vertical-align: middle;
  }
  .dropdown {
    position: absolute;
    top: 115%;
    right: 0;
    background: var(--surface-bg, #222);
    padding: 4px 2px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    z-index: 100;
  }
  .dropdown.open-up {
    top: auto;
    bottom: 115%;
  }
  .dropdown.align-left {
    right: auto;
    left: 0;
  }
  .preset-btn:hover {
    background: rgba(255, 255, 255, 0.5);
  }
  .preset-btn.selected {
    border-color: rgba(0, 255, 255, 0.5);
    background: rgba(0, 255, 255, 0.5);
  }
  input {
    grid-column: 1;
    width: 100%;
    padding: 0 6px;
    box-sizing: border-box;
  }
  .apply-btn {
    grid-column: 2;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .apply-btn:disabled {
    cursor: not-allowed;
  }
</style>
