// TEMPORARY (#418). The bond-edit failures only reproduce on CI's software renderer, so the
// trace has to ship to be readable. Inert unless a caller opts in by setting
// globalThis.matterviz_bond_trace to an array. Delete this module once the cause is pinned.

export const bond_trace = (event: string, detail: Record<string, unknown>) => {
  const sink = (globalThis as Record<string, unknown>).matterviz_bond_trace
  if (Array.isArray(sink)) sink.push({ event, ...detail })
}
