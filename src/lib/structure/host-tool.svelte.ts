import type { Component, Snippet } from 'svelte'
import type { StructureSettings } from './settings'
import type { AnyStructure } from './index'
import {
  copy_prediction_input,
  copy_prediction_overlay,
  copy_prediction_provenance,
} from './prediction'
import type {
  StructureToolGeometry,
  StructureToolOverlay,
  StructureToolPrediction,
  StructureToolProvenance,
} from './prediction'

export { prediction_to_json, prediction_from_json } from './prediction'
export type {
  StructureToolVolume,
  StructureToolGeometry,
  StructureToolOverlay,
  StructureToolPrediction,
  StructureToolProvenance,
} from './prediction'

// The host lends a full-size view without unmounting the tool that owns the computation.
export interface StructureToolViewProps {
  scene_props: StructureSettings
  supercell_scaling: string
  show_image_atoms: boolean
}
export interface StructureToolView {
  // Transient visuals that replace the viewer without exporting them.
  content?: Snippet<[StructureToolViewProps]>
}
export interface StructureToolRun {
  id: number
  structure: AnyStructure
  signal: AbortSignal
  on_overlay: (overlay: StructureToolOverlay | null) => void
  on_view: (view: StructureToolView | null) => void
  // Adopt `geometry` as the viewer's input in one undoable edit (undo clears this run's
  // output). The run stays current with `structure` updated and its prediction rebased onto
  // the new input, minus `geometry`. Invalid geometry throws a TypeError without writing.
  // A no-op once the run is no longer current.
  replace_input: (geometry: StructureToolGeometry) => void
  // Clear just the result/view, or cancel the computation and clear both.
  clear: () => void
  cancel: () => void
}
export type StructureToolProps = {
  structure: AnyStructure
  // Includes imported results; hiding visual output never removes this snapshot.
  prediction: StructureToolPrediction | null
  overlay_visible: boolean
  set_overlay_visible: (visible: boolean) => void
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
  // Synchronously writes validated geometry into the input and rebases `run_id`'s output.
  on_replace_input: (geometry: StructureToolGeometry, run_id: number) => void,
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
      // Reassigned when the run replaces its own input, so it stays current.
      let structure = get_structure()
      const owner = get_owner()
      let revision = get_revision()
      if (disposed || !owner || !structure)
        throw new Error(`Cannot start a host run without a mounted, enabled structure viewer`)
      let input = copy_prediction_input(structure)
      const captured_provenance = copy_prediction_provenance(provenance)
      const previous = current
      const stale_output = previous && !previous.is_current()
      const abort = new AbortController()
      const identifier = ++next_id
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
      const run: StructureToolRun = {
        id: identifier,
        structure: structuredClone(input),
        signal,
        on_overlay(overlay) {
          if (!is_current()) return
          if (overlay === null) return on_prediction(null)
          on_prediction({
            ...copy_prediction_overlay(overlay, input),
            input,
            run_id: identifier,
            provenance: captured_provenance,
          })
        },
        on_view(view) {
          if (is_current()) on_view(view)
        },
        replace_input(geometry) {
          if (!is_current()) return
          // Validates and copies, so a host cannot mutate the written positions afterwards.
          const copied = copy_prediction_overlay({ geometry }, input).geometry
          if (!copied) throw new TypeError(`geometry: expected positions, one per input site`)
          on_replace_input(copied, identifier)
          structure = get_structure()
          revision = get_revision()
          input = copy_prediction_input(structure)
          run.structure = structuredClone(input)
        },
        clear() {
          if (is_current()) clear()
        },
        cancel() {
          if (is_current()) invalidate()
        },
      }
      return run
    },
    // An id no run of this controller takes, for output no run computes (e.g. an import):
    // hosts and the viewer match output to its run by id.
    reserve_run_id: (): number => ++next_id,
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
  // Select all calculation inputs, preserving atom order. Omit for full-document identity.
  input_key?: (structure: AnyStructure) => string
}>({ component: null })
