// Vermittler (Cloudflare Worker) zwischen der App „TCG Vorbestellungen“ und der etron-onRetail-API.
//
// Warum: etron erlaubt keine Anfragen direkt aus dem Browser (CORS), und das Client Secret darf nicht
// in die öffentliche App. Der Worker hält den etron-Zugang als Secret und erlaubt nur wenige, fest
// definierte Aktionen.
//
// In Cloudflare unter Settings → Variables and Secrets einzutragen (alle als „Secret“):
//   ETRON_URL     https://xxxxxx.wawi.onretail.eu   (ohne Pfad)
//   ETRON_KEY     Client Key aus etron (API & Hooks → Authentication)
//   ETRON_SECRET  Client Secret aus etron
//   APP_TOKEN     frei gewähltes langes Passwort; dasselbe kommt in der App unter Einstellungen hinein
// Optional (normale Variable):
//   ALLOWED_ORIGIN  Standard: https://electronicfallout.github.io
//
// Diese Datei enthält keine Zugangsdaten und darf im Repository liegen.

let cached = null; // { token, until }

export default {
  async fetch(req, env) {
    const origin = env.ALLOWED_ORIGIN || 'https://electronicfallout.github.io';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, x-app-token',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply(405, { error: 'Nur POST' });
    if (req.headers.get('origin') !== origin) return reply(403, { error: 'Falsche Herkunft' });
    if (!env.APP_TOKEN || !safeEqual(req.headers.get('x-app-token') || '', env.APP_TOKEN)) return reply(401, { error: 'App-Schlüssel falsch' });
    if (!env.ETRON_URL || !env.ETRON_KEY || !env.ETRON_SECRET) return reply(500, { error: 'Im Worker fehlen ETRON_URL, ETRON_KEY oder ETRON_SECRET' });

    let body;
    try { body = await req.json(); } catch { return reply(400, { error: 'Ungültige Anfrage' }); }
    const action = ACTIONS[body && body.action];
    if (!action) return reply(400, { error: 'Unbekannte Aktion' });
    try {
      return reply(200, await action(api(env), body));
    } catch (e) {
      return reply(502, { error: String(e.message || e).slice(0, 400), status: e.status || null });
    }
  },
};

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function api(env) {
  const base = env.ETRON_URL.replace(/\/+$/, '').replace(/\/api\/v\d+$/, '') + '/api/v2';
  async function token(force) {
    if (!force && cached && cached.until > Date.now()) return cached.token;
    const r = await fetch(base + '/authentication/oauth2/token', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa(env.ETRON_KEY + ':' + env.ETRON_SECRET), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const t = await r.text();
    if (!r.ok) throw Object.assign(new Error('etron-Anmeldung abgelehnt (HTTP ' + r.status + '): ' + t.slice(0, 200)), { status: r.status });
    const j = JSON.parse(t);
    cached = { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in || 3600) - 60) * 1000 };
    return cached.token;
  }
  async function call(method, path, params, json) {
    const q = params ? '?' + Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v))).join('&') : '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(base + path + q, {
        method,
        headers: { Authorization: 'Bearer ' + await token(attempt > 0), ...(json ? { 'Content-Type': 'application/json' } : {}) },
        body: json ? JSON.stringify(json) : undefined,
      });
      if (r.status === 401 && attempt === 0) continue; // Token abgelaufen: neu holen
      const t = await r.text();
      if (!r.ok) throw Object.assign(new Error('etron HTTP ' + r.status + ': ' + t.slice(0, 300)), { status: r.status });
      try { return JSON.parse(t); } catch { return t; }
    }
  }
  return { call, token };
}

const PARTNER_FIELDS = ['id', 'name', 'firstname', 'lastname', 'ref', 'phone', 'mobile', 'email'];
const str = (v, n = 120) => String(v ?? '').trim().slice(0, n);

const ACTIONS = {
  // Verbindung prüfen: anmelden und einen Kunden lesen (es wird nur die Anzahl zurückgegeben)
  async ping(a) {
    await a.token(true);
    const r = await a.call('GET', '/search_extract/res.partner', { fields: ['id'], limit: 1 });
    const list = Array.isArray(r) ? r : (r && (r.data || r.result || r.records)) || [];
    return { ok: true, read: list.length };
  },
  // Kunden suchen: Name, Telefon/Mobil, E-Mail oder Kundennummer
  async partner_search(a, b) {
    const q = str(b.q, 60); if (q.length < 2) return { items: [] };
    const domain = /^\d+$/.test(q)
      ? ['|', '|', '|', ['id', '=', +q], ['ref', '=', q], ['phone', 'ilike', q], ['mobile', 'ilike', q]]
      : ['|', '|', '|', ['name', 'ilike', q], ['email', 'ilike', q], ['phone', 'ilike', q], ['mobile', 'ilike', q]];
    return { items: await a.call('GET', '/search_extract/res.partner', { domain, fields: PARTNER_FIELDS, limit: 15, order: 'name' }) };
  },
  async partner_get(a, b) {
    const id = parseInt(b.id, 10); if (!id) throw new Error('Kundennummer fehlt');
    return { items: await a.call('GET', '/search_extract/res.partner', { domain: [['id', '=', id]], fields: PARTNER_FIELDS, limit: 1 }) };
  },
  async partner_create(a, b) {
    const firstname = str(b.firstname), lastname = str(b.lastname);
    if (!firstname || !lastname) throw new Error('Vor- und Nachname fehlen');
    const values = { firstname, lastname, type: 'contact', customer_rank: 1 };
    if (str(b.phone)) values.mobile = str(b.phone, 40);
    if (str(b.email)) values.email = str(b.email);
    return { result: await a.call('POST', '/create/res.partner', null, { values }) };
  },
  // Artikel über Artikelnummern finden
  async product_find(a, b) {
    const codes = (Array.isArray(b.codes) ? b.codes : []).map((c) => str(c, 60)).filter(Boolean).slice(0, 50);
    if (!codes.length) return { items: [] };
    return { items: await a.call('GET', '/search_read/product.product', { domain: [['default_code', 'in', codes]], fields: ['id', 'default_code', 'name'] }) };
  },
  // Auftrag als Entwurf anlegen (wird NICHT bestätigt)
  async order_create(a, b) {
    const partner = parseInt(b.partner_id, 10); if (!partner) throw new Error('etron-Kundennummer fehlt');
    const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 50)
      .map((l) => ({ product_id: parseInt(l.product_id, 10), product_uom_qty: Math.max(1, Math.min(9999, parseInt(l.qty, 10) || 0)) }))
      .filter((l) => l.product_id);
    if (!lines.length) throw new Error('Keine Auftragszeilen');
    const values = { partner_id: partner, origin: str(b.origin, 60) || 'Vorbestellung', order_line: lines.map((l) => [0, 0, l]) };
    if (str(b.note)) values.note = str(b.note, 500);
    if (str(b.tag)) {
      const tags = await a.call('GET', '/search_read/crm.tag', { domain: [['name', '=', str(b.tag, 60)]], fields: ['id'] });
      const t = Array.isArray(tags) && tags[0];
      if (t && t.id) values.tag_ids = [[6, 0, [t.id]]];
    }
    return { result: await a.call('POST', '/create/sale.order', null, { values }) };
  },
};
