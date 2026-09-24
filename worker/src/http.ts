const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export const NO_STORE = { "Cache-Control": "no-store" };
export const PUBLIC_CACHE = { "Cache-Control": "public, max-age=300" };

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

/** Error response: { ok: false, error, message, ...extra }. */
export function problem(
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  return json({ ok: false, error, message, ...extra }, status, {
    ...NO_STORE,
    ...headers,
  });
}

export function text(
  body: string,
  contentType: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    headers: { ...BASE_HEADERS, "Content-Type": contentType, ...headers },
  });
}

export function withHeaders(
  response: Response,
  headers: Record<string, string>,
): Response {
  const copy = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers))
    copy.headers.set(name, value);
  return copy;
}

export type BodyResult =
  | { ok: true; text: string; bytes: number }
  | { ok: false; reason: "too_large" | "invalid_utf8" };

/** Reads the request body as UTF-8, giving up as soon as it exceeds maxBytes. */
export async function readBody(
  request: Request,
  maxBytes: number,
): Promise<BodyResult> {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes)
    return { ok: false, reason: "too_large" };
  if (!request.body) return { ok: true, text: "", bytes: 0 };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return {
      ok: true,
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        buffer,
      ),
      bytes,
    };
  } catch {
    return { ok: false, reason: "invalid_utf8" };
  }
}

/** The media type of the request without parameters, lower-cased. */
export function mediaType(request: Request): string {
  return (request.headers.get("Content-Type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
}
