export type DownloadData = string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>

function default_download(data: DownloadData, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const link = document.createElement(`a`)
  link.href = url
  link.download = filename
  // A detached anchor keeps its synthetic click away from document-level dismissal handlers.
  try {
    link.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Download data to a file, unless a global `download` override (installed by the VS Code
// webview to route saves through the host) takes it
export function download(data: DownloadData, filename: string, type: string): void {
  const global_download = (globalThis as Record<string, unknown>).download
  if (typeof global_download === `function` && global_download !== download) {
    return (global_download as typeof download)(data, filename, type)
  }
  return default_download(data, filename, type)
}
