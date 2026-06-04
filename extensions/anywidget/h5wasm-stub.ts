// h5wasm stub for the MatterViz anywidget bundle.
//
// The widget never parses HDF5 (.h5) files in the browser -- pymatviz parses
// trajectories on the Python side and passes structured data. Aliasing `h5wasm`
// to this stub (see vite.config.ts) keeps ~5 MB of HDF5 WASM out of the
// published bundle. The HDF5 parse path throws a clear error if ever reached.

const unsupported = (): never => {
  throw new Error(
    `HDF5 (.h5) files cannot be parsed in the MatterViz widget. Parse the ` +
      `trajectory in Python and pass the structured data instead.`,
  )
}

export class Dataset {
  constructor() {
    unsupported()
  }
}
export class Group {
  constructor() {
    unsupported()
  }
}
export class File {
  constructor() {
    unsupported()
  }
}
export type Entity = unknown

// Thenable that rejects only when awaited (no unhandled rejection at load time).
export const ready: PromiseLike<never> = {
  then: (_on_fulfilled?: unknown, on_rejected?: (reason: Error) => void) =>
    on_rejected?.(new Error(`HDF5 parsing is unavailable in the MatterViz widget bundle`)),
}

export default { Dataset, Group, File, ready }
