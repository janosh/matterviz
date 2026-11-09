<script lang="ts">
  import { Edit } from 'svelte-widgets/icons'
  import { ViewerPane, type PaneToggleProps } from '#lib/overlays/index.js'
  import { JsonTree } from 'svelte-widgets/json-tree'
  import { set_at_path } from 'svelte-widgets/json-tree/utils'
  import { parse_diagram } from './diagram'
  import type { BinaryPhaseDiagram } from './types'
  import { create_flash } from '#lib/effects.svelte.js'
  import { to_error } from 'svelte-widgets/utils'

  let {
    editor_open = $bindable(false),
    data = null,
    on_data,
    icon_style = ``,
    toggle_props: caller_toggle_props = {},
  }: {
    editor_open?: boolean
    data?: BinaryPhaseDiagram | null
    // Receives each valid edit; without it the tree is read-only
    on_data?: (data: BinaryPhaseDiagram) => void
    icon_style?: string
    toggle_props?: PaneToggleProps
  } = $props()

  const root_label = `diagram`

  // Brief error flash when an edit is rejected by validation
  const rejection = create_flash<string | null>(null, 3000)
  // The flash div stays mounted across consecutive rejections, so its fade-out animation
  // would not replay. Keying on a counter (not the text, which can repeat) remounts it.
  let rejection_seq = $state(0)

  // Inline value edits from JsonTree: an edit that breaks the format (e.g. renames a phase id
  // that regions still reference) is rejected instead of rendered
  function handle_change(path: string, new_value: unknown) {
    if (!data) return
    try {
      on_data?.(parse_diagram(set_at_path(data, path, new_value, root_label)))
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
  {#if data}
    <JsonTree
      value={data}
      {root_label}
      default_fold_level={2}
      download_filename="diagram-data.json"
      editable={Boolean(on_data)}
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
