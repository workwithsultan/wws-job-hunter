export class ApiError extends Error {
  constructor(
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}
export async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const value = payload as { error?: string; fields?: { field: string; message: string }[] };
    throw new ApiError(
      value.error ?? "The request could not be completed.",
      Object.fromEntries((value.fields ?? []).map((item) => [item.field, item.message])),
    );
  }
  return payload as T;
}
export const dateText = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
