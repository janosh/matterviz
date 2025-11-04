<script lang="ts">
  import { Icon } from '$lib'
  import type { Snippet } from 'svelte'
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
      [{
        current_values: Record<string, unknown>
        has_changes: boolean
        reference_values: Record<string, unknown>
      }]
    >
    on_reset?: () => void
  } = $props()

  // Create a deep copy of current_values on mount to use as reference values
  function deep_copy(obj: unknown): unknown {
    if (obj === null || typeof obj !== `object`) return obj
    if (obj instanceof Date) return new Date(obj.getTime())
    if (obj instanceof RegExp) return new RegExp(obj)
    if (Array.isArray(obj)) {
      return obj.map((item) =>
        typeof item === `object` && item !== null ? deep_copy(item) : item
      )
    }

    const copy: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      copy[key] = typeof value === `object` && value !== null
        ? deep_copy(value)
        : value
    }
    return copy
  }

  const reference_values = deep_copy(current_values) as Record<string, unknown>

  // Check if any values have changed from reference values
  let has_changes = $derived.by(() => {
    for (const [key, reference_value] of Object.entries(reference_values)) {
      const current_value = current_values[key]

      // Deep comparison for arrays
      if (Array.isArray(reference_value) && Array.isArray(current_value)) {
        if (reference_value.length !== current_value.length) return true
        if (
          reference_value.some((val, idx) => {
            const curr_val = current_value[idx]
            // Handle nested objects/arrays in arrays
            if (
              typeof val === `object` && val !== null &&
              typeof curr_val === `object` && curr_val !== null
            ) return JSON.stringify(val) !== JSON.stringify(curr_val) // Quick deep comparison fallback
            return val !== curr_val
          })
        ) {
          return true
        }
        continue
      }

      // Handle undefined/null comparisons properly
      if (reference_value === undefined && current_value === undefined) continue
      if (reference_value === null && current_value === null) continue

      // Basic comparison for primitives
      if (current_value !== reference_value) {
        return true
      }
    }
    return false
  })

  function handle_reset(event: MouseEvent) {
    event.stopPropagation()
    event.preventDefault()
    on_reset()
  }
</script>

<h4 id="settings-section-title">
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
<section {...rest} aria-labelledby="settings-section-title">
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
    border-radius: var(--reset-btn-border-radius, 2pt);
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
  .reset-button.standalone {
    position: absolute;
    top: -8pt;
    right: -8pt;
  }
</style>
