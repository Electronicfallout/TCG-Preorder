// Reicht Anfragen der App „TCG Vorbestellungen“ an die etron-API weiter (etron erlaubt keine Anfragen direkt aus Webseiten).
// Nur die App-Seite darf anfragen (externally_connectable), und nur an https://<instanz>.wawi.onretail.eu/api/…
// Cookies werden nie mitgeschickt; Zugangsdaten bringt die App selbst mit (aus der Dropbox).
// Ab 1.1: heo-Artikelseiten lesen (Seite kurz im Hintergrund öffnen, angezeigte Artikeldaten auslesen, Tab wieder schließen) und heo-Produktbilder laden.
const ALLOWED_URL = /^https:\/\/[a-z0-9-]+\.wawi\.onretail\.eu\/api\//i;
const ALLOWED_ORIGINS = ['https://electronicfallout.github.io'];
const SCRAPE_URL = /^https:\/\/(www\.)?heo\.com\/[a-z]{2}\/[a-z]{2}\/product\/[A-Za-z0-9-]+([?#].*)?$/i;
const IMG_URL = /^https:\/\/([a-z0-9-]+\.)*heo\.com\//i;

chrome.runtime.onMessageExternal.addListener((msg, sender, reply) => {
  const origin = sender.origin || (sender.url ? new URL(sender.url).origin : '');
  if (!ALLOWED_ORIGINS.includes(origin)) { reply({ error: 'Herkunft nicht erlaubt' }); return; }
  if (msg && msg.type === 'hello') { reply({ ok: true, version: chrome.runtime.getManifest().version }); return; }
  if (msg && msg.type === 'scrape') {
    if (typeof msg.url !== 'string' || !SCRAPE_URL.test(msg.url)) { reply({ error: 'Nur Artikelseiten von heo.com können gelesen werden.' }); return; }
    scrape(msg.url).then(reply, (e) => reply({ error: String(e && e.message || e) })); return true;
  }
  if (msg && msg.type === 'img') {
    if (typeof msg.url !== 'string' || !IMG_URL.test(msg.url)) { reply({ error: 'Bildadresse nicht erlaubt' }); return; }
    fetch(msg.url, { credentials: 'include', redirect: 'follow' }).then(async (r) => { const b = await r.blob(); if (!r.ok || !/^image\//.test(b.type) || b.size > 5e6) return reply({ error: 'kein Bild' });
      const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768)); reply({ b64: btoa(s), type: b.type }); })
      .catch((e) => reply({ error: String(e && e.message || e) })); return true;
  }
  if (!msg || msg.type !== 'fetch' || typeof msg.url !== 'string' || !ALLOWED_URL.test(msg.url)) { reply({ error: 'Adresse nicht erlaubt' }); return; }
  const method = ['GET', 'POST', 'PUT'].includes(msg.method) ? msg.method : 'GET';
  const headers = {};
  for (const [k, v] of Object.entries(msg.headers || {})) if (/^(authorization|content-type)$/i.test(k)) headers[k] = String(v);
  fetch(msg.url, { method, headers, body: method === 'GET' ? undefined : msg.body, credentials: 'omit', redirect: 'error' })
    .then(async (r) => reply({ status: r.status, text: await r.text() }))
    .catch((e) => reply({ error: String(e && e.message || e) }));
  return true; // Antwort kommt asynchron
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function scrape(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    const t0 = Date.now(); let prev = -1, ready = false;
    while (Date.now() - t0 < 30000) {
      await wait(1000);
      try { const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: probe }); const p = res && res.result;
        if (p && (p.ready || (p.n > 800 && p.n === prev))) { ready = true; break; } prev = p ? p.n : -1; } catch (e) { /* Seite lädt noch */ }
    }
    await wait(700);
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extract });
    return { ...(res && res.result || {}), timeout: !ready };
  } finally { try { await chrome.tabs.remove(tab.id); } catch (e) {} }
}
// läuft in der heo-Seite
function probe() { const h = document.querySelector('h1'); const t = (h && h.innerText || '').trim(); const n = (document.body && document.body.innerText || '').length;
  return { ready: t.length > 2 && !/loading|please wait|bitte warten/i.test(t) && n > 400, n }; }
function extract() {
  const out = { url: location.href, title: document.title, h1: ((document.querySelector('h1') || {}).innerText || '').trim().slice(0, 300), ld: [], meta: {}, pairs: [], img: '', text: '' };
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => { try { out.ld.push(JSON.parse(s.textContent)); } catch (e) {} });
  document.querySelectorAll('meta[property],meta[name],meta[itemprop]').forEach((m) => { const k = m.getAttribute('property') || m.getAttribute('name') || m.getAttribute('itemprop'); if (k && m.content) out.meta[k] = m.content.slice(0, 500); });
  const T = (el) => (el && el.innerText || '').replace(/\s+/g, ' ').trim();
  document.querySelectorAll('tr').forEach((tr) => { const c = [...tr.children].map(T); if (c.length === 2 && c[0] && c[1]) out.pairs.push([c[0].replace(/:$/, ''), c[1].slice(0, 300)]); });
  document.querySelectorAll('dt').forEach((dt) => { const dd = dt.nextElementSibling; if (dd && dd.tagName === 'DD') out.pairs.push([T(dt).replace(/:$/, ''), T(dd).slice(0, 300)]); });
  document.querySelectorAll('span,div,label,strong,b,th,td,p,li').forEach((el) => { if (el.children.length) return; const t = T(el); if (!t || t.length > 40) return;
    const m = t.match(/^(.{2,38}):\s*(.+)$/); if (m) { out.pairs.push([m[1], m[2].slice(0, 300)]); return; }
    if (/:$/.test(t)) { const n = el.nextElementSibling || (el.parentElement && el.parentElement.nextElementSibling); if (n && T(n)) out.pairs.push([t.replace(/:$/, ''), T(n).slice(0, 300)]); } });
  out.pairs = out.pairs.slice(0, 200);
  const im = [...document.images].filter((i) => i.naturalWidth >= 200 && /^https:/.test(i.currentSrc || i.src)).sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0];
  out.img = im ? (im.currentSrc || im.src) : '';
  // 1.2: alle Bildadressen (auch noch nicht geladene, lazy loading in Hintergrund-Tabs) für die App
  const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return ''; } };
  out.imgs = [...document.querySelectorAll('img,source,[data-src],[data-zoom-image],a[href$=".jpg"],a[href$=".png"],a[href$=".webp"]')].flatMap((e) => [e.currentSrc, e.getAttribute('src'), e.getAttribute('data-src'), e.getAttribute('data-zoom-image'), e.getAttribute('data-lazy'), (e.getAttribute('srcset') || '').split(',').pop().trim().split(' ')[0], e.tagName === 'A' ? e.getAttribute('href') : '']
    .filter(Boolean).map((u) => ({ u: abs(u), alt: (e.getAttribute('alt') || '').slice(0, 120), w: e.naturalWidth || 0 }))).filter((x) => /^https:/.test(x.u) && !/\.svg(\?|$)|logo|icon|sprite|flag|payment/i.test(x.u)).slice(0, 40);
  // Langtext: längster Textblock in einem Beschreibungs-Bereich
  const ds = [...document.querySelectorAll('[class*="descr" i],[id*="descr" i],[class*="beschreib" i],[id*="beschreib" i],[class*="longtext" i],[class*="product-text" i]')].map((e) => (e.innerText || '').trim()).filter((t) => t.length > 60).sort((a, b) => b.length - a.length);
  out.desc = (ds[0] || '').slice(0, 4000);
  out.text = (document.body && document.body.innerText || '').slice(0, 30000);
  return out;
}
