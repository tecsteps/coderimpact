import { Inflate } from "pako";

/**
 * Git packfile reader (https://git-scm.com/docs/pack-format): object headers,
 * zlib-compressed payloads, and offset and reference deltas. Produces the
 * object ids (SHA-1 of "<type> <size>\0<data>") with their contents.
 */
export type ObjectType = "commit" | "tree" | "blob" | "tag";
const TYPES: Record<number, ObjectType> = { 1: "commit", 2: "tree", 3: "blob", 4: "tag" };
const OFS_DELTA = 6;
const REF_DELTA = 7;

export interface GitObject {
  type: ObjectType;
  data: Uint8Array;
}

function hex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** Inflates one zlib stream starting at `offset` and reports how many input bytes it used. */
function inflateAt(buf: Uint8Array, offset: number): { data: Uint8Array; used: number } {
  const inf = new Inflate();
  inf.push(buf.subarray(offset), false);
  if (inf.err) throw new Error(`Pack inflate failed: ${inf.msg}`);
  const strm = (inf as unknown as { strm: { next_in: number } }).strm;
  const data = inf.result as Uint8Array;
  return { data, used: strm.next_in };
}

/** Applies a Git delta (copy and insert instructions) to a base object. */
export function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  const [baseSize, afterBase] = readDeltaSize(delta, 0);
  if (baseSize !== base.length) throw new Error("Delta base size mismatch");
  const [size, start] = readDeltaSize(delta, afterBase);
  const out = new Uint8Array(size);
  let o = 0;
  let i = start;
  while (i < delta.length) {
    const op = delta[i++];
    if (op & 0x80) {
      const copy = readCopy(delta, op, i);
      out.set(base.subarray(copy.off, copy.off + copy.len), o);
      o += copy.len;
      i = copy.next;
    } else if (op) {
      out.set(delta.subarray(i, i + op), o);
      o += op;
      i += op;
    } else throw new Error("Invalid delta opcode");
  }
  if (o !== size) throw new Error("Delta result size mismatch");
  return out;
}

/** A delta header size (little-endian base-128) at `pos`, and the position after it. */
function readDeltaSize(delta: Uint8Array, pos: number): [number, number] {
  let v = 0;
  let shift = 0;
  let b: number;
  do {
    b = delta[pos++];
    v |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80);
  return [v, pos];
}

/** A copy instruction's base offset and length; the opcode's low bits say which bytes follow. */
function readCopy(delta: Uint8Array, op: number, pos: number): { off: number; len: number; next: number } {
  let off = 0;
  let len = 0;
  if (op & 0x01) off |= delta[pos++];
  if (op & 0x02) off |= delta[pos++] << 8;
  if (op & 0x04) off |= delta[pos++] << 16;
  if (op & 0x08) off |= delta[pos++] << 24;
  if (op & 0x10) len |= delta[pos++];
  if (op & 0x20) len |= delta[pos++] << 8;
  if (op & 0x40) len |= delta[pos++] << 16;
  if (len === 0) len = 0x10000;
  return { off: off >>> 0, len, next: pos };
}

async function objectId(type: ObjectType, data: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`${type} ${data.length}\0`);
  const full = new Uint8Array(header.length + data.length);
  full.set(header);
  full.set(data, header.length);
  // Git names objects by their SHA-1; this is an identifier, not a security check.
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-1", full)));
}

interface RawEntry {
  offset: number;
  type: number;
  data: Uint8Array;
  baseOffset?: number;
  baseId?: string;
}

/**
 * Parses a complete packfile into objects keyed by id. `known` supplies bases
 * for thin-pack reference deltas that are not in the pack itself.
 */
export async function parsePack(pack: Uint8Array, known?: Map<string, GitObject>): Promise<Map<string, GitObject>> {
  const entries = readEntries(pack);
  const byOffset = new Map<number, GitObject>();
  const byId = new Map<string, GitObject>();
  const pending: RawEntry[] = [];
  for (const e of entries) {
    if (e.type === OFS_DELTA || e.type === REF_DELTA) {
      pending.push(e);
      continue;
    }
    const obj = { type: TYPES[e.type], data: e.data };
    byOffset.set(e.offset, obj);
    byId.set(await objectId(obj.type, obj.data), obj);
  }
  // Deltas can depend on other deltas: resolve in passes until nothing changes.
  let progress = true;
  while (pending.length && progress) progress = await resolvePass(pending, byOffset, byId, known);
  if (pending.length) throw new Error(`${pending.length} pack objects reference missing bases`);
  return byId;
}

