/** Python str.isspace() in the supported runtime, excluding JavaScript-only FEFF. */
const edgeWhitespace = /^[\u0009-\u000D\u001C-\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+|[\u0009-\u000D\u001C-\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$/gu;

export function stripRecipeName(value: string): string {
  return value.replace(edgeWhitespace, '');
}

/** Python's 80-character limit counts Unicode code points, not UTF-16 units. */
export function cleanRecipeName(value: string): string | null {
  const name = stripRecipeName(value);
  const length = Array.from(name).length;
  return length >= 1 && length <= 80 ? name : null;
}
