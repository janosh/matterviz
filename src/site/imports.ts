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
