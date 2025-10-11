<script lang="ts">
  import { theme_state } from '$lib/state.svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { ThemeMode } from './index'
  import { apply_theme_to_dom, save_theme_preference, THEME_OPTIONS } from './index'

  let { theme_mode = $bindable(theme_state.mode), onchange = () => {}, ...rest }:
    & Omit<HTMLAttributes<HTMLSelectElement>, `onchange`>
    & {
      theme_mode?: ThemeMode // Current theme mode (now bindable to global state)
      onchange?: (mode: ThemeMode) => void // Callback when theme changes
    } = $props()

  $effect(() => { // Sync and save to local storage when theme changes
    const prev = theme_state.mode
    if (prev === theme_mode) return
    theme_state.mode = theme_mode
    save_theme_preference(theme_mode)
    apply_theme_to_dom(theme_mode)
    onchange(theme_mode)
  })
</script>

<select bind:value={theme_mode} {...rest} class="theme-control {rest.class ?? ``}">
  {#each THEME_OPTIONS as { label, icon, value } (value)}
    <option {value}>{icon}&ensp;{label}</option>
  {/each}
</select>

<style>
  .theme-control {
    position: fixed;
    bottom: 1em;
    left: 1em;
    z-index: var(--theme-control-z-index, 2);
    background: var(--btn-bg);
    border: var(--pane-border);
    color: var(--text-color);
    border-radius: var(--theme-control-border-radius, 5pt);
    padding: var(--theme-control-padding, 1pt 2pt);
    backdrop-filter: blur(10px);
    transition: all 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  .theme-control:hover {
    background: var(--btn-bg-hover);
    border: var(--pane-border);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  .theme-control:focus {
    outline: 0.5px solid var(--accent-color);
  }
</style>
