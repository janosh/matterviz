<script lang="ts">
  import { JsonTree } from '$lib/layout/json-tree'
  import DraggablePane from '$lib/overlays/DraggablePane.svelte'
  import type { ComponentProps } from 'svelte'
  import { tooltip } from 'svelte-multiselect/attachments'
  import { build_diagram } from './build-diagram'
  import type { DiagramInput } from './diagram-input'
  import type { PhaseDiagramData } from './types'

  let {
    editor_open = $bindable(false),
    diagram_input = $bindable<DiagramInput | null>(null),
    on_rebuild,
    icon_style = ``,
    toggle_props: caller_toggle_props = {},
  }: {
    editor_open?: boolean
    diagram_input?: DiagramInput | null
    on_rebuild?: (data: PhaseDiagramData) => void
    icon_style?: string
    toggle_props?: ComponentProps<typeof DraggablePane>[`toggle_props`]
  } = $props()

  // Track the original input for reset (updated on each new external input)
  let original_input = $state<DiagramInput | null>(null)

  // Active tab: edit (textarea) or view (JsonTree)
  let active_tab = $state<`edit` | `view`>(`edit`)

  // Textarea content (kept separate to avoid losing edits on parse errors)
  let text_content = $state(``)
  let parse_error = $state<string | null>(null)

  // Sync textarea and original_input when diagram_input changes externally
  let last_synced_input = $state<DiagramInput | null>(null)
  $effect(() => {
    if (diagram_input && diagram_input !== last_synced_input) {
      original_input = JSON.parse(JSON.stringify(diagram_input))
      text_content = JSON.stringify(diagram_input, null, 2)
      last_synced_input = diagram_input
      parse_error = null
    }
  })

  // Debounced rebuild from textarea edits
  let debounce_timer: ReturnType<typeof setTimeout> | undefined

  function handle_input() {
    if (debounce_timer) clearTimeout(debounce_timer)
    debounce_timer = setTimeout(try_rebuild, 400)
  }

  function try_rebuild() {
    try {
      const parsed = JSON.parse(text_content) as DiagramInput
      // Validate minimal structure
      if (!parsed.meta?.components || !parsed.curves || !parsed.regions) {
        parse_error = `Missing required fields: meta.components, curves, regions`
        return
      }
      parse_error = null
      const built = build_diagram(parsed)
      diagram_input = parsed
      last_synced_input = parsed
      on_rebuild?.(built)
    } catch (err) {
      parse_error = err instanceof Error ? err.message : String(err)
    }
  }

  function reset() {
    if (!original_input) return
    diagram_input = JSON.parse(JSON.stringify(original_input))
    text_content = JSON.stringify(diagram_input, null, 2)
    parse_error = null
    if (!diagram_input) return
    try {
      on_rebuild?.(build_diagram(diagram_input))
    } catch (err) {
      parse_error = err instanceof Error ? err.message : String(err)
    }
  }

  function download_json() {
    if (!diagram_input) return
    const json = JSON.stringify(diagram_input, null, 2)
    const blob = new Blob([json], { type: `application/json` })
    const url = URL.createObjectURL(blob)
    const link = document.createElement(`a`)
    link.href = url
    link.download = `diagram-input.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Cleanup timer
  $effect(() => () => {
    if (debounce_timer) clearTimeout(debounce_timer)
  })
</script>

<DraggablePane
  bind:show={editor_open}
  open_icon="Cross"
  closed_icon="Edit"
  {icon_style}
  pane_props={{ class: `pd-editor-pane` }}
  toggle_props={{
    class: `pd-editor-toggle`,
    title: editor_open ? `` : `Edit diagram input`,
    ...caller_toggle_props,
  }}
  max_width="600px"
>
  <div class="editor-header">
    <h4>Diagram Input</h4>
    <div class="editor-actions">
      <button
        type="button"
        onclick={download_json}
        disabled={!diagram_input}
        title="Download DiagramInput JSON"
        {@attach tooltip({ content: `Download editable JSON` })}
      >
        ⬇
      </button>
      <button
        type="button"
        onclick={reset}
        disabled={!original_input}
        title="Reset to original parsed result"
        {@attach tooltip({ content: `Reset to original` })}
      >
        ↺
      </button>
    </div>
  </div>

  <div class="tab-bar">
    <button
      type="button"
      class:active={active_tab === `edit`}
      onclick={() => active_tab = `edit`}
    >
      Edit
    </button>
    <button
      type="button"
      class:active={active_tab === `view`}
      onclick={() => active_tab = `view`}
    >
      View
    </button>
  </div>

  {#if active_tab === `edit`}
    <textarea
      bind:value={text_content}
      oninput={handle_input}
      spellcheck={false}
      class="json-editor"
      class:has-error={parse_error}
    ></textarea>
    {#if parse_error}
      <div class="error-bar">{parse_error}</div>
    {/if}
  {:else}
    <div class="tree-container">
      {#if diagram_input}
        <JsonTree
          value={diagram_input}
          root_label="diagram_input"
          default_fold_level={2}
        />
      {:else}
        <p class="placeholder">No diagram input loaded</p>
      {/if}
    </div>
  {/if}
</DraggablePane>

<style>
  .editor-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
    h4 {
      margin: 0;
    }
  }
  .editor-actions {
    display: flex;
    gap: 4px;
    button {
      padding: 2px 6px;
      font-size: 14px;
      cursor: pointer;
    }
  }
  .tab-bar {
    display: flex;
    gap: 2px;
    margin-bottom: 6px;
    button {
      flex: 1;
      padding: 4px 8px;
      border: 1px solid var(--border-color, #ccc);
      background: transparent;
      cursor: pointer;
      font-size: 0.85em;
      border-radius: 3px 3px 0 0;
      &.active {
        background: var(--bg-active, rgba(99, 102, 241, 0.15));
        border-bottom-color: transparent;
        font-weight: 600;
      }
    }
  }
  .json-editor {
    width: 100%;
    min-height: 300px;
    max-height: 60vh;
    font-family: monospace;
    font-size: 12px;
    line-height: 1.4;
    padding: 8px;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 0 0 4px 4px;
    resize: vertical;
    tab-size: 2;
    white-space: pre;
    overflow: auto;
    box-sizing: border-box;
    &.has-error {
      border-color: #d32f2f;
    }
  }
  .error-bar {
    color: #d32f2f;
    font-size: 11px;
    padding: 4px 8px;
    background: rgba(211, 47, 47, 0.08);
    border-radius: 0 0 4px 4px;
    margin-top: 2px;
    max-height: 60px;
    overflow: auto;
    word-break: break-word;
  }
  .tree-container {
    max-height: 60vh;
    overflow: auto;
    border: 1px solid var(--border-color, #ccc);
    border-radius: 0 0 4px 4px;
    padding: 4px;
  }
  .placeholder {
    color: var(--text-muted, #888);
    font-style: italic;
    text-align: center;
    padding: 20px;
    margin: 0;
  }
</style>
