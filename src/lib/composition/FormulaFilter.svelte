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
        { value: `Si,O`, mode: `elements` },
        { value: `Mn,Co,Ni`, mode: `elements` },
      ],
    },
    {
      label: `Chemical system`,
      description: `Materials with only these elements (no others)`,
      examples: [
        { value: `Li-Fe-O`, mode: `chemsys` },
        { value: `Si-O`, mode: `chemsys` },
        { value: `Na-Cl`, mode: `chemsys` },
      ],
    },
    {
      label: `Exact formula`,
      description: `Materials with this exact stoichiometry`,
      examples: [
        { value: `LiFePO4`, mode: `exact` },
        { value: `SiO2`, mode: `exact` },
        { value: `NaCl`, mode: `exact` },
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
    onclear?: () => void // Callback when clear button is clicked (fires before onchange)
  } & HTMLAttributes<HTMLDivElement> = $props()

  // eslint-disable-next-line svelte/prefer-writable-derived -- need both external sync and local edits
  let input_value = $state(value)
  let examples_open = $state(false)
  let wrapper: HTMLDivElement | null = $state(null)
  let focused_item_idx = $state(-1)

  // Flatten examples for keyboard navigation
  type Example = (typeof SEARCH_EXAMPLES)[number][`examples`][number]
  const all_examples: Example[] = SEARCH_EXAMPLES.flatMap((cat) => [...cat.examples])

  function handle_document_click(event: MouseEvent): void {
    if (!wrapper) return
    const target = event.target
    if (!(target instanceof Node)) return
    if (!wrapper.contains(target)) close_examples()
  }

  // Close dropdown and restore focus to input for keyboard/screen-reader users
  function close_examples(): void {
    examples_open = false
    focused_item_idx = -1
    input_element?.focus()
  }

  $effect(() => {
    input_value = value
  })

  function set_value(new_value: string): void {
    value = input_value = new_value
    onchange?.(value, search_mode)
  }

  function sync_value(): void {
    const trimmed = input_value.trim()
    if (!trimmed) return set_value(``)
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
      else if (input_value) clear_filter()
    }
  }

  function clear_filter(): void {
    onclear?.()
    set_value(``)
  }

  function apply_example(
    ex: (typeof SEARCH_EXAMPLES)[number][`examples`][number],
  ): void {
    search_mode = ex.mode as FormulaSearchMode
    set_value(ex.value)
    close_examples()
  }

  function toggle_examples(): void {
    examples_open = !examples_open
    focused_item_idx = examples_open ? 0 : -1
  }

  function handle_menu_keydown(event: KeyboardEvent): void {
    const len = all_examples.length
    if (!len) return
    // Let button's native click handle Enter/Space to avoid double apply_example
    const is_button_activation = (event.key === `Enter` || event.key === ` `) &&
      event.target instanceof HTMLButtonElement
    if (is_button_activation) return

    const key_actions: Record<string, () => void> = {
      ArrowDown: () => (focused_item_idx = (focused_item_idx + 1) % len),
      ArrowUp: () => (focused_item_idx = (focused_item_idx - 1 + len) % len),
      Home: () => (focused_item_idx = 0),
      End: () => (focused_item_idx = len - 1),
      Escape: close_examples,
    }

    if (event.key in key_actions) {
      event.preventDefault()
      key_actions[event.key]()
    }
  }

  // Focus the active menu item when index changes
  $effect(() => {
    if (!examples_open || focused_item_idx < 0) return
    const items = wrapper?.querySelectorAll<HTMLButtonElement>(`[data-example-item]`)
    items?.[focused_item_idx]?.focus()
  })

  let placeholder = $derived(
    { exact: `NbZr2`, chemsys: `Nb-Zr`, elements: `Nb,Zr` }[search_mode],
  )
</script>

<svelte:document onclick={handle_document_click} />

