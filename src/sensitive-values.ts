export function sensitiveValueRepresentations(
  value: string | number | boolean,
): string[] {
  const raw = String(value);
  const representations = new Set([raw]);
  for (const encode of [encodeURI, encodeURIComponent]) {
    try {
      representations.add(encode(raw));
    } catch {
      // Invalid lone surrogate input remains covered by its raw representation.
    }
  }
  try {
    representations.add(
      new URLSearchParams({ value: raw }).get("value") ?? raw,
    );
  } catch {
    // URLSearchParams failures remain covered by the raw representation.
  }
  return [...representations].filter((candidate) => candidate.length > 0);
}
