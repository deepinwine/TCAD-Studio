/** Python's 80-character limit counts Unicode code points, not UTF-16 units. */
export function cleanRecipeName(value: string): string | null {
  const name = value.trim();
  const length = Array.from(name).length;
  return length >= 1 && length <= 80 ? name : null;
}
