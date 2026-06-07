<!-- Legend + per-kind visibility toggles for symmetry-element overlays. Renders one
checkbox per element kind present in `elements`, with a color swatch matching the
overlay render colors and the element count. Bind `show_kinds` and pass it through to
SymmetryElements (via symmetry_elements_props on the structure viewer). -->
<script lang="ts">
  import type { ShowSymmetryKinds, SymmetryElement } from './symmetry-elements'
  import {
    count_symmetry_elements,
    DEFAULT_SHOW_SYM_KINDS,
    SYM_ELEM_KIND_INFO,
    SYM_ELEM_KINDS,
  } from './symmetry-elements'

  let {
    elements = [],
    show_kinds = $bindable({ ...DEFAULT_SHOW_SYM_KINDS }),
    ...rest
  }: {
    elements?: SymmetryElement[]
    show_kinds?: ShowSymmetryKinds
    [key: string]: unknown
  } = $props()

  const counts = $derived(count_symmetry_elements(elements))
  const present_kinds = $derived(SYM_ELEM_KINDS.filter((kind) => counts[kind]))

  function toggle_kind(kind: (typeof SYM_ELEM_KINDS)[number], checked: boolean) {
    // Reassign (not mutate) so bound parents always see the change
    show_kinds = { ...show_kinds, [kind]: checked }
  }
</script>

{#if present_kinds.length > 0}
  <div class="sym-elem-controls" {...rest}>
    {#each present_kinds as kind (kind)}
      <label>
        <input
          type="checkbox"
          checked={show_kinds[kind] ?? false}
          onchange={(evt) => toggle_kind(kind, evt.currentTarget.checked)}
        />
        <span class="swatch" style:background={SYM_ELEM_KIND_INFO[kind].color}></span>
        {SYM_ELEM_KIND_INFO[kind].label} ({counts[kind]})
      </label>
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
  .swatch {
    width: 0.9em;
    height: 0.9em;
    border-radius: 2px;
    border: 1px solid var(--border-color, #ccc);
    flex-shrink: 0;
  }
</style>
