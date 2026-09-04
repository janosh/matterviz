<script lang="ts">
  import { Edit } from 'svelte-widgets/icons'
  import { ViewerPane, type PaneToggleProps } from '$lib/overlays'
  import { JsonTree } from 'svelte-widgets/json-tree'
  import { set_at_path } from 'svelte-widgets/json-tree/utils'
  import { build_diagram } from './build-diagram'
  import type { DiagramInput } from './diagram-input'
  import type { PhaseDiagramData } from './types'
  import { create_flash } from '$lib/effects.svelte'
  import { to_error } from '$lib/utils'

  let {
    editor_open = $bindable(false),
    diagram_input = $bindable<DiagramInput | null>(null),
    data = null,
    on_data,
    icon_style = ``,
    toggle_props: caller_toggle_props = {},
  }: {
    editor_open?: boolean
    diagram_input?: DiagramInput | null
    data?: PhaseDiagramData | null
    on_data?: (data: PhaseDiagramData) => void
    icon_style?: string
    toggle_props?: PaneToggleProps
  } = $props()

  // The source object currently displayed (DiagramInput or PhaseDiagramData)
  const display_source = $derived(diagram_input ?? data)

  const root_label = `diagram`

  // Brief error flash when an edit is rejected by build_diagram
  const rejection = create_flash<string | null>(null, 3000)
  // The flash div stays mounted across consecutive rejections, so its fade-out animation
  // would not replay. Keying on a counter (not the text, which can repeat) remounts it.
  let rejection_seq = $state(0)

  // True if obj looks like a DiagramInput rather than PhaseDiagramData
  function is_diagram_input(obj: Record<string, unknown>): boolean {
    const meta = obj.meta as Record<string, unknown> | undefined
    return Boolean(meta && Array.isArray(meta.components) && `curves` in obj)
  }

  // Inline value edits from JsonTree
  function handle_change(path: string, new_value: unknown) {
    if (!display_source) return
    try {
      const updated = set_at_path(display_source, path, new_value, root_label)
      if (is_diagram_input(updated as Record<string, unknown>)) {
        build_diagram(updated as DiagramInput)
        diagram_input = updated as DiagramInput
      } else {
        // Clear diagram_input so the rebuilt diagram doesn't shadow the edited data.
        diagram_input = null
        on_data?.(updated as PhaseDiagramData)
      }
    } catch (error) {
      rejection_seq += 1
      rejection.show(to_error(error).message)
    }
  }
</script>

<ViewerPane
  bind:open={editor_open}
  pane_name="diagram data editor"
  class_prefix="pd-editor"
  persistent
  toggle_props={caller_toggle_props}
  max_width="600px"
  closed_icon={Edit}
  {icon_style}
>
  {#if rejection.value}
    {#key rejection_seq}
      <div class="rejection-flash">{rejection.value}</div>
    {/key}
  {/if}
  {#if display_source}
    <JsonTree
      value={display_source}
      {root_label}
      default_fold_level={2}
      download_filename="diagram-data.json"
      editable
      on_change={handle_change}
    />
  {:else}
    <p class="placeholder">
      No diagram data loaded. Drop an SVG or JSON file onto the diagram.
    </p>
  {/if}
</ViewerPane>

<style>
  .rejection-flash {
    color: #d32f2f;
    font-size: 11px;
    padding: 4px 8px;
    background: rgba(211, 47, 47, 0.08);
    border-radius: 3px;
    word-break: break-word;
    animation: fade-out 3s ease-out forwards;
  }
  @keyframes fade-out {
    0%,
    80% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  .placeholder {
    color: var(--text-muted, #888);
    font-style: italic;
    text-align: center;
    padding: 20px;
    margin: 0;
  }
</style>
