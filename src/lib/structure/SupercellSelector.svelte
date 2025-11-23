<script lang="ts">
  import { Icon } from '$lib'
  import Spinner from '$lib/feedback/Spinner.svelte'
  import { is_valid_supercell_input } from '$lib/structure/supercell'
  import { click_outside, tooltip } from 'svelte-multiselect/attachments'
  import { fade } from 'svelte/transition'

  let {
    supercell_scaling = $bindable(`1x1x1`),
    loading = false,
    open_direction = `down`,
    align = `right`,
  }: {
    supercell_scaling: string
    loading?: boolean
    open_direction?: `up` | `down`
    align?: `left` | `right`
  } = $props()

  let menu_open = $state(false)
  let input_value = $state(supercell_scaling)
  let input_valid = $derived(is_valid_supercell_input(input_value))

  const presets = [`1x1x1`, `2x2x2`, `2x2x1`, `3x3x3`]

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
        style="--spinner-color: currentColor; --spinner-track-color: transparent; --spinner-border-width: 2px; --spinner-size: 1em; margin: 0"
      />
    {:else}
      {supercell_scaling}
    {/if}
  </button>

  {#if menu_open}
    <div
      class="dropdown"
      class:open-up={open_direction === `up`}
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
    padding: 1px 3px;
    font-size: clamp(1em, 2cqmin, 2.5em);
    border: 2px solid var(--accent-color, #4caf50);
  }
  .toggle-btn:hover,
  .toggle-btn.active {
    opacity: 1;
  }
  .dropdown {
    position: absolute;
    /* Default: open down, align right */
    top: 115%;
    right: 0;
    background: var(--surface-bg, #222);
    border-radius: 4px;
    padding: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 4px;
    min-width: 140px;
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
  .preset-btn {
    background: rgba(255, 255, 255, 0.05);
    border: none;
    padding: 4px 8px;
    border-radius: 3px;
    color: inherit;
    font-size: 0.9em;
    cursor: pointer;
    transition: background 0.2s;
  }
  .preset-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .preset-btn.selected {
    background: var(--accent-color, #4caf50);
    color: white;
  }
  input {
    grid-column: 1;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: inherit;
    padding: 4px 6px;
    border-radius: 3px;
    font-size: 0.9em;
    width: 100%;
    box-sizing: border-box;
  }
  input:focus {
    outline: none;
    border-color: var(--accent-color, #4caf50);
  }
  input.invalid {
    border-color: #ff5252;
  }
  .apply-btn {
    grid-column: 2;
    background: var(--accent-color, #4caf50);
    border: none;
    border-radius: 3px;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: white;
    padding: 0;
  }
  .apply-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: gray;
  }
</style>
