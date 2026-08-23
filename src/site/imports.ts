import type { FileInfo } from '$lib/io/types'

// Vite dev yields requested default exports directly, while the Rolldown production
// build can retain the module namespace around eager import.meta.glob values.
export const glob_default = <Value>(value: Value | { default: Value }): Value =>
  typeof value === `object` && value !== null && `default` in value ? value.default : value

export const glob_text = (value: unknown): string => {
  const raw = glob_default(value)
  if (typeof raw === `string`) return raw
  // JSON.stringify(undefined) would return undefined, breaking the string contract
  return raw == null ? `` : JSON.stringify(raw)
}

export const glob_basename = (path: string): string => path.split(`/`).pop() ?? path

// Lower-case last dot-segment of a fixture name or path after stripping a trailing .gz
// (`pb_vf3D.frmsf.gz` -> `frmsf`); extension-less names return the whole stem
// (`Si-CHGCAR.gz` -> `si-chgcar`)
export const fixture_ext = (path: string): string =>
  glob_basename(path).replace(/\.gz$/i, ``).split(`.`).pop()?.toLowerCase() ?? ``

// FileInfo for an import.meta.glob key under $site: static/<dir> symlinks src/site/<dir>, so
// the fixture is served at the path with the /src/site prefix dropped
export const site_file_info = (path: string, extra: Partial<FileInfo> = {}): FileInfo => ({
  name: glob_basename(path),
  url: path.replace(`/src/site`, ``),
  ...extra,
})
