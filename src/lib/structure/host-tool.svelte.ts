import type { Component, ComponentProps, Snippet } from 'svelte'
import type StructureScene from './StructureScene.svelte'
import type { AnyStructure } from './index'
import {
  copy_prediction_input,
  copy_prediction_overlay,
  copy_prediction_provenance,
} from './prediction'
import type {
  StructureToolOverlay,
  StructureToolPrediction,
  StructureToolProvenance,
} from './prediction'

export { prediction_to_json, prediction_from_json } from './prediction'
export type {
  StructureToolVolume,
  StructureToolOverlay,
  StructureToolPrediction,
  StructureToolProvenance,
} from './prediction'

// The host lends a full-size view without unmounting the tool that owns the computation.
export interface StructureToolViewProps {
  scene_props: ComponentProps<typeof StructureScene>
  supercell_scaling: string
  show_image_atoms: boolean
}
export interface StructureToolView {
  content: Snippet<[StructureToolViewProps]>
}
export interface StructureToolRun {
  id: number
  structure: AnyStructure
  signal: AbortSignal
  on_overlay: (overlay: StructureToolOverlay | null) => void
  on_view: (view: StructureToolView | null) => void
  // Clear just the result/view, or cancel the computation and clear both.
  clear: () => void
  cancel: () => void
}
export interface StructureToolProps {
  structure: AnyStructure
  start_run: (provenance: StructureToolProvenance) => StructureToolRun
}

// Each mounted viewer owns its controller. Guards also run synchronously on callbacks, so
// an input change cannot race the effect that aborts the old computation.
export function create_structure_tool_controller(
  get_structure: () => AnyStructure | null | undefined,
  get_owner: () => unknown,
  on_prediction: (prediction: StructureToolPrediction | null) => void,
  on_view: (view: StructureToolView | null) => void,
  get_revision: () => string,
) {
  let current: { abort: AbortController; is_current: () => boolean } | undefined
  let next_id = 0
  let disposed = false
  const clear = (): void => {
    on_prediction(null)
    on_view(null)
  }
  const invalidate = (): void => {
    const previous = current
    current = undefined
    clear()
    previous?.abort.abort()
  }
  return {
    start_run(provenance: StructureToolProvenance): StructureToolRun {
      const structure = get_structure()
      const owner = get_owner()
      const revision = get_revision()
      if (disposed || !owner || !structure)
        throw new Error(`Cannot start a host run without a mounted, enabled structure viewer`)
      const input = copy_prediction_input(structure)
      const captured_provenance = copy_prediction_provenance(provenance)
      const previous = current
      const stale_output = previous && !previous.is_current()
      const abort = new AbortController()
      const id = ++next_id
      const signal = abort.signal
      const is_current = (): boolean =>
        !disposed &&
        !signal.aborted &&
        current?.abort === abort &&
        get_owner() === owner &&
        get_structure() === structure &&
        get_revision() === revision
      current = { abort, is_current }
      // A same-turn input/tool change may precede the invalidation effect. Only retain
      // previous output (and its appearance) when it still belongs to this input and tool.
      if (stale_output) on_prediction(null)
      // A previous view may close over its aborted run. Return before starting new work.
      on_view(null)
      // Abort listeners can synchronously start another run; it must retain ownership.
      previous?.abort.abort()
      return {
        id,
        structure: structuredClone(input),
        signal,
        on_overlay(overlay) {
          if (!is_current()) return
          if (overlay === null) return on_prediction(null)
          on_prediction({
            ...copy_prediction_overlay(overlay, input.sites.length),
            input,
            run_id: id,
            provenance: captured_provenance,
          })
        },
        on_view(view) {
          if (is_current()) on_view(view)
        },
        clear() {
          if (is_current()) clear()
        },
        cancel() {
          if (is_current()) invalidate()
        },
      }
    },
    invalidate_if_changed(): void {
      if (current && !current.is_current()) invalidate()
    },
    clear: invalidate,
    dispose(): void {
      disposed = true
      invalidate()
    },
  }
}

// Register before mounting; this also reaches independently mounted file viewers.
export const structure_host_tool = $state<{
  component: Component<StructureToolProps> | null
}>({ component: null })
