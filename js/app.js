// TCG Vorbestellungen: Oberfläche und Logik.
// Daten liegen ausschließlich in der Dropbox (App-Ordner) oder beim Ausprobieren im Browser.
import { LS, LocalProvider, DropboxProvider, startDropboxLogin, finishDropboxLogin, makeInvite, parseInvite, redirectUri } from './storage.js';
import { SyncDoc, DATA_PATH, emptyData, now } from './store.js';
import { APP_VERSION } from './version.js';

const STATUSES = ["Offen","Zugeteilt","Auftrag angelegt","Abgeholt","Warteliste","Storniert"];
const LOCKED = new Set(["Auftrag angelegt","Abgeholt"]);         // Zuteilung steht fest
const COUNTS = s => s !== "Storniert" && s !== "Warteliste";       // zählt zur Vorbestellung
const S = { products:{}, customers:{}, orders:{}, loaded:{p:false,c:false,o:false}, db:null, canWrite:true, downloads:null, err:null, sugg:{} };
const $ = s => document.querySelector(s);
const app = $("#app");
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = v => (v === "" || v == null || isNaN(+v)) ? null : +v;
const today = () => new Date().toISOString().slice(0,10);
const fmtDate = d => d ? d.split("-").reverse().join(".") : "";
const pill = s => `<span class="pill s-${esc((s||"").split(" ")[0])}">${esc(s)}</span>`;
function toast(t){const el=$("#toast");el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,2600)}
const store = (k,v) => { try { if (v===undefined) return localStorage.getItem(k); localStorage.setItem(k,v);} catch(e){ return null; } };

// ---------- Kürzel
const staffEl = $("#staff"); staffEl.value = store("staff") || "";
staffEl.addEventListener("change", () => { staffEl.value = staffEl.value.toUpperCase().trim(); store("staff", staffEl.value); });
const staff = () => staffEl.value.toUpperCase().trim();

// ---------- Spiele
const GAMES = ["One Piece","Pokémon","Riftbound"];
const gameOf = p => p?.game || "One Piece";
S.game = store("game") || "Alle"; if (S.game!=="Alle" && !GAMES.includes(S.game)) S.game="Alle";
const inGame = p => S.game==="Alle" || gameOf(p)===S.game;
function setGame(g){ S.game=g; store("game",g); drawGames(); render(); }
function drawGames(){ const g=$("#games"); g.innerHTML=["Alle",...GAMES].map(x=>`<button type="button" class="${x===S.game?"on":""}" data-g="${x}">${x}</button>`).join("");
  g.querySelectorAll("button").forEach(b=>b.onclick=()=>{ S.game=b.dataset.g; store("game",S.game); drawGames(); render(); }); }
drawGames();

// ---------- name matching (Dubletten)
const norm = s => (s||"").toLowerCase().replace(/ß/g,"ss").normalize("NFKD").replace(/[̀-ͯ]/g,"").replace(/[^a-z ]/g," ").replace(/\s+/g," ").trim();
function lev(a,b){ if(Math.abs(a.length-b.length)>3) return 9; const d=[...Array(b.length+1).keys()]; for(let i=1;i<=a.length;i++){let p=d[0];d[0]=i;for(let j=1;j<=b.length;j++){const t=d[j];d[j]=Math.min(d[j]+1,d[j-1]+1,p+(a[i-1]===b[j-1]?0:1));p=t}} return d[b.length]; }
function similar(a,b){
  const na=norm(a), nb=norm(b); if(!na||!nb||na===nb) return na===nb;
  const sa=na.split(" ").sort().join(" "), sb=nb.split(" ").sort().join(" ");
  if (sa===sb || lev(sa,sb)<=2) return true;
  const ta=na.split(" "), tb=nb.split(" ");
  const lastA=ta[ta.length-1], lastB=tb[tb.length-1];
  return ta.length>1 && tb.length>1 && (lastA===lastB || ta[0]===tb[0] && lev(lastA,lastB)<=1) && (ta[0].startsWith(tb[0])||tb[0].startsWith(ta[0])||ta.includes(lastB)&&tb.includes(lastA));
}
const notDupe = (a,b) => (a.notDupes||[]).includes(b.id) || (b.notDupes||[]).includes(a.id);
const sameEtron = (a,b) => a.etronId && b.etronId && String(a.etronId).trim()===String(b.etronId).trim();
const dupesOf = c => Object.values(S.customers).filter(x => x.id!==c.id && !notDupe(c,x) && (similar(x.name,c.name) || sameEtron(x,c)));
const custByName = n => Object.values(S.customers).find(c => norm(c.name)===norm(n));

// ---------- derived numbers
function ordersOf(pid){ return Object.values(S.orders).filter(o=>o.productId===pid); }
// „Egal welches“-Bestellungen einer Serie: productId ist leer, choices nennt die möglichen Produkte
function flexOf(pid){ return Object.values(S.orders).filter(o=>!o.productId && (o.choices||[]).includes(pid)); }
const seriesOf = p => (p?.series||"").trim();
const siblings = p => seriesOf(p) ? Object.values(S.products).filter(x=>!x.archived && seriesOf(x)===seriesOf(p)).sort((a,b)=>a.name.localeCompare(b.name)) : (p?[p]:[]);
const orderLabel = o => o.productId ? (S.products[o.productId]?.name||"?") : (o.choices||[]).map(id=>S.products[id]?.name||"?").join(" oder ");
function stats(p){
  const os = ordersOf(p.id);
  const pre = os.filter(o=>COUNTS(o.status)).reduce((s,o)=>s+(o.qty||0),0);
  const alloc = os.filter(o=>o.status!=="Storniert").reduce((s,o)=>s+(o.alloc||0),0);
  const open = os.filter(o=>o.status==="Offen" && (o.qty||0)>0).length;
  const wait = os.filter(o=>o.status==="Warteliste").length;
  const rec = num(p.received);
  const flex = flexOf(p.id).filter(o=>COUNTS(o.status)).reduce((s,o)=>s+(o.qty||0),0);
  return { flex, pre, alloc, open, wait, rec, free: rec==null?null:rec-alloc, n: os.filter(o=>COUNTS(o.status)).length, over: rec!=null && alloc>rec };
}
const relKey = r => { if(!r) return "9999"; if(/^\d{4}-\d{2}-\d{2}$/.test(r)) return r; const q=r.match(/Q(\d)\s*(\d{4})/i); if(q) return `${q[2]}-${String(q[1]*3).padStart(2,"0")}-31`; const y=r.match(/^(\d{4})$/); if(y) return `${y[1]}-12-31z`; return "9998"; };
const relTxt = r => /^\d{4}-\d{2}-\d{2}$/.test(r||"") ? fmtDate(r) : (r || "offen");
const sortOrders = (a,b) => (a.date||"9999").localeCompare(b.date||"9999") || (a.createdAt||"").localeCompare(b.createdAt||"") || a.id.localeCompare(b.id);

// ---------- Zuteilung: proportional mit Restverteilung (größter Rest, bei Gleichstand frühere Bestellung) oder nach Eingang
function suggest(p, mode, noFlex){
  const os = ordersOf(p.id).filter(o=>o.status!=="Storniert" && o.status!=="Warteliste" && (o.qty||0)>0).sort(sortOrders);
  const fixed = os.filter(o=>LOCKED.has(o.status)); const flex = os.filter(o=>!LOCKED.has(o.status));
  let avail = (num(p.received)||0) - fixed.reduce((s,o)=>s+(o.alloc||0),0);
  const res = {}; avail = Math.max(0, avail);
  const want = flex.reduce((s,o)=>s+o.qty,0);
  if (want <= avail){ flex.forEach(o=>res[o.id]=o.qty); }
  else if (mode==="fifo"){ let a=avail; for(const o of flex){ const g=Math.min(o.qty,a); res[o.id]=g; a-=g; } }
  else {
    let used=0; const rest=[];
    flex.forEach((o,i)=>{ const exact=o.qty*avail/want; const b=Math.floor(exact+1e-9); res[o.id]=b; used+=b; rest.push({o,r:exact-b,i}); });
    rest.sort((x,y)=> y.r-x.r || x.i-y.i);
    for (const {o} of rest){ if(used>=avail) break; if(res[o.id]<o.qty){ res[o.id]++; used++; } }
  }
  if (noFlex) return res;
  // Was übrig bleibt, geht an „egal welches“-Bestellungen der Serie (nach Bestelldatum)
  let left = avail - Object.values(res).reduce((a,b)=>a+b,0);
  for (const o of flexOf(p.id).filter(o=>o.status==="Offen" && (o.qty||0)>0).sort(sortOrders)){ if(left<=0) break; const g=Math.min(o.qty,left); res[o.id]=g; left-=g; }
  return res;
}

// ---------- writes
async function write(col,id,data,mode="update"){
  if(!S.db){ toast("Speichern nicht möglich: nicht verbunden."); return false; }
  try { const ref=S.db.collection(col).doc(id); await (mode==="set"?ref.set(data):mode==="delete"?ref.delete():ref.update(data)); return true; }
  catch(e){ if(e.code==="invalid_argument"&&mode!=="set"){ S.canWrite=false; } toast(e.code==="quota_exceeded"?"Datenbank voll: bitte alte Einträge löschen.":"Nicht gespeichert: "+(e.message||e.code)); return false; }
}
async function pool(items, fn, n=4){ let i=0, done=0; const run=async()=>{ while(i<items.length){ const it=items[i++]; for(let t=0;t<4;t++){ try{ await fn(it); break; } catch(e){ if(e.code!=="resource_exhausted"&&e.code!=="unavailable") throw e; await new Promise(r=>setTimeout(r,800*(t+1)+Math.random()*400)); } } done++; } }; await Promise.all(Array.from({length:n},run)); return done; }
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2,6);

// ---------- views
const h0=()=>(location.hash||"#produkte").slice(1);
function route(){ const h=(location.hash||"#produkte").slice(1); document.querySelectorAll("#nav a").forEach(a=>{const v=a.dataset.v; a.classList.toggle("on", h===v || (v==="produkte"&&(h.startsWith("produkt-")||h.startsWith("serie-"))) || (v==="kunden"&&h.startsWith("kunde-")));}); render(); }
function render(){
  if (S.err) { app.innerHTML = `<div class="note bad">${esc(S.err)}</div>`; return; }
  if (!(S.loaded.p&&S.loaded.c&&S.loaded.o)) return;
  if (!S.skipImport && !Object.keys(S.products).length && !Object.keys(S.orders).length && h0()!=="einstellungen") return renderImport();
  const h=h0();
  const keepFocus = document.activeElement && document.activeElement.id; const sel = keepFocus && document.activeElement.selectionStart;
  if (h.startsWith("produkt-")) renderProduct(h.slice(8));
  else if (h.startsWith("kunde-")) renderCustomer(h.slice(6));
  else if (h.startsWith("serie-")) renderSeries(h.slice(6));
  else if (h==="kunden") renderCustomers();
  else if (h==="dubletten") renderDupes();
  else if (h==="export") renderExport();
  else if (h==="einstellungen") renderSettings();
  else renderProducts();
  if (keepFocus){ const el=document.getElementById(keepFocus); if(el){ el.focus(); try{ if(sel!=null) el.setSelectionRange(sel,sel);}catch(e){} } }
}

