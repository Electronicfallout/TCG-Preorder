// Speicher-Anbieter: Dropbox (App-Ordner) oder "Nur dieses Gerät" zum Ausprobieren.
// Schnittstelle:
//   read(path)              -> { data, rev } | null (nicht vorhanden)
//   write(path, data, rev)  -> { rev }   (rev null = neu anlegen; wirft ConflictError bei fremder Änderung)
//   list(folder)            -> [name]

import { pkcePair } from './pkce.js';

export class ConflictError extends Error { constructor() { super('conflict'); this.conflict = true; } }
export class OfflineError extends Error { constructor(m) { super(m || 'offline'); this.offline = true; } }
export class AuthError extends Error { constructor(m) { super(m || 'auth'); this.auth = true; } }

const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* voll oder gesperrt */ } },
  del(k) { try { localStorage.removeItem(k); } catch { } },
};
export { LS };

// ---------- Nur auf diesem Gerät ----------

export class LocalProvider {
  constructor() { this.kind = 'local'; }
  async read(path) {
    const raw = LS.get('vb.file:' + path);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return { data: o.data, rev: o.rev };
  }
  async write(path, data, rev) {
    const cur = await this.read(path);
    if ((cur ? cur.rev : null) !== (rev || null)) throw new ConflictError();
    const nrev = String(Date.now()) + Math.random().toString(36).slice(2, 6);
    LS.set('vb.file:' + path, JSON.stringify({ data, rev: nrev }));
    return { rev: nrev };
  }
  async list(folder) {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const pre = 'vb.file:' + folder + '/';
        if (k.startsWith(pre)) out.push(k.slice(pre.length));
      }
    } catch { }
    return out;
  }
}

// ---------- Programm (Vorbestellungen.exe): Dateien im lokalen Dropbox-Ordner ----------
// Der Dropbox-Client gleicht die Dateien zwischen den PCs ab. Konfliktkopien werden beim Abgleich zusammengeführt.

