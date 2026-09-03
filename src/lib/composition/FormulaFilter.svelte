<script lang="ts">
  import { Icon } from 'svelte-widgets'
  import { is_modifier_chord } from 'svelte-widgets/utils'
  import { Circle, Close, Info, Lock, Star, Unlock } from 'svelte-widgets/icons'
  import { is_elem_symbol, type ElementSymbol } from '$lib/element'
  import { make_change_detector } from '$lib/utils'
  import { tooltip } from 'svelte-widgets/attachments'
  import {
    create_recent_list,
    storage_get_json,
    storage_set_json,
  } from 'svelte-widgets/storage'
  import { untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { format_amount, get_alphabetical_formula } from './format'
  import type { FormulaSearchMode } from './index'
  import {
    normalize_formula_unicode,
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
      description: `Materials containing these elements. Operators/ranges: +Li,-O,Fe:1-2. Use * for any element.`,
      examples: [`Li,Fe`, `+Li,-O`, `Li,*,*`],
    },
    {
      label: `Chemical system`,
      description: `Materials with only these elements (no others). Wildcards/ranges supported.`,
      examples: [`Li-Fe-O`, `Li-Fe-*-*`, `*-*-O`],
    },
    {
      label: `Exact formula`,
      description: `Materials with this exact stoichiometry. Unicode paste, wildcards, and canonicalization supported.`,
      examples: [`LiFePO4`, `LiFe*2*`, `*2O3`],
    },
  ]

  const has_wildcards = (input: string): boolean => input.includes(`*`)
  // Token separator per mode (exact formulas have none)
  const MODE_SEPARATOR: Record<FormulaSearchMode, string> = {
    elements: `,`,
    chemsys: `-`,
    exact: ``,
  }
  const MODE_CYCLE: FormulaSearchMode[] = [`elements`, `chemsys`, `exact`]
  const MODE_LABELS: Record<FormulaSearchMode, string> = {
    elements: `has elements`,
    chemsys: `chemical system`,
    exact: `exact formula`,
  }
  const PLACEHOLDERS: Record<FormulaSearchMode, string> = {
    elements: `Li,Fe,O or Li,*,*`,
    chemsys: `Li-Fe-O or Li-*-*`,
    exact: `LiFePO4 or LiFe*2*`,
  }

  let {
    value = $bindable(``),
    search_mode = $bindable(`elements`),
    input_element = $bindable(null),
    show_clear_button = true,
    show_examples = true,
    normalize_exact = true,
    examples = DEFAULT_SEARCH_EXAMPLES,
    disabled = false,
    mode_locked = $bindable(false),
    max_history = 5, // Max recent inputs to remember; 0 disables history dropdown
    history_key = `formula-filter-history`, // localStorage key for persisting history
    validate,
    on_parse,
    on_validation,
    on_change,
    on_clear,
    ...rest
  }: {
    value: string // Current filter value (normalized on blur/enter)
    search_mode?: FormulaSearchMode // Inferred search mode based on input format
    input_element?: HTMLInputElement | null // Reference to the input element for programmatic focus
    show_clear_button?: boolean // Show clear button when value is non-empty
    show_examples?: boolean // Show the help button and examples dropdown
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
    on_parse?: (parsed: FormulaFilterParseResult) => void
    on_validation?: (validation: FormulaFilterValidation) => void
    on_change?: (value: string, search_mode: FormulaSearchMode) => void // Callback when value changes
    on_clear?: () => void // Callback when clear button is clicked
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
  // Persisted MRU list (max_history=0 loads nothing, so the dropdown never opens and
  // storage is never written); pins live in a sibling key, ordered most recently pinned first
  const is_string = (entry: unknown): entry is string => typeof entry === `string`
  const recent = $derived(
    create_recent_list<string>({
      storage_key: history_key,
      max_items: max_history,
      key_of: (entry) => entry,
      is_valid: is_string,
    }),
  )
  const history_pins_key = $derived(`${history_key}-pins`)
  const load_pinned = (): string[] => {
    const parsed = storage_get_json(history_pins_key, [])
    return Array.isArray(parsed) ? parsed.filter(is_string) : []
  }
  const save_pinned = (entries: string[]) => storage_set_json(history_pins_key, entries)

  let history = $state<string[]>(untrack(() => recent.load()))
  let pinned_history = $state<string[]>(untrack(() => load_pinned()))
  // Live props: without reloading, entries read from the old key get written back under the
  // new one, and lowering max_history never truncates.
  const history_source_changed = make_change_detector()
  $effect(() => {
    if (!history_source_changed(`${history_key}:${max_history}`)) return
    history = recent.load()
    pinned_history = load_pinned()
    // The open dropdown still points into the OLD list: Enter reads
    // visible_history[focused_history_idx], so a shorter reload indexed undefined and crashed.
    history_query = ``
    focused_history_idx = -1
    if (history.length === 0) history_open = false
  })

  function add_to_history(entry: string): void {
    if (max_history <= 0 || !entry.trim()) return
    history = recent.remember(entry, history)
    // Keep pin state for retained entries only
    pinned_history = pinned_history.filter((item) => history.includes(item))
    save_pinned(pinned_history)
  }

  function remove_from_history(entry: string): void {
    history = recent.forget(entry, history)
    pinned_history = pinned_history.filter((item) => item !== entry)
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
    storage_set_json(history_key, history)
    save_pinned(pinned_history)
    close_history()
  }

  const is_pinned = (entry: string): boolean => pinned_history.includes(entry)

  // Filtered history: exclude current value to avoid redundant suggestion
  let visible_history = $derived.by(() => {
    const query = history_query.toLowerCase().trim()
    const filtered = history.filter(
      (item) => item !== value && item.toLowerCase().includes(query),
    )
    return [...filtered.filter(is_pinned), ...filtered.filter((item) => !is_pinned(item))]
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

  // Last value this component wrote or synced from the prop, so the effect below only reacts
  // to external changes (e.g. URL params) and re-infers the mode for those. Plain variable:
  // it is bookkeeping for the effect, not state anything renders from.
  let last_synced: string | null = null
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

  // Paste lands the text after the event, so normalising waits a frame. Held and cancelled for
  // the same reason the dropdown's frame below is: an unmount inside that frame otherwise
  // leaves the callback writing to a destroyed component.
  let paste_frame = 0
  $effect(() => () => cancelAnimationFrame(paste_frame))

  // Detect if dropdown would exit viewport on the right and adjust anchor. The frame is
  // cancelled on teardown: closing or unmounting within the same frame otherwise left the
  // callback to measure a dropdown that is on its way out and write state behind it.
  $effect(() => {
    if (!examples_open || !examples_wrapper) return undefined
    const frame = requestAnimationFrame(() => {
      const dropdown = examples_wrapper?.querySelector(
        `.examples-dropdown`,
      ) as HTMLElement | null
      if (!dropdown) return
      const rect = dropdown.getBoundingClientRect()
      if (rect.right > window.innerWidth && !anchor_left) anchor_left = true
    })
    return () => cancelAnimationFrame(frame)
  })

  // Infer search mode from input format: a leading +/-/! operator, any +/! or a comma means a
  // list of elements; a dash outside a range constraint ("Fe:1-2" has one inside) separates a
  // chemical system (Li-Fe-O, Fe:1-2-Li); a lone constraint (Fe:2) is still an element list;
  // anything else is an exact formula (LiFePO4)
  function infer_mode(input: string): FormulaSearchMode {
    const trimmed = input.trim()
    if (!trimmed || /^[-+!]|[+!,]/.test(trimmed)) return `elements`
    if (trimmed.replaceAll(/:\s*\d+-\d+/g, ``).includes(`-`)) return `chemsys`
    return trimmed.includes(`:`) ? `elements` : `exact`
  }

  // Parse error of an exact formula (with or without wildcards), null when it parses
  function exact_formula_error(input: string): string | null {
    const trimmed = input.trim()
    if (!trimmed) return null
    try {
      if (has_wildcards(trimmed)) parse_formula_with_wildcards(trimmed)
      else parse_formula(trimmed)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : `Invalid exact formula`
    }
  }

  // Canonical form of a valid exact formula: elements alphabetical with merged amounts,
  // wildcards trailing in source order (LiFe*2* -> FeLi*2*). Invalid input passes through.
  function normalize_exact_formula(input: string): string {
    if (exact_formula_error(input) !== null) return input
    // zero amounts (H0) parse but format to nothing; keep the text rather than clear the field
    if (!has_wildcards(input))
      return get_alphabetical_formula(input, { plain_text: true, delim: `` }) || input
    const tokens = parse_formula_with_wildcards(input)
    const merged = new Map<ElementSymbol, number>()
    for (const { element, amount } of tokens) {
      if (element) merged.set(element, (merged.get(element) ?? 0) + amount)
    }
    const with_amount = (symbol: string, amount: number) =>
      amount === 1 ? symbol : `${symbol}${format_amount(amount)}`
    const explicit_str = [...merged]
      .toSorted(([elem_a], [elem_b]) => elem_a.localeCompare(elem_b))
      .map(([element, amount]) => with_amount(element, amount))
      .join(``)
    const wildcard_str = tokens
      .filter((token) => token.element === null)
      .map((token) => with_amount(`*`, token.amount))
      .join(``)
    return `${explicit_str}${wildcard_str}`
  }

  // Amount constraints: a count, a range or a comparison (2, 1-2, >=3)
  const is_valid_constraint = (constraint: string): boolean =>
    /^(?:\d+|\d+-\d+|(?:>=|<=|>|<)\d+)$/.test(constraint)

  function serialize_token(
    token: Pick<FormulaFilterToken, `operator` | `element` | `constraint`>,
  ): string {
    const prefix = token.operator === `exclude` ? `-` : ``
    const suffix = token.constraint ? `:${token.constraint}` : ``
    return `${prefix}${token.element}${suffix}`
  }

  // Chip labels show an explicit + prefix for include tokens; serialized values omit it
  const token_chip_label = (
    token: Pick<FormulaFilterToken, `operator` | `element` | `constraint`>,
  ): string => (token.operator === `include` ? `+` : ``) + serialize_token(token)

  // `+Li`, `-O`, `!O`, `Fe:1-2`: an optional include/exclude operator, an element or `*`
  // wildcard, and an optional amount constraint
  function parse_token(raw_token: string): FormulaFilterToken {
    const token = raw_token.trim()
    const operator = /^[-!]/.test(token) ? `exclude` : `include`
    const [element_part, constraint_part] = token.replace(/^[-+!]/, ``).split(`:`)
    const element = element_part.trim()
    const is_wildcard = element === `*`
    const constraint = constraint_part?.trim() || null
    const is_valid =
      (is_wildcard || is_elem_symbol(element)) &&
      (constraint === null || is_valid_constraint(constraint))
    return { raw: raw_token, element, operator, constraint, is_wildcard, is_valid }
  }

  function tokenize_query(input: string, mode: FormulaSearchMode): FormulaFilterToken[] {
    const trimmed = input.trim()
    if (!trimmed) return []
    if (mode === `exact`) {
      return [
        {
          raw: trimmed,
          element: trimmed,
          operator: `include`,
          constraint: null,
          is_wildcard: has_wildcards(trimmed),
          is_valid: exact_formula_error(trimmed) === null,
        },
      ]
    }
    // chemsys also accepts commas; a dash followed by a digit is inside a range (Fe:1-2)
    const tokens =
      mode === `chemsys` ? trimmed.replaceAll(`,`, `-`).split(/-(?!\d)/) : trimmed.split(`,`)
    return tokens
      .map((token) => token.trim())
      .filter(Boolean)
      .map(parse_token)
  }

  // Valid tokens serialized in canonical order: includes before excludes, wildcards last,
  // elements alphabetical
  function normalize_tokenized_input(input: string, mode: FormulaSearchMode): string {
    return tokenize_query(input, mode)
      .filter((token) => token.is_valid)
      .toSorted(
        (token_a, token_b) =>
          Number(token_a.operator === `exclude`) - Number(token_b.operator === `exclude`) ||
          Number(token_a.is_wildcard) - Number(token_b.is_wildcard) ||
          token_a.element.localeCompare(token_b.element),
      )
      .map(serialize_token)
      .join(MODE_SEPARATOR[mode])
  }

  function parse_query(query: string, mode: FormulaSearchMode): FormulaFilterParseResult {
    const tokens = tokenize_query(query, mode)
    const first_invalid_token = tokens.find((token) => !token.is_valid)
    const error_message =
      mode === `exact`
        ? exact_formula_error(query)
        : first_invalid_token
          ? `Invalid token: ${first_invalid_token.raw}`
          : null
    return {
      value: query,
      search_mode: mode,
      tokens,
      has_wildcards: tokens.some((token) => token.is_wildcard),
      is_valid: error_message === null,
      error_message,
    }
  }

  function run_validation(next_value: string, next_mode: FormulaSearchMode): void {
    const parsed = parse_query(next_value, next_mode)
    on_parse?.(parsed)

    const default_validation: FormulaFilterValidation = parsed.is_valid
      ? { state: `valid`, message: null }
      : { state: `invalid`, message: parsed.error_message ?? `Invalid filter query` }
    const custom_validation = validate?.(next_value, next_mode, parsed)
    validation = custom_validation ?? default_validation
    on_validation?.(validation)
  }

  // Distinct valid elements of any input format (formula, comma- or dash-separated list),
  // alphabetical, with one trailing `*` per wildcard. Invalid formulas yield nothing: an
  // invalid exact formula is committed verbatim and this runs on it from a $derived.
  function extract_elements(input: string): string[] {
    const trimmed = input.trim()
    if (!trimmed) return []
    if (/[-,]/.test(trimmed)) {
      const parts = trimmed.split(/[-,]/).map((part) => part.trim())
      const elements = [...new Set(parts.filter(is_elem_symbol))].toSorted()
      return [...elements, ...parts.filter((part) => part === `*`)]
    }
    try {
      const tokens = parse_formula_with_wildcards(trimmed)
      const elements = [...new Set(tokens.flatMap((token) => token.element ?? []))]
      return [
        ...elements.toSorted(),
        ...tokens.filter((tok) => tok.element === null).map(() => `*`),
      ]
    } catch {
      return []
    }
  }

  // Re-express the elements of `value` in another mode (exact mode drops the amounts)
  const format_for_mode = (input: string, mode: FormulaSearchMode): string =>
    extract_elements(input).join(MODE_SEPARATOR[mode])

  // Write a value and mode to every output: the input box, the bound props, validation and
  // on_change. last_synced keeps the prop-sync effect from re-inferring the mode for it.
  function commit(new_value: string, mode: FormulaSearchMode): void {
    last_synced = new_value
    value = new_value
    input_value = new_value
    search_mode = mode
    run_validation(new_value, mode)
    on_change?.(new_value, mode)
  }

  // elements -> chemsys -> exact -> elements, reformatting the current value on the way
  const mode_after = (mode: FormulaSearchMode): FormulaSearchMode =>
    MODE_CYCLE[(MODE_CYCLE.indexOf(mode) + 1) % MODE_CYCLE.length]

  function cycle_mode(): void {
    if (mode_locked) return
    const next_mode = mode_after(search_mode)
    commit(format_for_mode(value, next_mode), next_mode)
  }

  function set_value(new_value: string, forced_mode?: FormulaSearchMode): void {
    const mode = forced_mode ?? (mode_locked ? search_mode : infer_mode(new_value))
    if (new_value.trim()) add_to_history(new_value)
    close_history()
    commit(new_value, mode)
  }

  function sync_value(): void {
    const trimmed = normalize_formula_unicode(input_value)
    if (!trimmed) return set_value(``)

    const mode = mode_locked ? search_mode : infer_mode(trimmed)
    if (mode === `exact`) {
      const exact_value = normalize_exact ? normalize_exact_formula(trimmed) : trimmed
      return set_value(exact_value, mode)
    }

    if (!parse_query(trimmed, mode).is_valid) {
      // Preserve user input on invalid tokens instead of silently dropping them.
      input_value = trimmed
      run_validation(trimmed, mode)
      return
    }
    set_value(normalize_tokenized_input(trimmed, mode), mode)
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
      // Cmd/Ctrl+Arrow jumps within the input's text; only bare arrows walk history
    } else if (history_open && visible_history.length > 0 && !is_modifier_chord(event)) {
      const len = visible_history.length
      if (event.key === `ArrowDown`) {
        event.preventDefault()
        focused_history_idx = (focused_history_idx + 1) % len
      } else if (event.key === `ArrowUp`) {
        event.preventDefault()
        focused_history_idx = focused_history_idx <= 0 ? len - 1 : focused_history_idx - 1
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
    on_clear?.()
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
    // Enter/Space on a focused example button is that button's click, not menu navigation
    const is_button_activation =
      (event.key === `Enter` || event.key === ` `) && event.target instanceof HTMLButtonElement
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

  function remove_token(token_idx: number): void {
    if (search_mode === `exact`) return
    const tokens = tokenize_query(input_value, search_mode).filter(
      (_, idx) => idx !== token_idx,
    )
    set_value(tokens.map(serialize_token).join(MODE_SEPARATOR[search_mode]), search_mode)
  }

  // Focus the active menu item when index changes
  $effect(() => {
    if (!examples_open || focused_item_idx < 0) return
    const items = wrapper?.querySelectorAll<HTMLButtonElement>(`[data-example-item]`)
    items?.[focused_item_idx]?.focus({ preventScroll: true })
  })

  let parsed_tokens = $derived(tokenize_query(input_value, search_mode))
  // Preview of the next mode cycle step for the mode-hint tooltip
  let next_mode = $derived.by(() => {
    const next = mode_after(search_mode)
    return { mode: MODE_LABELS[next], value: format_for_mode(value, next) }
  })
</script>

<svelte:document onclick={handle_document_click} />

<div
  bind:this={wrapper}
  class:disabled
  class:invalid={validation.state === `invalid`}
  class:warning={validation.state === `warning`}
  {...rest}
  class={[`formula-filter`, rest.class]}
>
  <!-- Chips and validation live inside the root: as siblings they became separate grid/flex
       items in any host that lays filters out side by side -->
  <div class="filter-row">
    <!-- history items preventDefault their mousedown, so blur only fires when focus genuinely
    leaves (tab out, click outside); sync_value closes the history itself -->
    <input
      bind:this={input_element}
      bind:value={input_value}
      onblur={sync_value}
      onfocus={open_history}
      {oninput}
      onpaste={() => {
        cancelAnimationFrame(paste_frame)
        paste_frame = requestAnimationFrame(() => {
          input_value = normalize_formula_unicode(input_value)
          oninput()
        })
      }}
      {onkeydown}
      placeholder={PLACEHOLDERS[search_mode]}
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
                icon={is_pinned(entry) ? Star : Circle}
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
              <Icon icon={Close} style="width: 0.7em; height: 0.7em" />
            </button>
          </div>
        {/each}
      </div>
    {/if}
    {#if input_value}
      <button
        type="button"
        class={['mode-hint clickable', { locked: mode_locked }]}
        onclick={cycle_mode}
        title={mode_locked
          ? `Mode is locked`
          : `Click to switch to '${next_mode.mode}' → ${next_mode.value}`}
        {@attach tooltip()}
        aria-label="Change search mode"
      >
        {MODE_LABELS[search_mode]}
      </button>
    {/if}
    {#if !disabled}
      <button
        type="button"
        class={['icon-btn lock-btn', { active: mode_locked }]}
        onclick={() => (mode_locked = !mode_locked)}
        title={mode_locked ? `Unlock mode inference` : `Lock current mode`}
        {@attach tooltip()}
        aria-label={mode_locked ? `Unlock mode` : `Lock mode`}
      >
        <Icon icon={mode_locked ? Lock : Unlock} style="width: 1em; height: 1em" />
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
        <Icon icon={Close} style="width: 1em; height: 1em" />
      </button>
    {/if}
    {#if show_examples && !disabled}
      <div bind:this={examples_wrapper} style="position: relative">
        <button
          type="button"
          class={['icon-btn help-btn', { active: examples_open }]}
          onclick={toggle_examples}
          title="Show search examples"
          aria-label="Show search examples"
          aria-expanded={examples_open}
          aria-haspopup="menu"
        >
          <Icon icon={Info} style="width: 1.1em; height: 1.1em" />
        </button>
        {#if examples_open}
          <div
            class={['examples-dropdown', { 'anchor-left': anchor_left }]}
            role="menu"
            tabindex="-1"
            onkeydown={handle_menu_keydown}
          >
            {#each examples as category (category.label)}
              <div class="example-category">
                <div class="category-label">{category.label}:</div>
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
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
  {#if search_mode !== `exact` && parsed_tokens.length > 0}
    <div class="token-chip-row">
      {#each parsed_tokens as token, idx (`${token.operator}:${token.element}:${token.constraint ?? ``}:${idx}`)}
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
</div>

<style>
  .formula-filter {
    min-width: 0;
    &.disabled {
      opacity: 0.5;
      pointer-events: none;
    }
  }
  .filter-row {
    position: relative; /* anchors the history dropdown to the input row, not the chips */
    display: flex;
    align-items: center;
    gap: var(--formula-filter-gap, 1pt);
    padding: var(--formula-filter-padding, 4pt 8pt);
    border-radius: var(--formula-filter-border-radius, var(--border-radius, 3pt));
    background: var(--formula-filter-bg, rgba(128, 128, 128, 0.05));
    transition: background 0.15s;
    /* validation state lives on the .formula-filter root, the row's direct parent */
    .invalid > & {
      outline: 1px solid rgba(239, 68, 68, 0.65);
      background: rgba(239, 68, 68, 0.08);
    }
    .warning > & {
      outline: 1px solid rgba(245, 158, 11, 0.6);
      background: rgba(245, 158, 11, 0.08);
    }
    &:focus-within {
      background: rgba(77, 182, 255, 0.08);
    }
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
    &::placeholder {
      opacity: 0.4;
    }
    /* iOS Safari zooms the page when a focused input's font is below 16px */
    @media (pointer: coarse) {
      font-size: 16px;
    }
  }
  .mode-hint {
    opacity: 0.5;
    white-space: nowrap;
    &.clickable {
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
      transition:
        opacity 0.15s,
        background 0.15s;
      &:hover {
        opacity: 1;
        background: rgba(77, 182, 255, 0.2);
        border-color: rgba(77, 182, 255, 0.4);
      }
      &.locked {
        cursor: not-allowed;
        opacity: 0.5;
      }
    }
  }
  :is(.icon-btn, .history-remove, .history-pin) {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    padding: 3pt;
    border-radius: 50%;
    color: inherit;
  }
  .icon-btn {
    opacity: 0.4;
    &:hover {
      opacity: 1;
      background: rgba(128, 128, 128, 0.15);
    }
    &.active {
      opacity: 1;
      color: var(--highlight, #4db6ff);
    }
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
    &:hover {
      opacity: 1;
    }
  }
  .history-item {
    display: flex;
    align-items: center;
    padding: 0 4pt 0 0;
    &:is(.focused, :hover) {
      background: rgba(77, 182, 255, 0.08);
    }
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
  .history-remove,
  .history-pin {
    opacity: 0.3;
    &:hover {
      opacity: 0.8;
      background: rgba(128, 128, 128, 0.15);
    }
  }
  .history-remove {
    min-width: 24px;
    min-height: 24px;
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
    &.anchor-left {
      right: auto;
      left: 0;
    }
  }
  .example-category {
    display: flex;
    align-items: center;
    gap: 4pt 6pt;
    flex-wrap: wrap;
  }
  .category-label {
    font-size: 0.75em;
    font-weight: 600;
    opacity: 0.6;
    min-width: 115px;
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
    &:hover {
      background: rgba(77, 182, 255, 0.2);
      border-color: rgba(77, 182, 255, 0.5);
    }
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
    &.exclude {
      border-color: rgba(239, 68, 68, 0.35);
      background: rgba(239, 68, 68, 0.12);
    }
    &.invalid {
      border-color: rgba(239, 68, 68, 0.65);
    }
  }
  .validation-message {
    margin-top: 4pt;
    font-size: 0.74em;
    opacity: 0.75;
    &.invalid {
      color: rgb(239, 68, 68);
      opacity: 0.95;
    }
  }
  @media (max-width: 700px) {
    :is(.icon-btn, .history-remove, .history-pin) {
      min-width: 32px;
      min-height: 32px;
    }
    .icon-btn {
      padding: 5pt;
    }
    .history-value {
      padding: 6pt 10pt;
    }
    /* token chips double as remove buttons; 19px tall is too thin for a finger */
    .token-chip {
      min-height: 28px;
    }
  }
</style>
