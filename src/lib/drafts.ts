// Local drafts for voice updates made while offline / when a request failed. IndexedDB lives in this browser profile only
// (origin-isolated, not synced, not encrypted at rest beyond the device's own protection). Drafts are deleted after success.
export type Draft = { id: string; createdAt: number; transcript?: string; audio?: Blob; mime?: string; leadId?: string; error?: string };
const DB = "vault-drafts", STORE = "drafts";
const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = async <T,>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open();
  return new Promise<T>((res, rej) => { const r = f(db.transaction(STORE, mode).objectStore(STORE)); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
};
export const saveDraft = async (d: Omit<Draft, "id" | "createdAt"> & { id?: string }) => {
  const draft: Draft = { id: d.id ?? crypto.randomUUID(), createdAt: Date.now(), ...d }; await tx("readwrite", (s) => s.put(draft)); return draft;
};
export const listDrafts = async (): Promise<Draft[]> => { try { return ((await tx("readonly", (s) => s.getAll())) as Draft[]).sort((a, b) => b.createdAt - a.createdAt); } catch { return []; } };
export const deleteDraft = async (id: string) => { try { await tx("readwrite", (s) => s.delete(id)); } catch { /* ignore */ } };
