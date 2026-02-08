<script lang="ts">
  // Compact input for Miller indices (hkl). Accepts typing "001", "111", "-101"
  // or editing individual H, K, L number inputs. Emits a Vec3 tuple.
  import type { Vec3 } from '$lib/math'

  let {
    value = $bindable<Vec3>([0, 0, 1]),
  }: {
    value?: Vec3
  } = $props()

  // Sync the text input with the Vec3 value
  let hkl_text = $derived(format_hkl(value))

  function format_hkl(vec: Vec3): string {
    return vec.map((v) => (v < 0 ? `${v}` : `${v}`)).join(``)
  }

  // Parse hkl string like "001", "111", "-101" into Vec3
  function parse_hkl(input: string): Vec3 | null {
    const cleaned = input.replace(/\s/g, ``)
    if (cleaned.length < 3) return null
    const parts: number[] = []
    let idx = 0
    while (idx < cleaned.length && parts.length < 3) {
      let neg = false
      if (cleaned[idx] === `-`) {
        neg = true
        idx++
      }
      if (idx >= cleaned.length) return null
      const digit = parseInt(cleaned[idx], 10)
      if (isNaN(digit)) return null
      parts.push(neg ? -digit : digit)
      idx++
    }
    if (parts.length !== 3) return null
    return parts as Vec3
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
    maxlength="6"
    title="Miller indices (e.g. 001, 111, -101)"
  />
</div>

<style>
  .miller-input {
    display: flex;
    align-items: center;
    gap: 0.3em;
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
        padding: 0.15em 0.3em;
        border: 1px solid var(--border-color, #ccc);
        border-radius: 4px;
        font-family: monospace;
        font-size: 0.9em;
        text-align: center;
        box-sizing: border-box;
      }
    }
    .hkl-text {
      width: 3.5em;
      padding: 0.15em 0.3em;
      border: 1px solid var(--border-color, #ccc);
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.9em;
      text-align: center;
      opacity: 0.6;
      box-sizing: border-box;
    }
  }
</style>