const enc = encodeURIComponent;
export async function desktopInfo() {
  if (!/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return null;
  try { const r = await fetch('/api/info', { headers: { 'X-VB': '1' } }); if (!r.ok) return null; const j = await r.json(); return j.app === 'vorbestellungen' ? j : null; } catch { return null; }
}
export async function desk(url, opts = {}) {
  try { return await fetch(url, { ...opts, headers: { ...(opts.headers || {}), 'X-VB': '1' } }); }
  catch (e) { throw new OfflineError('Programm läuft nicht mehr. Bitte Vorbestellungen.exe neu starten.'); }
}
async function errText(r) { try { const j = await r.json(); return j.error || r.status; } catch { return r.status; } }

export class DiskProvider {
  constructor() { this.kind = 'disk'; }
  async read(path) {
    const r = await desk('/api/fs/read?path=' + enc(path));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Lesefehler: ' + await errText(r));
    return { data: JSON.parse(await r.text()), rev: r.headers.get('X-Rev') };
  }
  async write(path, data, rev) {
    const r = await desk('/api/fs/write?path=' + enc(path) + '&rev=' + enc(rev || ''), { method: 'PUT', body: JSON.stringify(data) });
    if (r.status === 409) throw new ConflictError();
    if (!r.ok) throw new Error('Speicherfehler: ' + await errText(r));
    return { rev: (await r.json()).rev };
  }
  async list(folder) { const r = await desk('/api/fs/list?folder=' + enc(folder)); return r.ok ? r.json() : []; }
  async conflicts(path) { const r = await desk('/api/fs/conflicts?path=' + enc(path)); return r.ok ? r.json() : []; }
  async remove(path) { await desk('/api/fs/remove?path=' + enc(path), { method: 'POST' }); }
}

// ---------- Dropbox ----------
// Zugang: { appKey, refreshToken }. Access-Token wird bei Bedarf geholt.

function asciiJson(o) {
  // Dropbox-API-Arg muss ASCII sein
  return JSON.stringify(o).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

export class DropboxProvider {
  constructor(cred) {
    this.kind = 'dropbox';
    this.appKey = cred.appKey;
    this.refreshToken = cred.refreshToken;
    this.accessToken = null;
    this.expires = 0;
  }

  async token() {
    if (this.accessToken && Date.now() < this.expires - 60000) return this.accessToken;
    let r;
    try {
      r = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.refreshToken, client_id: this.appKey }),
      });
    } catch (e) { throw new OfflineError(); }
    if (r.status === 400 || r.status === 401) throw new AuthError('Dropbox-Zugang ungültig oder widerrufen');
    if (!r.ok) throw new OfflineError('Dropbox nicht erreichbar (' + r.status + ')');
    const j = await r.json();
    this.accessToken = j.access_token;
    this.expires = Date.now() + (j.expires_in || 3600) * 1000;
    return this.accessToken;
  }

  async call(url, opts) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await this.token();
      let r;
      try {
        r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } });
      } catch (e) { throw new OfflineError(); }
      if (r.status === 401 && attempt === 0) { this.accessToken = null; continue; }
      if (r.status === 401) throw new AuthError();
      if (r.status === 429 || r.status >= 500) throw new OfflineError('Dropbox ausgelastet (' + r.status + ')');
      return r;
    }
  }

  async read(path) {
    const r = await this.call('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: { 'Dropbox-API-Arg': asciiJson({ path: '/' + path }) },
    });
    if (r.status === 409) {
      const txt = await r.text();
      if (txt.includes('not_found')) return null;
      throw new Error('Dropbox-Fehler: ' + txt);
    }
    if (!r.ok) throw new Error('Dropbox-Fehler ' + r.status);
    const meta = JSON.parse(r.headers.get('dropbox-api-result') || '{}');
    const data = JSON.parse(await r.text());
    return { data, rev: meta.rev };
  }

  async write(path, data, rev) {
    const mode = rev ? { '.tag': 'update', update: rev } : { '.tag': 'add' };
    const r = await this.call('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': asciiJson({ path: '/' + path, mode, autorename: false, mute: true, strict_conflict: true }),
      },
      body: new Blob([JSON.stringify(data)]),
    });
    if (r.status === 409) {
      const txt = await r.text();
      if (txt.includes('conflict')) throw new ConflictError();
      throw new Error('Dropbox-Fehler: ' + txt);
    }
    if (!r.ok) throw new Error('Dropbox-Fehler ' + r.status);
    const meta = await r.json();
    return { rev: meta.rev };
  }

  async list(folder) {
    const r = await this.call('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '/' + folder }),
    });
    if (r.status === 409) return [];
    if (!r.ok) throw new Error('Dropbox-Fehler ' + r.status);
    let j = await r.json();
    const names = j.entries.filter((e) => e['.tag'] === 'file').map((e) => e.name);
    while (j.has_more) {
      const r2 = await this.call('https://api.dropboxapi.com/2/files/list_folder/continue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cursor: j.cursor }),
      });
      j = await r2.json();
      names.push(...j.entries.filter((e) => e['.tag'] === 'file').map((e) => e.name));
    }
    return names;
  }
}

// ---------- Dropbox-Anmeldung (nur Planer) ----------

export function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export async function startDropboxLogin(appKey) {
  const { verifier, challenge } = await pkcePair();
  LS.set('vb.pkce', JSON.stringify({ verifier, appKey }));
  const p = new URLSearchParams({
    client_id: appKey,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline',
    redirect_uri: redirectUri(),
  });
  location.href = 'https://www.dropbox.com/oauth2/authorize?' + p.toString();
}

// Wird beim Start aufgerufen; gibt {appKey, refreshToken} zurück, wenn wir gerade von Dropbox zurückkommen.
export async function finishDropboxLogin() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  if (!code) return null;
  const saved = JSON.parse(LS.get('vb.pkce') || 'null');
  history.replaceState(null, '', location.pathname + location.hash);
  if (!saved) throw new Error('Anmeldung abgelaufen, bitte erneut versuchen');
  LS.del('vb.pkce');
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, client_id: saved.appKey,
      code_verifier: saved.verifier, redirect_uri: redirectUri(),
    }),
  });
  if (!r.ok) throw new Error('Dropbox-Anmeldung fehlgeschlagen: ' + (await r.text()));
  const j = await r.json();
  return { appKey: saved.appKey, refreshToken: j.refresh_token };
}

// ---------- Einladungscode ----------
// Format: VB1.<base64url(JSON)>

export function makeInvite(cred) {
  const json = JSON.stringify({ k: cred.appKey, t: cred.refreshToken });
  const b = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'VB1.' + b;
}

export function parseInvite(code) {
  code = String(code || '').trim();
  const m = code.match(/VB1\.([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    let s = m[1].replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const o = JSON.parse(decodeURIComponent(escape(atob(s))));
    if (!o.k || !o.t) return null;
    return { appKey: o.k, refreshToken: o.t };
  } catch { return null; }
}
