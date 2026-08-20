<script lang="ts">
  import type { Vec3 } from '$lib/math'
  import type { HTMLInputAttributes } from 'svelte/elements'

  // `label` also names the indices in the tooltip, so callers reading direct-lattice
  // directions can pass `uvw` instead of the default reciprocal-lattice `hkl`.
  let {
    value = $bindable([0, 0, 1]),
    label = `hkl`,
    ...rest
    // Omit `value`: HTMLInputAttributes types it as string|number|string[], which would
    // intersect with Vec3 to an unusable type
  }: { value?: Vec3; label?: string } & Omit<HTMLInputAttributes, `value`> = $props()

  // Crystallographic bar notation: combining macron U+0304 or overline U+0305 after a digit
  const BAR = /[\u0304\u0305]/g
  // A barred index is negative: "1̄2̄" and "12̄" both mean -12
  const unbar = (part: string): string => {
    const digits = part.replaceAll(BAR, ``)
    return digits === part ? part : `-${digits}`
  }

  // Parse Miller indices typed as compact single digits ("001", "-101", "1̄01") or as three
  // whitespace/comma-separated integers ("10 0 1", "10, 0, -1", "1̄2̄ 0 1"). Returns null for
  // anything that is not exactly three integers, so partial input never emits a value.
  function parse_hkl(input: string): Vec3 | null {
    const text = input.trim()
    const parts = /[\s,]/.test(text)
      ? text.split(/[\s,]+/).map(unbar)
      : (text
          .match(
            /^(?<h>-?\d[\u0304\u0305]?)(?<k>-?\d[\u0304\u0305]?)(?<l>-?\d[\u0304\u0305]?)$/,
          )
          ?.slice(1)
          .map(unbar) ?? [])
    if (parts.length !== 3 || !parts.every((part) => /^-?\d+$/.test(part))) return null
    return parts.map(Number) as Vec3
  }

  // Compact "001" when every index is a single digit, else spaced "10 0 1"
  const format_hkl = (hkl: Vec3): string =>
    hkl.every((idx) => Math.abs(idx) < 10) ? hkl.join(``) : hkl.join(` `)

  let input_el: HTMLInputElement | undefined = $state()

  // Sync the text from `value` only when the two disagree, so an external change (preset,
  // parent reset) re-renders but the user's own typing ("10 0", "1, 0, 1") is never rewritten
  $effect(() => {
    if (!input_el) return
    const typed = parse_hkl(input_el.value)
    if (!typed || typed.some((idx, dim) => idx !== value[dim])) {
      input_el.value = format_hkl(value)
    }
  })
</script>

<label class="miller-input">
  <span>{label}</span>
  <input
    bind:this={input_el}
    type="text"
    oninput={(event) => {
      const parsed = parse_hkl(event.currentTarget.value)
      if (parsed) value = parsed
    }}
    placeholder="001"
    maxlength="12"
    title="{label} indices (e.g. 001, -101 or 10 0 1)"
    {...rest}
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
      width: 5.5em;
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
