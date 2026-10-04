<script lang="ts">
  import type { AnyStructure } from '#lib'
  import type { StructureSettings } from '#lib/structure/index.js'
  import Structure from '#lib/structure/Structure.svelte'

  // Svelte's dev-only prop-ownership checks compare a prop's binding against the component
  // that passed it, so they stay silent under a bare mount(). This parent passes scene_props
  // either as an unbound literal (like the XRD demo) or bound to `bound_scene_props`.
  let {
    structure,
    bound_scene_props = $bindable(),
  }: { structure: AnyStructure; bound_scene_props?: StructureSettings } = $props()
</script>

{#if bound_scene_props}
  <Structure
    {structure}
    active_pane="controls"
    show_controls
    bind:scene_props={bound_scene_props}
  />
{:else}
  <Structure {structure} active_pane="controls" show_controls scene_props={{ gizmo: false }} />
{/if}
