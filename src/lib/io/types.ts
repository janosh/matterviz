export interface FileInfo {
  name: string
  url: string
  label?: string // human-readable display name (falls back to name)
  type?: string
  category?: string
  category_icon?: string
}

// Single item in an export pane section, rendered as `label [⬇] [📋] [(DPI: input)]`
export interface ExportItem {
  label: string
  // Tooltip for the item label (HTML allowed, sanitized before render)
  hint?: string
  // Disables the download and copy buttons
  disabled?: boolean
  // Click handler for the ⬇ download button (omit to hide the button)
  on_download?: () => void
  // Lazy clipboard content for the 📋 copy button (omit to hide); runs on click only, return null/empty to no-op, must not throw
  copy_text?: () => string | null
  // Render the shared DPI input next to this item
  show_dpi?: boolean
}

export interface ExportSection {
  title?: string
  // Tooltip for the section heading (HTML allowed, sanitized before render)
  tooltip?: string
  items: ExportItem[]
}
