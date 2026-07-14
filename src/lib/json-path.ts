// Dot/bracket path codec for arbitrary JavaScript object keys.
// Special keys use JSON.stringify so quotes/backslashes/brackets round-trip.

const PATH_IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/u

export function format_path_segment(
  segment: string | number,
  is_first: boolean = false,
): string {
  if (typeof segment === `number`) return `[${segment}]`
  if (PATH_IDENTIFIER_RE.test(segment)) return is_first ? segment : `.${segment}`
  return `[${JSON.stringify(segment)}]`
}

export const format_path = (segments: (string | number)[]): string =>
  segments.map((segment, idx) => format_path_segment(segment, idx === 0)).join(``)

export const build_path = (parent_path: string, key: string | number): string =>
  parent_path ? parent_path + format_path_segment(key) : format_path_segment(key, true)

export function parse_path(path: string): (string | number)[] {
  if (!path) return []

  const segments: (string | number)[] = []
  let pos = 0

  const push_bracket_token = (token: string): void => {
    if (!token) return
    const num = Number(token)
    segments.push(Number.isNaN(num) ? token : num)
  }

  while (pos < path.length) {
    if (path[pos] === `.`) {
      pos++
      continue
    }

    if (path[pos] === `[`) {
      pos++
      if (path[pos] === `]`) {
        pos++
        continue
      }

      if (path[pos] === `"`) {
        const json_start = pos
        const content_start = pos + 1
        pos++
        let escaped = false
        while (pos < path.length) {
          const char = path[pos]
          if (escaped) escaped = false
          else if (char === `\\`) escaped = true
          else if (char === `"`) break
          pos++
        }

        if (pos >= path.length) {
          segments.push(path.slice(content_start))
          break
        }

        try {
          segments.push(JSON.parse(path.slice(json_start, pos + 1)) as string)
        } catch {
          segments.push(path.slice(content_start, pos))
        }
        pos++
        if (path[pos] === `]`) pos++
        continue
      }

      const token_start = pos
      while (pos < path.length && path[pos] !== `]`) pos++
      push_bracket_token(path.slice(token_start, pos))
      if (path[pos] === `]`) pos++
      continue
    }

    const token_start = pos
    while (pos < path.length && path[pos] !== `.` && path[pos] !== `[`) pos++
    if (pos > token_start) segments.push(path.slice(token_start, pos))
  }

  return segments
}

export function resolve_path(root: unknown, path: string): unknown {
  if (!path) return root
  let current: unknown = root
  for (const key of parse_path(path)) {
    if (current == null || typeof current !== `object`) return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}
