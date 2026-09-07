import "server-only";

export async function nhtsaJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12000),
    next: { revalidate: 86400 },
  });
  if (!response.ok)
    throw new Error(
      "Vehicle data is temporarily unavailable. Try again or enter the details manually.",
    );
  return response.json();
}