function renderImport(){
  app.innerHTML = `<div class="panel setup"><h1>Noch keine Daten</h1>
  <p class="sub">Die Datei <span class="mono">vorbestellungen.json</span> in der Dropbox ist leer. Du kannst eine Sicherung übernehmen (z. B. den JSON-Export der bisherigen App) oder direkt unter Produkte loslegen.</p>
  <div class="row"><label class="row"><input type="file" id="impf" accept=".json,application/json"></label><span id="impst" class="muted"></span></div>
  <div class="row"><button id="start">Ohne Daten starten</button>${S.provider?.kind==="local"?'<button id="demo">Beispieldaten laden</button>':""}</div></div>`;
  $("#impf").onchange = e => importFile(e.target.files[0], $("#impst"));
  $("#start").onclick = () => { S.skipImport=true; location.hash="produkte"; renderProducts(); };
  const d=$("#demo"); if(d) d.onclick=()=>importObj(demoData());
}
// Produkte einer Serie (mind. 2 aktive) als eine Zeile zeigen
function listRows(ps){
  const out=[]; const done=new Set();
  for (const p of ps){ const sib=siblings(p).filter(x=>ps.includes(x));
    if (seriesOf(p) && !p.archived && sib.length>1){ if(done.has(seriesOf(p))) continue; done.add(seriesOf(p)); out.push({isSeries:true, sib}); }
    else out.push(p); }
  return out;
}
function seriesRow({sib}){
  const st=sib.map(stats); const sum=k=>st.reduce((a,s)=>a+(s[k]||0),0); const flex=Math.max(...st.map(s=>s.flex||0));
  const rec=st.some(s=>s.rec!=null)?sum("rec"):null; const pre=sum("pre")+flex; const pct=rec&&pre?Math.min(100,Math.round(rec/pre*100)):0; const free=rec==null?null:rec-sum("alloc");
  return `<tr class="click" data-go="serie-${sib[0].id}"><td><a href="#serie-${sib[0].id}"><b>Serie ${esc(seriesOf(sib[0]))}</b></a> <span class="muted">${sib.map(x=>esc(x.name)).join(" + ")}</span>${S.game==="Alle"?`<span class="gtag">${esc(gameOf(sib[0]))}</span>`:""}</td>
    <td>${esc(relTxt(sib[0].release))}</td><td class="n">${pre}</td><td class="n">${sum("n")+(flex?Object.values(S.orders).filter(o=>!o.productId&&COUNTS(o.status)&&(o.choices||[]).some(c=>sib.some(x=>x.id===c))).length:0)}</td>
    <td class="n">${rec??"–"}</td><td class="n">${sum("alloc")||""}</td>
    <td>${rec==null?'<span class="muted">Ware fehlt</span>':`<div class="bar-meter" title="${pct}% gedeckt"><i style="width:${pct}%"></i></div>`}</td><td class="n">${free??""}</td></tr>`;
}
function renderProducts(){
  const q = (S.pq||"").toLowerCase(); const showArch = S.parch;
  const ps = Object.values(S.products).filter(p=>inGame(p) && (showArch||!p.archived) && (!q || p.name.toLowerCase().includes(q))).sort((a,b)=>relKey(a.release).localeCompare(relKey(b.release))||a.name.localeCompare(b.name));
  const tot = ps.reduce((a,p)=>{const s=stats(p);a.pre+=s.pre;a.open+=s.open;a.over+=s.over?1:0;a.wait+=s.wait;return a},{pre:0,open:0,over:0,wait:0});
  app.innerHTML = `
  <div class="row spread"><div><h1>Produkte${S.game==="Alle"?"":" · "+esc(S.game)}</h1><p class="sub">Sortiert nach Release. Auf ein Produkt klicken, um Bestellungen zu sehen und zuzuteilen.</p></div></div>
  <div class="tiles">
    <div class="tile"><b>${ps.length}</b><span>Produkte</span></div>
    <div class="tile"><b>${tot.pre}</b><span>Stück vorbestellt</span></div>
    <div class="tile"><b>${tot.open}</b><span>Bestellungen offen</span></div>
    <div class="tile"><b>${tot.wait}</b><span>auf Warteliste</span></div>
    <div class="tile ${tot.over?"bad":""}"><b>${tot.over}</b><span>überzugeteilt</span></div>
  </div>
  <div class="row"><input id="pq" class="search" placeholder="Produkt suchen, z. B. OP19" value="${esc(S.pq||"")}"><label class="row muted"><input type="checkbox" id="parch" ${showArch?"checked":""}> Archivierte zeigen</label></div>
  ${(()=>{const hid=Object.values(S.products).filter(p=>!p.archived&&!inGame(p)).length; return hid?`<div class="note">${hid} Produkte anderer Spiele sind ausgeblendet. <button class="sm" id="showall">Alle Spiele zeigen</button></div>`:"";})()}
  <div class="tablebox"><table><thead><tr><th>Produkt</th><th>Release</th><th class="n">Vorbestellt</th><th class="n">Bestellungen</th><th class="n">Wareneingang</th><th class="n">Zugeteilt</th><th>Deckung</th><th class="n">Frei</th></tr></thead><tbody>
  ${listRows(ps).map(p=>{ if(p.isSeries) return seriesRow(p); const s=stats(p);const pct=s.rec&&s.pre?Math.min(100,Math.round(s.rec/s.pre*100)):0;return `<tr class="click ${p.archived?"dim":""}" data-go="produkt-${p.id}">
    <td><a href="#produkt-${p.id}">${esc(p.name)}</a>${seriesOf(p)?` <a class="gtag" href="#serie-${p.id}">Serie ${esc(seriesOf(p))}</a>`:""}${S.game==="Alle"?`<span class="gtag">${esc(gameOf(p))}</span>`:""}${p.archived?' <span class="muted">(archiviert)</span>':""}</td><td>${esc(relTxt(p.release))}</td>
    <td class="n">${s.pre}${s.flex?`<span class="gtag" title="Kunden, denen egal ist, welches Produkt der Serie">+${s.flex} egal</span>`:""}</td><td class="n">${s.n}</td><td class="n">${s.rec??"–"}</td><td class="n">${s.alloc||""}</td>
    <td>${s.rec==null?'<span class="muted">Ware fehlt</span>':`<div class="bar-meter ${s.over?"over":""}" title="${pct}% der Vorbestellung gedeckt"><i style="width:${pct}%"></i></div>`}</td>
    <td class="n" style="${s.over?"color:var(--bad);font-weight:700":""}">${s.free??""}</td></tr>`}).join("") || `<tr><td colspan="8" class="empty">Kein Produkt passt zur Suche.</td></tr>`}
  </tbody></table></div>
  <div class="panel"><h2>Neues Produkt anlegen</h2>
    <form class="form" id="np">
      <label class="wide">Produktname<input id="np-name" required placeholder="z. B. OP22, Pokémon Prismatic ETB, Riftbound Origins"></label>
      <label>Release<input id="np-rel" placeholder="2027-05-15, Q3 2027 oder leer"></label>
      <label>Spiel<select id="np-game">${GAMES.map(g=>`<option ${g===(S.game==="Alle"?"One Piece":S.game)?"selected":""}>${g}</option>`).join("")}</select></label>
      <label>Einheit<input id="np-unit" placeholder="Display, Case, Stück"></label>
      <button class="pri" ${S.canWrite?"":"disabled"}>Anlegen</button>
    </form><p class="muted">Varianten (Decks, Artworks) als eigenes Produkt anlegen, z. B. „ST45 | Rot“. Dann zählt jede Variante getrennt.</p></div>`;
  $("#pq").oninput = e => { S.pq=e.target.value; renderProducts(); };
  const sa=$("#showall"); if(sa) sa.onclick=()=>setGame("Alle");
  $("#parch").onchange = e => { S.parch=e.target.checked; renderProducts(); };
  app.querySelectorAll("tr[data-go]").forEach(tr=>tr.onclick=e=>{ if(e.target.tagName!=="A") location.hash=tr.dataset.go; });
  $("#np").onsubmit = async e => { e.preventDefault(); const name=$("#np-name").value.trim(); if(!name) return;
    if (Object.values(S.products).some(p=>p.name.toLowerCase()===name.toLowerCase())) return toast("Dieses Produkt gibt es schon.");
    const id = "p-"+name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,50)+"-"+Date.now().toString(36).slice(-4);
    if (await write("products",id,{name,group:name.split("|")[0].trim(),variant:(name.split("|")[1]||"").trim(),release:$("#np-rel").value.trim(),unit:$("#np-unit").value.trim(),game:$("#np-game").value,received:null,supplierOrdered:null,supplierConfirmed:null,archived:false},"set")) { toast("Produkt angelegt"); location.hash="produkt-"+id; } };
}

