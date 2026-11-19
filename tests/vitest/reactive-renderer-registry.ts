// Shared registry for reactive-renderer-stub.svelte. Lives in a plain .ts module
// (not the .svelte file) so tests can import these named exports with proper types
// -- the ambient `*.svelte` module declaration only types the default export.

export type StubHandle = {
  read: () => Record<string, unknown>
  write: (key: string, value: unknown) => void
}

const handles: StubHandle[] = []

export const register_stub = (handle: StubHandle): void => {
  handles.push(handle)
}

export const reset_stub = (): void => {
  handles.length = 0
}

// Defaults to the last renderer mounted. Pages with multiple viewers can select one by index.
export const renderer_stub = (idx = -1): StubHandle => {
  const handle = handles.at(idx)
  if (!handle) throw new Error(`No renderer at index ${idx} among ${handles.length} mounted`)
  return handle
}
