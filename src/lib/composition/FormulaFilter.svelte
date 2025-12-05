<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { FormulaSearchMode } from './index'
  import { normalize_element_symbols } from './parse'

  const SEARCH_EXAMPLES = [
    {
      label: `Contains elements`,
      description: `Materials containing at least these elements (may have others)`,
      examples: [
        { value: `Li,Fe`, mode: `elements` },
        { value: `Si,O,K`, mode: `elements` },
      ],
    },
    {
      label: `Chemical system`,
      description: `Materials with only these elements (no others)`,
      examples: [
        { value: `Li-Fe`, mode: `chemsys` },
        { value: `Si-O-K`, mode: `chemsys` },
      ],
    },
    {
      label: `Exact formula`,
      description: `Materials with this exact stoichiometry`,
      examples: [
        { value: `Li3Fe`, mode: `exact` },
        { value: `Eu2SiCl2O3`, mode: `exact` },
      ],
    },
  ] as const

  let {
    value = $bindable(``),
    search_mode = $bindable(`elements`),
    input_element = $bindable(null),
    show_mode_selector = true,
    show_clear_button = true,
    show_examples = true,
    label = `Formula/Elements`,
    title,
    disabled = false,
    onchange,
    onclear,
    ...rest
  }: {
    value: string // Current filter value (normalized on blur/enter)
    search_mode?: FormulaSearchMode // Search mode: 'elements' (comma-separated), 'chemsys' (hyphen-separated), 'exact' (formula)
    input_element?: HTMLInputElement | null // Reference to the input element for programmatic focus
    show_mode_selector?: boolean // Show the search mode dropdown selector
    show_clear_button?: boolean // Show clear button when value is non-empty
    show_examples?: boolean // Show the help button and examples dropdown
    label?: string // Label text for the filter
    title?: string // Tooltip title for the label
    disabled?: boolean // Disable all inputs
    onchange?: (value: string, search_mode: FormulaSearchMode) => void // Callback when value changes (after normalization)
    onclear?: () => void // Callback when clear button is clicked
  } & HTMLAttributes<HTMLDivElement> = $props()

  // eslint-disable-next-line svelte/prefer-writable-derived -- need both external sync and local edits
  let input_value = $state(value)
  let examples_open = $state(false)

  $effect(() => {
    input_value = value
  })

  function set_value(new_value: string): void {
    value = input_value = new_value
    onchange?.(value, search_mode)
  }

  function sync_value(): void {
    const trimmed = input_value.trim()
    if (search_mode === `exact`) return set_value(trimmed)
    const separator = search_mode === `chemsys` ? `-` : `,`
    set_value(normalize_element_symbols(trimmed.replace(/-/g, `,`)).join(separator))
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === `Enter`) {
      event.preventDefault()
      sync_value()
    } else if (event.key === `Escape`) {
      if (examples_open) examples_open = false
      else if (value) clear_filter()
    }
  }

  function clear_filter(): void {
    set_value(``)
    onclear?.()
  }

  function apply_example(
    ex: (typeof SEARCH_EXAMPLES)[number][`examples`][number],
  ): void {
    search_mode = ex.mode as FormulaSearchMode
    set_value(ex.value)
    examples_open = false
  }

  let placeholder = $derived(
    { exact: `NbZr2`, chemsys: `Nb-Zr`, elements: `Nb,Zr` }[search_mode],
  )
</script>

<svelte:document
  onclick={(ev) =>
  !(ev.target as HTMLElement).closest(`.formula-filter-wrapper`) &&
  (examples_open = false)}
/>

