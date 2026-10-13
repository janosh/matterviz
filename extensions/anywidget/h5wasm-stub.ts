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

// The two members the HDF5 path reads at runtime (h5-utils open_h5_source):
// `await h5wasm.ready`, then `new h5wasm.File()`. Everything else it imports is type-only.
// oxlint-disable-next-line typescript/no-extraneous-class -- intentional class API stub
export class File {
  constructor() {
    unsupported()
  }
}

// `await h5wasm.ready` in the (normally unused) HDF5 path fails fast with a clear
// error. The no-op catch keeps the never-awaited common case from logging an
// unhandled rejection at load; awaiters still receive the rejection.
export const ready = Promise.reject(
  new Error(`HDF5 parsing is unavailable in the MatterViz widget bundle`),
)
void ready.catch(() => {})
