export interface FileInfo {
  name: string
  url: string
  label?: string // human-readable display name (falls back to name)
  type?: string
  category?: string
  category_icon?: string
}

/** Stable source identity for content whose logical filename may change after decompression. */
export interface FileLoadMeta {
  /** Original basename before decompression, suitable for rebuilding a source URL. */
  source_filename: string
  /** Requested URL, when content came from a URL rather than a local file. */
  source_url?: string
}

/** Receives parsed content, its logical filename, and stable source identity. */
export type FileLoadCallback = (
  content: string | ArrayBuffer,
  filename: string,
  metadata: FileLoadMeta,
) => Promise<void> | void

/** Common file-load event fields separating logical names from source identity. */
export interface FileLoadData extends Partial<FileLoadMeta> {
  /** Logical filename used for parsing/display; do not use it to rebuild the source URL. */
  filename?: string
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
