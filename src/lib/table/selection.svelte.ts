// Cell-range selection model for HeatmapTable: a list of rectangles in absolute (sorted-row
// index, visible-column index) coordinates. Drag selects one rectangle, Shift/Cmd-drag adds
// disjoint ones, Shift+arrow grows the newest from its anchor. Headless so the geometry is
// testable without a DOM; the component maps pointer/keyboard events onto these calls.
export type CellPos = { row: number; col: number }
export type CellRect = {
  start_row: number
  start_col: number
  end_row: number
  end_col: number
}
type RectBounds = { row_lo: number; row_hi: number; col_lo: number; col_hi: number }

const rect_bounds = (rect: CellRect): RectBounds => ({
  row_lo: Math.min(rect.start_row, rect.end_row),
  row_hi: Math.max(rect.start_row, rect.end_row),
  col_lo: Math.min(rect.start_col, rect.end_col),
  col_hi: Math.max(rect.start_col, rect.end_col),
})

export class CellSelection {
  rects = $state<CellRect[]>([])
  dragging = $state(false)
  // true once a drag crossed into another cell, so the click on release can be swallowed
  drag_moved = false

  // Every selected cell as "row:col", for O(1) lookups while rendering
  keys = $derived.by(() => {
    const keys = new Set<string>()
    for (const rect of this.rects) {
      const { row_lo, row_hi, col_lo, col_hi } = rect_bounds(rect)
      for (let row = row_lo; row <= row_hi; row++) {
        for (let col = col_lo; col <= col_hi; col++) keys.add(`${row}:${col}`)
      }
    }
    return keys
  })
  size = $derived(this.keys.size)

  has = (row: number, col: number): boolean => this.keys.has(`${row}:${col}`)
  clear = (): void => {
    this.rects = []
  }

  // Pointer down on a cell: start a 1x1 rectangle, replacing the selection unless additive
  start_drag(pos: CellPos, additive: boolean): void {
    const rect = { start_row: pos.row, start_col: pos.col, end_row: pos.row, end_col: pos.col }
    this.rects = additive ? [...this.rects, rect] : [rect]
    this.dragging = true
    this.drag_moved = false
  }

  // Pointer moved over another cell while dragging: stretch the newest rectangle to it.
  // Returns true when this move actually changed the selection.
  extend_drag(pos: CellPos): boolean {
    const active = this.rects.at(-1)
    if (!this.dragging || !active) return false
    if (pos.row === active.end_row && pos.col === active.end_col) return false
    this.drag_moved = true
    this.rects = [
      ...this.rects.slice(0, -1),
      { ...active, end_row: pos.row, end_col: pos.col },
    ]
    return true
  }

  // Pointer up anywhere: returns whether the drag crossed cells (caller suppresses the click)
  end_drag(): boolean {
    if (!this.dragging) return false
    this.dragging = false
    return this.drag_moved
  }

  // Keyboard step from `from` to `to`: Shift grows the newest rectangle from where it
  // started, a plain arrow replaces the selection with the 1x1 cell it lands on.
  step(from: CellPos, to: CellPos, extend: boolean): void {
    const anchor = extend
      ? (this.rects.at(-1) ?? { start_row: from.row, start_col: from.col })
      : { start_row: to.row, start_col: to.col }
    const kept = extend ? this.rects.slice(0, -1) : []
    this.rects = [...kept, { ...anchor, end_row: to.row, end_col: to.col }]
  }

  // Selected cells as TSV blocks (one per rectangle, blank line between), read through
  // `cell_text`; rectangles are clipped to the current row/column counts.
  to_tsv(
    n_rows: number,
    n_cols: number,
    cell_text: (row: number, col: number) => string,
  ): string {
    return this.rects
      .map((rect) => {
        const bounds = rect_bounds(rect)
        const row_hi = Math.min(bounds.row_hi, n_rows - 1)
        const col_hi = Math.min(bounds.col_hi, n_cols - 1)
        const lines: string[] = []
        for (let row = bounds.row_lo; row <= row_hi; row++) {
          const cells: string[] = []
          for (let col = bounds.col_lo; col <= col_hi; col++) cells.push(cell_text(row, col))
          lines.push(cells.join(`\t`))
        }
        return lines.join(`\n`)
      })
      .join(`\n`)
  }
}
