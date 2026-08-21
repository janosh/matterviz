import { CellSelection } from '$lib/table'
import { describe, expect, it } from 'vitest'

describe(`CellSelection`, () => {
  const sorted_keys = (selection: CellSelection) => [...selection.keys].toSorted()

  it(`drag selects a rectangle in either direction, additive drags stack`, () => {
    const selection = new CellSelection()
    selection.start_drag({ row: 2, col: 1 }, false)
    expect(selection.dragging).toBe(true)
    expect(selection.extend_drag({ row: 2, col: 1 })).toBe(false) // same cell: no change
    expect(selection.extend_drag({ row: 0, col: 0 })).toBe(true) // dragging up-left
    expect(sorted_keys(selection)).toEqual([`0:0`, `0:1`, `1:0`, `1:1`, `2:0`, `2:1`])
    expect(selection.end_drag()).toBe(true) // crossed cells -> caller swallows the click

    selection.start_drag({ row: 5, col: 5 }, true)
    expect(selection.end_drag()).toBe(false) // a plain click selects one cell
    expect(selection.size).toBe(7)
    expect(selection.has(5, 5)).toBe(true)

    selection.start_drag({ row: 9, col: 9 }, false) // non-additive replaces everything
    expect(sorted_keys(selection)).toEqual([`9:9`])
    selection.clear()
    expect(selection.size).toBe(0)
    expect(selection.end_drag()).toBe(false)
  })

  it(`keyboard steps replace the selection, Shift grows it from the anchor`, () => {
    const selection = new CellSelection()
    selection.step({ row: 0, col: 0 }, { row: 1, col: 0 }, false)
    expect(sorted_keys(selection)).toEqual([`1:0`])
    selection.step({ row: 1, col: 0 }, { row: 3, col: 0 }, true)
    selection.step({ row: 3, col: 0 }, { row: 3, col: 1 }, true)
    expect(sorted_keys(selection)).toEqual([`1:0`, `1:1`, `2:0`, `2:1`, `3:0`, `3:1`])
    // without a prior rectangle, Shift anchors at the cell being left
    const fresh = new CellSelection()
    fresh.step({ row: 4, col: 4 }, { row: 4, col: 5 }, true)
    expect(sorted_keys(fresh)).toEqual([`4:4`, `4:5`])
  })

  it(`serialises rectangles as TSV blocks clipped to the table size`, () => {
    const selection = new CellSelection()
    selection.rects = [
      { start_row: 0, start_col: 0, end_row: 1, end_col: 1 },
      { start_row: 5, start_col: 0, end_row: 9, end_col: 4 }, // overshoots a 6x2 table
    ]
    expect(selection.to_tsv(6, 2, (row, col) => `r${row}c${col}`)).toBe(
      `r0c0\tr0c1\nr1c0\tr1c1\nr5c0\tr5c1`,
    )
  })
})
