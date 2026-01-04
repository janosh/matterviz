// Simplified binary detection
export const is_binary = (content: string): boolean =>
  content.includes(`\0`) ||
  // deno-lint-ignore no-control-regex
  (content.match(/[\u0000-\u0008\u000E-\u001F\u007F-\u00FF]/g) || []).length /
        content.length > 0.1 ||
  (content.match(/[\u0020-\u007E]/g) || []).length / content.length < 0.7
