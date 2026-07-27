// TEMPORARY (#418). The bond-edit failures only reproduce on CI's software renderer, so the
// trace has to ship to be readable. Inert unless a caller opts in by setting
// globalThis.matterviz_bond_trace to an array. Delete this module once the cause is pinned.

// The sink is global, so every Structure and StructureScene on the page writes to it. Without
// an id per component instance there is no way to tell a parent ignoring its child's write-back
// from two unrelated instances reporting independently.
let next_trace_id = 0
export const new_trace_id = (prefix: string) => `${prefix}${next_trace_id++}`

export const bond_trace = (event: string, id: string, detail: Record<string, unknown>) => {
  const sink = (globalThis as Record<string, unknown>).matterviz_bond_trace
  // Millisecond stamps: the open question is whether reset is slow or merely observed late,
  // and only the gap between the click and the restoring emit can tell those apart.
  if (Array.isArray(sink))
    sink.push({ event, id, t: Math.round(performance.now()), ...detail })
}
