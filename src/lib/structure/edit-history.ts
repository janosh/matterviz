// Pure undo/redo stack mechanics for Structure.svelte's edit-atoms history.
// Stacks are treated as immutable (updates return new arrays) so they work with
// $state.raw holders where only reassignment is reactive. Kept free of
// component state so the real logic (not a test-local mirror) is unit-testable.

export type HistoryStacks<T> = [undo_stack: T[], redo_stack: T[]]

// Record a new edit: push `snapshot` onto the undo stack (trimming to
// `max_history` entries) and invalidate the redo stack.
export function push_edit<T>(
  [undo_stack]: HistoryStacks<T>,
  snapshot: T,
  max_history: number,
): HistoryStacks<T> {
  const trimmed =
    undo_stack.length >= max_history
      ? undo_stack.slice(undo_stack.length - max_history + 1)
      : undo_stack
  return [[...trimmed, snapshot], []]
}

// Step the history in `direction`: pop that stack's top as the state to
// restore, pushing `current` onto the opposite stack. Returns null when there
// is nothing to step to (callers should snapshot `current` lazily by checking
// stack length first if snapshots are expensive).
export function step_history<T>(
  [undo_stack, redo_stack]: HistoryStacks<T>,
  direction: `undo` | `redo`,
  current: T,
): { stacks: HistoryStacks<T>; restored: T } | null {
  const source = direction === `undo` ? undo_stack : redo_stack
  const restored = source.at(-1)
  if (restored === undefined) return null
  const remaining = source.slice(0, -1)
  const stacks: HistoryStacks<T> =
    direction === `undo`
      ? [remaining, [...redo_stack, current]]
      : [[...undo_stack, current], remaining]
  return { stacks, restored }
}
