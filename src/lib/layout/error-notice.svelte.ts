import { untrack } from 'svelte'

// Raises a derived error as the viewer's notice and reports it, then clears that notice (only
// it, not a file-load or caller error) once the error goes away, e.g. bad then good host data
export function derived_error_notice(
  error: () => string | undefined,
  notice: { get: () => string | undefined; set: (message: string | undefined) => void },
  report: (error: string) => void,
): void {
  let raised: string | undefined
  $effect(() => {
    const current = error()
    if (!current && raised && notice.get() === raised) notice.set(undefined)
    raised = current
    if (current) {
      notice.set(current)
      untrack(() => report(current))
    }
  })
}
