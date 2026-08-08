<!-- SettingsSection now exists upstream. Delete this local copy and import it from
svelte-widgets once a version above 1.4.0 is published; its API is otherwise unchanged. -->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap } from 'svelte/reactivity'
  import { Icon } from 'svelte-widgets'
  import { Reset } from 'svelte-widgets/icons'

  type SettingMetadata = Readonly<
    Record<string, string | { readonly description: string } | undefined>
  >

  let {
    title,
    current_values = {},
    reset_values,
    children,
    layout = `flow`,
    on_reset,
    on_reset_key,
    setting_metadata,
    descriptions_open = $bindable(false),
    ...rest
  }: HTMLAttributes<HTMLElementTagNameMap[`section`]> & {
    title: string
    // Omit for a section that only holds actions (export buttons, say) and has nothing to diff.
    current_values?: Record<string, unknown>
    // Optional reset baseline. Only keys present in current_values are captured.
    reset_values?: Record<string, unknown>
    children: Snippet
    // `grid` puts every direct label/.setting row on one shared [label][value][wide] column
    // rhythm, so number inputs and sliders line up down the whole section instead of each
    // row's controls starting wherever its label text happens to end. `flow` leaves layout
    // to the caller (the historical behaviour).
    layout?: `flow` | `grid`
    // Omit to reset every changed key through `on_reset_key`. Pass one only for sections whose
    // reset has to do more than restore values (clearing validation state, for instance).
    on_reset?: () => void
    // Rows opt in with `data-key`. The callback receives the mounted reference value and
    // whether that key originally existed, so callers can restore or delete it exactly.
    on_reset_key?: (key: string, reference_value: unknown, reference_present: boolean) => void
    // Accepts SETTINGS_CONFIG directly as well as a compact key-to-description map.
    setting_metadata?: SettingMetadata
    descriptions_open?: boolean
  } = $props()

  // Create a deep copy of current_values on mount to use as reference values
  function deep_copy(obj: unknown): unknown {
    if (obj === null || typeof obj !== `object`) return obj
    if (obj instanceof Set || obj instanceof Map) {
      throw new TypeError(`SettingsSection values must not contain Set or Map instances`)
    }
    if (obj instanceof Date) return new Date(obj)
    if (obj instanceof RegExp) return new RegExp(obj)
    if (Array.isArray(obj)) return obj.map(deep_copy)
    const prototype = Object.getPrototypeOf(obj)
    if (prototype && prototype !== Object.prototype)
      throw new TypeError(`SettingsSection values must be plain objects`)
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, deep_copy(value)]),
    )
  }

  // Capture initial values once at mount - must NOT be $derived or it tracks changes
  const reference_values = untrack(() => {
    if (!reset_values) return deep_copy(current_values) as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(current_values)
        .filter((key) => Object.hasOwn(reset_values, key))
        .map((key) => [key, deep_copy(reset_values[key])]),
    )
  })

  // unique per-instance id so aria-labelledby stays valid with multiple sections on a page
  const section_id = $props.id()
  const title_id = `settings-section-title-${section_id}`

  // Order-independent deep equality for setting values
  const setting_equal = (left: unknown, right: unknown): boolean => {
    if (left === right || Object.is(left, right)) return true
    if (left == null || right == null) return false
    if (typeof left !== `object` || typeof right !== `object`) return false
    if (left instanceof Date || right instanceof Date)
      return (
        left instanceof Date && right instanceof Date && left.getTime() === right.getTime()
      )
    if (left instanceof RegExp || right instanceof RegExp)
      return left instanceof RegExp && right instanceof RegExp && `${left}` === `${right}`
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length)
        return false
      return left.every((item, idx) => setting_equal(item, right[idx]))
    }
    const left_obj = left as Record<string, unknown>
    const right_obj = right as Record<string, unknown>
    const left_keys = Object.keys(left_obj)
    if (left_keys.length !== Object.keys(right_obj).length) return false
    return left_keys.every(
      (key) => Object.hasOwn(right_obj, key) && setting_equal(left_obj[key], right_obj[key]),
    )
  }

  // Key presence is independent of value: additions/removals count even when the
  // value is undefined. Only compare values when both sides own the key.
  let changed_keys = $derived(
    Object.keys({ ...reference_values, ...current_values }).filter(
      (key) =>
        Object.hasOwn(reference_values, key) !== Object.hasOwn(current_values, key) ||
        !setting_equal(reference_values[key], current_values[key]),
    ),
  )
  let has_descriptions = $state(false)
  let refresh_rows = $state<(() => void) | undefined>()

  const reset_key = (key: string): void => {
    if (!on_reset_key || !changed_keys.includes(key)) return
    const reference_present = Object.hasOwn(reference_values, key)
    on_reset_key(key, deep_copy(reference_values[key]), reference_present)
  }

  function handle_reset(event: MouseEvent) {
    event.stopPropagation()
    event.preventDefault()
    if (on_reset) on_reset()
    // Iterating reads changed_keys once, which is what we want: the derived shrinks under us as
    // each reset_key hands the reference value back to the caller.
    else for (const key of changed_keys) reset_key(key)
  }

  function handle_descriptions_toggle(event: MouseEvent) {
    event.stopPropagation()
    event.preventDefault()
    descriptions_open = !descriptions_open
  }

  type EnhancedRow = {
    original_description: string | null
    description_element: HTMLElement | null
    reset_button: HTMLButtonElement | null
  }

  // A <label> only names its first control, so the slider paired with a number input would go
  // unnamed. Mark every control we name with the exact text used: that is enough to rename or
  // revoke it on a later pass without keeping a registry of elements, and it works on rows
  // Svelte has already detached.
  const auto_label_attr = `data-auto-label`

  const release_auto_label = (control: Element): void => {
    if (control.getAttribute(`aria-label`) === control.getAttribute(auto_label_attr)) {
      control.removeAttribute(`aria-label`)
    }
    control.removeAttribute(auto_label_attr)
  }

  // Enhance only explicitly keyed rows. Callers that omit both opt-in props never attach this
  // behavior, preserving the historical DOM and event handling.
  const enhance_rows = (section: HTMLElement): (() => void) => {
    const enhanced_rows = new SvelteMap<HTMLElement, EnhancedRow>()
    let refresh_queued = false
    let disposed = false

    const remove_reset_button = (row: HTMLElement, enhancement: EnhancedRow): void => {
      enhancement.reset_button?.remove()
      enhancement.reset_button = null
      row.classList.remove(`has-setting-reset`)
    }

    const cleanup_enhancement = (row: HTMLElement, enhancement: EnhancedRow): void => {
      enhancement.description_element?.remove()
      remove_reset_button(row, enhancement)
      for (const control of row.querySelectorAll(`[${auto_label_attr}]`)) {
        release_auto_label(control)
      }
      if (enhancement.original_description === null) {
        row.removeAttribute(`data-description`)
      } else {
        row.setAttribute(`data-description`, enhancement.original_description)
      }
    }

    const label_text = (row: HTMLLabelElement): string => {
      const label_copy = row.cloneNode(true) as HTMLElement
      for (const control of label_copy.querySelectorAll(
        `input, select, textarea, button, .settings-row-description`,
      )) {
        control.remove()
      }
      return (row.dataset.label ?? label_copy.textContent ?? ``)
        .replaceAll(/\s+/gu, ` `)
        .trim()
    }

    const sync_labelled_controls = (row: HTMLElement): void => {
      const label = row instanceof HTMLLabelElement ? label_text(row) : ``
      for (const control of row.querySelectorAll(`input, select, textarea`)) {
        const marker = control.getAttribute(auto_label_attr)
        const own_label = control.getAttribute(`aria-label`)
        // An author-set name always wins, whether it was there first or replaced ours
        if (
          marker === null &&
          (own_label !== null || control.hasAttribute(`aria-labelledby`))
        ) {
          continue
        }
        if (marker !== null && own_label !== marker) control.removeAttribute(auto_label_attr)
        else if (!label) release_auto_label(control)
        else if (marker !== label) {
          control.setAttribute(`aria-label`, label)
          control.setAttribute(auto_label_attr, label)
        }
      }
    }

    const enhance_row = (row: HTMLElement): boolean => {
      const key = row.dataset.key
      if (!key) return false
      let enhancement = enhanced_rows.get(row)
      if (!enhancement) {
        enhancement = {
          original_description: row.getAttribute(`data-description`),
          description_element: null,
          reset_button: null,
        }
        enhanced_rows.set(row, enhancement)
      }
      sync_labelled_controls(row)

      const metadata = setting_metadata?.[key]
      const mapped_description =
        typeof metadata === `string` ? metadata : metadata?.description
      if (mapped_description) row.setAttribute(`data-description`, mapped_description)
      else if (enhancement.original_description === null)
        row.removeAttribute(`data-description`)
      else row.setAttribute(`data-description`, enhancement.original_description)

      const description = mapped_description ?? enhancement.original_description ?? undefined
      if (descriptions_open && description) {
        if (!enhancement.description_element) {
          const description_element = document.createElement(`small`)
          description_element.className = `settings-row-description`
          enhancement.description_element = description_element
          row.append(description_element)
        }
        // Avoid notifying our own subtree observer forever: assigning textContent replaces
        // the text node even when the string is unchanged.
        if (enhancement.description_element.textContent !== description) {
          enhancement.description_element.textContent = description
        }
      } else {
        enhancement.description_element?.remove()
        enhancement.description_element = null
      }

      const needs_reset = Boolean(on_reset_key) && changed_keys.includes(key)
      if (!needs_reset) remove_reset_button(row, enhancement)
      else {
        if (!enhancement.reset_button) {
          const reset_button = document.createElement(`button`)
          reset_button.type = `button`
          reset_button.className = `setting-reset-button`
          reset_button.textContent = `↶`
          // Resolve the key at click time so a row that changes data-key needs no rewiring
          reset_button.addEventListener(`click`, (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (row.dataset.key) reset_key(row.dataset.key)
          })
          enhancement.reset_button = reset_button
          row.classList.add(`has-setting-reset`)
          row.append(reset_button)
        }
        enhancement.reset_button.setAttribute(`aria-label`, `Reset ${key} to default`)
        enhancement.reset_button.title = `Reset ${key} to default`
      }
      return Boolean(description)
    }

    const refresh = (): void => {
      if (disposed) return
      let found_description = false
      for (const row of section.querySelectorAll<HTMLElement>(`[data-key]`)) {
        found_description = enhance_row(row) || found_description
      }
      has_descriptions = found_description
      for (const [row, enhancement] of enhanced_rows) {
        if (!row.isConnected || !section.contains(row) || !row.dataset.key) {
          cleanup_enhancement(row, enhancement)
          enhanced_rows.delete(row)
        }
      }
    }

    const schedule_refresh = (): void => {
      if (refresh_queued) return
      refresh_queued = true
      queueMicrotask(() => {
        refresh_queued = false
        refresh()
      })
    }

    const observer = new MutationObserver(schedule_refresh)
    observer.observe(section, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [`data-key`, `data-label`],
    })
    refresh_rows = schedule_refresh
    untrack(refresh)

    return () => {
      disposed = true
      observer.disconnect()
      if (refresh_rows === schedule_refresh) refresh_rows = undefined
      for (const [row, enhancement] of enhanced_rows) cleanup_enhancement(row, enhancement)
      has_descriptions = false
    }
  }

  $effect(() => {
    // Track reactive inputs here so refreshing rows does not recreate the observer or its nodes.
    void [changed_keys, descriptions_open, setting_metadata]
    refresh_rows?.()
  })
