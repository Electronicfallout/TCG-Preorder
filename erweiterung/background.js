// Reicht Anfragen der App „TCG Vorbestellungen“ an die etron-API weiter (etron erlaubt keine Anfragen direkt aus Webseiten).
// Nur die App-Seite darf anfragen (externally_connectable), und nur an https://<instanz>.wawi.onretail.eu/api/…
// Cookies werden nie mitgeschickt; Zugangsdaten bringt die App selbst mit (aus der Dropbox).
const ALLOWED_URL = /^https:\/\/[a-z0-9-]+\.wawi\.onretail\.eu\/api\//i;
const ALLOWED_ORIGINS = ['https://electronicfallout.github.io'];

chrome.runtime.onMessageExternal.addListener((msg, sender, reply) => {
  const origin = sender.origin || (sender.url ? new URL(sender.url).origin : '');
  if (!ALLOWED_ORIGINS.includes(origin)) { reply({ error: 'Herkunft nicht erlaubt' }); return; }
  if (msg && msg.type === 'hello') { reply({ ok: true, version: chrome.runtime.getManifest().version }); return; }
  if (!msg || msg.type !== 'fetch' || typeof msg.url !== 'string' || !ALLOWED_URL.test(msg.url)) { reply({ error: 'Adresse nicht erlaubt' }); return; }
  const method = ['GET', 'POST', 'PUT'].includes(msg.method) ? msg.method : 'GET';
  const headers = {};
  for (const [k, v] of Object.entries(msg.headers || {})) if (/^(authorization|content-type)$/i.test(k)) headers[k] = String(v);
  fetch(msg.url, { method, headers, body: method === 'GET' ? undefined : msg.body, credentials: 'omit', redirect: 'error' })
    .then(async (r) => reply({ status: r.status, text: await r.text() }))
    .catch((e) => reply({ error: String(e && e.message || e) }));
  return true; // Antwort kommt asynchron
});
