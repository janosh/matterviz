<script lang="ts">
  import { JsonTree } from '$lib/layout/json-tree'
  import { set_at_path } from '$lib/layout/json-tree/utils'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import type { ComponentProps } from 'svelte'
  import { build_diagram } from './build-diagram'
  import type { DiagramInput } from './diagram-input'
  import type { PhaseDiagramData } from './types'

  let {
    editor_open = $bindable(false),
    diagram_input = $bindable<DiagramInput | null>(null),
    data = null,
    ondata,
    icon_style = ``,
    toggle_props: caller_toggle_props = {},
  }: {
    editor_open?: boolean
    diagram_input?: DiagramInput | null
    data?: PhaseDiagramData | null
    ondata?: (data: PhaseDiagramData) => void
    icon_style?: string
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  } = $props()

  // The source object currently displayed (DiagramInput or PhaseDiagramData)
  const display_source = $derived(diagram_input ?? data)

  const root_label = `diagram`

  // Brief error flash when an edit is rejected by build_diagram
  let rejection_msg = $state<string | null>(null)
  let rejection_timer: ReturnType<typeof setTimeout> | undefined

  function show_rejection(msg: string) {
    if (rejection_timer) clearTimeout(rejection_timer)
    rejection_msg = msg
    rejection_timer = setTimeout(() => (rejection_msg = null), 3000)
  }

  // Shared format detection: true if obj looks like a DiagramInput
  function is_diagram_input(obj: Record<string, unknown>): boolean {
    const meta = obj.meta as Record<string, unknown> | undefined
    return Boolean(meta && Array.isArray(meta.components) && `curves` in obj)
  }

  // Handle inline value edits from JsonTree
  function handle_change(path: string, new_value: unknown, _old_value: unknown) {
    if (!display_source) return
    const updated = set_at_path(display_source, path, new_value, root_label)

    if (is_diagram_input(updated as Record<string, unknown>)) {
      try {
        build_diagram(updated as DiagramInput)
        diagram_input = updated as DiagramInput
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        show_rejection(msg)
      }
      return
    }
    // PhaseDiagramData format — clear diagram_input so rebuilt_data doesn't shadow
    diagram_input = null
    ondata?.(updated as PhaseDiagramData)
  }
</script>

<DraggablePane
  bind:show={editor_open}
  open_icon="Cross"
  closed_icon="Edit"
  {icon_style}
  persistent
  pane_props={{ class: `pd-editor-pane` }}
  toggle_props={{
    class: `pd-editor-toggle`,
    title: editor_open ? `` : `Edit diagram data`,
    ...caller_toggle_props,
  }}
  max_width="600px"
>
  {#if rejection_msg}
    <div class="rejection-flash">{rejection_msg}</div>
  {/if}
  {#if display_source}
    <JsonTree
      value={display_source}
      {root_label}
      default_fold_level={2}
      download_filename="diagram-data.json"
      editable
      onchange={handle_change}
    />
  {:else}
    <p class="placeholder">
      No diagram data loaded. Drop an SVG or JSON file onto the diagram.
    </p>
  {/if}
</DraggablePane>

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
    0%, 80% {
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