/** Applies every pending delta whose base is known; true when at least one was resolved. */
async function resolvePass(pending: RawEntry[], byOffset: Map<number, GitObject>, byId: Map<string, GitObject>, known?: Map<string, GitObject>): Promise<boolean> {
  let progress = false;
  const unresolved: RawEntry[] = [];
  for (let k = pending.length - 1; k >= 0; k--) {
    const e = pending[k];
    const base = e.baseOffset === undefined ? byId.get(e.baseId!) ?? known?.get(e.baseId!) : byOffset.get(e.baseOffset);
    if (!base) {
      unresolved.push(e);
      continue;
    }
    const obj = { type: base.type, data: applyDelta(base.data, e.data) };
    byOffset.set(e.offset, obj);
    byId.set(await objectId(obj.type, obj.data), obj);
    progress = true;
  }
  // Keep the unresolved ones in pack order for the next pass (no splice per entry: that is quadratic).
  pending.length = 0;
  for (let k = unresolved.length - 1; k >= 0; k--) pending.push(unresolved[k]);
  return progress;
}

/** The raw (still deltified) entries of a packfile, in pack order. */
function readEntries(pack: Uint8Array): RawEntry[] {
  const sig = new TextDecoder().decode(pack.subarray(0, 4));
  if (sig !== "PACK") throw new Error("Not a packfile");
  const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  const count = view.getUint32(8);
  let pos = 12;
  const entries: RawEntry[] = [];
  for (let n = 0; n < count; n++) {
    const offset = pos;
    const header = readEntryHeader(pack, pos);
    const { data, used } = inflateAt(pack, header.pos);
    pos = header.pos + used;
    entries.push({ offset, type: header.type, data, baseOffset: header.baseOffset, baseId: header.baseId });
  }
  return entries;
}

/** An entry's type and delta base, and the position of its zlib payload. */
function readEntryHeader(pack: Uint8Array, offset: number): { type: number; pos: number; baseOffset?: number; baseId?: string } {
  let pos = offset;
  let b = pack[pos++];
  const type = (b >> 4) & 7;
  // Object size (not needed: the inflated length is authoritative).
  while (b & 0x80) b = pack[pos++];
  if (type === OFS_DELTA) {
    b = pack[pos++];
    let rel = b & 0x7f;
    while (b & 0x80) {
      b = pack[pos++];
      rel = ((rel + 1) << 7) | (b & 0x7f);
    }
    return { type, pos, baseOffset: offset - rel };
  }
  if (type === REF_DELTA) return { type, pos: pos + 20, baseId: hex(pack.subarray(pos, pos + 20)) };
  return { type, pos };
}

export interface TreeItem {
  mode: string;
  name: string;
  id: string;
}

/** Parses a tree object: entries of "<mode> <name>\0<20-byte id>". */
export function parseTree(data: Uint8Array): TreeItem[] {
  const out: TreeItem[] = [];
  const dec = new TextDecoder();
  let i = 0;
  while (i < data.length) {
    const space = data.indexOf(0x20, i);
    const nul = data.indexOf(0x00, space);
    const mode = dec.decode(data.subarray(i, space));
    const name = dec.decode(data.subarray(space + 1, nul));
    out.push({ mode: mode.padStart(6, "0"), name, id: hex(data.subarray(nul + 1, nul + 21)) });
    i = nul + 21;
  }
  return out;
}

/** The tree id of a commit object. */
export function commitTree(data: Uint8Array): string {
  const m = /^tree ([0-9a-f]{40})/m.exec(new TextDecoder().decode(data.subarray(0, 200)));
  if (!m) throw new Error("Commit has no tree");
  return m[1];
}
