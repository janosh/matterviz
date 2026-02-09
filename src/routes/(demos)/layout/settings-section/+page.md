# SettingsSection

A collapsible settings group that tracks changes from initial values and offers a reset button.

## Basic Usage

```svelte example
<script lang="ts">
  import { SettingsSection } from 'matterviz/layout'

  let font_size = $state(14)
  let dark_mode = $state(true)
  let language = $state(`en`)
</script>

<SettingsSection
  title="Display Settings"
  current_values={{ font_size, dark_mode, language }}
  on_reset={() => {
    font_size = 14
    dark_mode = true
    language = `en`
  }}
>
  {#snippet children({ has_changes })}
    <div style="display: flex; flex-direction: column; gap: 8pt; padding: 8pt">
      <label>
        Font size: <input type="range" min={10} max={24} bind:value={font_size} />
        {font_size}px
      </label>
      <label>
        <input type="checkbox" bind:checked={dark_mode} /> Dark mode
      </label>
      <label>
        Language:
        <select bind:value={language}>
          <option value="en">English</option>
          <option value="de">Deutsch</option>
          <option value="ja">日本語</option>
        </select>
      </label>
      {#if has_changes}
        <span style="font-size: 0.8em; opacity: 0.6"
        >Settings modified — click Reset to restore defaults</span>
      {/if}
    </div>
  {/snippet}
</SettingsSection>
```