function renderProduct(pid){
  const p = S.products[pid]; if(!p){ app.innerHTML=`<a class="back" href="#produkte">← Produkte</a><div class="empty">Dieses Produkt gibt es nicht mehr.</div>`; return; }
  const s = stats(p); const sug = S.sugg[pid];
  const os = [...ordersOf(pid), ...flexOf(pid)].sort(sortOrders);
  const fstat = S.fstat||"aktiv";
  const shown = os.filter(o => fstat==="alle" || (fstat==="aktiv" ? o.status!=="Storniert" : o.status===fstat));
  const sugSum = sug ? Object.values(sug.map).reduce((a,b)=>a+b,0) : 0;
  app.innerHTML = `
  <a class="back" href="#produkte">← Produkte</a>
  <div class="row spread"><div><h1>${esc(p.name)}</h1><p class="sub">${esc(gameOf(p))} · Release ${esc(relTxt(p.release))}${p.unit?" · Einheit "+esc(p.unit):""}${siblings(p).length>1?` · <a class="back" href="#serie-${p.id}">Ganze Serie „${esc(seriesOf(p))}“ zuteilen →</a>`:""}</p></div>
   <div class="row"><button class="sm" id="arch">${p.archived?"Wieder aktivieren":"Archivieren"}</button><button class="sm danger" id="del">Löschen</button><span id="delc"></span></div></div>
  ${p.archived?`<div class="note">Dieses Produkt ist archiviert und erscheint nur mit „Archivierte zeigen“ in der Produktliste.</div>`:""}
  <div class="tiles">
    <div class="tile"><b>${s.pre}</b><span>vorbestellt</span></div>
    ${s.flex?`<div class="tile"><b>+${s.flex}</b><span>egal welches (Serie)</span></div>`:""}
    <div class="tile"><b>${s.rec??"–"}</b><span>Wareneingang</span></div>
    <div class="tile"><b>${s.alloc}</b><span>zugeteilt</span></div>
    <div class="tile ${s.over?"bad":s.free===0?"ok":""}"><b>${s.free??"–"}</b><span>noch frei</span></div>
    <div class="tile ${s.rec!=null&&s.pre>s.rec?"bad":""}"><b>${s.rec==null?"–":Math.max(0,s.pre-s.rec)}</b><span>Fehlmenge</span></div>
  </div>
  ${s.over?`<div class="note bad">Es sind ${s.alloc-s.rec} Stück mehr zugeteilt als geliefert. Bitte Zuteilungen reduzieren.</div>`:""}
  <div class="panel"><h2>Produktdaten</h2>
    <div class="form">
      <label>Release<input id="pd-release" value="${esc(p.release||"")}" placeholder="JJJJ-MM-TT, Q2 2027"></label>
      <label>Serie<input id="pd-series" value="${esc(p.series||"")}" placeholder="z. B. Mega Evolution"></label>
      <label>Spiel<select id="pd-game">${GAMES.map(g=>`<option ${g===gameOf(p)?"selected":""}>${g}</option>`).join("")}</select></label>
      <label>Einheit<input id="pd-unit" value="${esc(p.unit||"")}"></label>
      <label>Beim Lieferanten bestellt<input id="pd-supplierOrdered" type="number" min="0" value="${p.supplierOrdered??""}"></label>
      <label>Lieferant zugesagt<input id="pd-supplierConfirmed" type="number" min="0" value="${p.supplierConfirmed??""}"></label>
      <label>Wareneingang (verfügbar)<input id="pd-received" type="number" min="0" value="${p.received??""}"></label>
    </div></div>
  <div class="panel"><div class="row spread"><h2>Zuteilung</h2>
    <div class="row">
      <select id="mode"><option value="prop">Proportional (fair verteilt)</option><option value="fifo" ${S.mode==="fifo"?"selected":""}>Nach Bestelldatum (wer zuerst kommt)</option></select>
      <button id="sug" ${s.rec==null?"disabled":""}>Vorschlag berechnen</button>
      ${sug?`<button class="pri" id="apply" ${S.canWrite?"":"disabled"}>Vorschlag übernehmen (${sugSum} Stück)</button><button id="dis">Verwerfen</button>`:""}
      <button id="close" ${s.alloc?"":"disabled"} title="Alle offenen Bestellungen mit Zuteilung auf Zugeteilt setzen">Zuteilung abschließen</button>
    </div></div>
    ${s.rec==null?'<p class="muted">Erst den Wareneingang eintragen, dann kann ein Vorschlag berechnet werden.</p>':sug?'<p class="muted">Vorschlag steht in der Spalte „Vorschlag“. Noch nichts gespeichert.</p>':'<p class="muted">Zuteilungen können auch direkt in der Tabelle eingetragen werden. Bestellungen mit Status „Auftrag angelegt“ oder „Abgeholt“ bleiben beim Vorschlag unverändert.</p>'}
  </div>
  <div class="row spread"><h2>Bestellungen (${shown.length})</h2>
    <select id="fstat">${["aktiv","alle",...STATUSES].map(x=>`<option ${x===fstat?"selected":""}>${x}</option>`).join("")}</select></div>
  <div class="tablebox"><table><thead><tr><th>Kunde</th><th class="n">Menge</th><th>Bestellt am</th><th>MA</th><th>Status</th><th class="n">Zuteilung</th>${sug?'<th class="n">Vorschlag</th>':""}<th>Auftrag</th><th>Kommentar</th></tr></thead><tbody>
  ${shown.map(o=>{const c=S.customers[o.customerId];const d=c?dupesOf(c):[];return `<tr data-o="${o.id}" class="${o.status==="Storniert"?"dim":""}">
    <td><a href="#kunde-${o.customerId}">${esc(c?.name||"?")}</a>${!o.productId?` <span class="pill s-Offen" title="${esc(orderLabel(o))}">egal welches</span>`:o.pairId?` <span class="gtag">Teil von „beide“</span>`:""}${d.length?` <span class="pill s-Warteliste" title="Ähnlich: ${esc(d.map(x=>x.name).join(", "))}">Dublette?</span>`:""}</td>
    <td class="n"><input type="number" min="0" data-f="qty" id="q-${o.id}" value="${o.qty??""}"></td>
    <td><input type="date" data-f="date" id="d-${o.id}" value="${esc(o.date||"")}"></td>
    <td class="mono">${esc(o.staff||"")}</td>
    <td><select data-f="status" id="s-${o.id}">${STATUSES.map(x=>`<option ${x===o.status?"selected":""}>${x}</option>`).join("")}</select></td>
    <td class="n"><input type="number" min="0" data-f="alloc" id="a-${o.id}" value="${o.alloc??""}"></td>
    ${sug?`<td class="n" style="font-weight:700;color:var(--accent)">${sug.map[o.id]??""}</td>`:""}
    <td style="text-align:center">${auftragBox([o])}</td>
    <td><input class="c" data-f="comment" id="k-${o.id}" value="${esc(o.comment||"")}"></td></tr>`}).join("") || `<tr><td colspan="8" class="empty">Noch keine Bestellungen. Unten die erste erfassen.</td></tr>`}
  </tbody></table></div>
  ${orderForm("pr", pid)}`;
  // product fields
  $("#pd-game").onchange=e=>write("products",pid,{game:e.target.value}).then(ok=>ok&&toast("Gespeichert"));
  ["release","series","unit","supplierOrdered","supplierConfirmed","received"].forEach(f=>{ const el=$("#pd-"+f); el.onchange=()=>{ const v=el.type==="number"?num(el.value):el.value.trim(); write("products",pid,{[f]:v}).then(ok=>ok&&toast("Gespeichert")); }; });
  $("#arch").onclick=()=>write("products",pid,{archived:!p.archived});
  $("#del").onclick=()=>{ const own=ordersOf(pid), fl=flexOf(pid);
    $("#delc").innerHTML=` <button class="sm danger" id="delok">Ja: Produkt und ${own.length} Bestellungen endgültig löschen</button>`;
    $("#delok").onclick=()=>{ const t=now(); S.doc.update(o=>{ o.products[pid]={deleted:true,updatedAt:t};
        for(const x of own) o.orders[x.id]={deleted:true,updatedAt:t};
        for(const x of fl){ const ch=(o.orders[x.id].choices||[]).filter(c=>c!==pid); o.orders[x.id]= ch.length>1 ? {...o.orders[x.id],choices:ch,updatedAt:t} : ch.length===1 ? {...o.orders[x.id],choices:undefined,productId:ch[0],updatedAt:t} : {deleted:true,updatedAt:t}; } });
      toast("Produkt gelöscht"); location.hash="produkte"; }; };
  $("#fstat").onchange=e=>{S.fstat=e.target.value;render();};
  $("#mode").onchange=e=>{S.mode=e.target.value; if(S.sugg[pid]){S.sugg[pid]={map:suggest(p,S.mode)};render();}};
  $("#sug").onclick=()=>{ S.sugg[pid]={map:suggest(p,$("#mode").value)}; render(); };
  if (sug){ $("#dis").onclick=()=>{delete S.sugg[pid];render();};
    $("#apply").onclick=async()=>{ const b=$("#apply"); b.disabled=true; const ch=Object.entries(sug.map).filter(([id,v])=>S.orders[id] && (S.orders[id].alloc!==v || !S.orders[id].productId) && !(!S.orders[id].productId && !v));
      try{ await pool(ch, ([id,v])=>S.db.collection("orders").doc(id).update(S.orders[id].productId?{alloc:v}:{alloc:v,productId:pid,comment:[S.orders[id].comment,`war: ${orderLabel(S.orders[id])}`].filter(Boolean).join(" · ")})); delete S.sugg[pid]; toast(`${ch.length} Zuteilungen gespeichert`); render(); }catch(e){ toast("Nicht alles gespeichert: "+(e.message||e.code)); b.disabled=false; } }; }
  $("#close").onclick=async()=>{ const ch=ordersOf(pid).filter(o=>o.status==="Offen"&&(o.alloc||0)>0); if(!ch.length) return toast("Keine offene Bestellung mit Zuteilung.");
    try{ await pool(ch,o=>S.db.collection("orders").doc(o.id).update({status:"Zugeteilt"})); toast(`${ch.length} Bestellungen auf Zugeteilt gesetzt. Jetzt im etron-Export.`);}catch(e){toast("Fehler: "+(e.message||e.code));} };
  bindRows(); bindOrderForm("pr");
}

// Häkchen „Auftrag angelegt“: an = Auftrag in etron angelegt, aus = zurück auf Zugeteilt
S.doneNow = new Set();
function auftragBox(list){
  const os=list.filter(o=>o&&o.productId&&(o.alloc||0)>0&&o.status!=="Storniert"); if(!os.length) return `<span class="muted" title="Erst zuteilen">–</span>`;
  const on=os.every(o=>LOCKED.has(o.status));
  return `<input type="checkbox" class="auftrag" data-auftrag="${os.map(o=>o.id).join(",")}" id="au-${os[0].id}" ${on?"checked":""} title="${on?"Auftrag in etron angelegt":"Haken setzen, wenn der Auftrag in etron angelegt ist"}">`;
}
function bindAuftrag(){
  app.querySelectorAll("[data-auftrag]").forEach(el=>el.onchange=async()=>{ const ids=el.dataset.auftrag.split(","); const on=el.checked;
    ids.forEach(id=>on?S.doneNow.add(id):S.doneNow.delete(id));
    await pool(ids, id=>S.db.collection("orders").doc(id).update({status:on?"Auftrag angelegt":"Zugeteilt"}));
    toast(on?"Auftrag angelegt ✓":"Zurück auf Zugeteilt"); });
}
function bindRows(){
  bindAuftrag();
  app.querySelectorAll("tr[data-o] [data-f]").forEach(el=>el.onchange=()=>{ const id=el.closest("tr").dataset.o, f=el.dataset.f;
    let v = el.type==="number"?num(el.value):el.value.trim(); const patch={[f]:v};
    if (f==="status" && v==="Storniert") patch.alloc=null;
    write("orders",id,patch).then(ok=>ok&&toast("Gespeichert")); });
}

