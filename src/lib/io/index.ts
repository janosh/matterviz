import { COMPRESSION_EXTENSIONS_REGEX } from '$lib/constants'

export { default as ExportPane } from './ExportPane.svelte'
export * from './decompress'
export * from './export'
export * from './fetch'
export * from './file-drop'
export * from './is-binary'
export type * from './types'
export * from './url-drop'

// Lowercase a filename and strip all trailing compression extensions (.gz, .zip, ...)
export function strip_compression_extensions(filename: string): string {
  let base_name = filename.toLowerCase()
  while (COMPRESSION_EXTENSIONS_REGEX.test(base_name)) {
    base_name = base_name.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
  }
  return base_name
}
