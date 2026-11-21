/* IndexedDB 持久化：照片、音乐与设置都留在同一个浏览器里 */

const DB_NAME = 'xmas-light-tree';
const DB_VERSION = 1;
const PHOTO_STORE = 'photos';
const META_STORE = 'meta';
const LS_PREFIX = 'xmas-tree:';

let dbPromise = null;
let memoryFallback = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) {
        const store = db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  }).catch((err) => {
    console.warn('[store] IndexedDB 不可用，改用内存存储', err);
    memoryFallback = { photos: new Map(), meta: new Map() };
    return null;
  });
  return dbPromise;
}

function tx(db, store, mode, run) {
  return new Promise((resolve, reject) => {
    let request;
    const transaction = db.transaction(store, mode);
    const target = transaction.objectStore(store);
    try {
      request = run(target);
    } catch (err) {
      reject(err);
      return;
    }
    transaction.oncomplete = () => resolve(request && 'result' in request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/* ---------------- 设置 ---------------- */

export async function loadSettings() {
  try {
    const db = await openDB();
    let stored = null;
    if (!db) {
      stored = memoryFallback.meta.get('settings');
    } else {
      stored = await tx(db, META_STORE, 'readonly', (s) => s.get('settings'));
    }
    if (stored) return stored;
  } catch (err) {
    console.warn('[store] 读取设置失败', err);
  }
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}settings`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveSettings(patch) {
  const settings = { ...patch, savedAt: Date.now() };
  try {
    localStorage.setItem(`${LS_PREFIX}settings`, JSON.stringify(settings));
  } catch {
    /* ignore quota */
  }
  try {
    const db = await openDB();
    if (!db) {
      memoryFallback.meta.set('settings', settings);
      return;
    }
    await tx(db, META_STORE, 'readwrite', (s) => s.put(settings, 'settings'));
  } catch (err) {
    console.warn('[store] 保存设置失败', err);
  }
}

/* ---------------- 照片 ---------------- */

export async function listPhotos() {
  try {
    const db = await openDB();
    if (!db) return [...memoryFallback.photos.values()].sort((a, b) => a.createdAt - b.createdAt);
    const all = await tx(db, PHOTO_STORE, 'readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => a.createdAt - b.createdAt);
  } catch (err) {
    console.warn('[store] 读取照片失败', err);
    return [];
  }
}

export async function addPhoto(record) {
  const db = await openDB();
  if (!db) {
    memoryFallback.photos.set(record.id, record);
    return record;
  }
  await tx(db, PHOTO_STORE, 'readwrite', (s) => s.put(record));
  return record;
}

export async function removePhoto(id) {
  const db = await openDB();
  if (!db) {
    memoryFallback.photos.delete(id);
    return;
  }
  await tx(db, PHOTO_STORE, 'readwrite', (s) => s.delete(id));
}

export async function clearPhotos() {
  const db = await openDB();
  if (!db) {
    memoryFallback.photos.clear();
    return;
  }
  await tx(db, PHOTO_STORE, 'readwrite', (s) => s.clear());
}

/* ---------------- 音乐 ---------------- */

export async function saveMusic(record) {
  const db = await openDB();
  if (!db) {
    memoryFallback.meta.set('music', record);
    return;
  }
  await tx(db, META_STORE, 'readwrite', (s) => s.put(record, 'music'));
}

export async function loadMusic() {
  try {
    const db = await openDB();
    if (!db) return memoryFallback.meta.get('music') || null;
    return (await tx(db, META_STORE, 'readonly', (s) => s.get('music'))) || null;
  } catch (err) {
    console.warn('[store] 读取音乐失败', err);
    return null;
  }
}

export async function clearMusic() {
  const db = await openDB();
  if (!db) {
    memoryFallback.meta.delete('music');
    return;
  }
  await tx(db, META_STORE, 'readwrite', (s) => s.delete('music'));
}

export async function estimateUsage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
}