<div class="formula-filter-wrapper" class:disabled {...rest}>
  <label class="filter-group" class:active={Boolean(value)}>
    <span {title}>{label}</span>
    <input
      bind:this={input_element}
      bind:value={input_value}
      onblur={sync_value}
      {onkeydown}
      {placeholder}
      {disabled}
      style="flex: 1"
      aria-label={label}
    />
    {#if show_clear_button && value && !disabled}
      <button
        type="button"
        class="icon-btn clear-btn"
        onclick={clear_filter}
        title="Clear filter (Escape)"
        aria-label="Clear filter"
      >
        <Icon icon="Close" style="width: 14px; height: 14px" />
      </button>
    {/if}
    {#if show_examples && !disabled}
      <button
        type="button"
        class="icon-btn help-btn"
        class:active={examples_open}
        onclick={() => (examples_open = !examples_open)}
        title="Show search examples"
        aria-label="Show search examples"
        aria-expanded={examples_open}
      >
        <Icon icon="Info" style="width: 16px; height: 16px" />
      </button>
    {/if}
    {#if show_mode_selector}
      <select bind:value={search_mode} {disabled} aria-label="Search mode">
        <option value="elements">Contains elements</option>
        <option value="chemsys">Chemical system</option>
        <option value="exact">Exact formula</option>
      </select>
    {/if}
  </label>

  {#if examples_open}
    <div class="examples-dropdown" role="menu">
      <header>
        <strong>Search Examples</strong>
        <button
          type="button"
          class="icon-btn close-btn"
          onclick={() => (examples_open = false)}
          aria-label="Close examples"
        >
          <Icon icon="Close" style="width: 12px; height: 12px" />
        </button>
      </header>

      {#each SEARCH_EXAMPLES as category (category.label)}
        <div class="example-category">
          <div class="category-label">{category.label}:</div>
          <div class="example-pills">
            {#each category.examples as example (example.value)}
              <button
                type="button"
                class="example-pill"
                onclick={() => apply_example(example)}
                title={category.description}
              >
                {example.value}
              </button>
            {/each}
          </div>
        </div>
      {/each}

      <footer><small>Click an example to apply it</small></footer>
    </div>
  {/if}
</div>

<style>
  .formula-filter-wrapper {
    position: relative;
    display: flex;
    flex-direction: column;
  }
  .formula-filter-wrapper.disabled {
    opacity: 0.6;
    pointer-events: none;
  }
  .filter-group {
    display: flex;
    gap: 8pt;
    border-radius: 4px;
    transition: all 0.2s;
    padding: 1pt 3pt;
    border: 1px solid transparent;
    place-items: center;
    min-width: 0;
  }
  .filter-group.active {
    background-color: var(--active-filter-bg, rgba(77, 182, 255, 0.1));
    border-color: var(--active-filter-border, rgba(77, 182, 255, 0.4));
  }
  .filter-group input,
  .filter-group select {
    min-width: 0;
  }
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2pt;
    border-radius: 3px;
    color: inherit;
    opacity: 0.6;
    transition: opacity 0.15s, background-color 0.15s;
  }
  .icon-btn:hover {
    opacity: 1;
    background-color: rgba(128, 128, 128, 0.2);
  }
  .icon-btn:focus-visible {
    outline: 2px solid var(--highlight, #4db6ff);
    outline-offset: 1px;
  }
  .icon-btn.active {
    opacity: 1;
    color: var(--highlight, #4db6ff);
  }
  .examples-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4pt;
    background: var(--dropdown-bg, var(--surface-bg, #1a1a2e));
    border: 1px solid var(--dropdown-border, rgba(128, 128, 128, 0.3));
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    z-index: 100;
    padding: 10pt;
    display: flex;
    flex-direction: column;
    gap: 10pt;
    min-width: 280px;
    animation: dropdown-fade-in 0.15s ease-out;
  }
  @keyframes dropdown-fade-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .examples-dropdown header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 6pt;
    border-bottom: 1px solid rgba(128, 128, 128, 0.2);
  }
  .examples-dropdown header strong {
    font-size: 0.9em;
    color: var(--text-primary, #fff);
  }
  .close-btn {
    opacity: 0.5;
    padding: 3pt;
  }
  .close-btn:hover {
    opacity: 1;
  }
  .example-category {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6pt;
  }
  .category-label {
    font-size: 0.8em;
    font-weight: 500;
    color: var(--text-secondary, rgba(255, 255, 255, 0.7));
    min-width: 130px;
  }
  .example-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 6pt;
  }
  .example-pill {
    background: var(--pill-bg, rgba(77, 182, 255, 0.1));
    border: 1px solid var(--pill-border, rgba(77, 182, 255, 0.3));
    border-radius: 4px;
    padding: 3pt 8pt;
    font-size: 0.85em;
    font-family: var(--mono-font, ui-monospace, monospace);
    color: var(--highlight, #4db6ff);
    cursor: pointer;
    transition: all 0.15s;
  }
  .example-pill:hover {
    background: var(--pill-hover-bg, rgba(77, 182, 255, 0.2));
    border-color: var(--pill-hover-border, rgba(77, 182, 255, 0.5));
    transform: translateY(-1px);
  }
  .example-pill:active {
    transform: translateY(0);
  }
  .examples-dropdown footer {
    padding-top: 6pt;
    border-top: 1px solid rgba(128, 128, 128, 0.2);
  }
  .examples-dropdown footer small {
    font-size: 0.75em;
    color: var(--text-tertiary, rgba(255, 255, 255, 0.5));
  }
</style>
