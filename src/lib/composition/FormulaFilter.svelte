<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { FormulaSearchMode } from './index'
  import { normalize_element_symbols } from './parse'

  const SEARCH_EXAMPLES = [
    {
      label: `Contains elements`,
      description: `Materials containing at least these elements (may have others)`,
      examples: [`Li,Fe`, `Si,O`, `Mn,Co,Ni`],
    },
    {
      label: `Chemical system`,
      description: `Materials with only these elements (no others)`,
      examples: [`Li-Fe-O`, `Si-O`, `Na-Cl`],
    },
    {
      label: `Exact formula`,
      description: `Materials with this exact stoichiometry`,
      examples: [`LiFePO4`, `SiO2`, `NaCl`],
    },
  ] as const

  let {
    value = $bindable(``),
    search_mode = $bindable(`elements`),
    input_element = $bindable(null),
    show_clear_button = true,
    show_examples = true,
    disabled = false,
    onchange,
    onclear,
    ...rest
  }: {
    value: string // Current filter value (normalized on blur/enter)
    search_mode?: FormulaSearchMode // Inferred search mode based on input format
    input_element?: HTMLInputElement | null // Reference to the input element for programmatic focus
    show_clear_button?: boolean // Show clear button when value is non-empty
    show_examples?: boolean // Show the help button and examples dropdown
    disabled?: boolean // Disable all inputs
    onchange?: (value: string, search_mode: FormulaSearchMode) => void // Callback when value changes
    onclear?: () => void // Callback when clear button is clicked
  } & HTMLAttributes<HTMLDivElement> = $props()

  // eslint-disable-next-line svelte/prefer-writable-derived -- need both external sync and local edits
  let input_value = $state(value)
  let examples_open = $state(false)
  let wrapper: HTMLDivElement | null = $state(null)
  let examples_wrapper: HTMLDivElement | null = $state(null)
  let focused_item_idx = $state(-1)
  let anchor_left = $state(false)

  // Flatten examples for keyboard navigation
  const all_examples = SEARCH_EXAMPLES.flatMap((cat) => cat.examples)

  function handle_document_click(event: MouseEvent): void {
    if (!wrapper || !examples_open) return
    const target = event.target
    if (!(target instanceof Node)) return
    if (!wrapper.contains(target)) close_examples()
  }

  function close_examples(restore_focus = true): void {
    examples_open = false
    focused_item_idx = -1
    if (restore_focus) input_element?.focus({ preventScroll: true })
  }

  $effect(() => {
    input_value = value
  })

  // Detect if dropdown would exit viewport on the right and adjust anchor
  $effect(() => {
    if (!examples_open || !examples_wrapper) return
    requestAnimationFrame(() => {
      const dropdown = examples_wrapper?.querySelector(`.examples-dropdown`) as
        | HTMLElement
        | null
      if (!dropdown) return
      const rect = dropdown.getBoundingClientRect()
      if (rect.right > window.innerWidth && !anchor_left) anchor_left = true
    })
  })

  // Infer search mode from input format
  function infer_mode(input: string): FormulaSearchMode {
    const trimmed = input.trim()
    if (!trimmed) return `elements`
    if (trimmed.includes(`,`)) return `elements` // Li,Fe,O → contains elements
    if (trimmed.includes(`-`)) return `chemsys` // Li-Fe-O → chemical system
    return `exact` // LiFePO4 → exact formula
  }

  function set_value(new_value: string): void {
    const mode = infer_mode(new_value)
    value = input_value = new_value
    search_mode = mode
    onchange?.(value, mode)
  }

  function sync_value(): void {
    const trimmed = input_value.trim()
    if (!trimmed) return set_value(``)

    const mode = infer_mode(trimmed)
    if (mode === `exact`) return set_value(trimmed)

    // Normalize element symbols for elements/chemsys modes
    const separator = mode === `chemsys` ? `-` : `,`
    const normalized = normalize_element_symbols(trimmed.replace(/[-,]/g, `,`))
    set_value(normalized.join(separator))
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

  function apply_example(example: string): void {
    set_value(example)
    close_examples()
  }

  function toggle_examples(event: MouseEvent): void {
    event.stopPropagation()
    examples_open = !examples_open
    focused_item_idx = examples_open ? 0 : -1
    if (examples_open) anchor_left = false
  }

  function handle_menu_keydown(event: KeyboardEvent): void {
    const len = all_examples.length
    if (!len) return
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
    items?.[focused_item_idx]?.focus({ preventScroll: true })
  })

  // Cache inferred mode to avoid redundant computations
  let inferred_mode = $derived(infer_mode(input_value))

  let placeholder = $derived(
    inferred_mode === `chemsys`
      ? `Li-Fe-O`
      : inferred_mode === `exact`
      ? `LiFePO4`
      : `Li,Fe,O`,
  )

  let mode_hint = $derived(
    {
      elements: `contains elements`,
      chemsys: `chemical system`,
      exact: `exact formula`,
    }[inferred_mode],
  )
</script>

<svelte:document onclick={handle_document_click} />

<div class="formula-filter" bind:this={wrapper} class:disabled {...rest}>
  <input
    bind:this={input_element}
    bind:value={input_value}
    onblur={sync_value}
    {onkeydown}
    {placeholder}
    {disabled}
    aria-label="Formula filter"
  />
  {#if input_value}
    <span class="mode-hint">{mode_hint}</span>
  {/if}
  {#if show_clear_button && value && !disabled}
    <button
      type="button"
      class="icon-btn clear-btn"
      onclick={clear_filter}
      title="Clear (Escape)"
      aria-label="Clear filter"
    >
      <Icon icon="Close" style="width: 1em; height: 1em" />
    </button>
  {/if}
  {#if show_examples && !disabled}
    <div class="examples-wrapper" bind:this={examples_wrapper}>
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
        <Icon icon="Info" style="width: 1.1em; height: 1.1em" />
      </button>
      {#if examples_open}
        <div
          class="examples-dropdown"
          class:anchor-left={anchor_left}
          role="menu"
          tabindex="-1"
          onkeydown={handle_menu_keydown}
        >
          {#each SEARCH_EXAMPLES as category (category.label)}
            <div class="example-category">
              <div class="category-label">{category.label}:</div>
              <div class="example-tags">
                {#each category.examples as example (example)}
                  <button
                    type="button"
                    class="example-tag"
                    data-example-item
                    onclick={() => apply_example(example)}
                    title={category.description}
                    role="menuitem"
                    tabindex="-1"
                  >
                    {example}
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .formula-filter {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6pt;
    padding: 4pt 8pt;
    border-radius: 6px;
    background: var(--filter-bg, rgba(128, 128, 128, 0.05));
    transition: background 0.15s;
  }
  .formula-filter:focus-within {
    background: rgba(77, 182, 255, 0.08);
  }
  .formula-filter.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: inherit;
    padding: 2pt 0;
    outline: none;
    font-family: var(--mono-font, monospace);
  }
  input::placeholder {
    opacity: 0.4;
  }
  .mode-hint {
    font-size: 0.7em;
    opacity: 0.5;
    white-space: nowrap;
  }
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    padding: 3pt;
    border-radius: 50%;
    color: inherit;
    opacity: 0.4;
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
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 6pt;
  }
  .examples-dropdown.anchor-left {
    right: auto;
    left: 0;
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
