<script lang="ts">
  import { theme_state } from '$lib/state.svelte'
  import type { ThemeMode } from './index'
  import { apply_theme_to_dom, save_theme_preference, THEME_OPTIONS } from './index'

  interface Props {
    theme_mode?: ThemeMode // Current theme mode (now bindable to global state)
    onchange?: (mode: ThemeMode) => void // Callback when theme changes
    [key: string]: unknown
  }
  let {
    theme_mode = $bindable(theme_state.mode),
    onchange = () => {},
    ...rest
  }: Props = $props()

  // Sync and save when theme changes
  $effect(() => {
    theme_state.mode = theme_mode
    save_theme_preference(theme_mode)

    // Apply the theme to the DOM immediately
    apply_theme_to_dom(theme_mode)

    onchange(theme_mode)
  })
</script>

<select bind:value={theme_mode} class="theme-control" {...rest}>
  {#each THEME_OPTIONS as option (option.value)}
    <option value={option.value}>{option.icon} {option.label}</option>
  {/each}
</select>

<style>
  .theme-control {
    position: fixed;
    bottom: 1em;
    left: 1em;
    z-index: 100;
    background: var(--theme-control-bg);
    border: 1px solid var(--theme-control-border);
    color: var(--text-color);
    border-radius: 5pt;
    padding: 4pt 6pt;
    backdrop-filter: blur(10px);
    transition: all 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  .theme-control:hover {
    background: var(--theme-control-hover-bg);
    border-color: var(--theme-control-hover-border);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
  .theme-control:focus {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
  }
</style>
