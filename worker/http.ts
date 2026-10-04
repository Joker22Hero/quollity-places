import type { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
export function fail(
  status: 400 | 401 | 403 | 404 | 409 | 413 | 503,
  message: string,
): never {
  throw new HTTPException(status, { message });
}
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.output<T>> {
  if (!request.headers.get('content-type')?.includes('application/json'))
    fail(400, 'Send application/json.');
  if (!request.body) fail(400, 'A JSON body is required.');
  const reader = request.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 131072) {
        await reader.cancel();
        fail(413, 'Request exceeds 128 KiB.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail(400, 'Invalid JSON.');
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    fail(
      400,
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
        .join('; '),
    );
  return parsed.data;
}
