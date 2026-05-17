// Simplified binary detection
export const is_binary = (content: string): boolean => {
  if (!content) return false
  if (content.includes(`\0`)) return true

  let binary_char_count = 0
  let printable_ascii_count = 0

  for (let char_idx = 0; char_idx < content.length; char_idx += 1) {
    const char_code = content.charCodeAt(char_idx)
    if (
      char_code <= 8 ||
      (char_code >= 14 && char_code <= 31) ||
      (char_code >= 127 && char_code <= 255)
    ) {
      binary_char_count += 1
    }
    if (char_code >= 32 && char_code <= 126) printable_ascii_count += 1
  }

  return (
    binary_char_count / content.length > 0.1 || printable_ascii_count / content.length < 0.7
  )
}