</script>

<h4 id={title_id}>
  {title}

  {#if has_descriptions || changed_keys.length}
    <span class="heading-actions">
      {#if has_descriptions}
        <button
          type="button"
          class="description-toggle"
          onclick={handle_descriptions_toggle}
          aria-expanded={descriptions_open}
          aria-label="{descriptions_open
            ? `Hide`
            : `Show`} descriptions for {title.toLowerCase()}"
        >
          Explain
        </button>
      {/if}
      {#if changed_keys.length}
        <button
          type="button"
          class="reset-button"
          onclick={handle_reset}
          title="Reset {title.toLowerCase()} to defaults"
          aria-label="Reset {title.toLowerCase()} to defaults"
        >
          <Icon icon={Reset} style="width: 0.9em; height: 0.9em" />
          Reset
        </button>
      {/if}
    </span>
  {/if}
</h4>
<section
  {...rest}
  class={[`settings-section`, rest.class, layout]}
  aria-labelledby={title_id}
  {@attach on_reset_key || setting_metadata ? enhance_rows : null}
>
  {@render children()}
</section>

<style>
  h4 {
    margin: 0;
    position: relative;
  }
  :is(.reset-button, .description-toggle) {
    padding: var(--reset-btn-padding, 1pt 4pt);
    font-size: 0.65em;
    border-radius: var(--reset-btn-border-radius, var(--border-radius, 3pt));
    background: var(--btn-bg, rgba(0, 0, 0, 0.1));
    color: var(--text-color-muted, #6b7280);
    border: 1px solid var(--border-color, #d1d5db);
    cursor: pointer;
    box-shadow: none;
    opacity: 0.7;
  }
  :is(
    .reset-button:hover,
    .description-toggle:hover,
    .description-toggle[aria-expanded='true']
  ) {
    background: var(--btn-bg-hover, rgba(0, 0, 0, 0.2));
    color: var(--text-color, #374151);
    opacity: 1;
  }
  .reset-button {
    display: flex;
    align-items: center;
    gap: 2pt;
    transition: all 0.15s ease;
    &:hover {
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }
  }
  .heading-actions {
    position: absolute;
    top: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 3pt;
    z-index: 5;
  }
  section :global([data-key].has-setting-reset) {
    position: relative;
    padding-inline-end: 1.6em;
  }
  section :global(.setting-reset-button) {
    position: absolute;
    top: 50%;
    right: 1pt;
    translate: 0 -50%;
    display: grid;
    place-items: center;
    width: 1.35em;
    height: 1.35em;
    padding: 0;
    border: 0;
    border-radius: var(--border-radius, 3pt);
    background: transparent;
    color: var(--text-color-muted, #6b7280);
    font: inherit;
    line-height: 1;
    cursor: pointer;
    opacity: 0.65;
    &:hover,
    &:focus-visible {
      background: var(--btn-bg-hover, rgba(0, 0, 0, 0.15));
      color: var(--text-color, #374151);
      opacity: 1;
    }
  }
  section :global(.settings-row-description) {
    grid-column: 1 / -1;
    display: block;
    margin: 1pt 0 2pt;
    color: var(--text-color-muted, #6b7280);
    font-size: 0.78em;
    font-weight: 400;
    line-height: 1.3;
  }
  section.grid {
    display: grid;
    gap: var(--settings-row-gap, 4pt) 0;
    align-content: start;
  }
  /* Rows are [label] [value] [wide control]. A row holding a single control lets it span the
     last two tracks, so selects, sliders and swatches all begin on the same vertical line.
     --ctrl-cols is published so a pane can give the same rhythm to rows it nests one level
     deeper (grouped axis rows, say) without restating the track list. */
  section.grid > :global(:is(label, .setting)) {
    display: grid;
    grid-template-columns: var(
      --ctrl-cols,
      var(--ctrl-label-w, 8.5em) var(--ctrl-value-w, 4em) minmax(0, 1fr)
    );
    align-items: center;
    column-gap: var(--ctrl-gap, 7pt);
    min-height: 1.9em;
    margin: 0;
    /* the label cell truncates rather than wrapping the row onto a second line */
    > :global(:first-child) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    /* a row holding a single control lets it span the last two tracks */
    > :global(
      :nth-child(2):is(
        :last-child,
        :has(+ .settings-row-description),
        :has(+ .setting-reset-button)
      )
    ) {
      grid-column: 2 / -1;
    }
    /* fixed-size controls keep their size instead of stretching across their track */
    > :global(:is(input[type='color'], input[type='checkbox'])) {
      justify-self: start;
    }
    /* range inputs have an intrinsic width and will not stretch into their track on their own */
    > :global(input[type='range']) {
      width: 100%;
      min-width: 40px;
    }
  }
</style>