function orderForm(k, pid, cid, only){
  const prods = Object.values(S.products).filter(p=>!p.archived && (only ? only.includes(p.id) : inGame(p))).sort((a,b)=>gameOf(a).localeCompare(gameOf(b))||a.name.localeCompare(b.name));
  return `<div class="panel"><h2>Neue Bestellung erfassen</h2>
  <form class="form" id="${k}-f">
    ${pid?"":`<label class="wide">Produkt<select id="${k}-p" required><option value="">Produkt wählen</option>${prods.map(p=>`<option value="${p.id}">${S.game==="Alle"?esc(gameOf(p))+" · ":""}${esc(p.name)}</option>`).join("")}</select></label>`}
    ${cid?"":`<label class="wide">Kunde<input id="${k}-c" list="${k}-cl" required autocomplete="off" placeholder="Vorname Nachname"><datalist id="${k}-cl">${Object.values(S.customers).map(c=>`<option value="${esc(c.name)}">`).join("")}</datalist></label>`}
    <label class="wide" id="${k}-ml" hidden>Bei dieser Serie<select id="${k}-m"></select></label>
    <label>Menge (Stück)<input id="${k}-q" type="number" min="1" required></label>
    <label>Bestelldatum<input id="${k}-d" type="date" value="${today()}"></label>
    <label class="wide">Kommentar<input id="${k}-k" placeholder="z. B. 1 Case = 12 Stück"></label>
    <label><span>&nbsp;</span><select id="${k}-s"><option>Offen</option><option>Warteliste</option></select></label>
    <button class="pri" ${S.canWrite?"":"disabled"}>Speichern</button>
  </form><div id="${k}-hint"></div>
  <p class="muted">Nachbestellung = neue Zeile mit der zusätzlichen Menge. Cases vorher in Stück umrechnen.</p></div>`;
}
// mode: one = nur dieses Produkt, any = egal welches der Serie, all = je eine Bestellung pro Produkt der Serie
async function saveOrder(o, mode, sib){
  if (mode==="any") return write("orders",newId("o"),{...o,productId:null,choices:sib},"set");
  if (mode==="all"){ const pair=newId("g"); let ok=true; for(const id of sib) ok = await write("orders",newId("o"),{...o,productId:id,pairId:pair},"set") && ok; return ok; }
  return write("orders",newId("o"),o,"set");
}
function bindOrderForm(k){
  const f=$("#"+k+"-f"); if(!f) return; const ci=$("#"+k+"-c"), hint=$("#"+k+"-hint");
  const check=()=>{ if(!ci) return; const n=ci.value.trim(); if(!n||custByName(n)){hint.innerHTML="";return;}
    const d=Object.values(S.customers).filter(c=>similar(c.name,n)); hint.innerHTML = d.length?`<div class="note">„${esc(n)}“ ist neu. Meinst du ${d.map(c=>`<button type="button" class="sm" data-n="${esc(c.name)}">${esc(c.name)}</button>`).join(" ")}? Sonst wird ein neuer Kunde angelegt.</div>`:`<p class="muted">Neuer Kunde „${esc(n)}“ wird angelegt.</p>`;
    hint.querySelectorAll("[data-n]").forEach(b=>b.onclick=()=>{ci.value=b.dataset.n;check();}); };
  if(ci) ci.oninput=check;
  const curPid=()=>{ const h=(location.hash||"").slice(1); return h.startsWith("produkt-")?h.slice(8):($("#"+k+"-p")?.value||""); };
  const modeUi=()=>{ const p=S.products[curPid()]; const sib=siblings(p); const ml=$("#"+k+"-ml"); if(!ml) return;
    ml.hidden = sib.length<2; if(sib.length<2) return;
    const others=sib.filter(x=>x.id!==p.id).map(x=>x.name).join(", ");
    $("#"+k+"-m").innerHTML=`<option value="one">nur ${esc(p.name)}</option><option value="any">egal welches: ${esc(sib.map(x=>x.name).join(" oder "))}</option><option value="all">alle: ${esc(p.name)} und ${esc(others)}</option>`; };
  const ps=$("#"+k+"-p"); if(ps) ps.onchange=modeUi; modeUi();
  f.onsubmit=async e=>{ e.preventDefault();
    const h=(location.hash||"").slice(1); const pid=h.startsWith("produkt-")?h.slice(8):$("#"+k+"-p").value; if(!pid) return toast("Bitte Produkt wählen.");
    let cid = h.startsWith("kunde-")?h.slice(6):null;
    if(!staff()){ staffEl.focus(); return toast("Bitte oben dein Kürzel eintragen."); }
    if(!cid){ const n=ci.value.trim(); const ex=custByName(n); if(ex) cid=ex.id; else { cid=newId("c"); if(!await write("customers",cid,{name:n,contact:"",note:""},"set")) return; } }
    const o={productId:pid,customerId:cid,qty:num($("#"+k+"-q").value),date:$("#"+k+"-d").value,staff:staff(),status:$("#"+k+"-s").value,alloc:null,comment:$("#"+k+"-k").value.trim(),createdAt:new Date().toISOString()};
    const mode=$("#"+k+"-ml")?.hidden===false ? $("#"+k+"-m").value : "one";
    if(await saveOrder(o, mode, siblings(S.products[pid]).map(x=>x.id))){ toast("Bestellung gespeichert"); f.reset(); $("#"+k+"-d").value=today(); hint.innerHTML=""; }
  };
}

// ---------- Serie: alle Produkte einer Serie in einer Liste, gemeinsame Zuteilung
function seriesSuggest(sib, mode){
  const res = {}; const left = {};
  for (const p of sib){ const m = suggest(p, mode, true); Object.assign(res, m);
    const fixedLocked = ordersOf(p.id).filter(o=>LOCKED.has(o.status)).reduce((a,o)=>a+(o.alloc||0),0);
    left[p.id] = Math.max(0,(num(p.received)||0) - fixedLocked) - Object.values(m).reduce((a,b)=>a+b,0); }
  const flex = {}; const ids = sib.map(p=>p.id);
  const fl = Object.values(S.orders).filter(o=>!o.productId && o.status==="Offen" && (o.qty||0)>0 && (o.choices||[]).some(c=>ids.includes(c))).sort(sortOrders);
  for (const o of fl){ const opts=(o.choices||[]).filter(c=>ids.includes(c)&&left[c]>0).sort((a,b)=>left[b]-left[a]); if(!opts.length) continue;
    const pid=opts[0]; const g=Math.min(o.qty,left[pid]); flex[o.id]={pid,n:g}; left[pid]-=g; }
  return { res, flex, left };
}
function renderSeries(anyPid){
  const p0 = S.products[anyPid]; if(!p0){ app.innerHTML=`<a class="back" href="#produkte">← Produkte</a><div class="empty">Diese Serie gibt es nicht mehr.</div>`; return; }
  const sib = siblings(p0); const ids = sib.map(p=>p.id); const key = "serie:"+seriesOf(p0); const sug = S.sugg[key];
  const all = Object.values(S.orders).filter(o=>ids.includes(o.productId) || (!o.productId && (o.choices||[]).some(c=>ids.includes(c))));
  const fstat = S.fstat||"aktiv";
  // Zeilen: Paare („beide“) zusammenfassen, sonst eine Zeile pro Bestellung
  const rowsMap = new Map();
  for (const o of all.sort(sortOrders)){ const k = o.pairId || o.id; if(!rowsMap.has(k)) rowsMap.set(k, []); rowsMap.get(k).push(o); }
  let rows = [...rowsMap.values()];
  rows = rows.filter(r => fstat==="alle" || r.some(o => fstat==="aktiv" ? o.status!=="Storniert" : o.status===fstat));
  const wish = r => { const o=r[0]; if(r.length>1||o.pairId) return "beide"; if(!o.productId) return "egal"; if(o.choices) return "egal → "+(S.products[o.productId]?.name||"?"); return "nur "+(S.products[o.productId]?.name||"?"); };
  const st = sib.map(p=>({p, s:stats(p)}));
  const cell = (r, pid) => { const o = r.find(x=>x.productId===pid);
    if (o) return `<td class="n"><input type="number" min="0" data-f="alloc" data-oid="${o.id}" id="sa-${o.id}" value="${o.alloc??""}" title="Bestellt ${o.qty??"?"}"></td>${sug?`<td class="n" style="font-weight:700;color:var(--accent)">${sug.res[o.id]??""}</td>`:""}`;
    const f = r.find(x=>!x.productId && (x.choices||[]).includes(pid));
    if (f) return `<td class="n"><input type="number" min="0" data-flex="${f.id}" data-pid="${pid}" id="sf-${f.id}-${pid}" placeholder="–"></td>${sug?`<td class="n" style="font-weight:700;color:var(--accent)">${sug.flex[f.id]?.pid===pid?sug.flex[f.id].n:""}</td>`:""}`;
    return `<td class="n muted">·</td>${sug?"<td></td>":""}`; };
  const sugSum = sug ? Object.values(sug.res).reduce((a,b)=>a+b,0)+Object.values(sug.flex).reduce((a,b)=>a+b.n,0) : 0;
  app.innerHTML = `<a class="back" href="#produkte">← Produkte</a>
  <div><h1>Serie ${esc(seriesOf(p0))}</h1><p class="sub">${esc(gameOf(p0))} · ${sib.map(p=>`<a class="back" href="#produkt-${p.id}">${esc(p.name)}</a>`).join(" · ")}</p></div>
  <div class="tablebox"><table><thead><tr><th>Produkt</th><th class="n">nur dieses</th><th class="n">+ egal</th><th class="n">Wareneingang</th><th class="n">Zugeteilt</th><th class="n">Frei</th></tr></thead><tbody>
  ${st.map(({p,s})=>`<tr><td><a href="#produkt-${p.id}">${esc(p.name)}</a></td><td class="n">${s.pre}</td><td class="n">${s.flex||""}</td>
    <td class="n"><input type="number" min="0" data-rec="${p.id}" id="sr-${p.id}" value="${p.received??""}" placeholder="fehlt"></td><td class="n">${s.alloc||""}</td>
    <td class="n" style="${s.over?"color:var(--bad);font-weight:700":""}">${s.free??""}</td></tr>`).join("")}
  </tbody></table></div>
  <div class="panel"><div class="row spread"><h2>Zuteilung für die ganze Serie</h2><div class="row">
    <select id="mode"><option value="prop">Proportional (fair verteilt)</option><option value="fifo" ${S.mode==="fifo"?"selected":""}>Nach Bestelldatum</option></select>
    <button id="sug" ${st.some(x=>x.s.rec==null)?"disabled":""}>Vorschlag berechnen</button>
    ${sug?`<button class="pri" id="apply">Vorschlag übernehmen (${sugSum} Stück)</button><button id="dis">Verwerfen</button>`:""}
    <button id="close">Zuteilung abschließen</button></div></div>
    <p class="muted">${st.some(x=>x.s.rec==null)?"Für den Vorschlag bei allen Produkten den Wareneingang eintragen.":"Zuerst bekommen die festen Wünsche (nur A, nur B, beide) ihre Ware, dann gehen die Reste an „egal“-Kunden, jeweils an das Produkt mit mehr übrig. Zuteilungen kannst du auch direkt in der Tabelle ändern."}</p>
    ${sug?`<p class="muted">Danach übrig: ${sib.map(p=>`${esc(p.name)} ${sug.left[p.id]}`).join(" · ")}</p>`:""}</div>
  <div class="row spread"><h2>Bestellungen (${rows.length})</h2><select id="fstat">${["aktiv","alle",...STATUSES].map(x=>`<option ${x===fstat?"selected":""}>${x}</option>`).join("")}</select></div>
  <div class="tablebox"><table><thead><tr><th>Kunde</th><th>Wunsch</th><th class="n">Menge</th><th>Bestellt am</th><th>Status</th>${sib.map(p=>`<th class="n">${esc(p.name)}</th>${sug?'<th class="n">Vorschl.</th>':""}`).join("")}<th>Auftrag</th><th>Kommentar</th></tr></thead><tbody>
  ${rows.map(r=>{const o=r[0];const c=S.customers[o.customerId];return `<tr data-row="${r.map(x=>x.id).join(",")}" class="${r.every(x=>x.status==="Storniert")?"dim":""}">
    <td><a href="#kunde-${o.customerId}">${esc(c?.name||"?")}</a></td><td>${esc(wish(r))}</td><td class="n">${o.qty??""}</td><td>${fmtDate(o.date)}</td>
    <td><select data-rs id="ss-${o.id}">${STATUSES.map(x=>`<option ${x===o.status?"selected":""}>${x}</option>`).join("")}</select></td>
    ${sib.map(p=>cell(r,p.id)).join("")}<td style="text-align:center">${auftragBox(r)}</td><td class="muted">${esc(o.comment||"")}</td></tr>`}).join("")||`<tr><td colspan="9" class="empty">Noch keine Bestellungen für diese Serie.</td></tr>`}
  </tbody></table></div>
  ${orderForm("se", null, null, ids)}`;
  app.querySelectorAll("[data-rec]").forEach(el=>el.onchange=()=>write("products",el.dataset.rec,{received:num(el.value)}).then(ok=>ok&&toast("Gespeichert")));
  app.querySelectorAll("input[data-oid]").forEach(el=>el.onchange=()=>write("orders",el.dataset.oid,{alloc:num(el.value)}).then(ok=>ok&&toast("Gespeichert")));
  app.querySelectorAll("input[data-flex]").forEach(el=>el.onchange=()=>{ const v=num(el.value); if(!v) return; const o=S.orders[el.dataset.flex];
    write("orders",o.id,{productId:el.dataset.pid,alloc:v,comment:[o.comment,`war: ${orderLabel(o)}`].filter(Boolean).join(" · ")}).then(ok=>ok&&toast("Zugeteilt")); });
  app.querySelectorAll("select[data-rs]").forEach(el=>el.onchange=async()=>{ const ids2=el.closest("tr").dataset.row.split(","); const v=el.value;
    await pool(ids2, id=>S.db.collection("orders").doc(id).update(v==="Storniert"?{status:v,alloc:null}:{status:v})); toast("Gespeichert"); });
  $("#fstat").onchange=e=>{S.fstat=e.target.value;render();};
  $("#mode").onchange=e=>{S.mode=e.target.value; if(S.sugg[key]){S.sugg[key]=seriesSuggest(sib,S.mode);render();}};
  $("#sug").onclick=()=>{ S.sugg[key]=seriesSuggest(sib,$("#mode").value); render(); };
  if (sug){ $("#dis").onclick=()=>{delete S.sugg[key];render();};
    $("#apply").onclick=async()=>{ $("#apply").disabled=true;
      const ch=[...Object.entries(sug.res).filter(([id,v])=>S.orders[id]&&S.orders[id].alloc!==v).map(([id,v])=>[id,{alloc:v}]),
                ...Object.entries(sug.flex).filter(([id])=>S.orders[id]&&!S.orders[id].productId).map(([id,f])=>[id,{productId:f.pid,alloc:f.n,comment:[S.orders[id].comment,`war: ${orderLabel(S.orders[id])}`].filter(Boolean).join(" · ")}])];
      try{ await pool(ch,([id,pt])=>S.db.collection("orders").doc(id).update(pt)); delete S.sugg[key]; toast(`${ch.length} Zuteilungen gespeichert`); render(); }catch(e){ toast("Fehler: "+(e.message||e.code)); } }; }
  $("#close").onclick=async()=>{ const ch=all.filter(o=>o.productId&&o.status==="Offen"&&(o.alloc||0)>0); if(!ch.length) return toast("Keine offene Bestellung mit Zuteilung.");
    await pool(ch,o=>S.db.collection("orders").doc(o.id).update({status:"Zugeteilt"})); toast(`${ch.length} Bestellungen auf Zugeteilt gesetzt.`); };
  bindAuftrag(); bindOrderForm("se");
}

