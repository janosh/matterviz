<!-- Legend + per-kind visibility toggles for symmetry-element overlays. Renders one
checkbox per element kind present in `elements`, with a color swatch matching the
overlay render colors and the element count. Bind `show_kinds` and pass it through to
SymmetryElements (via symmetry_elements_props on the structure viewer). The overlay is
only drawn while the viewer renders the analyzed (input) cell; pass `in_input_frame={false}`
while a conventional/primitive cell is shown to disable the toggles and say why. -->
<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'
  import type { ShowSymmetryKinds, SymmetryElement } from './symmetry-elements'
  import {
    count_symmetry_elements,
    DEFAULT_SHOW_SYM_KINDS,
    SYM_ELEM_KIND_INFO,
    SYM_ELEM_KINDS,
    SYM_ELEMENTS_INPUT_FRAME_NOTE,
  } from './symmetry-elements'

  let {
    elements = [],
    show_kinds = $bindable({ ...DEFAULT_SHOW_SYM_KINDS }),
    in_input_frame = true,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    elements?: SymmetryElement[]
    show_kinds?: ShowSymmetryKinds
    // Whether the viewer currently renders the original (input) cell the elements belong to
    in_input_frame?: boolean
  } = $props()

  const counts = $derived(count_symmetry_elements(elements))
  const present_kinds = $derived(SYM_ELEM_KINDS.filter((kind) => counts[kind]))
</script>

{#if present_kinds.length > 0}
  <div {...rest} class={[`sym-elem-controls`, rest.class]}>
    {#each present_kinds as kind (kind)}
      <label class:disabled={!in_input_frame}>
        <input
          type="checkbox"
          checked={show_kinds[kind] ?? false}
          disabled={!in_input_frame}
          onchange={(evt) =>
            // Reassign (not mutate) so bound parents always see the change
            (show_kinds = { ...show_kinds, [kind]: evt.currentTarget.checked })}
        />
        <span class="swatch" style:background={SYM_ELEM_KIND_INFO[kind].color}></span>
        {SYM_ELEM_KIND_INFO[kind].label} ({counts[kind]})
      </label>
    {/each}
    {#if !in_input_frame}
      <small class="frame-note">{SYM_ELEMENTS_INPUT_FRAME_NOTE}</small>
    {/if}
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
