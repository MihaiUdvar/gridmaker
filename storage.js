// storage.js — persist the current project in IndexedDB so the work survives
// iOS killing the tab. Images are stored as ArrayBuffers (Safari has had bugs
// storing File objects directly); settings/layout as a small JSON record.

const DB_NAME = 'gridmaker';
const DB_VERSION = 1;
const PROJECT_STORE = 'project';
const PHOTO_STORE = 'photos';
const PROJECT_KEY = 'current';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECT_STORE)) db.createObjectStore(PROJECT_STORE);
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try {
      result = fn(s);
    } catch (e) {
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
  });
}

/** Save layout/settings and the per-photo view state (no image bytes). */
export async function saveProject(project) {
  const db = await openDB();
  await tx(db, PROJECT_STORE, 'readwrite', (s) => s.put(project, PROJECT_KEY));
}

/** Save one photo's bytes + metadata. */
export async function savePhoto({ id, blob, name, type, naturalWidth, naturalHeight }) {
  const db = await openDB();
  const buffer = await blob.arrayBuffer();
  await tx(db, PHOTO_STORE, 'readwrite', (s) =>
    s.put({ id, buffer, name, type: type || blob.type, naturalWidth, naturalHeight }),
  );
}

export async function deletePhoto(id) {
  const db = await openDB();
  await tx(db, PHOTO_STORE, 'readwrite', (s) => s.delete(id));
}

export async function clearAll() {
  const db = await openDB();
  await tx(db, PHOTO_STORE, 'readwrite', (s) => s.clear());
  await tx(db, PROJECT_STORE, 'readwrite', (s) => s.clear());
}

/**
 * Load the saved project and its photos.
 * @returns { project, photos: Map<id, { id, blob, name, type, naturalWidth, naturalHeight }> } | null
 */
export async function loadProject() {
  const db = await openDB();
  const project = await tx(db, PROJECT_STORE, 'readonly', (s) => s.get(PROJECT_KEY));
  if (!project) return null;
  const records = await tx(db, PHOTO_STORE, 'readonly', (s) => s.getAll());
  const wanted = new Set((project.photos || []).map((p) => p.id));
  const photos = new Map();
  const orphans = [];
  for (const rec of records || []) {
    if (!wanted.has(rec.id)) {
      orphans.push(rec.id);
      continue;
    }
    photos.set(rec.id, {
      id: rec.id,
      blob: new Blob([rec.buffer], { type: rec.type || 'image/jpeg' }),
      name: rec.name,
      type: rec.type,
      naturalWidth: rec.naturalWidth,
      naturalHeight: rec.naturalHeight,
    });
  }
  if (orphans.length) {
    tx(db, PHOTO_STORE, 'readwrite', (s) => { orphans.forEach((id) => s.delete(id)); }).catch(() => {});
  }
  return { project, photos };
}
