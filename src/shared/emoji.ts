export function countryEmoji(country: string): string {
  const code = country.toLowerCase();
  if (code === "any") return "🌍";
  if (!/^[a-z]{2}$/i.test(country))
    throw new Error("A country flag needs a two-letter country code.");
  const region = ({ uk: "GB", an: "CW" } as Record<string, string>)[code] ?? code.toUpperCase();
  return String.fromCodePoint(...[...region].map((letter) => 127397 + letter.charCodeAt(0)));
}
export const workTypeEmoji = { any: "🌐", remote: "🏠", hybrid: "🔀", onsite: "🏢" } as const;
