// Drives a worker-backed analysis from reactive inputs inside a component. An async compute
// cannot be a $derived, so this owns the one effect every analysis plot used to copy: a
// request id drops results of superseded inputs, the superseded job is aborted so the worker
// client stops tracking it (and terminates the busy worker once nothing else is in flight,
// pre-warming a replacement for the re-request that follows an option keystroke), and a
// failure clears the stale curves so the plot's empty-state message can show the error.
import { to_error } from '$lib/utils'

interface AsyncResultBinding<Input, Options, Result> {
  // Reactive reads; the effect re-runs whenever either changes identity
  input: () => Input | undefined
  options: () => Options
  compute: (input: Input, options: Options, signal: AbortSignal) => Promise<Result>
  // Writers onto the component's bindable props
  set_result: (result: Result | undefined) => void
  set_loading: (loading: boolean) => void
  set_error: (message: string | undefined) => void
}

export function use_async_result<Input, Options, Result>(
  binding: AsyncResultBinding<Input, Options, Result>,
): void {
  let request_id = 0
  $effect(() => {
    const [input, options] = [binding.input(), binding.options()]
    const this_request = ++request_id
    const controller = new AbortController()
    binding.set_loading(Boolean(input))
    if (input) {
      binding.set_error(undefined)
      binding
        .compute(input, options, controller.signal)
        .then((computed) => {
          if (this_request === request_id) binding.set_result(computed)
        })
        .catch((err: unknown) => {
          if (this_request !== request_id) return
          binding.set_result(undefined)
          binding.set_error(to_error(err).message)
        })
        .finally(() => {
          if (this_request === request_id) binding.set_loading(false)
        })
    }
    // Superseded or unmounted: nobody will read this answer, so stop computing it. The id
    // bump keeps the abort rejection from being reported as an error.
    return () => {
      request_id++
      controller.abort()
    }
  })
}
