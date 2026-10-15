// A plot's bindable error_msg carries the parent's own message in and the plot's errors
// (structure failures, rejected file drops) back out. Each source is kept apart and their
// join is written to the binding, so no ordering of writes loses another source's message.
// Dismissing clears the parent's message and hides the plot's current errors until they change.
export function bind_error_report(
  bound: { get: () => string | undefined; set: (msg: string | undefined) => void },
  own_errors: () => (string | undefined)[],
): { dismiss: () => void } {
  const own = $derived(own_errors().filter(Boolean).join(`; `) || undefined)
  let dismissed: string | undefined
  let parent_msg: string | undefined
  let reported: string | undefined
  $effect(() => {
    const current = bound.get()
    // anything but this plot's last report was written by the parent
    if (current !== reported) parent_msg = current
    if (own !== dismissed) dismissed = undefined
    const shown = own === dismissed ? undefined : own
    reported = [parent_msg, shown].filter(Boolean).join(`; `) || undefined
    bound.set(reported)
  })
  return {
    dismiss: () => {
      dismissed = own
      bound.set(undefined)
    },
  }
}
