<script lang="ts">
  // Compact input for Miller indices (hkl). Accepts typing "001", "111", "-101"
  // or editing individual H, K, L number inputs. Emits a Vec3 tuple.
  import type { Vec3 } from '$lib/math'

  let { value = $bindable([0, 0, 1]) }: { value?: Vec3 } = $props()

  // Sync the text input with the Vec3 value
  let hkl_text = $derived(format_hkl(value))

  // Format: compact "001" for single-digit, spaced "10 0 1" for multi-digit
  function format_hkl(vec: Vec3): string {
    return vec.every((v) => Math.abs(v) < 10) ? vec.join(``) : vec.join(` `)
  }

  // Parse hkl string: supports compact "001"/"-101" and spaced/comma "10, 0, 1"
  function parse_hkl(input: string): Vec3 | null {
    // Try spaced/comma format first (handles multi-digit)
    const spaced = input.trim().split(/[,\s]+/)
    if (spaced.length === 3) {
      const nums = spaced.map(Number)
      if (nums.every((n) => !isNaN(n))) return nums as Vec3
    }
    // Fall back to compact single-digit format: "001", "-101"
    const compact = input.replace(/\s+/g, ``)
    const match = compact.match(/^(-?\d)(-?\d)(-?\d)$/)
    if (match) return [Number(match[1]), Number(match[2]), Number(match[3])] as Vec3
    return null
  }

  function handle_text_input(event: Event) {
    const text = (event.target as HTMLInputElement).value
    const parsed = parse_hkl(text)
    if (parsed) value = parsed
  }

  function set_component(idx: number, val: number) {
    const updated: Vec3 = [...value]
    updated[idx] = val
    value = updated
  }
</script>

<div class="miller-input">
  {#each [`H`, `K`, `L`] as label, idx (label)}
    <label>
      <span>{label}</span>
      <input
        type="number"
        step={1}
        value={value[idx]}
        oninput={(event) =>
        set_component(idx, Number((event.target as HTMLInputElement).value))}
      />
    </label>
  {/each}
  <input
    type="text"
    class="hkl-text"
    value={hkl_text}
    oninput={handle_text_input}
    placeholder="001"
    maxlength="12"
    title="Miller indices (e.g. 001, -101, or 10 0 1)"
  />
</div>

<style>
  .miller-input {
    display: flex;
    align-items: center;
    gap: 0.3em;
    input {
      padding: 0.15em 0.3em;
      border: 1px solid var(--border-color, #ccc);
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.9em;
      text-align: center;
      box-sizing: border-box;
    }
    label {
      display: flex;
      align-items: center;
      gap: 0.15em;
      span {
        font-weight: 600;
        font-size: 0.85em;
      }
      input[type='number'] {
        width: 2.8em;
      }
    }
    .hkl-text {
      width: 5em;
      opacity: 0.6;
    }
  }
</style>
