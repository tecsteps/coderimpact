// Request bodies read with a byte cap: counting while reading, so an oversized
// body (with or without Content-Length) is refused without buffering it.

/** Chunks of a web stream or a Node stream, as an async iterable (web streams are cancelled when left early). */
async function* chunksOf(body) {
  if (typeof body.getReader !== "function") {
    yield* body;
    return;
  }
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

function concat(chunks, size) {
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * @param {ReadableStream<Uint8Array> | AsyncIterable<Uint8Array> | null} body
 * @param {number} max
 * @returns {Promise<Uint8Array | null>} the bytes, or null when the body is larger than `max`
 */
export async function readCapped(body, max) {
  if (!body) return new Uint8Array(0);
  const chunks = [];
  let size = 0;
  for await (const value of chunksOf(body)) {
    size += value.byteLength;
    if (size > max) return null;
    chunks.push(value);
  }
  return concat(chunks, size);
}

/** Text of a capped body, or null when it is too large. */
export async function readCappedText(body, max) {
  const bytes = await readCapped(body, max);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}
