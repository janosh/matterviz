<script lang="ts">
  // Compact single-field input for Miller indices (hkl).
  // Accepts "001", "111", "-101", "1 0 1", "10, 0, 1" and emits a Vec3 tuple.
  import type { Vec3 } from '$lib/math'

  let { value = $bindable([0, 0, 1]) }: { value?: Vec3 } = $props()

  // Format: compact "001" for single-digit, spaced "10 0 1" for multi-digit
  let hkl_text = $derived(
    value.every((v) => Math.abs(v) < 10) ? value.join(``) : value.join(` `),
  )

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

  function handle_input(event: Event) {
    const parsed = parse_hkl((event.target as HTMLInputElement).value)
    if (parsed) value = parsed
  }
</script>

<label class="miller-input">
  <span>hkl</span>
  <input
    type="text"
    value={hkl_text}
    oninput={handle_input}
    placeholder="001"
    maxlength="12"
    title="Miller indices (e.g. 001, -101, or 10 0 1)"
  />
</label>

<style>
  .miller-input {
    display: flex;
    align-items: center;
    gap: 0.3em;
    span {
      font-weight: 600;
      font-size: 0.85em;
    }
    input {
      width: 4em;
      padding: 0.15em 0.3em;
      border: 1px solid var(--border-color, #ccc);
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.9em;
      text-align: center;
      box-sizing: border-box;
    }
  }
</style>
