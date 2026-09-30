// Drives a worker-backed analysis from reactive inputs inside a component. An async compute
// cannot be a $derived, so this owns the one effect every analysis plot used to copy: the
// superseded job is aborted so the worker client stops tracking it (and terminates the busy
// worker once nothing else is in flight), its settlement is ignored, and a failure clears the stale
// curves so the plot's empty-state message can show the error.
import { to_error } from '$lib/utils'
import type { TrajectoryPositionStream } from './index'

// One pane owns one request across collection and computation. Aborting a settled request
// is harmless, so its signal also remains the stale-result guard until the next request.
export function create_request_owner() {
  let controller: AbortController | undefined
  const cancel = () => {
    controller?.abort()
    controller = undefined
  }
  return {
    cancel,
    start: (): AbortSignal => {
      cancel()
      controller = new AbortController()
      return controller.signal
    },
  }
}

// Structured-cloneable copy of a position stream for a worker payload. Svelte proxies cannot
// be cloned and `$state.snapshot(stream)` would deep-copy the buffer before postMessage copies
// it again, so the typed array goes straight through and only the small plain parts are
// snapshotted. Per-site `vectors` / frame `signals` are dropped: the analyses read them off
// the input they were lifted into (VACF velocities, spectroscopy signals), never off the stream.
export const plain_position_stream = ({
  positions,
  n_frames,
  n_atoms,
  coords_unwrapped,
  frame_stride,
  elements,
  lattice_matrices,
  pbc,
  steps,
}: TrajectoryPositionStream): TrajectoryPositionStream => ({
  positions,
  n_frames,
  n_atoms,
  coords_unwrapped,
  frame_stride,
  elements: $state.snapshot(elements),
  lattice_matrices: $state.snapshot(lattice_matrices),
  pbc: $state.snapshot(pbc),
  steps: $state.snapshot(steps),
})

interface AsyncResultBinding<Input, Options, Result> {
  // Reactive reads: a new input identity recomputes, options only when their JSON changes (so
  // a recreated but equal object does not). Options must therefore be JSON-serializable.
  // Without input, result/loading/error are the caller's props, reset only on its withdrawal.
  input: () => Input | undefined
  options: () => Options
  compute: (input: Input, options: Options, signal: AbortSignal) => Promise<Result>
  // Main-thread edits of the computed result (e.g. relabelling the lag axis for a new dt):
  // reruns on its own reactive reads without recomputing, and reports a throw as the error
  revise?: (result: Result) => Result
  // Writers onto the component's bindable props
  set_result: (result: Result | undefined) => void
  set_loading: (loading: boolean) => void
  set_error: (message: string | undefined) => void
  // Off where the parent reports its own failure into the shared error slot as it withdraws
  // the input (TrajectoryAnalysisPane's failed collect)
  clear_error_on_withdraw?: boolean
}

export function use_async_result<Input, Options, Result>(
  binding: AsyncResultBinding<Input, Options, Result>,
): void {
  const options_key = $derived(JSON.stringify(binding.options()))
  // Dropped whenever the input changes, so a superseded result is never revised onto the next
  let computed = $state.raw<Result>()
  // Non-reactive, and reset on withdrawal so it never pins a (maybe hundreds of MB) buffer
  let last_input: Input | undefined
  $effect(() => {
    const input = binding.input()
    const options: Options = JSON.parse(options_key)
    if (input !== last_input) computed = undefined
    // Aborted by the cleanup below, so `signal.aborted` is exactly "superseded or unmounted":
    // nobody will read that answer (nor its abort rejection)
    const controller = new AbortController()
    const { signal } = controller
    if (input) {
      binding.set_loading(true)
      binding.set_error(undefined)
      binding
        .compute(input, options, signal)
        .then((value) => {
          if (!signal.aborted) computed = value
        })
        .catch((err: unknown) => {
          if (signal.aborted) return
          computed = undefined
          binding.set_error(to_error(err).message)
        })
        .finally(() => {
          if (!signal.aborted) binding.set_loading(false)
        })
    } else if (last_input) {
      binding.set_result(undefined)
      binding.set_loading(false)
      if (binding.clear_error_on_withdraw) binding.set_error(undefined)
    }
    last_input = input
    return () => controller.abort()
  })
  // Without an input the result prop holds the caller's precomputed curves, left untouched
  $effect(() => {
    if (!binding.input()) return
    binding.set_result(undefined)
    // Nothing computed yet, or a failure whose error only a new compute clears
    if (!computed) return
    try {
      binding.set_result(binding.revise ? binding.revise(computed) : computed)
      binding.set_error(undefined) // a corrected revise-only edit starts no compute to clear it
    } catch (exc) {
      binding.set_error(to_error(exc).message)
    }
  })
}
