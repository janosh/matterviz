<!-- Legend + per-kind visibility toggles for symmetry-element overlays. Renders one
checkbox per element kind present in `elements`, with a color swatch matching the
overlay render colors and the element count. Bind `show_kinds` and pass it through to
SymmetryElements (via symmetry_elements_props on the structure viewer). The overlay is
only drawn while the viewer renders the analyzed (input) cell; pass `in_input_frame={false}`
while a conventional/primitive cell is shown to disable the toggles and say why. -->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import type { Matrix3x3, Vec3 } from '$lib/math'
  import type { ShowSymmetryKinds, SymmetryElement } from './symmetry-elements'
  import {
    count_symmetry_elements,
    DEFAULT_SHOW_SYM_KINDS,
    SYM_ELEM_KIND_INFO,
    SYM_ELEM_KINDS,
    SYM_ELEMENTS_INPUT_FRAME_NOTE,
    tile_symmetry_elements,
    symmetry_tiling_reason,
  } from './symmetry-elements'

  let {
    elements = [],
    show_kinds = $bindable({ ...DEFAULT_SHOW_SYM_KINDS }),
    in_input_frame = true,
    tiling = [1, 1, 1],
    lattice,
    tiling_result,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    elements?: SymmetryElement[]
    show_kinds?: ShowSymmetryKinds
    // Whether the viewer currently renders the original (input) cell the elements belong to
    in_input_frame?: boolean
    tiling?: Vec3
    lattice?: Matrix3x3
    // Share the selected overlay with the renderer when both use the same inputs.
    tiling_result?: ReturnType<typeof tile_symmetry_elements>
  } = $props()

  const counts = $derived(count_symmetry_elements(elements))
  const present_kinds = $derived(SYM_ELEM_KINDS.filter((kind) => counts[kind]))
  const hint_id = $props.id()
  const selected_reason = $derived(
    tiling_result
      ? tiling_result.unavailable_reason
      : lattice
        ? symmetry_tiling_reason(
            elements.filter((element) => show_kinds[element.kind]),
            tiling,
            lattice,
          )
        : null,
  )
  const reasons = $derived(
    Object.fromEntries(
      present_kinds.map((kind) => [
        kind,
        !in_input_frame
          ? SYM_ELEMENTS_INPUT_FRAME_NOTE
          : lattice
            ? show_kinds[kind]
              ? selected_reason
              : symmetry_tiling_reason(
                  elements.filter(
                    (element) => show_kinds[element.kind] || element.kind === kind,
                  ),
                  tiling,
                  lattice,
                )
            : tiling.some((count) => count > 1)
              ? `Provide the input lattice to preview tiled symmetry elements.`
              : null,
      ]),
    ),
  )
  const messages = $derived([
    ...new Set(Object.values(reasons).filter((reason) => reason !== null)),
  ])
</script>

{#if present_kinds.length > 0}
  <div {...rest} class={[`sym-elem-controls`, rest.class]}>
    {#each present_kinds as kind (kind)}
      {@const reason = reasons[kind]}
      {@const disabled = !in_input_frame || Boolean(reason && !show_kinds[kind])}
      <label class:disabled>
        <input
          type="checkbox"
          checked={show_kinds[kind] ?? false}
          {disabled}
          aria-describedby={reason ? `${hint_id}-${messages.indexOf(reason)}` : undefined}
          onchange={(evt) =>
            // Reassign (not mutate) so bound parents always see the change
            (show_kinds = { ...show_kinds, [kind]: evt.currentTarget.checked })}
        />
        <span class="swatch" style:background={SYM_ELEM_KIND_INFO[kind].color}></span>
        {SYM_ELEM_KIND_INFO[kind].label} ({counts[kind]})
      </label>
    {/each}
    {#each messages as message, idx}
      <small id={`${hint_id}-${idx}`} class="frame-note">{message}</small>
    {/each}
  </div>
{/if}

<style>
  .sym-elem-controls {
    display: flex;
    flex-direction: column;
    gap: 3pt;
  }
  label {
    display: flex;
    align-items: center;
    gap: 6pt;
    cursor: pointer;
    font-size: 0.95em;
  }
  label.disabled {
    cursor: default;
    opacity: 0.6;
  }
  .frame-note {
    color: var(--text-muted, #666);
    font-style: italic;
  }
  .swatch {
    width: 0.9em;
    height: 0.9em;
    border-radius: 2px;
    border: 1px solid var(--border-color, #ccc);
    flex-shrink: 0;
  }
</style>
