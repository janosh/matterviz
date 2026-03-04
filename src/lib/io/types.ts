export interface FileInfo {
  name: string
  url: string
  label?: string // human-readable display name (falls back to name)
  type?: string
  category?: string
  category_icon?: string
}
