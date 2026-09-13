import type { AppSettings, Passage, PassageBook, PassageLesson, Unit } from './types'

const DB_NAME = 'kotonoha-offline-v1'
const DB_VERSION = 1
const STORE = 'snapshots'
const VOCAB_KEY = 'vocab'
const PASSAGES_KEY = 'passages'

export type VocabSnapshot = {
  units: Unit[]
  settings: AppSettings
  savedAt: number
}

export type PassagesSnapshot = {
  passages: Passage[]
  books: PassageBook[]
  lessons: PassageLesson[]
  savedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('INDEXEDDB_UNAVAILABLE'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('INDEXEDDB_OPEN_FAILED'))
  })
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb()
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).get(key)
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
      request.onerror = () => reject(request.error || new Error('INDEXEDDB_GET_FAILED'))
    })
  } catch {
    return null
  }
}

async function idbPut(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error || new Error('INDEXEDDB_PUT_FAILED'))
    })
  } catch {
    /* ignore: offline cache is best-effort */
  }
}

export async function saveVocabState(units: Unit[], settings: AppSettings) {
  const snapshot: VocabSnapshot = { units, settings, savedAt: Date.now() }
  await idbPut(VOCAB_KEY, snapshot)
}

export async function loadVocabState(): Promise<VocabSnapshot | null> {
  const snapshot = await idbGet<VocabSnapshot>(VOCAB_KEY)
  if (!snapshot || !Array.isArray(snapshot.units) || !snapshot.units.length) return null
  return snapshot
}

export async function savePassagesBundle(
  passages: Passage[],
  books: PassageBook[],
  lessons: PassageLesson[],
) {
  const snapshot: PassagesSnapshot = {
    passages,
    books,
    lessons,
    savedAt: Date.now(),
  }
  await idbPut(PASSAGES_KEY, snapshot)
}

export async function loadPassagesBundle(): Promise<PassagesSnapshot | null> {
  const snapshot = await idbGet<PassagesSnapshot>(PASSAGES_KEY)
  if (!snapshot || !Array.isArray(snapshot.passages)) return null
  return snapshot
}
