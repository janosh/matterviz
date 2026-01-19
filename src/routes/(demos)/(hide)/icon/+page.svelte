<script lang="ts">
  import type { IconName } from '$lib'
  import { Icon, ICON_DATA } from '$lib'
  import { fuzzy_match } from 'svelte-multiselect'
  import { highlight_matches } from 'svelte-multiselect/attachments'

  let filter_text = $state(``)
  let copied_text = $state<string | null>(null)

  async function copy(text: string) {
    await navigator.clipboard.writeText(text)
    copied_text = text
    setTimeout(() => (copied_text = null), 1500)
  }

  const icon_names = Object.keys(ICON_DATA) as IconName[]

  let filtered_icons = $derived(
    icon_names.filter((name) => !filter_text || fuzzy_match(filter_text, name)),
  )
</script>

<h1>Icon Gallery</h1>

<p>
  The <a
    href="https://github.com/janosh/matterviz/blob/main/src/lib/Icon.svelte#L28"
  ><code>Icon</code></a> component renders SVG icons from a built-in library of
  <strong>{icon_names.length}</strong> icons. Pass an icon name to the
  <code>icon</code> prop, or provide custom <code>path</code> and
  <code>viewBox</code> props for custom SVGs.
</p>

<div class="controls">
  <label>
    <Icon icon="Search" style="font-size: 1.2em" />
    <input
      type="text"
      placeholder="Filter icons (fuzzy search)..."
      bind:value={filter_text}
    />
  </label>
  <span class="count">
    {filtered_icons.length} / {icon_names.length} icons
  </span>
</div>

<div
  class="icon-grid"
  {@attach highlight_matches({
    query: filter_text,
    fuzzy: true,
    css_class: `highlight`,
  })}
>
  {#each filtered_icons as icon_name (icon_name)}
    <div class="icon-card">
      <button
        class="svg-btn"
        class:copied={copied_text === ICON_DATA[icon_name].path}
        onclick={() => copy(ICON_DATA[icon_name].path)}
        title="Click to copy SVG path"
      >
        <Icon icon={icon_name} style="font-size: 2em" />
      </button>
      <button
        class="name-btn"
        class:copied={copied_text === icon_name}
        onclick={() => copy(icon_name)}
        title="Click to copy icon name"
      >
        <code>{icon_name}</code>
      </button>
    </div>
  {/each}
</div>

{#if filtered_icons.length === 0}
  <div class="no-results">
    <Icon icon="Search" style="font-size: 3em; opacity: 0.3" />
    <p>No icons match "{filter_text}"</p>
  </div>
{/if}

<h2>Usage</h2>

<pre
  class="language-svelte"
>
<code>{`${`<`}script>
  import { Icon } from '$lib'
${`<`}/script>

<!-- Using built-in icon -->
<Icon icon="GitHub" />

<!-- With custom size -->
<Icon icon="Settings" style="font-size: 2em" />

<!-- Custom SVG path -->
<Icon path="M12 2L2 7l10 5 10-5-10-5z" viewBox="0 0 24 24" />`}</code></pre>

<style>
  ::highlight(highlight) {
    background: color-mix(in srgb, var(--accent-color, cornflowerblue) 35%, transparent);
    color: inherit;
  }
  .controls {
    display: flex;
    gap: 1em;
    align-items: center;
    flex-wrap: wrap;
    margin-block: 1em;
  }
  .controls label {
    display: flex;
    align-items: center;
    gap: 3pt;
    flex: 1;
    min-width: 200px;
  }
  .controls input {
    flex: 1;
    padding: 0.3em 0.5em;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 4px;
    font-size: 1em;
    background: var(--input-bg, var(--surface-bg, inherit));
    color: inherit;
  }
  .count {
    color: var(--text-color, inherit);
    font-size: 0.9em;
    white-space: nowrap;
  }
  .icon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    grid-template-rows: repeat(auto-fill, auto auto);
    gap: 8pt;
    margin-block: 1em;
  }
  .icon-card {
    display: grid;
    grid-template-rows: subgrid;
    grid-row: span 2;
    justify-items: center;
    padding: 6pt;
    border-radius: 6pt;
    background: var(--surface-bg, #f9f9f9);
    transition: box-shadow 0.2s;
  }
  .icon-card:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
  .icon-card button {
    background: none;
    border: none;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .icon-card .svg-btn {
    align-self: center;
    padding: 4pt;
    border-radius: 4pt;
    transition: background 0.2s;
  }
  .icon-card .svg-btn:hover {
    background: color-mix(in srgb, currentColor 10%, transparent);
  }
  .icon-card .svg-btn.copied {
    color: var(--success-color, #4caf50);
  }
  .icon-card .name-btn {
    align-self: start;
    padding: 0;
    max-width: 100%;
    overflow: hidden;
  }
  .icon-card .name-btn code {
    display: block;
    font-size: 0.75em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-color, inherit);
    padding: 0 4pt;
    border-radius: 3pt;
    transition: background 0.2s;
  }
  .icon-card .name-btn:hover code {
    background: color-mix(in srgb, currentColor 10%, transparent);
  }
  .icon-card .name-btn.copied code {
    color: var(--success-color, #4caf50);
  }
  .no-results {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1em;
    padding: 3em;
    text-align: center;
    color: var(--text-color, inherit);
  }
  pre {
    background: var(--code-bg, #f5f5f5);
    padding: 1em;
    border-radius: 8px;
    overflow-x: auto;
  }
</style>
