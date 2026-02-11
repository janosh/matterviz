<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import { get_alphabetical_formula } from '$lib/composition/format'
  import { ELEM_SYMBOLS } from '$lib/labels'
  import { tooltip } from 'svelte-multiselect'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { FormulaSearchMode } from './index'
  import {
    extract_formula_elements,
    has_wildcards,
    normalize_element_symbols,
    parse_formula,
    parse_formula_with_wildcards,
  } from './parse'

  type SearchExampleCategory = {
    label: string
    description: string
    examples: string[]
  }

  export type FormulaFilterToken = {
    raw: string
    element: string
    operator: `include` | `exclude`
    constraint: string | null
    is_wildcard: boolean
    is_valid: boolean
  }

  export type FormulaFilterParseResult = {
    value: string
    normalized_value: string
    search_mode: FormulaSearchMode
    tokens: FormulaFilterToken[]
    has_wildcards: boolean
    is_valid: boolean
    error_message: string | null
  }

  export type FormulaFilterValidation = {
    state: `valid` | `warning` | `invalid`
    message: string | null
  }

  const DEFAULT_SEARCH_EXAMPLES: SearchExampleCategory[] = [
    {
      label: `Has elements`,
      description:
        `Materials containing these elements. Operators/ranges: +Li,-O,Fe:1-2. Use * for any element.`,
      examples: [`Li,Fe`, `+Li,-O`, `Li,*,*`],
    },
    {
      label: `Chemical system`,
      description:
        `Materials with only these elements (no others). Wildcards/ranges supported.`,
      examples: [`Li-Fe-O`, `Li-Fe-*-*`, `*-*-O`],
    },
    {
      label: `Exact formula`,
      description:
        `Materials with this exact stoichiometry. Unicode paste, wildcards, and canonicalization supported.`,
      examples: [`LiFePO4`, `LiFe*2*`, `*2O3`],
    },
  ]

  const SUBSCRIPT_TO_ASCII: Record<string, string> = {
    [`\u2080`]: `0`,
    [`\u2081`]: `1`,
    [`\u2082`]: `2`,
    [`\u2083`]: `3`,
    [`\u2084`]: `4`,
    [`\u2085`]: `5`,
    [`\u2086`]: `6`,
    [`\u2087`]: `7`,
    [`\u2088`]: `8`,
    [`\u2089`]: `9`,
  }

  const SUPERSCRIPT_TO_ASCII: Record<string, string> = {
    [`\u2070`]: `0`,
    [`\u00B9`]: `1`,
    [`\u00B2`]: `2`,
    [`\u00B3`]: `3`,
    [`\u2074`]: `4`,
    [`\u2075`]: `5`,
    [`\u2076`]: `6`,
    [`\u2077`]: `7`,
    [`\u2078`]: `8`,
    [`\u2079`]: `9`,
    [`\u207A`]: `+`,
    [`\u207B`]: `-`,
  }

  let {
    value = $bindable(``),
    search_mode = $bindable(`elements`),
    input_element = $bindable(null),
    show_clear_button = true,
    show_examples = true,
    show_mode_lock = true,
    show_chip_editor = true,
    normalize_exact = true,
    examples = DEFAULT_SEARCH_EXAMPLES,
    disabled = false,
    mode_locked = $bindable(false),
    max_history = 5, // Max recent inputs to remember; 0 disables history dropdown
    history_key = `formula-filter-history`, // localStorage key for persisting history
    validate,
    onparse,
    on_validation,
    onchange,
    onclear,
    ...rest
  }: {
    value: string // Current filter value (normalized on blur/enter)
    search_mode?: FormulaSearchMode // Inferred search mode based on input format
    input_element?: HTMLInputElement | null // Reference to the input element for programmatic focus
    show_clear_button?: boolean // Show clear button when value is non-empty
    show_examples?: boolean // Show the help button and examples dropdown
    show_mode_lock?: boolean // Show mode lock toggle button
    show_chip_editor?: boolean // Show token chip editor for tokenized modes
    normalize_exact?: boolean // Canonicalize exact formulas on submit
    examples?: SearchExampleCategory[] // Override built-in search example categories
    disabled?: boolean // Disable all inputs
    mode_locked?: boolean // Prevent auto mode inference and mode cycling
    max_history?: number // Max recent inputs to remember; 0 disables history dropdown
    history_key?: string // localStorage key for persisting history
    validate?: (
      value: string,
      search_mode: FormulaSearchMode,
      parsed: FormulaFilterParseResult,
    ) => FormulaFilterValidation | null
    onparse?: (parsed: FormulaFilterParseResult) => void
    on_validation?: (validation: FormulaFilterValidation) => void
    onchange?: (value: string, search_mode: FormulaSearchMode) => void // Callback when value changes
    onclear?: () => void // Callback when clear button is clicked
  } & HTMLAttributes<HTMLDivElement> = $props()

  let input_value = $state(value)
  let examples_open = $state(false)
  let history_open = $state(false)
  let wrapper: HTMLDivElement | null = $state(null)
  let examples_wrapper: HTMLDivElement | null = $state(null)
  let focused_item_idx = $state(-1)
  let focused_history_idx = $state(-1)
  let anchor_left = $state(false)
  let history_query = $state(``)
  let validation = $state<FormulaFilterValidation>({ state: `valid`, message: null })

  // Flatten examples for keyboard navigation
  let all_examples = $derived(examples.flatMap((cat) => cat.examples))

  // === History Management ===
  const has_storage = typeof localStorage !== `undefined`
  const history_pins_key = $derived(`${history_key}-pins`)

  function load_history(): string[] {
    if (max_history <= 0 || !has_storage) return []
    try {
      const raw = localStorage.getItem(history_key)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((item): item is string => typeof item === `string`).slice(
        0,
        max_history,
      )
    } catch {
      return []
    }
  }

  function save_history(entries: string[]): void {
    if (max_history <= 0 || !has_storage) return
    try {
      localStorage.setItem(history_key, JSON.stringify(entries.slice(0, max_history)))
    } catch {
      // localStorage may be unavailable (e.g. private browsing)
    }
  }

  function load_pinned(): string[] {
    if (max_history <= 0 || !has_storage) return []
    try {
      const raw = localStorage.getItem(history_pins_key)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((item): item is string => typeof item === `string`)
    } catch {
      return []
    }
  }

  function save_pinned(entries: string[]): void {
    if (max_history <= 0 || !has_storage) return
    try {
      localStorage.setItem(history_pins_key, JSON.stringify(entries))
    } catch {
      // localStorage may be unavailable
    }
  }

  let history = $state<string[]>(load_history())
  let pinned_history = $state<string[]>(load_pinned())

  function add_to_history(entry: string): void {
    if (max_history <= 0 || !entry.trim()) return
    // Remove duplicate if present, then prepend
    const filtered = history.filter((item) => item !== entry)
    history = [entry, ...filtered].slice(0, max_history)
    // Keep pin state for retained entries only
    pinned_history = pinned_history.filter((item) => history.includes(item))
    save_history(history)
    save_pinned(pinned_history)
  }

  function remove_from_history(entry: string): void {
    history = history.filter((item) => item !== entry)
    pinned_history = pinned_history.filter((item) => item !== entry)
    save_history(history)
    save_pinned(pinned_history)
    // Clamp focused index to prevent out-of-bounds access on Enter
    if (history.length === 0) history_open = false
    else if (focused_history_idx >= visible_history.length) {
      focused_history_idx = visible_history.length - 1
    }
  }

  function toggle_pin_history(entry: string): void {
    pinned_history = pinned_history.includes(entry)
      ? pinned_history.filter((item) => item !== entry)
      : [entry, ...pinned_history.filter((item) => item !== entry)]
    save_pinned(pinned_history)
  }

  function clear_history(): void {
    history = []
    pinned_history = []
    save_history(history)
    save_pinned(pinned_history)
    close_history()
  }

  function is_pinned(entry: string): boolean {
    return pinned_history.includes(entry)
  }

  // Filtered history: exclude current value to avoid redundant suggestion
  let visible_history = $derived.by(() => {
    const filtered = history
      .filter((item) => item !== value)
      .filter((item) =>
        item.toLowerCase().includes(history_query.toLowerCase().trim())
      )
    const pinned = filtered.filter((item) => pinned_history.includes(item))
    const unpinned = filtered.filter((item) => !pinned_history.includes(item))
    return [...pinned, ...unpinned]
  })

  function close_history(): void {
    history_open = false
    history_query = ``
    focused_history_idx = -1
  }

  function open_history(): void {
    if (max_history <= 0 || visible_history.length === 0 || examples_open) return
    history_open = true
    history_query = ``
    focused_history_idx = -1
  }

  function handle_document_click(event: MouseEvent): void {
    if (!wrapper || (!examples_open && !history_open)) return
    const target = event.target
    if (!(target instanceof Node)) return
    if (!wrapper.contains(target)) {
      if (examples_open) close_examples()
      if (history_open) close_history()
    }
  }

  function close_examples(restore_focus = true): void {
    examples_open = false
    focused_item_idx = -1
    if (restore_focus) input_element?.focus({ preventScroll: true })
  }

  // Track last synced value to detect external changes (e.g. from URL params)
  // and re-infer mode accordingly. Without this, mode would only be set on first render.
  let last_synced = $state<string | null>(null)
  $effect(() => {
    if (value !== last_synced) {
      last_synced = value
      input_value = value
      if (value && !mode_locked) {
        const inferred = infer_mode(value)
        if (inferred !== search_mode) search_mode = inferred
      }
      run_validation(value, search_mode)
    }
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
    if (/^[+\-!]\s*\w/.test(trimmed)) return `elements`
    if (trimmed.includes(`+`) || trimmed.includes(`!`)) return `elements`
    if (trimmed.includes(`:`)) return trimmed.includes(`-`) ? `chemsys` : `elements`
    if (trimmed.includes(`,`)) return `elements` // Li,Fe,O → has elements
    if (trimmed.includes(`-`)) return `chemsys` // Li-Fe-O → chemical system
    return `exact` // LiFePO4 → exact formula
  }

  // Cycle through modes: elements → chemsys → exact → elements
  const MODE_CYCLE: FormulaSearchMode[] = [`elements`, `chemsys`, `exact`]

  function normalize_unicode_formula(input: string): string {
    let normalized = input
    for (const [subscript, ascii] of Object.entries(SUBSCRIPT_TO_ASCII)) {
      normalized = normalized.replaceAll(subscript, ascii)
    }
    for (const [superscript, ascii] of Object.entries(SUPERSCRIPT_TO_ASCII)) {
      normalized = normalized.replaceAll(superscript, ascii)
    }
    return normalized
      .replaceAll(`·`, ``)
      .replaceAll(`⋅`, ``)
      .replaceAll(`−`, `-`)
      .replace(/\s+/g, ``)
  }

  function normalize_exact_formula(input: string): string {
    const sanitized_input = normalize_unicode_formula(input.trim())
    if (!sanitize_exact_formula(sanitized_input).is_valid) return sanitized_input

    if (!has_wildcards(sanitized_input)) {
      const canonical = get_alphabetical_formula(sanitized_input, true, ``)
      return canonical || sanitized_input
    }

    try {
      const tokens = parse_formula_with_wildcards(sanitized_input)
      const explicit = tokens
        .filter((token) => token.element !== null)
        .map((token) => ({ element: token.element as string, count: token.count }))
      const wildcard_tokens = tokens.filter((token) => token.element === null)

      // Merge explicit element counts before sorting.
      const merged_explicit: Array<{ element: string; count: number }> = []
      for (const token of explicit) {
        const existing = merged_explicit.find((item) =>
          item.element === token.element
        )
        if (existing) existing.count += token.count
        else merged_explicit.push(token)
      }
      const sorted_explicit = merged_explicit.sort((elem_a, elem_b) =>
        elem_a.element.localeCompare(elem_b.element)
      )
      const wildcard_str = wildcard_tokens.map((token) =>
        token.count > 1 ? `*${token.count}` : `*`
      ).join(``)
      const explicit_str = sorted_explicit.map((token) =>
        token.count > 1 ? `${token.element}${token.count}` : token.element
      ).join(``)
      return `${explicit_str}${wildcard_str}`
    } catch {
      return sanitized_input
    }
  }

  function is_valid_constraint(constraint: string): boolean {
    if (!constraint) return true
    return /^\d+$/.test(constraint) || /^\d+-\d+$/.test(constraint) ||
      /^(>=|<=|>|<)\d+$/.test(constraint)
  }

  function strip_operator_prefix(
    token: string,
  ): { operator: FormulaFilterToken[`operator`]; value: string } {
    const operator = token.startsWith(`-`) || token.startsWith(`!`)
      ? `exclude`
      : `include`
    const value =
      token.startsWith(`+`) || token.startsWith(`-`) || token.startsWith(`!`)
        ? token.slice(1)
        : token
    return { operator, value }
  }

  function serialize_token(
    token: Pick<FormulaFilterToken, `operator` | `element` | `constraint`>,
  ): string {
    const prefix = token.operator === `exclude` ? `-` : ``
    const suffix = token.constraint ? `:${token.constraint}` : ``
    return `${prefix}${token.element}${suffix}`
  }

  function token_chip_label(
    token: Pick<FormulaFilterToken, `operator` | `element` | `constraint`>,
  ): string {
    const prefix = token.operator === `exclude` ? `-` : `+`
    const suffix = token.constraint ? `:${token.constraint}` : ``
    return `${prefix}${token.element}${suffix}`
  }

  function parse_token(raw_token: string): FormulaFilterToken {
    const token = raw_token.trim()
    const { operator, value: without_operator } = strip_operator_prefix(token)
    const [element_part, constraint] = without_operator.split(`:`)
    const element = element_part.trim()
    const is_wildcard = element === `*`
    const is_valid_element = is_wildcard ||
      ELEM_SYMBOLS.includes(element as (typeof ELEM_SYMBOLS)[number])
    const normalized_constraint = constraint?.trim() || null
    const is_valid = is_valid_element && (normalized_constraint === null ||
      is_valid_constraint(normalized_constraint))

    return {
      raw: raw_token,
      element,
      operator,
      constraint: normalized_constraint,
      is_wildcard,
      is_valid,
    }
  }

  function tokenize_query(
    input: string,
    mode: FormulaSearchMode,
  ): FormulaFilterToken[] {
    const trimmed = input.trim()
    if (!trimmed) return []
    if (mode === `exact`) {
      return [{
        raw: trimmed,
        element: trimmed,
        operator: `include`,
        constraint: null,
        is_wildcard: has_wildcards(trimmed),
        is_valid: sanitize_exact_formula(trimmed).is_valid,
      }]
    }
    const normalized = mode === `chemsys` ? trimmed.replaceAll(`,`, `-`) : trimmed
    const tokens = mode === `chemsys`
      // Keep range constraints like Fe:1-2 intact while splitting token separators.
      ? normalized.split(/-(?!\d)/)
      : normalized.split(`,`)
    return tokens
      .map((token) => token.trim())
      .filter(Boolean)
      .map(parse_token)
  }

  function sanitize_exact_formula(
    input: string,
  ): { is_valid: boolean; error_message: string | null } {
    const trimmed = input.trim()
    if (!trimmed) return { is_valid: true, error_message: null }
    try {
      if (has_wildcards(trimmed)) {
        parse_formula_with_wildcards(trimmed)
      } else {
        parse_formula(trimmed)
      }
      return { is_valid: true, error_message: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : `Invalid exact formula`
      return { is_valid: false, error_message: message }
    }
  }

  function normalize_tokenized_input(input: string, mode: FormulaSearchMode): string {
    const separator = mode === `chemsys` ? `-` : `,`
    const parsed_tokens = tokenize_query(input, mode)
    if (parsed_tokens.length === 0) return ``

    const normalized_tokens = parsed_tokens
      .filter((token) => token.is_valid)
      .map((token) => ({
        ...token,
        element: token.is_wildcard
          ? `*`
          : normalize_element_symbols(token.element).at(0) || token.element,
      }))
      .sort((token_a, token_b) => {
        if (token_a.operator !== token_b.operator) {
          return token_a.operator === `include` ? -1 : 1
        }
        if (token_a.is_wildcard !== token_b.is_wildcard) {
          return token_a.is_wildcard ? 1 : -1
        }
        return token_a.element.localeCompare(token_b.element)
      })

    return normalized_tokens
      .map(serialize_token)
      .join(separator)
  }

  function parse_query(
    normalized_value: string,
    mode: FormulaSearchMode,
  ): FormulaFilterParseResult {
    const tokens = tokenize_query(normalized_value, mode)
    const first_invalid_token = tokens.find((token) => !token.is_valid)
    const exact_validation = mode === `exact`
      ? sanitize_exact_formula(normalized_value)
      : {
        is_valid: !first_invalid_token,
        error_message: first_invalid_token
          ? `Invalid token: ${first_invalid_token.raw}`
          : null,
      }
    return {
      value: normalized_value,
      normalized_value,
      search_mode: mode,
      tokens,
      has_wildcards: tokens.some((token) => token.is_wildcard),
      is_valid: exact_validation.is_valid,
      error_message: exact_validation.error_message,
    }
  }

  function run_validation(next_value: string, next_mode: FormulaSearchMode): void {
    const parsed = parse_query(next_value, next_mode)
    onparse?.(parsed)

    const default_validation: FormulaFilterValidation = parsed.is_valid
      ? { state: `valid`, message: null }
      : { state: `invalid`, message: parsed.error_message ?? `Invalid filter query` }
    const custom_validation = validate?.(next_value, next_mode, parsed)
    validation = custom_validation ?? default_validation
    on_validation?.(validation)
  }

  // Extract elements from any input format (formula, comma-separated, dash-separated)
  // Always returns elements in alphabetical order for consistency, preserving wildcards (*)
  function extract_elements(input: string): string[] {
    const trimmed = input.trim()
    if (!trimmed) return []
    // If contains commas or dashes, split by those and sort alphabetically
    if (trimmed.includes(`,`) || trimmed.includes(`-`)) {
      const parts = trimmed.split(/[-,]/).map((str) => str.trim()).filter(Boolean)
      // Separate wildcards from regular elements
      const wildcards = parts.filter((part) => part === `*`)
      const regular_parts = parts.filter((part) => part !== `*`)
      // Filter valid elements and sort alphabetically, then append wildcards
      const valid_elements = normalize_element_symbols(regular_parts.join(`,`)).sort()
      return [...valid_elements, ...wildcards]
    }
    // Otherwise parse as formula (already returns sorted by default)
    // For formulas with wildcards, we can't parse them normally
    if (has_wildcards(trimmed)) { // Use shared utility and extract unique elements
      const tokens = parse_formula_with_wildcards(trimmed)
      const unique_elements: string[] = []
      for (const token of tokens) {
        if (token.element !== null && !unique_elements.includes(token.element)) {
          unique_elements.push(token.element)
        }
      }
      const elements = unique_elements.sort()
      const wildcards = tokens.filter((token) => token.element === null).map(() =>
        `*`
      )
      return [...elements, ...wildcards]
    }
    try {
      return extract_formula_elements(trimmed, { sorted: true })
    } catch {
      return []
    }
  }

  // Format elements for the given mode
  function format_for_mode(elements: string[], mode: FormulaSearchMode): string {
    if (elements.length === 0) return ``
    if (mode === `elements`) return elements.join(`,`)
    if (mode === `chemsys`) return elements.join(`-`)
    // For exact mode, just join without separator (user will need to add counts)
    return elements.join(``)
  }

  function cycle_mode(): void {
    if (mode_locked) return
    const current_idx = MODE_CYCLE.indexOf(search_mode)
    const next_idx = (current_idx + 1) % MODE_CYCLE.length
    const next_mode = MODE_CYCLE[next_idx]

    // Extract elements from current value and reformat for new mode
    const elements = extract_elements(value)
    const reformatted = format_for_mode(elements, next_mode)

    search_mode = next_mode
    last_synced = value = input_value = reformatted // update last_synced to prevent effect re-inference
    run_validation(reformatted, next_mode)
    onchange?.(reformatted, next_mode)
  }

  function set_value(new_value: string, forced_mode?: FormulaSearchMode): void {
    const mode = forced_mode ?? (mode_locked ? search_mode : infer_mode(new_value))
    last_synced = value = input_value = new_value // update last_synced to prevent effect re-inference
    search_mode = mode
    if (new_value.trim()) add_to_history(new_value)
    close_history()
    run_validation(value, mode)
    onchange?.(value, mode)
  }

  function sync_value(): void {
    const trimmed = normalize_unicode_formula(input_value).trim()
    if (!trimmed) return set_value(``)

    const mode = mode_locked ? search_mode : infer_mode(trimmed)
    if (mode === `exact`) {
      const exact_value = normalize_exact ? normalize_exact_formula(trimmed) : trimmed
      return set_value(exact_value, mode)
    }

    const parsed = parse_query(trimmed, mode)
    if (!parsed.is_valid) {
      // Preserve user input on invalid tokens instead of silently dropping them.
      input_value = trimmed
      run_validation(trimmed, mode)
      return
    }

    const normalized = normalize_tokenized_input(trimmed, mode)
    set_value(normalized, mode)
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === `Enter`) {
      event.preventDefault()
      if (history_open && focused_history_idx >= 0) {
        set_value(visible_history[focused_history_idx])
      } else {
        sync_value()
      }
    } else if (event.key === `Escape`) {
      if (history_open) close_history()
      else if (examples_open) examples_open = false
      else if (input_value) clear_filter()
    } else if (history_open && visible_history.length > 0) {
      const len = visible_history.length
      if (event.key === `ArrowDown`) {
        event.preventDefault()
        focused_history_idx = (focused_history_idx + 1) % len
      } else if (event.key === `ArrowUp`) {
        event.preventDefault()
        focused_history_idx = focused_history_idx <= 0
          ? len - 1
          : focused_history_idx - 1
      }
    }
  }

  function oninput(): void {
    if (history_open) {
      history_query = input_value
      focused_history_idx = visible_history.length > 0 ? 0 : -1
    }
    const mode = mode_locked ? search_mode : infer_mode(input_value)
    run_validation(input_value, mode)
  }

  function clear_filter(): void {
    onclear?.()
    set_value(``)
  }

  function apply_example(example: string): void {
    set_value(example, mode_locked ? search_mode : infer_mode(example))
    close_examples()
  }

  function toggle_examples(event: MouseEvent): void {
    event.stopPropagation()
    close_history()
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

  function toggle_mode_lock(): void {
    mode_locked = !mode_locked
  }

  function remove_token(token_idx: number): void {
    if (search_mode === `exact`) return
    const separator = search_mode === `chemsys` ? `-` : `,`
    const tokens = tokenize_query(input_value, search_mode)
      .filter((_, idx) => idx !== token_idx)
    const next_value = tokens.map(serialize_token).join(separator)
    input_value = next_value
    set_value(next_value, search_mode)
  }

  // Focus the active menu item when index changes
  $effect(() => {
    if (!examples_open || focused_item_idx < 0) return
    const items = wrapper?.querySelectorAll<HTMLButtonElement>(`[data-example-item]`)
    items?.[focused_item_idx]?.focus({ preventScroll: true })
  })

  let placeholder = $derived(
    search_mode === `chemsys`
      ? `Li-Fe-O or Li-*-*`
      : search_mode === `exact`
      ? `LiFePO4 or LiFe*2*`
      : `Li,Fe,O or Li,*,*`,
  )

  const MODE_LABELS: Record<FormulaSearchMode, string> = {
    elements: `has elements`,
    chemsys: `chemical system`,
    exact: `exact formula`,
  }

  let mode_hint = $derived(MODE_LABELS[search_mode])
  let parsed_tokens = $derived(tokenize_query(input_value, search_mode))
  let show_chip_row = $derived(
    show_chip_editor && search_mode !== `exact` && parsed_tokens.length > 0,
  )
  // Preview of next mode cycle step for tooltip
  let next_mode = $derived.by(() => {
    const next = MODE_CYCLE[(MODE_CYCLE.indexOf(search_mode) + 1) % MODE_CYCLE.length]
    const mode = MODE_LABELS[next]
    const next_value = format_for_mode(extract_elements(value), next)
    return { mode, value: next_value }
  })
</script>

<svelte:document onclick={handle_document_click} />

<div
  class="formula-filter"
  bind:this={wrapper}
  class:disabled
  class:invalid={validation.state === `invalid`}
  class:warning={validation.state === `warning`}
  {...rest}
>
  <input
    bind:this={input_element}
    bind:value={input_value}
    onblur={() => {
      // mousedown preventDefault on history items prevents blur, so this only
      // fires when focus genuinely leaves (tab out, click outside, etc.)
      // sync_value → set_value → close_history, so no separate close needed
      sync_value()
    }}
    onfocus={open_history}
    {oninput}
    onpaste={() => {
      requestAnimationFrame(() => {
        input_value = normalize_unicode_formula(input_value)
        oninput()
      })
    }}
    {onkeydown}
    {placeholder}
    {disabled}
    aria-label="Formula filter"
  />
  {#if history_open && visible_history.length > 0}
    <div class="history-dropdown" role="listbox" aria-label="Recent searches">
      <div class="history-header-row">
        <span class="history-header">Recent</span>
        <button
          type="button"
          class="history-clear-all"
          title="Clear history"
          aria-label="Clear all history"
          onmousedown={(event) => {
            event.preventDefault()
            clear_history()
          }}
        >
          Clear
        </button>
      </div>
      {#each visible_history as entry, idx (entry)}
        <div class="history-item" class:focused={idx === focused_history_idx}>
          <button
            type="button"
            class="history-value"
            role="option"
            aria-selected={idx === focused_history_idx}
            onmousedown={(event) => {
              event.preventDefault()
              set_value(entry)
            }}
          >
            {entry}
          </button>
          <button
            type="button"
            class="history-pin"
            title={is_pinned(entry) ? `Unpin entry` : `Pin entry`}
            aria-label={is_pinned(entry) ? `Unpin ${entry}` : `Pin ${entry}`}
            onmousedown={(event) => {
              event.preventDefault()
              toggle_pin_history(entry)
            }}
          >
            <Icon
              icon={is_pinned(entry) ? `Star` : `Circle`}
              style="width: 0.8em; height: 0.8em"
            />
          </button>
          <button
            type="button"
            class="history-remove"
            title="Remove from history"
            aria-label="Remove {entry} from history"
            onmousedown={(event) => {
              event.preventDefault()
              remove_from_history(entry)
            }}
          >
            <Icon icon="Close" style="width: 0.7em; height: 0.7em" />
          </button>
        </div>
      {/each}
    </div>
  {/if}
  {#if input_value}
    <button
      type="button"
      class="mode-hint clickable"
      class:locked={mode_locked}
      onclick={cycle_mode}
      title={mode_locked
      ? `Mode is locked`
      : `Click to switch to '${next_mode.mode}' → ${next_mode.value}`}
      {@attach tooltip()}
      aria-label="Change search mode"
    >
      {mode_hint}
    </button>
  {/if}
  {#if show_mode_lock && !disabled}
    <button
      type="button"
      class="icon-btn lock-btn"
      class:active={mode_locked}
      onclick={toggle_mode_lock}
      title={mode_locked ? `Unlock mode inference` : `Lock current mode`}
      {@attach tooltip()}
      aria-label={mode_locked ? `Unlock mode` : `Lock mode`}
    >
      <Icon icon={mode_locked ? `Lock` : `Unlock`} style="width: 1em; height: 1em" />
    </button>
  {/if}
  {#if show_clear_button && value && !disabled}
    <button
      type="button"
      class="icon-btn clear-btn"
      onclick={clear_filter}
      title="Clear (Escape)"
      {@attach tooltip()}
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
          {#each examples as category (category.label)}
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
{#if show_chip_row}
  <div class="token-chip-row">
    {#each parsed_tokens as
      token,
      idx
      (`${token.operator}:${token.element}:${token.constraint ?? ``}:${idx}`)
    }
      <button
        type="button"
        class="token-chip"
        class:exclude={token.operator === `exclude`}
        class:invalid={!token.is_valid}
        onclick={() => remove_token(idx)}
        title="Click to remove token"
        aria-label="Remove token {token.raw}"
      >
        {token_chip_label(token)}
      </button>
    {/each}
  </div>
{/if}
{#if validation.message}
  <div class="validation-message" class:invalid={validation.state === `invalid`}>
    {validation.message}
  </div>
{/if}

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
  .formula-filter.invalid {
    outline: 1px solid rgba(239, 68, 68, 0.65);
    background: rgba(239, 68, 68, 0.08);
  }
  .formula-filter.warning {
    outline: 1px solid rgba(245, 158, 11, 0.6);
    background: rgba(245, 158, 11, 0.08);
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
    opacity: 0.5;
    white-space: nowrap;
  }
  .mode-hint.clickable {
    display: inline-flex;
    align-items: center;
    gap: 2pt;
    background: rgba(77, 182, 255, 0.1);
    border: 1px solid rgba(77, 182, 255, 0.25);
    border-radius: 4px;
    padding: 1pt 5pt;
    cursor: pointer;
    color: var(--highlight, #4db6ff);
    opacity: 0.8;
    transition: opacity 0.15s, background 0.15s;
  }
  .mode-hint.clickable:hover {
    opacity: 1;
    background: rgba(77, 182, 255, 0.2);
    border-color: rgba(77, 182, 255, 0.4);
  }
  .mode-hint.clickable.locked {
    cursor: not-allowed;
    opacity: 0.5;
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
  .history-dropdown {
    position: absolute;
    top: calc(100% + 2pt);
    left: 0;
    right: 0;
    z-index: 101;
    background: var(--dropdown-bg, var(--surface-bg, #fff));
    border: 1px solid var(--dropdown-border, rgba(128, 128, 128, 0.2));
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 4pt 0;
    display: flex;
    flex-direction: column;
  }
  .history-header {
    font-size: 0.7em;
    font-weight: 600;
    opacity: 0.45;
    padding: 2pt 10pt 4pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .history-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6pt;
    padding-right: 6pt;
  }
  .history-clear-all {
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 0.75em;
    opacity: 0.6;
  }
  .history-clear-all:hover {
    opacity: 1;
  }
  .history-item {
    display: flex;
    align-items: center;
    padding: 0 4pt 0 0;
  }
  .history-item.focused,
  .history-item:hover {
    background: rgba(77, 182, 255, 0.08);
  }
  .history-value {
    flex: 1;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4pt 10pt;
    font-family: var(--mono-font, monospace);
    font-size: 0.88em;
    color: inherit;
  }
  .history-remove {
    min-width: 24px;
    min-height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    padding: 3pt;
    border-radius: 50%;
    opacity: 0.3;
    color: inherit;
  }
  .history-pin {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    padding: 3pt;
    border-radius: 50%;
    opacity: 0.3;
    color: inherit;
  }
  .history-pin:hover {
    opacity: 0.8;
    background: rgba(128, 128, 128, 0.15);
  }
  .history-remove:hover {
    opacity: 0.8;
    background: rgba(128, 128, 128, 0.15);
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
  .token-chip-row {
    margin-top: 4pt;
    display: flex;
    flex-wrap: wrap;
    gap: 4pt;
  }
  .token-chip {
    border: 1px solid rgba(77, 182, 255, 0.35);
    background: rgba(77, 182, 255, 0.12);
    border-radius: 4px;
    font-family: var(--mono-font, monospace);
    font-size: 0.78em;
    padding: 2pt 6pt;
    cursor: pointer;
    color: inherit;
  }
  .token-chip.exclude {
    border-color: rgba(239, 68, 68, 0.35);
    background: rgba(239, 68, 68, 0.12);
  }
  .token-chip.invalid {
    border-color: rgba(239, 68, 68, 0.65);
  }
  .validation-message {
    margin-top: 4pt;
    font-size: 0.74em;
    opacity: 0.75;
  }
  .validation-message.invalid {
    color: rgb(239, 68, 68);
    opacity: 0.95;
  }
  @media (max-width: 700px) {
    .icon-btn {
      min-width: 28px;
      min-height: 28px;
      padding: 5pt;
    }
    .history-remove,
    .history-pin {
      min-width: 28px;
      min-height: 28px;
    }
    .history-value {
      padding: 6pt 10pt;
    }
  }
</style>