function renderCustomers(){
  const q=norm(S.cq||""); const onlyD=S.cdup;
  const counts={}; Object.values(S.orders).forEach(o=>{ const c=counts[o.customerId]||(counts[o.customerId]={n:0,open:0}); if(COUNTS(o.status)){c.n++; if(o.status==="Offen"||o.status==="Zugeteilt") c.open+=(o.alloc||o.qty||0);} });
  const cs=Object.values(S.customers).map(c=>({...c,d:dupesOf(c)})).filter(c=>(!q||norm(c.name).includes(q)||String(c.etronId||"").includes(S.cq.trim())) && (!onlyD||c.d.length) && (!S.cnoe||!c.etronId)).sort((a,b)=>a.name.localeCompare(b.name,"de"));
  const dn=Object.values(S.customers).filter(c=>dupesOf(c).length).length;
  app.innerHTML=`<div><h1>Kunden</h1><p class="sub">${Object.keys(S.customers).length} Kunden, davon ${Object.values(S.customers).filter(c=>!c.etronId).length} ohne etron-Nr. ${dn?`${dn} sehen nach Dublette aus: <a class="back" href="#dubletten">jetzt prüfen</a>.`:""}</p></div>
  <div class="row"><input id="cq" class="search" placeholder="Kunde suchen" value="${esc(S.cq||"")}"><label class="row muted"><input type="checkbox" id="cdup" ${onlyD?"checked":""}> Nur mögliche Dubletten</label><label class="row muted"><input type="checkbox" id="cnoe" ${S.cnoe?"checked":""}> Nur ohne etron-Nr.</label></div>
  <div class="tablebox"><table><thead><tr><th>Kunde</th><th>etron-Nr.</th><th>Kontakt</th><th class="n">Bestellungen</th><th class="n">Stück offen</th><th>Ähnlich</th></tr></thead><tbody>
  ${cs.map(c=>`<tr class="click" data-go="kunde-${c.id}"><td><a href="#kunde-${c.id}">${esc(c.name)}</a></td><td><input data-cf="${c.id}" id="e-${c.id}" style="width:110px" value="${esc(c.etronId||"")}" placeholder="fehlt"></td><td>${esc(c.contact||"")}</td><td class="n">${counts[c.id]?.n||0}</td><td class="n">${counts[c.id]?.open||""}</td><td>${c.d.map(x=>esc(x.name)).join(", ")}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">Kein Kunde gefunden.</td></tr>`}
  </tbody></table></div>`;
  $("#cq").oninput=e=>{S.cq=e.target.value;renderCustomers();};
  $("#cdup").onchange=e=>{S.cdup=e.target.checked;renderCustomers();};
  $("#cnoe").onchange=e=>{S.cnoe=e.target.checked;renderCustomers();};
  app.querySelectorAll("[data-cf]").forEach(el=>{ el.onclick=e=>e.stopPropagation(); el.onchange=()=>saveEtron(el.dataset.cf, el.value); });
  app.querySelectorAll("tr[data-go]").forEach(tr=>tr.onclick=e=>{ if(e.target.tagName!=="A") location.hash=tr.dataset.go; });
}

function renderCustomer(cid){
  const c=S.customers[cid]; if(!c){ app.innerHTML=`<a class="back" href="#kunden">← Kunden</a><div class="empty">Diesen Kunden gibt es nicht mehr (evtl. zusammengeführt).</div>`; return; }
  const os=Object.values(S.orders).filter(o=>o.customerId===cid).sort((a,b)=>(S.products[a.productId]?.name||"").localeCompare(S.products[b.productId]?.name||"")||sortOrders(a,b));
  const d=dupesOf(c); const others=Object.values(S.customers).filter(x=>x.id!==cid).sort((a,b)=>a.name.localeCompare(b.name,"de"));
  const pickup=os.filter(o=>(o.status==="Zugeteilt"||o.status==="Auftrag angelegt")&&(o.alloc||0)>0);
  app.innerHTML=`<a class="back" href="#kunden">← Kunden</a>
  <div><h1>${esc(c.name)}</h1><p class="sub">${os.length} Bestellungen${pickup.length?` · ${pickup.reduce((s,o)=>s+o.alloc,0)} Stück bereit zur Abholung`:""}</p></div>
  ${d.length?`<div class="note">Ähnliche Schreibweise: ${d.map(x=>`<a href="#kunde-${x.id}">${esc(x.name)}</a>`).join(", ")}. Falls es dieselbe Person ist, unten zusammenführen.</div>`:""}
  <div class="panel"><h2>Kundendaten</h2><div class="form">
    <label>Name<input id="cd-name" value="${esc(c.name)}"></label>
    <label>etron-Kundennr.<input id="cd-etronId" value="${esc(c.etronId||"")}" placeholder="fehlt"></label>
    <label>Kontakt (Telefon/E-Mail)<input id="cd-contact" value="${esc(c.contact||"")}"></label>
    <label class="wide">Notiz<input id="cd-note" value="${esc(c.note||"")}"></label></div></div>
  <div class="tablebox"><table><thead><tr><th>Produkt</th><th>Release</th><th class="n">Menge</th><th>Bestellt am</th><th>Status</th><th class="n">Zuteilung</th><th>Auftrag</th><th>Kommentar</th></tr></thead><tbody>
  ${os.map(o=>{const p=S.products[o.productId||(o.choices||[])[0]];return `<tr data-o="${o.id}" class="${o.status==="Storniert"?"dim":""}"><td><a href="#produkt-${p?.id||""}">${esc(orderLabel(o))}</a><span class="gtag">${esc(gameOf(p))}</span></td><td>${esc(relTxt(p?.release))}</td>
    <td class="n"><input type="number" min="0" data-f="qty" id="q-${o.id}" value="${o.qty??""}"></td><td>${fmtDate(o.date)}</td>
    <td><select data-f="status" id="s-${o.id}">${STATUSES.map(x=>`<option ${x===o.status?"selected":""}>${x}</option>`).join("")}</select></td>
    <td class="n">${o.alloc??""}</td><td style="text-align:center">${auftragBox([o])}</td><td><input class="c" data-f="comment" id="k-${o.id}" value="${esc(o.comment||"")}"></td></tr>`}).join("")||`<tr><td colspan="8" class="empty">Keine Bestellungen.</td></tr>`}
  </tbody></table></div>
  ${orderForm("cu", null, cid)}
  <div class="panel"><h2>Mit anderem Kunden zusammenführen</h2>
    <p class="muted">Alle Bestellungen von „${esc(c.name)}“ wandern zum gewählten Kunden, danach wird „${esc(c.name)}“ gelöscht.</p>
    <div class="row"><select id="mt"><option value="">Ziel-Kunde wählen</option>${[...d,...others.filter(x=>!d.includes(x))].map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select>
    <button id="mg" class="danger" ${S.canWrite?"":"disabled"}>Zusammenführen</button><span id="mgc"></span></div></div>`;
  ["name","contact","note"].forEach(f=>{ const el=$("#cd-"+f); el.onchange=()=>{ const v=el.value.trim(); if(f==="name"&&!v) return; write("customers",cid,{[f]:v}).then(ok=>ok&&toast("Gespeichert")); }; });
  $("#cd-etronId").onchange=e=>saveEtron(cid,e.target.value);
  bindRows(); bindOrderForm("cu");
  $("#mg").onclick=()=>{ const t=$("#mt").value; if(!t) return toast("Bitte Ziel-Kunde wählen."); const tn=S.customers[t].name;
    $("#mgc").innerHTML=`<span class="muted">${os.length} Bestellungen zu „${esc(tn)}“ verschieben?</span> <button class="sm danger" id="mgok">Ja, zusammenführen</button>`;
    $("#mgok").onclick=async()=>{ if(await mergeCustomers(cid,t)) location.hash="kunde-"+t; }; };
}

async function saveEtron(cid,v){
  v=String(v||"").trim(); const c=S.customers[cid]; if(!c) return;
  const other=v && Object.values(S.customers).find(x=>x.id!==cid && String(x.etronId||"").trim()===v);
  if(await write("customers",cid,{etronId:v})) toast(other?`Gespeichert. Achtung: ${other.name} hat dieselbe etron-Nr. und steht jetzt bei den Dubletten.`:"etron-Nr. gespeichert");
}
async function mergeCustomers(fromId,toId){
  const f=S.customers[fromId], t=S.customers[toId]; if(!f||!t) return false;
  const os=Object.values(S.orders).filter(o=>o.customerId===fromId);
  try{
    await pool(os,o=>S.db.collection("orders").doc(o.id).update({customerId:toId}));
    const patch={}; if(!t.contact&&f.contact) patch.contact=f.contact;
    if(!t.etronId&&f.etronId) patch.etronId=f.etronId;
    const notes=[t.note,f.note,(t.etronId&&f.etronId&&t.etronId!==f.etronId)?`Zweite etron-Nr. ${f.etronId} (von ${f.name})`:"",`Zusammengeführt mit „${f.name}“ am ${fmtDate(today())}${staff()?" ("+staff()+")":""}`].filter(Boolean);
    patch.note=notes.join(" · ");
    await S.db.collection("customers").doc(toId).update(patch);
    await S.db.collection("customers").doc(fromId).delete();
    toast(`„${f.name}“ in „${t.name}“ zusammengeführt (${os.length} Bestellungen)`); return true;
  }catch(e){ toast("Fehler beim Zusammenführen: "+(e.message||e.code)); return false; }
}
function renderDupes(){
  const cs=Object.values(S.customers).sort((a,b)=>a.name.localeCompare(b.name,"de")); const pairs=[]; const seen=new Set();
  for(const a of cs) for(const b of dupesOf(a)){ const k=[a.id,b.id].sort().join("|"); if(!seen.has(k)){ seen.add(k); pairs.push([a,b]); } }
  const cnt={}; Object.values(S.orders).forEach(o=>cnt[o.customerId]=(cnt[o.customerId]||0)+1);
  const card=(c,other)=>`<div class="panel" style="gap:6px"><b style="font-size:15px"><a class="back" href="#kunde-${c.id}">${esc(c.name)}</a></b>
    <span class="muted">${cnt[c.id]||0} Bestellungen</span>
    <label class="muted" style="font-size:12px">etron-Nr. <input data-cf="${c.id}" id="de-${c.id}" style="width:120px" value="${esc(c.etronId||"")}" placeholder="fehlt"></label>
    <span class="muted">${esc(c.contact||"kein Kontakt")}</span>
    <button class="sm pri" data-keep="${c.id}" data-drop="${other.id}" ${S.canWrite?"":"disabled"}>Diesen behalten</button></div>`;
  app.innerHTML=`<div><h1>Dubletten</h1><p class="sub">${pairs.length} mögliche doppelte Einträge (ähnlicher Name oder gleiche etron-Nr.). Beim Zusammenführen wandern alle Bestellungen zum behaltenen Kunden, Kontakt und etron-Nr. werden übernommen, falls dort leer.</p></div>
  ${pairs.length?pairs.map(([a,b])=>`<div class="panel"><div class="row spread"><h2>${sameEtron(a,b)?'<span class="pill s-Storniert" style="text-decoration:none">gleiche etron-Nr.</span> ':""}${esc(a.name)} / ${esc(b.name)}</h2>
    <button class="sm" data-no="${a.id}|${b.id}">Kein Duplikat</button></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">${card(a,b)}${card(b,a)}</div><div data-conf="${a.id}|${b.id}"></div></div>`).join("")
   :`<div class="empty">Keine möglichen Dubletten mehr. Neue Namen werden bei der Eingabe geprüft.</div>`}`;
  app.querySelectorAll("[data-cf]").forEach(el=>el.onchange=()=>saveEtron(el.dataset.cf, el.value));
  app.querySelectorAll("[data-keep]").forEach(b=>b.onclick=()=>{ const keep=S.customers[b.dataset.keep], drop=S.customers[b.dataset.drop];
    const box=b.closest(".panel").parentElement.closest(".panel").querySelector("[data-conf]");
    box.innerHTML=`<div class="note">„${esc(drop.name)}“ wird gelöscht, seine ${cnt[drop.id]||0} Bestellungen gehen an „${esc(keep.name)}“. <button class="sm danger" id="ok-${drop.id}">Zusammenführen</button> <button class="sm" id="no-${drop.id}">Abbrechen</button></div>`;
    $("#ok-"+drop.id).onclick=async e=>{ e.target.disabled=true; await mergeCustomers(drop.id,keep.id); };
    $("#no-"+drop.id).onclick=()=>box.innerHTML=""; });
  app.querySelectorAll("[data-no]").forEach(b=>b.onclick=async()=>{ const [x,y]=b.dataset.no.split("|"); const a=S.customers[x];
    if(await write("customers",x,{notDupes:[...(a.notDupes||[]),y]})) toast("Als verschiedene Kunden markiert"); });
}
function exportRows(){ return Object.values(S.orders).filter(o=>o.status==="Zugeteilt"&&(o.alloc||0)>0&&inGame(S.products[o.productId])).sort((a,b)=>(S.customers[a.customerId]?.name||"").localeCompare(S.customers[b.customerId]?.name||"","de")||sortOrders(a,b)); }
function csv(rows){ const q=v=>{v=String(v??"");return /[;"\n]/.test(v)?`"${v.replace(/"/g,'""')}"`:v}; const head=["etron-Kundennr.","Kunde","Kontakt","Spiel","Produkt","Menge","Bestelldatum","Mitarbeiter","Kommentar","Vorbestell-Nr"];
  return "﻿"+[head,...rows.map(o=>{const c=S.customers[o.customerId]||{},p=S.products[o.productId]||{};return [c.etronId,c.name,c.contact,gameOf(p),p.name,o.alloc,fmtDate(o.date),o.staff,o.comment,o.id]})].map(r=>r.map(q).join(";")).join("\r\n"); }
