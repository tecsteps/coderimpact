/**
 * Git pkt-line framing (https://git-scm.com/docs/protocol-common): each line
 * is prefixed with its length as four hex digits; 0000 is a flush packet,
 * 0001 a delimiter, 0002 a response end.
 */
const encoder = new TextEncoder();

export const FLUSH = "0000";
export const DELIM = "0001";

export function pktLine(text: string): string {
  const bytes = encoder.encode(text).length + 4;
  return bytes.toString(16).padStart(4, "0") + text;
}

export type Packet = { kind: "data"; data: Uint8Array } | { kind: "flush" } | { kind: "delim" } | { kind: "end" };

/** Splits a buffer into packets. */
export function* readPackets(buf: Uint8Array): Generator<Packet> {
  let i = 0;
  const dec = new TextDecoder();
  while (i + 4 <= buf.length) {
    const len = Number.parseInt(dec.decode(buf.subarray(i, i + 4)), 16);
    if (Number.isNaN(len)) throw new Error("Malformed pkt-line");
    if (len === 0) {
      yield { kind: "flush" };
      i += 4;
    } else if (len === 1) {
      yield { kind: "delim" };
      i += 4;
    } else if (len === 2) {
      yield { kind: "end" };
      i += 4;
    } else {
      yield { kind: "data", data: buf.subarray(i + 4, i + len) };
      i += len;
    }
  }
}

/** Text lines of a response, without trailing newlines. */
export function packetLines(buf: Uint8Array): string[] {
  const out: string[] = [];
  const dec = new TextDecoder();
  for (const p of readPackets(buf)) if (p.kind === "data") out.push(dec.decode(p.data).replace(/\n$/, ""));
  return out;
}
