import type { Component, ComponentProps, Snippet } from 'svelte'
import type StructureScene from './StructureScene.svelte'
import type { VolumetricData } from '$lib/isosurface'
import type { AnyStructure } from './index'

// Reuse a field ID only for the same physical quantity, units and normalization. Change it
// when those semantics change; array order, labels and grid resolution do not affect identity.
export type StructureToolVolume = VolumetricData & { field_id: string }
export interface StructureToolOverlay {
  // Publication copies these values. Hosts may reuse or mutate buffers after on_overlay returns.
  // Shared buffers are supported for density values, but not inside site properties.
  site_properties?: Record<string, unknown>[]
  volumes?: StructureToolVolume[]
  color_property?: string
}
export interface StructureToolProvenance {
  model: string
  version: string
  units: Record<string, string>
  settings: Record<string, unknown>
}
export interface StructureToolPrediction extends StructureToolOverlay {
  input: AnyStructure
  run_id: number
  provenance: StructureToolProvenance
}

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

// structuredClone keeps shared storage shared; reject it in arbitrary property metadata.
function reject_shared_buffers(value: unknown, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== `object` || seen.has(value)) return
  seen.add(value)
  const buffer = ArrayBuffer.isView(value) ? value.buffer : value
  if (typeof SharedArrayBuffer !== `undefined` && buffer instanceof SharedArrayBuffer)
    throw new Error(
      `Prediction properties cannot contain shared buffers; copy them before publishing`,
    )
  if (ArrayBuffer.isView(value)) return
  const children =
    value instanceof Map
      ? [...value.keys(), ...value.values()]
      : value instanceof Set
        ? [...value]
        : Object.values(value)
  for (const child of children) reject_shared_buffers(child, seen)
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
      if (!provenance.model.trim() || !provenance.version.trim())
        throw new Error(`Prediction model and version must be nonempty`)
      const input = structuredClone($state.snapshot(structure))
      const captured_provenance = structuredClone($state.snapshot(provenance))
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
          if (
            overlay?.site_properties &&
            overlay.site_properties.length !== input.sites.length
          )
            throw new Error(
              `Run ${id}: received ${overlay.site_properties.length} property rows for ${input.sites.length} sites`,
            )
          const field_ids = new Set<string>()
          for (const { field_id } of overlay?.volumes ?? []) {
            if (!field_id?.trim() || field_ids.has(field_id))
              throw new Error(
                `Run ${id}: density field ID must be nonempty and unique, got ${field_id}`,
              )
            field_ids.add(field_id)
          }
          if (!overlay) return on_prediction(null)
          const { volumes, ...properties } = overlay
          const copied_properties = structuredClone($state.snapshot(properties))
          reject_shared_buffers(copied_properties)
          on_prediction({
            ...copied_properties,
            // Keep large density buffers out of $state.snapshot so each is copied only once.
            volumes: volumes?.map(({ values, ...metadata }) => ({
              ...structuredClone($state.snapshot(metadata)),
              values: new Float64Array(values),
            })),
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

// JSON preserves the full input and transient outputs, including flat density arrays with
// their lattice, origin, dimensions, ordering and boundary conditions.
export const prediction_to_json = (prediction: StructureToolPrediction): string =>
  JSON.stringify(
    {
      schema: `matterviz-prediction-v1`,
      ...prediction,
      volumes: prediction.volumes?.map(({ values, ...volume }) => ({
        ...volume,
        values: Array.from(values),
      })),
    },
    null,
    2,
  )

// Register before mounting; this also reaches independently mounted file viewers.
export const structure_host_tool = $state<{
  component: Component<StructureToolProps> | null
}>({ component: null })