<div class="formula-filter-wrapper" bind:this={wrapper} class:disabled {...rest}>
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
      <div class="examples-wrapper">
        <button
          type="button"
          class="icon-btn help-btn"
          class:active={examples_open}
          onclick={toggle_examples}
          title="Show search examples"
          aria-label="Show search examples"
          aria-expanded={examples_open}
          aria-haspopup="menu"
        >
          <Icon icon="Info" style="width: 20px; height: 20px" />
        </button>
        {#if examples_open}
          <div
            class="examples-dropdown"
            role="menu"
            tabindex="-1"
            onkeydown={handle_menu_keydown}
          >
            {#each SEARCH_EXAMPLES as category (category.label)}
              <div class="example-category">
                <div class="category-label">{category.label}:</div>
                <div class="example-tags">
                  {#each category.examples as example (example.value)}
                    <button
                      type="button"
                      class="example-tag"
                      data-example-item
                      onclick={() => apply_example(example)}
                      title={category.description}
                      role="menuitem"
                      tabindex="-1"
                    >
                      {example.value}
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
    {#if show_mode_selector}
      <select bind:value={search_mode} {disabled} aria-label="Search mode">
        <option value="elements">Contains elements</option>
        <option value="chemsys">Chemical system</option>
        <option value="exact">Exact formula</option>
      </select>
    {/if}
  </label>
</div>

<style>
  .formula-filter-wrapper {
    position: relative;
  }
  .formula-filter-wrapper.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  .filter-group {
    display: flex;
    gap: 5pt;
    align-items: center;
    min-width: 0;
    padding: 4pt 8pt;
    border-radius: 6px;
    transition: all 0.15s;
    background: var(--filter-bg, rgba(128, 128, 128, 0.05));
  }
  .filter-group.active {
    background: rgba(77, 182, 255, 0.08);
  }
  .filter-group span {
    white-space: nowrap;
  }
  .filter-group input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: inherit;
    padding: 2pt 0;
    outline: none;
    font-family: var(--mono-font, monospace);
  }
  .filter-group input::placeholder {
    opacity: 0.4;
  }
  .filter-group select {
    border: 1px solid rgba(128, 128, 128, 0.2);
    background: rgba(0, 0, 0, 0.15);
    color: inherit;
    font-size: 0.8em;
    padding: 3pt 5pt;
    border-radius: 4px;
    cursor: pointer;
  }
  .filter-group select:focus {
    outline: none;
    border-color: var(--highlight, #4db6ff);
  }
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4pt;
    border-radius: 50%;
    color: inherit;
    opacity: 0.5;
  }
  .icon-btn:hover {
    opacity: 1;
    background: rgba(128, 128, 128, 0.15);
  }
  .icon-btn.active {
    opacity: 1;
    color: var(--highlight, #4db6ff);
  }
  .examples-wrapper {
    position: relative;
  }
  .examples-dropdown {
    position: absolute;
    top: calc(100% + 4pt);
    right: 0;
    z-index: 100;
    width: max-content;
    background: var(--dropdown-bg, var(--surface-bg, #fff));
    border: 1px solid var(--dropdown-border, rgba(128, 128, 128, 0.2));
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 8pt;
    display: flex;
    flex-direction: column;
    gap: 6pt;
  }
  .example-category {
    display: flex;
    align-items: center;
    gap: 6pt;
    flex-wrap: wrap;
  }
  .category-label {
    font-size: 0.75em;
    font-weight: 600;
    text-transform: uppercase;
    opacity: 0.6;
    min-width: 115px;
  }
  .example-tags {
    display: flex;
    gap: 4pt;
    flex-wrap: wrap;
  }
  .example-tag {
    background: rgba(77, 182, 255, 0.1);
    border: 1px solid rgba(77, 182, 255, 0.3);
    border-radius: 4px;
    padding: 3pt 7pt;
    font-size: 0.82em;
    font-family: var(--mono-font, monospace);
    color: var(--highlight, #4db6ff);
    cursor: pointer;
  }
  .example-tag:hover {
    background: rgba(77, 182, 255, 0.2);
    border-color: rgba(77, 182, 255, 0.5);
  }
</style>
