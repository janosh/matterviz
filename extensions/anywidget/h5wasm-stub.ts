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

// Mirror h5wasm's class exports so `new h5wasm.File()` and `x instanceof
// h5wasm.Dataset/Group` in the stubbed HDF5 path still resolve -- these must be
// classes (a function can't back `instanceof`), so the empty-class rule is moot.
// oxlint-disable typescript/no-extraneous-class -- intentional class API stubs
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
// oxlint-enable typescript/no-extraneous-class
export type Entity = unknown

// `await h5wasm.ready` in the (normally unused) HDF5 path fails fast with a clear
// error. The no-op catch keeps the never-awaited common case from logging an
// unhandled rejection at load; awaiters still receive the rejection.
export const ready = Promise.reject(
  new Error(`HDF5 parsing is unavailable in the MatterViz widget bundle`),
)
void ready.catch(() => {})

export default { Dataset, Group, File, ready }
