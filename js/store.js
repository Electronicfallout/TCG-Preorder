// Zusammenführen bei gleichzeitigen Änderungen und Synchronisation.

import { LS, ConflictError } from './storage.js';

export const DATA_PATH = 'vorbestellungen.json';

export function emptyData() {
  return { meta: { version: 1, updatedAt: now() }, products: {}, customers: {}, orders: {} };
}

export function now() { return Date.now(); }

// ---------- Zusammenführen ----------
// Jeder Top-Level-Schlüssel ist entweder ein Datensatz (hat updatedAt) oder eine Sammlung von Datensätzen.
// Bei Sammlungen gewinnt pro Datensatz die neuere Änderung. Gelöschte Datensätze bleiben als {deleted:true}.

function isRecord(v) { return v && typeof v === 'object' && 'updatedAt' in v; }

export function merge(a, b) {
  if (!a) return clone(b);
  if (!b) return clone(a);
  const out = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const x = a[k], y = b[k];
    if (x === undefined) { out[k] = clone(y); continue; }
    if (y === undefined) { out[k] = clone(x); continue; }
    if (isRecord(x) || isRecord(y)) {
      out[k] = clone((x.updatedAt || 0) >= (y.updatedAt || 0) ? x : y);
    } else if (typeof x === 'object' && typeof y === 'object') {
      const m = {};
      for (const id of new Set([...Object.keys(x), ...Object.keys(y)])) {
        const r = x[id], s = y[id];
        if (!r) m[id] = clone(s);
        else if (!s) m[id] = clone(r);
        else m[id] = mergeRecord(r, s);
      }
      out[k] = m;
    } else {
      out[k] = clone(x);
    }
  }
  return out;
}

// Pro Feld zusammenführen: _ft hält je Feld den Zeitpunkt der letzten Änderung ("*" = Zeitpunkt des Anlegens/Ersetzens).
// So überschreibt eine Änderung an der Telefonnummer auf PC B nicht den kurz vorher auf PC A bestätigten Namen.
// Gelöschte Datensätze: der neuere Stand gewinnt ganz.
const META = new Set(['updatedAt', '_ft']);
// '~' = Stand aller Felder ohne eigenen Zeitstempel (bei älteren Datensätzen vor der ersten Feldänderung)
function fieldTs(r, f) { const ft = r._ft || {}; if (f in ft) return ft[f]; return f in r ? (ft['~'] ?? ft['*'] ?? r.updatedAt ?? 0) : (ft['*'] || 0); }
export function mergeRecord(r, s) {
  const newer = (r.updatedAt || 0) >= (s.updatedAt || 0) ? r : s;
  if (r.deleted || s.deleted) return clone(newer);
  const out = {}, ft = {};
  const star = Math.max(r._ft?.['*'] || 0, s._ft?.['*'] || 0); if (star) ft['*'] = star;
  for (const f of new Set([...Object.keys(r), ...Object.keys(s)])) {
    if (META.has(f)) continue;
    const tr = fieldTs(r, f), ts = fieldTs(s, f); const w = tr >= ts ? r : s; const t = Math.max(tr, ts);
    if (t < star) continue; // Feld gab es vor dem letzten Ersetzen des ganzen Datensatzes
    if (f in w) out[f] = clone(w[f]);
    ft[f] = t;
  }
  if (r._ft || s._ft) out._ft = ft;
  out.updatedAt = Math.max(r.updatedAt || 0, s.updatedAt || 0);
  return out;
}

export function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }

export function stable(o) {
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  if (o && typeof o === 'object') return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
  return JSON.stringify(o);
}

// Gelöschte Datensätze nach 120 Tagen endgültig entfernen
export function compact(obj) {
  const limit = now() - 120 * 86400000;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object' && !isRecord(v)) {
      for (const id of Object.keys(v)) if (v[id] && v[id].deleted && v[id].updatedAt < limit) delete v[id];
    }
  }
  return obj;
}

// ---------- Synchronisiertes Dokument ----------
// codec: { decode(file) -> obj, encode(obj) -> file }

export class SyncDoc {
  constructor(provider, path, codec, cacheKey) {
    this.provider = provider;
    this.path = path;
    this.codec = codec || { decode: async (f) => f, encode: async (o) => o };
    this.cacheKey = cacheKey;
    this.obj = null;
    this.rev = null;
    this.dirty = false;
    this.status = 'idle'; // idle | syncing | ok | offline | error
    this.error = null;
    this.lastSync = 0;
    this.listeners = new Set();
    this._timer = null;
    this._running = null;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(this); } catch (e) { console.error(e); } } }

  async loadCache() {
    if (!this.cacheKey) return false;
    const raw = LS.get(this.cacheKey);
    if (!raw) return false;
    try {
      const c = JSON.parse(raw);
      this.obj = await this.codec.decode(c.file);
      this.rev = c.rev;
      this.dirty = !!c.dirty;
      this.lastSync = c.lastSync || 0;
      return true;
    } catch (e) {
      console.warn('Cache unlesbar', e);
      return false;
    }
  }

  async saveCache() {
    if (!this.obj || !this.cacheKey) return;
    const file = await this.codec.encode(this.obj);
    LS.set(this.cacheKey, JSON.stringify({ file, rev: this.rev, dirty: this.dirty, lastSync: this.lastSync }));
  }

  // Liest die Datei aus dem Speicher; null wenn sie (noch) nicht existiert.
  async fetchRemote() {
    const r = await this.provider.read(this.path);
    if (!r) return null;
    return { obj: await this.codec.decode(r.data), rev: r.rev };
  }

  update(fn) {
    if (!this.obj) throw new Error('Dokument nicht geladen');
    fn(this.obj);
    if (this.obj.meta) this.obj.meta.updatedAt = now();
    this.dirty = true;
    this.saveCache();
    this.emit();
    this.scheduleSync(400);
  }

  scheduleSync(ms = 800) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.sync(), ms);
  }

  async sync() {
    if (this._running) { this._again = true; return this._running; }
    this._running = this._sync().finally(() => {
      this._running = null;
      if (this._again) { this._again = false; this.scheduleSync(50); }
    });
    return this._running;
  }

  async _sync() {
    this.status = 'syncing';
    this.emit();
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const remote = await this.fetchRemote();
        if (!remote && !this.obj) break; // Datei gibt es noch nicht: Aufrufer legt sie an
        const merged = compact(merge(this.obj, remote ? remote.obj : null));
        const needWrite = this.dirty || !remote || stable(merged) !== stable(remote.obj);
        if (!needWrite) {
          this.obj = merged;
          this.rev = remote.rev;
          break;
        }
        try {
          const file = await this.codec.encode(merged);
          const res = await this.provider.write(this.path, file, remote ? remote.rev : null);
          this.obj = merged;
          this.rev = res.rev;
          this.dirty = false;
          break;
        } catch (e) {
          if (e instanceof ConflictError || e.conflict) continue; // jemand war schneller: neu laden und zusammenführen
          throw e;
        }
      }
      this.status = 'ok';
      this.error = null;
      this.lastSync = now();
    } catch (e) {
      console.warn('Sync', this.path, e);
      this.status = e.offline ? 'offline' : 'error';
      this.error = e.message || String(e);
    }
    await this.saveCache();
    this.emit();
  }
}
