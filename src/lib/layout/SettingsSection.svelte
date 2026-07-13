<script lang="ts">
  import Icon from '$lib/Icon.svelte'
  import type { Snippet } from 'svelte'
  import { untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    title,
    current_values,
    children,
    on_reset = () => {},
    ...rest
  }: HTMLAttributes<HTMLElementTagNameMap[`section`]> & {
    title: string
    current_values: Record<string, unknown>
    children: Snippet<
      [
        {
          current_values: Record<string, unknown>
          has_changes: boolean
          reference_values: Record<string, unknown>
        },
      ]
    >
    on_reset?: () => void
  } = $props()

  // Create a deep copy of current_values on mount to use as reference values
  function deep_copy(obj: unknown): unknown {
    if (obj === null || typeof obj !== `object`) return obj
    if (obj instanceof Date) return new Date(obj)
    if (obj instanceof RegExp) return new RegExp(obj)
    if (Array.isArray(obj)) return obj.map(deep_copy)
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, deep_copy(value)]),
    )
  }

  // Capture initial values once at mount - must NOT be $derived or it tracks changes
  const reference_values = untrack(() => deep_copy(current_values) as Record<string, unknown>)

  // unique per-instance id so aria-labelledby stays valid with multiple sections on a page
  const title_id = `settings-section-title-${crypto.randomUUID()}`

  // Check if any values have changed from reference values
  // Deep comparison for arrays (JSON.stringify fallback for nested objects/arrays)
  // Symmetric deep equality so object/array settings compare by value, not reference.
  // Settings values are JSON-serializable (primitives, arrays, plain objects).
  const setting_equal = (left: unknown, right: unknown): boolean =>
    Object.is(left, right) ||
    (left != null &&
      right != null &&
      typeof left === `object` &&
      typeof right === `object` &&
      JSON.stringify(left) === JSON.stringify(right))

  // Keys added to either side count as changes
  let has_changes = $derived.by(() =>
    [...new Set([...Object.keys(reference_values), ...Object.keys(current_values)])].some(
      (key) => !setting_equal(reference_values[key], current_values[key]),
    ),
  )
  function handle_reset(event: MouseEvent) {
    event.stopPropagation()
    event.preventDefault()
    on_reset()
  }
</script>

<h4 id={title_id}>
  {title}

  {#if has_changes}
    <button
      class="reset-button"
      onclick={handle_reset}
      title="Reset {title.toLowerCase()} to defaults"
      aria-label="Reset {title.toLowerCase()} to defaults"
    >
      <Icon icon="Reset" style="width: 0.9em; height: 0.9em" />
      Reset
    </button>
  {/if}
</h4>
<section {...rest} aria-labelledby={title_id}>
  {@render children?.({ current_values, has_changes, reference_values })}
</section>

<style>
  h4 {
    margin: 0;
    position: relative;
  }
  .reset-button {
    position: absolute;
    top: 0;
    right: 0;
    display: flex;
    align-items: center;
    gap: 2pt;
    padding: var(--reset-btn-padding, 1pt 4pt);
    font-size: 0.65em;
    border-radius: var(--reset-btn-border-radius, var(--border-radius, 3pt));
    background: var(--btn-bg, rgba(0, 0, 0, 0.1));
    color: var(--text-color-muted, #6b7280);
    border: 1px solid var(--border-color, #d1d5db);
    cursor: pointer;
    z-index: 5;
    transition: all 0.15s ease;
    box-shadow: none;
    opacity: 0.7;
  }
  .reset-button:hover {
    background: var(--btn-bg-hover, rgba(0, 0, 0, 0.2));
    color: var(--text-color, #374151);
    opacity: 1;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }
</style>
