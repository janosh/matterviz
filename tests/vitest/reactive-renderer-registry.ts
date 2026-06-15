// Shared registry for reactive-renderer-stub.svelte. Lives in a plain .ts module
// (not the .svelte file) so tests can import these named exports with proper types
// -- the ambient `*.svelte` module declaration only types the default export.

export type StubHandle = {
  read: () => Record<string, unknown>
  write: (key: string, value: unknown) => void
}

let current: StubHandle | null = null

export const register_stub = (handle: StubHandle): void => {
  current = handle
}

// Control surface of the most recently mounted stub, for the test to read the
// props a renderer passed in and drive $bindable writeback by key.
export const latest_stub = (): StubHandle => {
  if (!current) throw new Error(`no reactive-renderer-stub mounted yet`)
  return current
}
