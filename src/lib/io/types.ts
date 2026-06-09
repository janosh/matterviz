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
  // Disables the download button (and the copy button unless copy_disabled is set)
  disabled?: boolean
  // Click handler for the ⬇ download button (omit to hide the button)
  on_download?: () => void
  // Tooltip for the download button (defaults to `Download {label}`)
  download_title?: string
  // Lazy clipboard content for the 📋 copy button (omit to hide the button).
  // Only evaluated on click; return null/empty string to no-op. Must not throw.
  copy_text?: () => string | null
  // Disables only the copy button (falls back to `disabled`)
  copy_disabled?: boolean
  // Render the shared DPI input next to this item
  show_dpi?: boolean
}

export interface ExportSection {
  title?: string
  // Tooltip for the section heading (HTML allowed, sanitized before render)
  tooltip?: string
  items: ExportItem[]
}
