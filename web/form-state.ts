export function keywordEntry(
  saved: readonly string[],
  entry: string,
): { values: string[]; error: string } {
  const values = entry
    .split(/[,\n]/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (!values.length) return { values, error: "Enter a keyword." };
  if (values.some((term) => term.length > 100 || /["\r]/.test(term)))
    return { values, error: "Use keywords of up to 100 characters, without quotation marks." };
  if (saved.length + values.length > 30) return { values, error: "Use no more than 30 keywords." };
  const seen = new Set(saved.map((term) => term.toLowerCase()));
  for (const value of values) {
    if (seen.has(value.toLowerCase())) return { values, error: `Already added: "${value}".` };
    seen.add(value.toLowerCase());
  }
  return { values, error: "" };
}
