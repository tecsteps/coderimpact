import { openDB, type IDBPDatabase } from "idb";
import { AppError } from "../errors";

/**
 * Local folders opened in this browser. Nothing is uploaded: files are read
 * from disk when the reader needs them.
 *
 * Chrome and Edge give a FileSystemDirectoryHandle that is kept in IndexedDB,
 * so a local project reopens after a reload (after one "Allow" click when the
 * browser asks again). Firefox and Safari only hand over the files of a
 * picked or dropped folder; those stay in memory for this tab.
 */

/** URL owner segment of local projects: /~/<name>/tree/<id>. */
export const LOCAL_OWNER = "~";

export function isLocalOwner(owner: string): boolean {
  return owner === LOCAL_OWNER;
}

export interface LocalProject {
  /** 40 hex characters, used where a repository has its commit SHA. */
  id: string;
  /** Folder name as shown. */
  name: string;
  /** URL-safe variant of the name. */
  slug: string;
  handle?: FileSystemDirectoryHandle;
  addedAt: number;
}

/** A local folder that can be listed and read. */
export interface LocalRoot {
  /** Entries of one folder: names and, for files, size and modification time. */
  list(dir: string): Promise<LocalEntry[]>;
  read(path: string): Promise<File>;
  /** Folder handles only: writes a file in place and returns its new state. */
  write?(path: string, text: string): Promise<File>;
}

export interface LocalEntry {
  name: string;
  kind: "file" | "directory";
  size?: number;
  lastModified?: number;
}

const DB = "coderimpact-local";
let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  dbp ??= openDB(DB, 1, {
    upgrade(d) {
      d.createObjectStore("projects", { keyPath: "id" });
    },
  });
  return dbp;
}

/** Progress of listing a local folder, for the loading screen. */
export interface ListingProgress {
  phase: "idle" | "waiting" | "listing";
  entries: number;
}
let listing: ListingProgress = { phase: "idle", entries: 0 };
const listingListeners = new Set<() => void>();
export function setListing(p: ListingProgress) {
  listing = p;
  listingListeners.forEach((l) => l());
}
export function getListing(): ListingProgress {
  return listing;
}
export function subscribeListing(l: () => void) {
  listingListeners.add(l);
  return () => listingListeners.delete(l);
}

/** Roots opened in this tab (handles and in-memory file lists). */
const roots = new Map<string, LocalRoot>();
/** Projects of this tab, also when IndexedDB is unavailable (private windows). */
const known = new Map<string, LocalProject>();

export function supportsDirectoryPicker(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function" && window.self === window.top;
}

function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(20));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function slugFor(name: string): string {
  const s = trimDashesAndDots(name.replace(/[^A-Za-z0-9._-]+/g, "-"));
  return s || "project";
}

// A loop instead of /^[-.]+|[-.]+$/: that regex backtracks on long runs of dashes.
function trimDashesAndDots(s: string): string {
  const edge = (c: string) => c === "-" || c === ".";
  let start = 0;
  let end = s.length;
  while (start < end && edge(s[start])) start++;
  while (end > start && edge(s[end - 1])) end--;
  return s.slice(start, end);
}

export async function listProjects(): Promise<LocalProject[]> {
  let stored: LocalProject[] = [];
  try {
    stored = (await (await db()).getAll("projects")) as LocalProject[];
  } catch {
    /* no IndexedDB: this tab's projects only */
  }
  const byId = new Map(stored.map((p) => [p.id, p]));
  for (const p of known.values()) byId.set(p.id, p);
  return [...byId.values()].sort((a, b) => b.addedAt - a.addedAt);
}

export async function getProject(id: string): Promise<LocalProject | undefined> {
  if (known.has(id)) return known.get(id);
  try {
    return (await (await db()).get("projects", id)) as LocalProject | undefined;
  } catch {
    return undefined;
  }
}

export async function removeProject(id: string): Promise<void> {
  roots.delete(id);
  known.delete(id);
  try {
    await (await db()).delete("projects", id);
  } catch {
    /* nothing stored */
  }
}

async function saveProject(p: LocalProject) {
  known.set(p.id, p);
  try {
    await (await db()).put("projects", p);
  } catch {
    /* private mode: the project still works in this tab */
  }
}

/** Registers a folder handle, reusing the id when the same folder was opened before. */
export async function addHandle(handle: FileSystemDirectoryHandle): Promise<LocalProject> {
  for (const p of await listProjects()) {
    if (p.handle && (await p.handle.isSameEntry(handle).catch(() => false))) {
      const updated = { ...p, handle, addedAt: Date.now() };
      await saveProject(updated);
      roots.set(p.id, handleRoot(handle));
      return updated;
    }
  }
  const project: LocalProject = { id: newId(), name: handle.name, slug: slugFor(handle.name), handle, addedAt: Date.now() };
  await saveProject(project);
  roots.set(project.id, handleRoot(handle));
  return project;
}

