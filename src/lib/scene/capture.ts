// A capture waits for the same render-submission callback as scene snapshots. No polling.
export class SceneCapture {
  private pending?: { revision: number; resolve: () => void; reject: (error: Error) => void }
  private closed = false

  wait(revision: number, signal: AbortSignal): Promise<void> {
    if (this.closed)
      return Promise.reject(new Error(`Scene was unmounted before image export`))
    if (this.pending) return Promise.reject(new Error(`Scene capture is already pending`))
    signal.throwIfAborted()
    const { promise, resolve, reject } = Promise.withResolvers<undefined>()
    const pending = { revision, resolve: () => resolve(undefined), reject }
    this.pending = pending
    const abort = () =>
      reject(new Error(`Scene capture was cancelled`, { cause: signal.reason }))
    signal.addEventListener(`abort`, abort, { once: true })
    return promise.finally(() => {
      signal.removeEventListener(`abort`, abort)
      if (this.pending === pending) this.pending = undefined
    })
  }

  rendered(revision: number, building: boolean, error?: string): void {
    const pending = this.pending
    if (!pending) return
    if (revision !== pending.revision)
      pending.reject(new Error(`Isosurface settings changed during image export; try again`))
    else if (!building) {
      if (error) pending.reject(new Error(error))
      else pending.resolve()
    }
  }

  close(): void {
    this.closed = true
    this.pending?.reject(new Error(`Scene was unmounted before image export`))
  }
}
