// Drives a worker-backed analysis from reactive inputs inside a component. An async compute
// cannot be a $derived, so this owns the one effect every analysis plot used to copy: the
// superseded job is aborted so the worker client stops tracking it (and terminates the busy
// worker once nothing else is in flight, pre-warming a replacement for the re-request that
// follows an option keystroke), its settlement is ignored, and a failure clears the stale
// curves so the plot's empty-state message can show the error.
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
  $effect(() => {
    const [input, options] = [binding.input(), binding.options()]
    // Aborted by the cleanup below, so `signal.aborted` is exactly "superseded or unmounted":
    // nobody will read that answer (nor its abort rejection)
    const controller = new AbortController()
    const { signal } = controller
    binding.set_loading(Boolean(input))
    if (input) {
      binding.set_error(undefined)
      binding
        .compute(input, options, signal)
        .then((computed) => {
          if (!signal.aborted) binding.set_result(computed)
        })
        .catch((err: unknown) => {
          if (signal.aborted) return
          binding.set_result(undefined)
          binding.set_error(to_error(err).message)
        })
        .finally(() => {
          if (!signal.aborted) binding.set_loading(false)
        })
    }
    return () => controller.abort()
  })
}