async function backup(){
  const strip=m=>Object.values(m).map(x=>({...x}));
  const data=JSON.stringify({format:"vorbestellungen-v1",exportedAt:new Date().toISOString(),products:strip(S.products),customers:strip(S.customers),orders:strip(S.orders)},null,1);
  const name=`vorbestellungen-daten-${today()}.json`;
  if(S.downloads){ try{ await S.downloads.save({filename:name,data:new Blob([data],{type:"application/json"})}); return; }catch(e){ if(e&&e.code==="dismissed") return; } }
  showText(data); toast("Download nicht verfügbar: Text unten markieren, kopieren und als .json speichern.");
}
function renderExport(){
  const rows=exportRows(); const byC={};
  const shownRows=[...rows, ...[...S.doneNow].map(id=>S.orders[id]).filter(o=>o&&o.status==="Auftrag angelegt"&&inGame(S.products[o.productId]))];
  shownRows.forEach(o=>(byC[o.customerId]=byC[o.customerId]||[]).push(o));
  app.innerHTML=`<div><h1>etron-Export${S.game==="Alle"?"":" · "+esc(S.game)}</h1><p class="sub">Alle Bestellungen mit Status „Zugeteilt“. Daraus werden in etron onRetail die Aufträge angelegt. Danach pro Position den Haken bei „Auftrag angelegt“ setzen. Abgehakte bleiben bis zum Neuladen grau sichtbar, falls du dich verklickt hast.</p></div>
  <div class="tiles"><div class="tile"><b>${new Set(rows.map(o=>o.customerId)).size}</b><span>Kunden offen</span></div><div class="tile"><b>${rows.length}</b><span>Positionen</span></div><div class="tile"><b>${rows.reduce((s,o)=>s+o.alloc,0)}</b><span>Stück</span></div></div>
  ${Object.keys(byC).some(id=>!S.customers[id]?.etronId)?`<div class="note">${Object.keys(byC).filter(id=>!S.customers[id]?.etronId).length} Kunden haben noch keine etron-Nr. Bitte vor dem Anlegen der Aufträge unter Kunden eintragen.</div>`:""}
  <div class="row"><button class="pri" id="dl" ${rows.length?"":"disabled"}>CSV herunterladen</button><button id="cp" ${rows.length?"":"disabled"}>Als Text kopieren</button><button id="mk" ${rows.length&&S.canWrite?"":"disabled"}>Alle als „Auftrag angelegt“ markieren</button><span id="mkc"></span></div>
  ${shownRows.length?Object.entries(byC).map(([cid,list])=>{const c=S.customers[cid]||{};return `<div class="panel"><div class="row spread"><h2><a class="back" href="#kunde-${cid}">${esc(c.name||"?")}</a></h2><span class="muted">${c.etronId?"etron-Nr. "+esc(c.etronId):'<span style="color:var(--bad);font-weight:600">etron-Nr. fehlt</span>'} · ${esc(c.contact||"")}</span></div>
    <div class="tablebox"><table><thead><tr><th>Produkt</th><th class="n">Menge</th><th>Kommentar</th><th>Auftrag angelegt</th></tr></thead><tbody>${list.map(o=>`<tr class="${o.status==="Auftrag angelegt"?"dim":""}"><td>${esc(S.products[o.productId]?.name||"?")}</td><td class="n">${o.alloc}</td><td>${esc(o.comment||"")}</td><td style="text-align:center">${auftragBox([o])}</td></tr>`).join("")}</tbody></table></div></div>`}).join(""):`<div class="empty">Gerade nichts zu exportieren. Sobald bei einem Produkt die Zuteilung abgeschlossen ist, erscheinen die Kunden hier.</div>`}
  <div class="panel"><h2>Gesamtsicherung</h2><p class="muted">Alle Produkte, Kunden und Bestellungen als eine JSON-Datei, z. B. für den Umzug in die Dropbox.</p><div class="row"><button id="bk">Alle Daten exportieren (JSON)</button></div></div>
  <textarea id="ta" hidden rows="6" style="width:100%"></textarea>`;
  $("#bk").onclick=backup; bindAuftrag();
  if(!rows.length) return;
  $("#dl").onclick=async()=>{ const data=csv(rows); const name=`etron-auftraege-${today()}.csv`;
    if(S.downloads){ try{ await S.downloads.save({filename:name,data:new Blob([data],{type:"text/csv;charset=utf-8"})}); return; }catch(e){ if(e&&e.code==="dismissed") return; } }
    showText(data); toast("Download nicht verfügbar: Text unten markieren und kopieren."); };
  $("#cp").onclick=async()=>{ const data=csv(rows).slice(1); try{ await navigator.clipboard.writeText(data); toast("Kopiert"); }catch(e){ showText(data); } };
  $("#mk").onclick=()=>{ $("#mkc").innerHTML=` <button class="sm danger" id="mkok">${rows.length} Positionen markieren</button>`; $("#mkok").onclick=async()=>{ try{ await pool(rows,o=>S.db.collection("orders").doc(o.id).update({status:"Auftrag angelegt"})); toast("Markiert"); }catch(e){ toast("Fehler: "+(e.message||e.code)); } }; };
  bindAuftrag();
}
function showText(t){ const ta=$("#ta"); ta.hidden=false; ta.value=t; ta.focus(); ta.select(); }