/**
 * Registers files from a folder input or a dropped folder (browsers without
 * folder handles). `reuseId` keeps an existing project's links working.
 */
export async function addFiles(name: string, files: { path: string; file: File }[], reuseId?: string): Promise<LocalProject> {
  const previous = reuseId ? await getProject(reuseId) : undefined;
  const project: LocalProject = previous
    ? { ...previous, handle: undefined, addedAt: Date.now() }
    : { id: newId(), name, slug: slugFor(name), addedAt: Date.now() };
  await saveProject(project);
  roots.set(project.id, filesRoot(files));
  return project;
}

/** Opens the system folder picker (Chrome, Edge). */
export async function pickDirectory(): Promise<LocalProject | null> {
  try {
    const handle = await window.showDirectoryPicker({ id: "coderimpact", mode: "read" });
    return addHandle(handle);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

/** Files of an `<input webkitdirectory>` selection, keyed by path inside the picked folder. */
export function filesFromInput(list: FileList): { name: string; files: { path: string; file: File }[] } {
  const files: { path: string; file: File }[] = [];
  let name = "project";
  for (const file of Array.from(list)) {
    const rel = file.webkitRelativePath || file.name;
    const i = rel.indexOf("/");
    if (i > 0) name = rel.slice(0, i);
    files.push({ path: i > 0 ? rel.slice(i + 1) : rel, file });
  }
  return { name, files };
}

/**
 * Something dropped on the page. A folder becomes a project (with a
 * persistent handle where the browser offers one). Dropped files become a
 * small project of their own, opened at the first file.
 */
export async function projectFromDrop(items: DataTransferItemList): Promise<{ project: LocalProject; open?: string } | null> {
  const fileItems = Array.from(items).filter((i) => i.kind === "file");
  if (fileItems.length === 0) return null;
  // Handles and entries must be requested synchronously, before any await.
  const handles = fileItems.map((i) => (i as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.());
  const entries = fileItems.map((i) => i.webkitGetAsEntry?.() ?? null);
  const plain = fileItems.map((i) => i.getAsFile());

  const firstHandle = handles[0] ? await handles[0].catch(() => null) : null;
  if (firstHandle?.kind === "directory") return { project: await addHandle(firstHandle as FileSystemDirectoryHandle) };
  const dirEntry = entries.find((e) => e?.isDirectory);
  if (dirEntry) return { project: await addEntry(dirEntry as FileSystemDirectoryEntry) };

  const files = plain.filter((f): f is File => !!f).map((file) => ({ path: file.name, file }));
  if (files.length === 0) return null;
  const name = files.length === 1 ? files[0].file.name : "Dropped files";
  return { project: await addFiles(name, files), open: files[0].path };
}

/** A dropped folder without a handle: listed lazily from its entry, like a handle. */
async function addEntry(dir: FileSystemDirectoryEntry): Promise<LocalProject> {
  const project: LocalProject = { id: newId(), name: dir.name, slug: slugFor(dir.name), addedAt: Date.now() };
  await saveProject(project);
  roots.set(project.id, entryRoot(dir));
  return project;
}

function entryRoot(root: FileSystemDirectoryEntry): LocalRoot {
  const dirs = new Map<string, Promise<FileSystemDirectoryEntry>>([["", Promise.resolve(root)]]);
  const dir = (path: string): Promise<FileSystemDirectoryEntry> => {
    let p = dirs.get(path);
    if (!p) {
      p = new Promise<FileSystemDirectoryEntry>((res, rej) => root.getDirectory(path, {}, (d) => res(d as FileSystemDirectoryEntry), rej));
      dirs.set(path, p);
      p.catch(() => dirs.delete(path));
    }
    return p;
  };
  const fileOf = (e: FileSystemFileEntry) => new Promise<File>((res, rej) => e.file(res, rej));
  return {
    async list(path) {
      const d = await dir(path);
      const reader = d.createReader();
      const all: FileSystemEntry[] = [];
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        all.push(...batch);
      }
      return Promise.all(
        all.map(async (e): Promise<LocalEntry> => {
          if (e.isDirectory) return { name: e.name, kind: "directory" };
          const f = await fileOf(e as FileSystemFileEntry).catch(() => null);
          return { name: e.name, kind: "file", size: f?.size, lastModified: f?.lastModified };
        }),
      );
    },
    async read(path) {
      return new Promise<File>((res, rej) =>
        root.getFile(path, {}, (e) => (e as FileSystemFileEntry).file(res, rej), () => rej(new AppError("not-found", `${path} is not in the dropped folder.`))),
      );
    },
  };
}

/**
 * The root for a project id, asking for nothing: throws "local-access" when
 * the browser needs the visitor to allow access again, and "not-found" when
 * the folder has to be picked again.
 */
export async function rootFor(id: string): Promise<{ project: LocalProject; root: LocalRoot }> {
  const project = await getProject(id);
  const cached = roots.get(id);
  if (cached && project) return { project, root: cached };
  if (!project) {
    throw new AppError("not-found", "This local folder was not opened in this browser. Open it from the start page with Open a local folder.");
  }
  if (!project.handle) {
    throw new AppError("local-access", `Access to ${project.name} ended when the page was reloaded (this browser does not keep folder access, or the folder was picked with a file input). Choose the folder again to continue.`, {
      localId: id,
    });
  }
  const state = await project.handle.queryPermission({ mode: "read" });
  if (state !== "granted") {
    throw new AppError("local-access", `Your browser needs your permission again to read ${project.name}. The files stay on your computer.`, {
      localId: id,
      canRequest: true,
    });
  }
  const root = handleRoot(project.handle);
  roots.set(id, root);
  return { project, root };
}

/** Asks for read access again (needs a click). */
export async function requestAccess(id: string): Promise<boolean> {
  const project = await getProject(id);
  if (!project?.handle) return false;
  const state = await project.handle.requestPermission({ mode: "read" });
  if (state !== "granted") return false;
  roots.set(id, handleRoot(project.handle));
  return true;
}

function handleRoot(root: FileSystemDirectoryHandle): LocalRoot {
  const dirs = new Map<string, Promise<FileSystemDirectoryHandle>>();
  dirs.set("", Promise.resolve(root));
  const dir = (path: string): Promise<FileSystemDirectoryHandle> => {
    let p = dirs.get(path);
    if (!p) {
      const i = path.lastIndexOf("/");
      p = dir(i >= 0 ? path.slice(0, i) : "").then((parent) => parent.getDirectoryHandle(path.slice(i + 1)));
      dirs.set(path, p);
      p.catch(() => dirs.delete(path));
    }
    return p;
  };
  return {
    async list(path) {
      const d = await dir(path);
      const out: LocalEntry[] = [];
      const files: Promise<void>[] = [];
      for await (const h of d.values()) {
        if (h.kind === "directory") out.push({ name: h.name, kind: "directory" });
        else {
          const e: LocalEntry = { name: h.name, kind: "file" };
          out.push(e);
          files.push(
            (h as FileSystemFileHandle).getFile().then(
              (f) => {
                e.size = f.size;
                e.lastModified = f.lastModified;
              },
              () => undefined,
            ),
          );
        }
      }
      await Promise.all(files);
      return out;
    },
    async read(path) {
      const i = path.lastIndexOf("/");
      const d = await dir(i >= 0 ? path.slice(0, i) : "");
      return (await d.getFileHandle(path.slice(i + 1))).getFile();
    },
    async write(path, text) {
      const i = path.lastIndexOf("/");
      const d = await dir(i >= 0 ? path.slice(0, i) : "");
      const file = await d.getFileHandle(path.slice(i + 1));
      const w = await file.createWritable();
      await w.write(text);
      await w.close();
      return file.getFile();
    },
  };
}

/**
 * Local folders: asks for write access (needs a click or key press; the
 * browser shows its own prompt once per folder). False when the visitor
 * declines or the folder has no handle (file input, other browsers).
 */
export async function requestWriteAccess(id: string): Promise<boolean> {
  const project = await getProject(id);
  if (!project?.handle) return false;
  if ((await project.handle.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await project.handle.requestPermission({ mode: "readwrite" })) === "granted";
}

/** Whether a folder can be written at all: picked or dropped with a folder handle. */
export async function canWriteProject(id: string): Promise<boolean> {
  return !!(await getProject(id))?.handle && browserCanWriteFiles();
}

/** Chrome and Edge on computers can save files a page opened; Safari, Firefox and phones cannot. */
export function browserCanWriteFiles(): boolean {
  return typeof FileSystemFileHandle !== "undefined" && "createWritable" in FileSystemFileHandle.prototype && supportsDirectoryPicker();
}

function filesRoot(files: { path: string; file: File }[]): LocalRoot {
  const byPath = new Map<string, File>();
  const children = new Map<string, Map<string, LocalEntry>>();
  const child = (dir: string) => {
    let m = children.get(dir);
    if (!m) {
      m = new Map();
      children.set(dir, m);
    }
    return m;
  };
  child("");
  for (const { path, file } of files) {
    byPath.set(path, file);
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const name = parts[i];
      const last = i === parts.length - 1;
      if (!child(dir).has(name)) child(dir).set(name, last ? { name, kind: "file", size: file.size, lastModified: file.lastModified } : { name, kind: "directory" });
    }
  }
  return {
    async list(dir) {
      return [...(children.get(dir)?.values() ?? [])];
    },
    async read(path) {
      const f = byPath.get(path);
      if (!f) throw new AppError("not-found", `${path} is not in the picked folder.`);
      return f;
    },
  };
}