// ---------- Speicher-Anbindung
// Kleine Hülle mit der Form collection(c).doc(id).set/update/delete, damit die Ansichten unabhängig vom Speicher bleiben.
function makeDb(doc){
  const col = c => ({ doc: id => ({
    set: async d => doc.update(o => { (o[c] ||= {})[id] = { ...d, updatedAt: now() }; }),
    update: async d => { const cur = doc.obj[c]?.[id]; if (!cur || cur.deleted) throw { code: "not_found", message: "Eintrag gibt es nicht mehr" };
      doc.update(o => { o[c][id] = { ...o[c][id], ...d, updatedAt: now() }; }); },
    delete: async () => doc.update(o => { (o[c] ||= {})[id] = { deleted: true, updatedAt: now() }; }),
  }) });
  return { collection: col };
}
function saveFile(filename, blob){
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
S.downloads = { save: async ({ filename, data }) => saveFile(filename, data) };

const live = m => Object.fromEntries(Object.entries(m || {}).filter(([, v]) => v && !v.deleted).map(([id, v]) => [id, { id, ...v }]));
function pull(){
  const o = S.doc.obj || {};
  S.products = live(o.products); S.customers = live(o.customers); S.orders = live(o.orders);
  S.loaded = { p: true, c: true, o: true };
}
const SYNC_TXT = { idle: "–", syncing: "Speichert …", ok: "Gespeichert", offline: "Offline, wird nachgeholt", error: "Fehler beim Speichern" };
function drawSync(){
  const el = $("#sync"); if (!el || !S.doc) return;
  el.className = "sync " + S.doc.status;
  el.querySelector("span").textContent = S.provider.kind === "local" ? "Nur dieser Browser" : SYNC_TXT[S.doc.status] || S.doc.status;
  el.title = S.doc.error || (S.doc.lastSync ? "Zuletzt abgeglichen " + new Date(S.doc.lastSync).toLocaleTimeString("de-AT") : "");
}

// ---------- Import / Sicherung
function toMaps(d){
  const t = now(); const map = arr => Object.fromEntries((arr || []).map(({ id, ...r }) => [id, { ...r, updatedAt: r.updatedAt || t }]));
  return { products: map(d.products), customers: map(d.customers), orders: map(d.orders) };
}
function importObj(d){
  if (!d || !Array.isArray(d.products) || !Array.isArray(d.customers) || !Array.isArray(d.orders)) { toast("Diese Datei ist keine Vorbestellungs-Sicherung."); return false; }
  const m = toMaps(d);
  S.doc.update(o => { for (const k of ["products", "customers", "orders"]) o[k] = { ...(o[k] || {}), ...m[k] }; });
  setGame("Alle");
  toast(`Übernommen: ${d.products.length} Produkte, ${d.customers.length} Kunden, ${d.orders.length} Bestellungen`);
  location.hash = "produkte"; return true;
}
async function importFile(file, st){
  if (!file) return;
  try { const d = JSON.parse(await file.text()); if (importObj(d) && st) st.textContent = ""; }
  catch (e) { if (st) st.textContent = "Datei nicht lesbar: " + e.message; }
}
function backupData(){
  const arr = m => Object.values(m).map(x => ({ ...x }));
  return { format: "vorbestellungen-v1", exportedAt: new Date().toISOString(), products: arr(S.products), customers: arr(S.customers), orders: arr(S.orders) };
}
// Erfundene Beispieldaten nur für „Nur ausprobieren“
function demoData(){
  const d = today();
  return { format: "vorbestellungen-v1",
    products: [ { id: "p-demo-op", name: "OP-Beispielset", group: "OP-Beispielset", variant: "", release: "2027-03-01", game: "One Piece", unit: "Display", received: 5, archived: false },
                { id: "p-demo-pk", name: "Pokémon Beispiel-ETB", group: "Pokémon Beispiel-ETB", variant: "", release: "Q2 2027", game: "Pokémon", unit: "Stück", received: null, archived: false } ],
    customers: [ { id: "c-demo-1", name: "Anna Beispiel", contact: "", note: "Beispielkunde" }, { id: "c-demo-2", name: "Beispiel Anna", contact: "", note: "Beispiel für eine Dublette" }, { id: "c-demo-3", name: "Max Muster", contact: "", note: "" } ],
    orders: [ { id: "o-demo-1", productId: "p-demo-op", customerId: "c-demo-1", qty: 3, date: d, staff: "XX", status: "Offen", alloc: null, comment: "", createdAt: d },
              { id: "o-demo-2", productId: "p-demo-op", customerId: "c-demo-3", qty: 4, date: d, staff: "XX", status: "Offen", alloc: null, comment: "", createdAt: d },
              { id: "o-demo-3", productId: "p-demo-pk", customerId: "c-demo-2", qty: 1, date: d, staff: "XX", status: "Warteliste", alloc: null, comment: "", createdAt: d } ] };
}

// ---------- Einstellungen
function renderSettings(){
  const isDb = S.provider.kind === "dropbox";
  app.innerHTML = `<div><h1>Einstellungen</h1><p class="sub">Version ${esc(APP_VERSION)} · ${isDb ? "Daten in der Dropbox (App-Ordner, Datei vorbestellungen.json)" : "Nur ausprobieren: Daten liegen nur in diesem Browser"}</p></div>
  <div class="panel"><h2>Speicher</h2><p>Status: <b>${esc(SYNC_TXT[S.doc.status] || S.doc.status)}</b>${S.doc.error ? ` <span class="muted">(${esc(S.doc.error)})</span>` : ""}</p>
    <div class="row"><button id="syncnow">Jetzt abgleichen</button><button id="logout" class="danger">${isDb ? "Dropbox auf diesem Gerät trennen" : "Ausprobieren beenden"}</button></div>
    <p class="muted">Trennen entfernt nur den Zugang auf diesem Gerät. Die Daten in der Dropbox bleiben.</p></div>
  ${isDb ? `<div class="panel"><h2>Kollegen einladen</h2>
    <p class="muted">Mit diesem Code kann ein weiteres Gerät auf denselben Dropbox-App-Ordner zugreifen (nicht auf den Rest der Dropbox). Nur an Mitarbeiter weitergeben.</p>
    <div class="row"><button id="inv">Einladungscode anzeigen</button></div><textarea id="invt" hidden rows="3" style="width:100%" readonly></textarea></div>` : ""}
  <div class="panel"><h2>Sicherung</h2>
    <div class="row"><button id="bk2">Alle Daten herunterladen (JSON)</button></div>
    <p class="muted">Importieren ergänzt bzw. überschreibt Einträge mit gleicher ID. Dropbox hebt frühere Versionen der Datei 30 Tage auf.</p>
    <div class="row"><input type="file" id="impf2" accept=".json,application/json"><span id="impst2" class="muted"></span></div></div>
  <div class="panel"><h2>Excel-Liste importieren</h2>
    <p class="muted">Liest eine Excel-Liste (z. B. Name, Telefon, E-Mail, Produkt A, Produkt B) nur hier im Browser ein. In den Produktspalten zählt eine Zahl als Menge, jeder andere Eintrag als 1 Stück.</p>
    <div class="row"><input type="file" id="xlf" accept=".xlsx,.xls,.csv"></div><div id="xlui"></div></div>`;
  $("#xlf").onchange = e => xlStart(e.target.files[0]);
  $("#syncnow").onclick = () => S.doc.sync();
  $("#logout").onclick = () => { $("#logout").outerHTML = `<button id="lo2" class="danger">Wirklich trennen?</button>`; $("#lo2").onclick = () => { LS.del("vb.cred"); LS.del("vb.cache"); location.hash = ""; location.reload(); }; };
  const inv = $("#inv"); if (inv) inv.onclick = () => { const t = $("#invt"); t.hidden = false; t.value = makeInvite(S.cred); t.select(); };
  $("#bk2").onclick = () => saveFile(`vorbestellungen-sicherung-${today()}.json`, new Blob([JSON.stringify(backupData(), null, 1)], { type: "application/json" }));
  $("#impf2").onchange = e => importFile(e.target.files[0], $("#impst2"));
}

// ---------- Excel-Import (läuft nur im Browser, nichts verlässt das Gerät außer in die Dropbox)
function loadXlsx(){ return window.XLSX ? Promise.resolve() : new Promise((ok, no) => { const sc = document.createElement("script"); sc.src = "vendor/xlsx.full.min.js"; sc.onload = ok; sc.onerror = () => no(new Error("Excel-Bibliothek nicht ladbar")); document.head.appendChild(sc); }); }
// CSV selbst zerlegen (Trennzeichen ; , oder Tab, Anführungszeichen erlaubt)
function parseCsv(text){
  text = text.replace(/^\uFEFF/, ""); const first = text.split(/\r?\n/)[0] || "";
  const sep = [";", "\t", ","].sort((x, y) => first.split(y).length - first.split(x).length)[0];
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch; }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
async function xlStart(file, sheetName){
  if (!file) return; const ui = $("#xlui");
  let sheets = {};
  try {
    if (/\.csv$|\.txt$/i.test(file.name)) sheets = { CSV: parseCsv(await file.text()) };
    else { await loadXlsx(); const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      for (const n of wb.SheetNames) sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "", raw: true }); }
  } catch (e) { ui.innerHTML = `<div class="note bad">Datei nicht lesbar: ${esc(e.message)}</div>`; return; }
  const names = Object.keys(sheets).filter(n => sheets[n].some(r => r.some(v => String(v).trim() !== "")));
  if (!names.length) { ui.innerHTML = `<div class="note bad">In der Datei steht nichts.</div>`; return; }
  const sn = sheetName && names.includes(sheetName) ? sheetName : names[0];
  let rows = sheets[sn].filter(r => r.some(v => String(v).trim() !== ""));
  // Eine Excel-Zeile mit Semikolons in einer Zelle (z. B. "Name;Telefon;…") aufteilen
  if (rows.length && rows[0].filter(v => String(v).trim() !== "").length === 1 && String(rows[0][0]).includes(";")) rows = rows.map(r => String(r[0] ?? "").split(";"));
  // Kopfzeile = erste Zeile, in der „Name“ vorkommt (Titelzeilen darüber werden übersprungen)
  let hi = rows.slice(0, 15).findIndex(r => r.some(v => /name/i.test(String(v)))); if (hi < 0) hi = 0;
  const head = rows[hi].map(h => String(h).trim()); const X = { file, sheet: sn, sheets: names, head, rows: rows.slice(hi + 1) };
  if (!X.rows.length) { ui.innerHTML = `<div class="note bad">Unter der Kopfzeile stehen keine Einträge.</div>`; return; }
  const find = re => head.findIndex(h => re.test(h));
  X.cName = find(/name/i); X.cTel = find(/tel|handy|phone|nummer/i); X.cMail = find(/mail/i);
  X.prodCols = head.map((h, i) => i).filter(i => ![X.cName, X.cTel, X.cMail].includes(i) && (head[i] || X.rows.some(r => String(r[i] ?? "").trim() !== "")));
  S.xl = X; xlDraw();
}
function xlDraw(){
  const X = S.xl, ui = $("#xlui"); if (!X) return;
  const colSel = (id, cur) => `<select id="${id}"><option value="-1">–</option>${X.head.map((h, i) => `<option value="${i}" ${i === cur ? "selected" : ""}>${esc(h || "Spalte " + (i + 1))}</option>`).join("")}</select>`;
  const prods = Object.values(S.products).filter(p => !p.archived).sort((a, b) => a.name.localeCompare(b.name));
  ui.innerHTML = `${X.sheets.length > 1 ? `<div class="row"><label class="row">Tabellenblatt <select id="xl-sh">${X.sheets.map(n => `<option ${n === X.sheet ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label></div>` : ""}
    <p class="muted">Gefunden: ${X.rows.length} Zeilen, Spalten: ${X.head.map(h => esc(h || "?")).join(" · ")}</p>
    <div class="form">
      <label>Spalte Name${colSel("xl-n", X.cName)}</label><label>Spalte Telefon${colSel("xl-t", X.cTel)}</label><label>Spalte E-Mail${colSel("xl-m", X.cMail)}</label>
      <label>Serie<input id="xl-s" placeholder="z. B. Mega Evolution" value="${esc(X.series || "")}"></label>
      <label>Spiel<select id="xl-g">${GAMES.map(g => `<option ${g === (X.game || "Pokémon") ? "selected" : ""}>${g}</option>`).join("")}</select></label>
      <label class="wide">Mehrere Produkte angekreuzt bedeutet<select id="xl-r"><option value="any" ${X.rule !== "all" ? "selected" : ""}>egal welches (Kunde bekommt eines davon)</option><option value="all" ${X.rule === "all" ? "selected" : ""}>beide (Kunde bekommt alle angekreuzten)</option></select></label>
    </div>
    <h2 style="margin-top:12px">Produktspalten</h2>
    <div class="form">${X.prodCols.map(i => `<label>${esc(X.head[i] || "Spalte " + (i + 1))}<select data-pc="${i}"><option value="">nicht importieren</option><option value="new" ${(X.map?.[i] ?? "new") === "new" ? "selected" : ""}>neu anlegen: ${esc(X.head[i])}</option>${prods.map(p => `<option value="${p.id}" ${X.map?.[i] === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>`).join("")}</div>
    <p class="muted" id="xl-sum"></p><div id="xl-err"></div>
    <div class="row"><button class="pri" id="xl-go">Importieren</button><button id="xl-x">Abbrechen</button></div>`;
  const read = () => { X.cName = +$("#xl-n").value; X.cTel = +$("#xl-t").value; X.cMail = +$("#xl-m").value; X.series = $("#xl-s").value.trim(); X.game = $("#xl-g").value; X.rule = $("#xl-r").value;
    X.map = {}; ui.querySelectorAll("[data-pc]").forEach(el => X.map[el.dataset.pc] = el.value); };
  const plan = () => { read(); const cols = Object.entries(X.map).filter(([, v]) => v).map(([i]) => +i);
    const items = []; let skip = 0;
    for (const r of X.rows) { const name = String(r[X.cName] ?? "").trim(); if (!name) { skip++; continue; }
      const hit = cols.map(i => ({ i, v: r[i] })).filter(x => String(x.v ?? "").trim() !== "" && !/^(0|nein|-)$/i.test(String(x.v).trim()));
      if (!hit.length) { skip++; continue; }
      items.push({ name, tel: X.cTel >= 0 ? String(r[X.cTel] ?? "").trim() : "", mail: X.cMail >= 0 ? String(r[X.cMail] ?? "").trim() : "", hit: hit.map(x => ({ i: x.i, q: typeof x.v === "number" && x.v > 0 ? Math.round(x.v) : (parseInt(x.v, 10) > 0 ? parseInt(x.v, 10) : 1) })) }); }
    return { cols, items, skip }; };
  const sum = () => { const { items, skip } = plan(); const multi = items.filter(x => x.hit.length > 1).length; const nw = items.filter(x => !custByName(x.name)).length;
    $("#xl-sum").textContent = `${items.length} Zeilen werden übernommen (${multi} mit mehreren Produkten, ${nw} neue Kunden). ${skip} Zeilen ohne Name oder Produkt werden übersprungen.`; };
  ui.querySelectorAll("select,input").forEach(el => el.onchange = sum); sum();
  const sh = $("#xl-sh"); if (sh) sh.onchange = () => xlStart(X.file, sh.value);
  const err = m => { $("#xl-err").innerHTML = `<div class="note bad">${esc(m)}</div>`; };
  $("#xl-x").onclick = () => { S.xl = null; ui.innerHTML = ""; $("#xlf").value = ""; };
  $("#xl-go").onclick = async () => {
    const { cols, items } = plan();
    if (X.cName < 0) return err("Bitte die Spalte mit dem Namen auswählen.");
    if (!cols.length) return err("Bitte mindestens eine Produktspalte auf „neu anlegen“ oder ein Produkt stellen.");
    if (!items.length) return err("Keine Zeile hat einen Namen und einen Eintrag in einer Produktspalte.");
    if (cols.length > 1 && !X.series) { $("#xl-s").focus(); return err("Bitte einen Serien-Namen eintragen, z. B. „Mega Evolution“."); }
    if (!staff()) { staffEl.focus(); return err("Bitte oben rechts dein Kürzel eintragen, dann noch einmal auf Importieren klicken."); }
    $("#xl-go").disabled = true;
    const pid = {};
    for (const i of cols) { const v = X.map[i];
      if (v === "new") { const name = X.head[i] || "Produkt " + (i + 1); const ex = Object.values(S.products).find(p => p.name.toLowerCase() === name.toLowerCase());
        if (ex) { pid[i] = ex.id; const pt = {}; if (X.series && !ex.series) pt.series = X.series; if (ex.archived) pt.archived = false; if (Object.keys(pt).length) await write("products", ex.id, pt); }
        else { pid[i] = newId("p"); await write("products", pid[i], { name, group: X.series || name, variant: "", series: X.series, game: X.game, release: "", unit: "", received: null, supplierOrdered: null, supplierConfirmed: null, archived: false }, "set"); } }
      else { pid[i] = v; const pt = {}; if (X.series && seriesOf(S.products[v]) !== X.series) pt.series = X.series; if (S.products[v]?.archived) pt.archived = false; if (Object.keys(pt).length) await write("products", v, pt); } }
    let n = 0;
    for (const it of items) {
      let c = custByName(it.name); let cid = c?.id;
      const contact = [it.tel, it.mail].filter(Boolean).join(" · ");
      if (!cid) { cid = newId("c"); await write("customers", cid, { name: it.name, contact, note: "" }, "set"); }
      else if (!c.contact && contact) await write("customers", cid, { contact });
      const base = { customerId: cid, date: today(), staff: staff(), status: "Offen", alloc: null, comment: "Excel-Import", createdAt: new Date().toISOString() };
      if (it.hit.length === 1) { await saveOrder({ ...base, productId: pid[it.hit[0].i], qty: it.hit[0].q }, "one"); n++; }
      else if (X.rule === "any") { await saveOrder({ ...base, productId: null, qty: Math.max(...it.hit.map(h => h.q)) }, "any", it.hit.map(h => pid[h.i])); n++; }
      else { const g = newId("g"); for (const h of it.hit) { await write("orders", newId("o"), { ...base, productId: pid[h.i], qty: h.q, pairId: g }, "set"); n++; } }
    }
    S.xl = null; setGame("Alle"); toast(`${n} Bestellungen importiert`); location.hash = cols.length > 1 ? "serie-" + pid[cols[0]] : "produkt-" + pid[cols[0]];
  };
}

// ---------- Start: Verbinden
function renderConnect(msg){
  document.querySelector("#nav").hidden = true;
  app.innerHTML = `<div class="setup" style="display:grid;gap:18px">
  <div><h1>Vorbestellungen einrichten</h1><p class="sub">Die Daten liegen in eurer Dropbox, nicht in dieser App und nicht auf GitHub.</p></div>
  ${msg ? `<div class="note bad">${esc(msg)}</div>` : ""}
  <div class="panel"><h2>Erstes Gerät: mit Dropbox verbinden</h2>
    <p class="muted">App key der Dropbox-App eintragen (Einrichtung siehe README). Redirect-URI in der Dropbox-App: <span class="mono">${esc(redirectUri())}</span></p>
    <div class="row"><input id="ak" placeholder="App key" style="flex:1 1 200px" value="${esc(LS.get("vb.appkey") || "")}"><button class="pri" id="con">Mit Dropbox verbinden</button></div></div>
  <div class="panel"><h2>Weiteres Gerät: Einladungscode</h2>
    <div class="row"><input id="ic" placeholder="VB1.…" style="flex:1 1 200px"><button id="join">Verbinden</button></div></div>
  <div class="panel"><h2>Nur ausprobieren</h2><p class="muted">Speichert nur in diesem Browser, mit Beispieldaten. Nichts geht in die Dropbox.</p>
    <div class="row"><button id="try">Ausprobieren</button></div></div></div>`;
  $("#con").onclick = () => { const k = $("#ak").value.trim(); if (!k) return toast("Bitte App key eintragen."); LS.set("vb.appkey", k); startDropboxLogin(k); };
  $("#join").onclick = () => { const c = parseInvite($("#ic").value); if (!c) return toast("Code ungültig."); LS.set("vb.cred", JSON.stringify({ kind: "dropbox", ...c })); location.reload(); };
  $("#try").onclick = () => { LS.set("vb.cred", JSON.stringify({ kind: "local" })); location.reload(); };
}

async function boot(){
  let cred = null;
  try { const back = await finishDropboxLogin(); if (back) { cred = { kind: "dropbox", ...back }; LS.set("vb.cred", JSON.stringify(cred)); } }
  catch (e) { return renderConnect(e.message); }
  if (!cred) { try { cred = JSON.parse(LS.get("vb.cred") || "null"); } catch { cred = null; } }
  if (!cred) return renderConnect();
  S.cred = cred;
  S.provider = cred.kind === "dropbox" ? new DropboxProvider(cred) : new LocalProvider();
  S.doc = new SyncDoc(S.provider, DATA_PATH, null, "vb.cache");
  const cached = await S.doc.loadCache();
  S.db = makeDb(S.doc);
  let seen = "";
  S.doc.on(() => {
    drawSync();
    if (!S.doc.obj) return;
    const key = (S.doc.rev || "") + ":" + (S.doc.obj.meta?.updatedAt || 0);
    if (key === seen) return; seen = key; pull(); route();
  });
  if (cached) { pull(); route(); }
  await S.doc.sync();
  if (!S.doc.obj) {
    if (S.doc.status === "ok") { S.doc.obj = emptyData(); S.doc.dirty = true; await S.doc.sync(); }
    else { app.innerHTML = `<div class="note bad">Dropbox nicht erreichbar: ${esc(S.doc.error || "unbekannter Fehler")}. <button id="rt">Erneut versuchen</button> <a class="back" href="#einstellungen">Einstellungen</a></div>`; $("#rt").onclick = () => location.reload(); return; }
  }
  if (cred.kind === "local" && !Object.keys(S.doc.obj.products || {}).length && !LS.get("vb.demo")) { LS.set("vb.demo", "1"); importObj(demoData()); }
  setInterval(() => { if (document.visibilityState === "visible" && !S.doc.dirty) S.doc.sync(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") S.doc.sync(); });
}
window.addEventListener("hashchange", route);
// Höhe der Kopfleiste für fixierte Tabellenköpfe
const setHdr=()=>document.documentElement.style.setProperty("--hdr", (document.querySelector(".bar")?.offsetHeight||100)+"px");
window.addEventListener("resize", setHdr); setHdr();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
