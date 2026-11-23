// TCG Vorbestellungen: Oberfläche und Logik.
// Daten liegen ausschließlich in der Dropbox (App-Ordner) oder beim Ausprobieren im Browser.
import { LS, LocalProvider, DropboxProvider, startDropboxLogin, finishDropboxLogin, makeInvite, parseInvite, redirectUri } from './storage.js';
import { SyncDoc, DATA_PATH, emptyData, now, stable, clone } from './store.js';
import { APP_VERSION } from './version.js';

const STATUSES = ["Offen","Zugeteilt","Auftrag angelegt","Abgeholt","Warteliste","Storniert"];
const LOCKED = new Set(["Auftrag angelegt","Abgeholt"]);         // Zuteilung steht fest
const COUNTS = s => s !== "Storniert" && s !== "Warteliste";       // zählt zur Vorbestellung
const S = { products:{}, customers:{}, orders:{}, loaded:{p:false,c:false,o:false}, db:null, canWrite:true, downloads:null, err:null, sugg:{} };
const $ = s => document.querySelector(s);
const app = $("#app");
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = v => (v === "" || v == null || isNaN(+v)) ? null : +v;
const today = () => { const d=new Date(); return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
const fmtDate = d => d ? d.split("-").reverse().join(".") : "";
const pill = s => `<span class="pill s-${esc((s||"").split(" ")[0])}">${esc(s)}</span>`;
function toast(t){const el=$("#toast");el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,2600)}
const store = (k,v) => { try { if (v===undefined) return localStorage.getItem(k); localStorage.setItem(k,v);} catch(e){ return null; } };

// ---------- Kürzel
// Kürzel gilt nur für dieses App-Fenster (geteilte Flex-PCs): sessionStorage + Rücksetzen nach 30 Min. ohne Eingabe
const STAFF_IDLE = 30*60*1000;
const sess = (k,v) => { try { if (v===undefined) return sessionStorage.getItem(k); if (v===null) sessionStorage.removeItem(k); else sessionStorage.setItem(k,v); } catch(e){ return null; } };
try { localStorage.removeItem("staff"); } catch(e){}
let lastAct = Number(sess("vb.act")) || 0;
const staffEl = $("#staff"); staffEl.value = (Date.now()-lastAct < STAFF_IDLE && sess("vb.staff")) || "";
const touch = () => { lastAct = Date.now(); sess("vb.act", String(lastAct)); };
["pointerdown","keydown"].forEach(ev => document.addEventListener(ev, touch, { passive: true })); touch();
setInterval(() => { if (staffEl.value && Date.now()-lastAct > STAFF_IDLE) { staffEl.value = ""; sess("vb.staff", null); markStaff(); toast("Kürzel nach 30 Minuten ohne Eingabe zurückgesetzt."); } }, 60000);
function markStaff(){ const v=staffEl.value.toUpperCase().trim(); const known=Object.values(S.staff||{}); const rec=known.find(m=>m.kuerzel===v);
  const btn=$("#staffbtn"), lab=$("#staffl"); if(btn){ btn.hidden=!known.length; lab.hidden=known.length>0;
    btn.textContent = rec ? `${rec.name} (${rec.kuerzel})` : "Wer bist du?"; btn.classList.toggle("need", !rec); btn.title = rec ? "Klicken, um zu wechseln" : "Bitte deinen Namen auswählen"; }
  staffEl.classList.toggle("need", !v || (known.length>0 && !rec)); staffEl.title = rec ? `Angemeldet als ${rec.name}` : (v && known.length ? "Kürzel nicht angelegt" : ""); }
staffEl.addEventListener("change", () => { staffEl.value = staffEl.value.toUpperCase().trim(); sess("vb.staff", staffEl.value); markStaff(); });
staffEl.addEventListener("input", markStaff); $("#staffbtn").onclick=()=>pickStaff(); markStaff();
const staff = () => staffEl.value.toUpperCase().trim();
function setStaff(k){ staffEl.value=k||""; sess("vb.staff", k||null); touch(); markStaff(); }
// Namensauswahl: auf geteilten PCs klickt jeder vor dem Anlegen seinen Namen an
function pickStaff(){
  if(document.getElementById("pickstaff")) return;
  const list=Object.values(S.staff||{}).sort((a,b)=>(a.name||"").localeCompare(b.name||"","de"));
  const box=document.createElement("div"); box.className="modal"; box.id="pickstaff"; document.body.appendChild(box);
  box.innerHTML=`<div class="panel modal-card" role="dialog" aria-modal="true" aria-labelledby="psh" style="max-width:520px">
    <h2 id="psh">Wer bist du?</h2><p class="muted">Bitte deinen Namen anklicken. Er gilt für dieses Fenster und wird nach 30 Minuten ohne Eingabe gelöscht.</p>
    <div class="pickgrid">${list.map(m=>`<button type="button" class="pick ${m.kuerzel===staff()?"on":""}" data-k="${esc(m.kuerzel)}"><b>${esc(m.name||m.kuerzel)}</b><span>${esc(m.kuerzel)}</span></button>`).join("")}</div>
    <div class="row spread"><a class="back" href="#einstellungen" id="ps-set">Mitarbeiter verwalten</a><span class="row">${staff()?`<button type="button" id="ps-out">Abmelden</button>`:""}<button type="button" id="ps-x">Abbrechen</button></span></div></div>`;
  const close=()=>box.remove();
  box.querySelectorAll("[data-k]").forEach(b=>b.onclick=()=>{ setStaff(b.dataset.k); close(); toast(`Hallo ${staffRec()?.name||b.dataset.k}! Jetzt kannst du weitermachen.`); });
  box.querySelector("#ps-x").onclick=close; box.querySelector("#ps-set").onclick=close;
  const o=box.querySelector("#ps-out"); if(o) o.onclick=()=>{ setStaff(""); close(); };
  box.onclick=e=>{ if(e.target===box) close(); };
  box.querySelector(".pick")?.focus();
}
function staffRec(k){ return Object.values(S.staff||{}).find(m=>m.kuerzel===(k??staff())); }
const staffName = () => staffRec()?.name || staff();
function needStaff(){
  if(Object.keys(S.staff||{}).length && !staffRec()){ pickStaff(); return true; }
  if(!staff()){ markStaff(); staffEl.focus(); toast("Bitte zuerst oben rechts dein Kürzel eintragen."); return true; }
  if(Object.keys(S.staff||{}).length && !staffRec()){ pickStaff(); return true; }
  return false; }

// ---------- Spiele
const BASE_GAMES = ["One Piece","Pokémon","Riftbound","Magic","Yu-Gi-Oh!"];
const NO_GAME = "Ohne Spiel";
const gameId = n => "g-" + n.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
// Spielsysteme: feste Grundliste + selbst angelegte (Sammlung games); „Ohne Spiel“ ist immer wählbar
function games(){ const g=Object.values(S.games||{}); const hidden=new Set(g.filter(x=>x.hidden).map(x=>x.name));
  return [...new Set([...BASE_GAMES.filter(x=>!hidden.has(x)), ...g.filter(x=>!x.hidden).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)).map(x=>x.name)])]; }
const gameOptions = cur => { const l=games(); if(cur && cur!==NO_GAME && !l.includes(cur)) l.push(cur); return [...l, NO_GAME].map(g=>`<option value="${esc(g)}" ${g===cur?"selected":""}>${esc(g)}</option>`).join(""); };
const gameOf = p => p?.game || "One Piece";
S.game = store("game") || "Alle";
const inGame = p => S.game==="Alle" || gameOf(p)===S.game;
function setGame(g){ S.game=g; store("game",g); drawGames(); render(); }
function drawGames(){ const g=$("#games"); const used=new Set(Object.values(S.products||{}).map(gameOf));
  const list=["Alle",...games(),...(used.has(NO_GAME)?[NO_GAME]:[])];
  if(S.loaded?.p && !list.includes(S.game)) { S.game="Alle"; }
  g.innerHTML=list.map(x=>`<button type="button" class="${x===S.game?"on":""}" data-g="${esc(x)}">${esc(x)}</button>`).join("");
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
  // Doppelnamen: „Max Muster-Beispiel“ ~ „Max Muster“ (alle Teile des kürzeren Namens kommen im längeren vor)
  const [sh,lo]=ta.length<=tb.length?[ta,tb]:[tb,ta];
  if (sh.length>1 && sh.every(t=>lo.some(u=>u===t||(t.length>3&&lev(t,u)<=1)))) return true;
  const lastA=ta[ta.length-1], lastB=tb[tb.length-1];
  return ta.length>1 && tb.length>1 && (lastA===lastB || ta[0]===tb[0] && lev(lastA,lastB)<=1) && (ta[0].startsWith(tb[0])||tb[0].startsWith(ta[0])||ta.includes(lastB)&&tb.includes(lastA));
}
const notDupe = (a,b) => (a.notDupes||[]).includes(b.id) || (b.notDupes||[]).includes(a.id);
const sameEtron = (a,b) => a.etronId && b.etronId && String(a.etronId).trim()===String(b.etronId).trim();
const dupesOf = c => Object.values(S.customers).filter(x => x.id!==c.id && !notDupe(c,x) && (similar(x.name,c.name) || sameEtron(x,c)));
// Namenssuche: jedes eingegebene Wort (auch Teile) muss im Namen vorkommen, Reihenfolge egal
const nameMatch = (q, c) => { const w=norm(q).split(" ").filter(Boolean); if(!w.length) return true; const n=norm(c?.name||""); return w.every(x=>n.includes(x)); };
// Anzeige-Sortierung der Vorbesteller (ändert nichts an der Zuteilungs-Reihenfolge)
const SORTS = [["","Reihenfolge wie eingetragen"],["first","A–Z nach Vorname"],["last","A–Z nach Nachname"]];
const sortSel = () => `<select id="osort" aria-label="Sortierung">${SORTS.map(([v,t])=>`<option value="${v}" ${v===(S.osort||"")?"selected":""}>${t}</option>`).join("")}</select>`;
function bindSort(){ const el=$("#osort"); if(el) el.onchange=e=>{ S.osort=e.target.value; render(); }; }
function sortView(list, cidOf){ if(!S.osort) return list; const key=x=>{ const np=nameParts(S.customers[cidOf(x)]||{}); return S.osort==="last" ? (np.last+" "+np.first) : (np.first+" "+np.last); };
  return [...list].sort((a,b)=>key(a).localeCompare(key(b),"de",{sensitivity:"base"})); }
const oqInput = () => `<input id="oq" type="search" class="search" placeholder="Kunde suchen (Vor-/Nachname)" value="${esc(S.oq||"")}" style="width:220px">`;
function bindOq(){ const el=$("#oq"); if(el) el.oninput=e=>{S.oq=e.target.value;render();}; }
const custByName = n => Object.values(S.customers).find(c => norm(c.name)===norm(n));
// Vor-/Nachname: gespeichert in firstName/lastName; ältere Kunden haben nur name (dann: erstes Wort = Vorname, ungeprüft)
const nameChecked = c => !!(c && c.firstName);
const nameParts = c => { if (nameChecked(c)) return { first: c.firstName, last: c.lastName || "" }; const t=(c?.name||"").trim().split(/\s+/); return { first: t[0]||"", last: t.slice(1).join(" ") }; };
// Vor dem Namen: Haken zum Bestätigen eines ungeprüften Vor-/Nachnamens (verschwindet danach), Hinweis bei fehlender Telefonnummer
function custFlags(c){ if(!c||!c.id) return ""; const np=nameParts(c); let h="";
  if(!nameChecked(c)) h+=`<input type="checkbox" class="ncheck" data-ncheck="${c.id}" title="Ungeprüft: Vorname „${esc(np.first)}“, Nachname „${esc(np.last)}“. Abhaken, wenn das stimmt (sonst Name anklicken und korrigieren).">`;
  if(!contactFields(c).tel) h+=`<span class="pill nonr" title="Keine Telefonnummer hinterlegt">keine Nr.</span>`;
  return h; }
document.addEventListener("change", e=>{ const t=e.target; if(!t.matches||!t.matches("[data-ncheck]")||!t.checked) return; const c=S.customers[t.dataset.ncheck]; if(!c) return;
  const np=nameParts(c); write("customers",c.id,{firstName:np.first,lastName:np.last,name:(np.first+" "+np.last).trim()}).then(ok=>ok&&toast(`Name bestätigt: ${np.first} ${np.last}`)); });
const custByParts = (fn, ln) => { const a=norm(fn+" "+ln), b=norm(ln+" "+fn); return Object.values(S.customers).find(c => { const n=norm(c.name); return n===a || n===b; }); };

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
  else if (h==="protokoll") renderLog();
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
      <label>Spiel<select id="np-game">${gameOptions(S.game==="Alle"?"One Piece":S.game)}</select></label>
      <label>Einheit<input id="np-unit" placeholder="Display, Case, Stück"></label>
      <button class="pri" ${S.canWrite?"":"disabled"}>Anlegen</button>
    </form><p class="muted">Varianten (Decks, Artworks) als eigenes Produkt anlegen, z. B. „ST45 | Rot“. Dann zählt jede Variante getrennt. Mehrere Produkte in einer gemeinsamen Liste (z. B. zwei Sets am selben Release): erstes Produkt anlegen, dann auf seiner Seite „+ Weiteres Produkt in diese Liste“.</p></div>`;
  $("#pq").oninput = e => { S.pq=e.target.value; render(); };
  const sa=$("#showall"); if(sa) sa.onclick=()=>setGame("Alle");
  $("#parch").onchange = e => { S.parch=e.target.checked; renderProducts(); };
  app.querySelectorAll("tr[data-go]").forEach(tr=>tr.onclick=e=>{ if(e.target.tagName!=="A"&&e.target.tagName!=="INPUT") location.hash=tr.dataset.go; });
  $("#np").onsubmit = async e => { e.preventDefault(); const name=$("#np-name").value.trim(); if(!name) return;
    if (Object.values(S.products).some(p=>p.name.toLowerCase()===name.toLowerCase())) return toast("Dieses Produkt gibt es schon.");
    const id = "p-"+name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,50)+"-"+Date.now().toString(36).slice(-4);
    if (await write("products",id,{name,group:name.split("|")[0].trim(),variant:(name.split("|")[1]||"").trim(),release:$("#np-rel").value.trim(),unit:$("#np-unit").value.trim(),game:$("#np-game").value,received:null,supplierOrdered:null,supplierConfirmed:null,archived:false},"set")) { toast("Produkt angelegt"); location.hash="produkt-"+id; } };
}

function veTxt(n, ps){ if(n==null||!ps) return ""; const v=Math.floor(n/ps), r=n%ps; return v&&r?`${v} VE + ${r} Stk.`:v?`${v} VE`:`${r} Stk.`; }
function veField(f, label, p){ const ps=p.packSize; const n=p[f];
  return `<label>${label}<span class="row" style="gap:6px;flex-wrap:nowrap"><input id="pd-${f}" type="number" min="0" value="${n??""}" style="flex:1" title="Stück">${ps?`<input id="ve-${f}" type="number" min="0" step="1" class="ve" value="${n!=null&&n%ps===0?n/ps:""}" placeholder="VE" title="In VE eintragen (1 VE = ${ps} Stück)"><span class="muted">VE</span>`:""}</span>${ps&&n!=null&&n%ps?`<span class="muted">= ${veTxt(n,ps)}</span>`:""}</label>`; }

// ---------- weiteres Produkt in dieselbe Liste (Serie) aufnehmen
const addVarBtn = () => `<button class="sm" id="addv" title="Weiteres Produkt (z. B. zweites Set am selben Release) in diese gemeinsame Liste aufnehmen">+ Weiteres Produkt in diese Liste</button>`;
function bindAddVar(p){ const b=$("#addv"); if(!b) return;
  b.onclick=()=>{ const box=$("#addvbox"); box.innerHTML=`<div class="panel"><h2>Weiteres Produkt in diese Liste</h2><form class="form" id="av-f">
      <label class="wide">Produktname<input id="av-name" required placeholder="z. B. IB-10"></label>
      <label>Artikelnummer<input id="av-art" placeholder="optional"></label>
      <button class="pri" ${S.canWrite?"":"disabled"}>Anlegen</button><button type="button" id="av-x">Abbrechen</button></form>
      <p class="muted">Spiel, Release, Einheit und VE werden von „${esc(p.name)}“ übernommen. Danach stehen beide Produkte gemeinsam in einer Liste, und Bestellungen bekommen ein Mengenfeld je Produkt.</p></div>`;
    $("#av-x").onclick=()=>{ box.innerHTML=""; }; $("#av-name").focus();
    $("#av-f").onsubmit=async e=>{ e.preventDefault(); const name=$("#av-name").value.trim(), art=$("#av-art").value.trim(); if(!name) return;
      if (Object.values(S.products).some(x=>x.name.toLowerCase()===name.toLowerCase())) return toast("Dieses Produkt gibt es schon.");
      let ser=seriesOf(p); if(!ser){ ser=p.name+" / "+name; if(!await write("products",p.id,{series:ser})) return; }
      const id="p-"+name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,50)+"-"+Date.now().toString(36).slice(-4);
      if (await write("products",id,{name,group:name.split("|")[0].trim(),variant:(name.split("|")[1]||"").trim(),series:ser,release:p.release||"",unit:p.unit||"",packSize:p.packSize??null,game:gameOf(p),articleNo:art||undefined,received:null,supplierOrdered:null,supplierConfirmed:null,archived:false},"set")) { toast("Produkt angelegt"); location.hash="serie-"+id; } }; }; }

function renderProduct(pid){
  const p = S.products[pid]; if(!p){ app.innerHTML=`<a class="back" href="#produkte">← Produkte</a><div class="empty">Dieses Produkt gibt es nicht mehr.</div>`; return; }
  const s = stats(p); const sug = S.sugg[pid];
  const os = [...ordersOf(pid), ...flexOf(pid)].sort(sortOrders);
  const fstat = S.fstat||"aktiv";
  const shown = sortView(os.filter(o => nameMatch(S.oq, S.customers[o.customerId])).filter(o => fstat==="alle" || (fstat===MSG_OPEN ? msgOpenType([o]) : fstat==="aktiv" ? isActive(o, sug) : o.status===fstat)), o=>o.customerId);
  const sugSum = sug ? Object.values(sug.map).reduce((a,b)=>a+b,0) : 0;
  app.innerHTML = `
  <a class="back" href="#produkte">← Produkte</a>
  <div class="row spread"><div><h1>${esc(p.name)}</h1><p class="sub"><a class="back" href="#protokoll" data-logq="${esc(p.name)}">Verlauf</a>${/^https?:\/\//.test(p.etronUrl||"")?` · <a class="back" href="${esc(p.etronUrl)}" target="_blank" rel="noopener">In etron öffnen</a>`:""} · ${p.articleNo?"Art.-Nr. "+esc(p.articleNo)+" · ":""}${esc(gameOf(p))} · Release ${esc(relTxt(p.release))}${p.unit?" · Einheit "+esc(p.unit):""}${siblings(p).length>1?` · <a class="back" href="#serie-${p.id}">Ganze Serie „${esc(seriesOf(p))}“ zuteilen →</a>`:""}</p></div>
   <div class="row">${addVarBtn()}<button class="sm" id="arch">${p.archived?"Wieder aktivieren":"Archivieren"}</button><button class="sm danger" id="del">Löschen</button><span id="delc"></span></div></div>
  <div id="addvbox"></div>
  ${p.archived?`<div class="note">Dieses Produkt ist archiviert und erscheint nur mit „Archivierte zeigen“ in der Produktliste.</div>`:""}
  <div class="tiles">
    <div class="tile"><b>${s.pre}</b><span>vorbestellt</span></div>
    ${s.flex?`<div class="tile"><b>+${s.flex}</b><span>egal welches (Serie)</span></div>`:""}
    <div class="tile"><b>${s.rec??"–"}</b><span>Wareneingang${p.packSize&&s.rec!=null?` (${veTxt(s.rec,p.packSize)})`:""}</span></div>
    <div class="tile"><b>${s.alloc}</b><span>zugeteilt</span></div>
    <div class="tile ${s.over?"bad":s.free===0?"ok":""}"><b>${s.free??"–"}</b><span>noch frei</span></div>
    <div class="tile ${s.rec!=null&&s.pre>s.rec?"bad":""}"><b>${s.rec==null?"–":Math.max(0,s.pre-s.rec)}</b><span>Fehlmenge</span></div>
  </div>
  ${s.over?`<div class="note bad">Es sind ${s.alloc-s.rec} Stück mehr zugeteilt als geliefert. Bitte Zuteilungen reduzieren.</div>`:""}
  <div class="panel"><h2>Produktdaten</h2>
    <div class="form">
      <label class="wide">Produktname<input id="pd-name" value="${esc(p.name||"")}"></label>
      <label>Artikelnummer<input id="pd-articleNo" value="${esc(p.articleNo||"")}" placeholder="etron-Artikelnr."></label>
      <label class="wide">etron-Link zum Artikel<span class="row" style="gap:6px;flex-wrap:nowrap"><input id="pd-etronUrl" type="url" value="${esc(p.etronUrl||"")}" placeholder="https://… (Adresse aus dem Browser kopieren)" style="flex:1">${/^https?:\/\//.test(p.etronUrl||"")?`<a class="btn" href="${esc(p.etronUrl)}" target="_blank" rel="noopener">Öffnen</a>`:""}</span></label>
      <label class="wide">Name in Kundennachrichten<input id="pd-msgName" value="${esc(p.msgName||"")}" placeholder="leer = Produktname (ohne Artikelnummer eintragen)"></label>
      <label>Release<input id="pd-release" value="${esc(p.release||"")}" placeholder="JJJJ-MM-TT, Q2 2027"></label>
      <label>Serie<input id="pd-series" value="${esc(p.series||"")}" placeholder="z. B. Mega Evolution"></label>
      <label>Spiel<select id="pd-game">${gameOptions(gameOf(p))}</select></label>
      <label>Einheit<input id="pd-unit" value="${esc(p.unit||"")}"></label>
      <label>VE (Stück pro Karton)<input title="Verpackungseinheit" id="pd-packSize" type="number" min="1" step="1" value="${p.packSize??""}" placeholder="z. B. 8 Displays pro Karton"></label>
      ${veField("supplierOrdered","Beim Lieferanten bestellt",p)}
      ${veField("supplierConfirmed","Lieferant zugesagt",p)}
      ${veField("received","Wareneingang (verfügbar)",p)}
    </div></div>
  <div class="panel"><div class="row spread"><h2>Zuteilung</h2>
    <div class="row">
      <select id="mode"><option value="prop">Proportional (fair verteilt)</option><option value="fifo" ${S.mode==="fifo"?"selected":""}>Nach Bestelldatum (wer zuerst kommt)</option></select>
      <button id="sug" ${s.rec==null?"disabled":""}>Vorschlag berechnen</button>
      ${sug?`<button class="pri" id="apply" ${S.canWrite?"":"disabled"}>Vorschlag übernehmen (${sugSum} Stück)</button><button id="dis">Verwerfen</button>`:""}
      <button id="close" ${s.alloc?"":"disabled"} title="Alle offenen Bestellungen mit Zuteilung auf Zugeteilt setzen">Zuteilung abschließen</button>
      <button id="rest" title="Alle offenen Bestellungen ohne Zuteilung auf Warteliste setzen">Rest auf Warteliste</button>
    </div></div>
    ${s.rec==null?'<p class="muted">Erst den Wareneingang eintragen, dann kann ein Vorschlag berechnet werden.</p>':sug?'<p class="muted">Vorschlag steht in der Spalte „Vorschlag“. Noch nichts gespeichert.</p>':'<p class="muted">Zuteilungen können auch direkt in der Tabelle eingetragen werden. Bestellungen mit Status „Auftrag angelegt“ oder „Abgeholt“ bleiben beim Vorschlag unverändert.</p>'}
  </div>
  ${orderForm("pr", pid)}
  <div class="row spread"><h2>Bestellungen (${shown.length})</h2>
    <span class="row" style="gap:6px">${oqInput()}${sortSel()}<select id="fstat">${["aktiv","alle",...STATUSES,MSG_OPEN].map(x=>`<option value="${x}" ${x===fstat?"selected":""}>${x==="aktiv"?"aktiv (offen + Warteliste)":x}</option>`).join("")}</select>${typeSel(fstat)}</span></div>
  <div class="tablebox"><table><thead><tr><th>Kunde</th><th class="n">Menge</th><th>Bestellt am</th><th>MA</th><th>Status</th><th class="n">Zuteilung</th>${sug?'<th class="n">Vorschlag</th>':""}<th>Auftrag</th><th>Nachricht</th><th>Kommentar</th></tr></thead><tbody>
  ${shown.map(o=>{const c=S.customers[o.customerId];const d=c?dupesOf(c):[];return `<tr data-o="${o.id}" class="${o.status==="Storniert"?"dim":""}">
    <td>${custFlags(c)}<a href="#kunde-${o.customerId}">${esc(c?.name||"?")}</a>${!o.productId?` <span class="pill s-Offen" title="${esc(orderLabel(o))}">egal welches</span>`:o.pairId?` <span class="gtag">Teil von „beide“</span>`:""}${d.length?` <span class="pill s-Warteliste" title="Ähnlich: ${esc(d.map(x=>x.name).join(", "))}">Dublette?</span>`:""}</td>
    <td class="n"><input type="number" min="0" data-f="qty" id="q-${o.id}" value="${o.qty??""}"></td>
    <td><input type="date" data-f="date" id="d-${o.id}" value="${esc(o.date||"")}"></td>
    <td class="mono">${esc(o.staff||"")}</td>
    <td><select data-f="status" id="s-${o.id}">${STATUSES.map(x=>`<option ${x===o.status?"selected":""}>${x}</option>`).join("")}</select></td>
    <td class="n"><input type="number" min="0" data-f="alloc" id="a-${o.id}" value="${o.alloc??""}"></td>
    ${sug?`<td class="n" style="font-weight:700;color:var(--accent)">${sug.map[o.id]??""}</td>`:""}
    <td style="text-align:center">${auftragBox([o])}</td><td>${msgBtn([o])}</td>
    <td><input class="c" data-f="comment" id="k-${o.id}" value="${esc(o.comment||"")}"></td></tr>`}).join("") || `<tr><td colspan="8" class="empty">Noch keine Bestellungen. Unten die erste erfassen.</td></tr>`}
  </tbody></table></div>`;
  // product fields
  $("#pd-game").onchange=e=>write("products",pid,{game:e.target.value}).then(ok=>ok&&toast("Gespeichert"));
  ["name","msgName","articleNo","etronUrl","release","series","unit","packSize","supplierOrdered","supplierConfirmed","received"].forEach(f=>{ const el=$("#pd-"+f); el.onchange=()=>{ const v=el.type==="number"?num(el.value):el.value.trim(); if(f==="packSize"&&v!=null&&!(v>=1&&Number.isInteger(v))){ el.value=p.packSize??""; return toast("Bitte eine ganze Zahl ab 1 eintragen."); } if(f==="name"&&!v){ el.value=p.name; return toast("Produktname darf nicht leer sein."); } if(f==="etronUrl"&&v&&!/^https?:\/\//.test(v)) return toast("Bitte die vollständige Adresse mit https:// einfügen."); write("products",pid,{[f]:v}).then(ok=>ok&&toast("Gespeichert")); }; });
  if(p.packSize) ["supplierOrdered","supplierConfirmed","received"].forEach(f=>{ const el=$("#ve-"+f); el.onchange=()=>{ const v=num(el.value); write("products",pid,{[f]:v==null?null:v*p.packSize}).then(ok=>ok&&toast(v==null?"Gespeichert":`Gespeichert: ${v*p.packSize} Stück`)); }; });
  bindAddVar(p);
  $("#arch").onclick=()=>write("products",pid,{archived:!p.archived});
  $("#del").onclick=()=>{ const own=ordersOf(pid), fl=flexOf(pid);
    $("#delc").innerHTML=` <button class="sm danger" id="delok">Ja: Produkt und ${own.length} Bestellungen endgültig löschen</button>`;
    $("#delok").onclick=()=>{ const t=now(); S.doc.update(o=>{ o.products[pid]={deleted:true,updatedAt:t};
        for(const x of own) o.orders[x.id]={deleted:true,updatedAt:t};
        for(const x of fl){ const ch=(o.orders[x.id].choices||[]).filter(c=>c!==pid); o.orders[x.id]= ch.length>1 ? {...o.orders[x.id],choices:ch,_ft:undefined,updatedAt:t} : ch.length===1 ? {...o.orders[x.id],choices:undefined,_ft:undefined,productId:ch[0],updatedAt:t} : {deleted:true,updatedAt:t}; } });
      toast("Produkt gelöscht"); location.hash="produkte"; }; };
  $("#fstat").onchange=e=>{S.fstat=e.target.value;render();}; bindTypeSel(); bindOq(); bindSort();
  $("#mode").onchange=e=>{S.mode=e.target.value; if(S.sugg[pid]){S.sugg[pid]={map:suggest(p,S.mode)};render();}};
  $("#sug").onclick=()=>{ S.sugg[pid]={map:suggest(p,$("#mode").value)}; render(); };
  if (sug){ $("#dis").onclick=()=>{delete S.sugg[pid];render();};
    $("#apply").onclick=async()=>{ const b=$("#apply"); b.disabled=true; const ch=Object.entries(sug.map).filter(([id,v])=>S.orders[id] && (S.orders[id].alloc!==v || !S.orders[id].productId) && !(!S.orders[id].productId && !v));
      try{ await pool(ch, ([id,v])=>S.db.collection("orders").doc(id).update(S.orders[id].productId?{alloc:v}:{alloc:v,productId:pid,comment:[S.orders[id].comment,`war: ${orderLabel(S.orders[id])}`].filter(Boolean).join(" · ")})); delete S.sugg[pid]; toast(`${ch.length} Zuteilungen gespeichert`); render(); }catch(e){ toast("Nicht alles gespeichert: "+(e.message||e.code)); b.disabled=false; } }; }
  bindRest(()=>ordersOf(pid)); // „egal welches“ nur auf der Serienseite
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
  app.querySelectorAll("[data-msg]").forEach(b=>b.onclick=()=>msgDialog(b.dataset.msg.split(",")));
  app.querySelectorAll("[data-copy]").forEach(b=>b.onclick=()=>quickCopy(b.dataset.copy.split(",")));
  app.querySelectorAll("[data-auftrag]").forEach(el=>el.onchange=async()=>{ const ids=el.dataset.auftrag.split(","); const on=el.checked;
    ids.forEach(id=>on?S.doneNow.add(id):S.doneNow.delete(id));
    await pool(ids, id=>S.db.collection("orders").doc(id).update({status:on?"Auftrag angelegt":"Zugeteilt"}));
    toast(on?"Auftrag angelegt ✓":"Zurück auf Zugeteilt"); });
}
function bindRows(){
  bindAuftrag();
  app.querySelectorAll("tr[data-o] [data-f]").forEach(el=>el.onchange=async()=>{ const id=el.closest("tr").dataset.o, f=el.dataset.f;
    let v = el.type==="number"?num(el.value):el.value.trim();
    if (f==="status" && v==="Storniert") return cancelOrders([id]);
    if (f==="alloc") return saveAlloc(id, v);
    const o=S.orders[id]; const patch={[f]:v};
    if (f==="status" && v==="Offen" && o && isResolvedFlex(o) && !(o.alloc>0)) Object.assign(patch, unflex(o), {status:"Offen"});
    write("orders",id,patch).then(ok=>ok&&toast(patch.productId===null?"Wieder offen: „egal welches“":"Gespeichert")); });
}

// ---------- Nachrichten an Kunden
const DEFAULT_TEMPLATES = [
  { id: "t-abholbereit", name: "Abholbereit", text: "Hallo {Vorname},\nDeine Vorbestellung von {Spiel} {Produkt} ist angekommen.\nDu kannst sie ab {Tag} im Shop abholen.\n\nLiebe Grüße\nHive Games\n{Mitarbeiter}" },
  { id: "t-storno", name: "Storno", text: "Hallo {Vorname},\nleider müssen wir deine Vorbestellung von {Produkt} stornieren, da wir nicht genug Ware bekommen haben. Das tut uns sehr leid.\n\nLiebe Grüße\nHive Games\n{Mitarbeiter}" },
  { id: "t-warteliste", name: "Warteliste", text: "Hallo {Vorname},\nvon {Produkt} haben wir leider nicht genug für alle Vorbestellungen bekommen. Du stehst auf der Warteliste und wir melden uns, sobald eine Nachlieferung kommt.\n\nLiebe Grüße\nHive Games\n{Mitarbeiter}" },
];
function templates(){ const all = Object.values(S.templates||{}); const ids = new Set(all.map(t=>t.id)); const own = all.filter(t=>!t.hidden); return [...own, ...DEFAULT_TEMPLATES.filter(t=>!ids.has(t.id))].sort((a,b)=>(a.order??99)-(b.order??99)||a.name.localeCompare(b.name)); }
const autoTplId = os => os.find(o=>o.status==="Storniert")?"t-storno":os.find(o=>o.status==="Warteliste")?"t-warteliste":"t-abholbereit";
const QUICK = {"t-abholbereit":"Abholung","t-storno":"Storno","t-warteliste":"Warteliste"};
function quickTpl(os){ if(!os.some(o=>["Zugeteilt","Auftrag angelegt","Abgeholt","Storniert","Warteliste"].includes(o.status))) return null; return templates().find(t=>t.id===autoTplId(os))||null; }
async function copyText(txt){ try{ await navigator.clipboard.writeText(txt); return true; }
  catch(e){ const ta=document.createElement("textarea"); ta.value=txt; document.body.appendChild(ta); ta.select(); let ok=false; try{ ok=document.execCommand("copy"); }catch(_){} ta.remove(); return ok; } }
const markSent = (os, t) => pool(os, o=>S.db.collection("orders").doc(o.id).update({notified:{date:today(),template:t?.name||"Eigene Nachricht",tid:t?.id||"",staff:staff()}}));
async function quickCopy(ids){ if(needStaff()) return; const os=ids.map(id=>S.orders[id]).filter(Boolean); const t=quickTpl(os); if(!t) return;
  if(!await copyText(fillTemplate(t.text,os))) return toast("Kopieren nicht möglich, bitte über „Nachricht“");
  await markSent(os, t); toast(`„${t.name}“ kopiert und als gesendet markiert`); }
const TID_BY_NAME = {Abholbereit:"t-abholbereit", Storno:"t-storno", Warteliste:"t-warteliste"};
const MSG_OPEN = "Nachricht noch nicht gesendet";
// „aktiv“ = noch offen: Status Offen oder Warteliste. Während ein Zuteilungsvorschlag offen ist, auch Zugeteilte (die der Vorschlag ändern kann).
const isActive = (o, sug) => o.status==="Offen" || o.status==="Warteliste" || (!!sug && o.status==="Zugeteilt");
const MSG_TYPES = [["","alle Nachrichtentypen"],["t-abholbereit","nur Abholung"],["t-storno","nur Storno"],["t-warteliste","nur Warteliste"]];
const msgOpenType = list => msgOpen(list) && (!S.mtype || autoTplId(list.filter(o=>o&&["Zugeteilt","Auftrag angelegt","Storniert","Warteliste"].includes(o.status)))===S.mtype);
const typeSel = f => f===MSG_OPEN ? `<select id="ftype" aria-label="Nachrichtentyp">${MSG_TYPES.map(([v,t])=>`<option value="${v}" ${v===(S.mtype||"")?"selected":""}>${t}</option>`).join("")}</select>` : "";
function bindTypeSel(){ const el=$("#ftype"); if(el) el.onchange=e=>{S.mtype=e.target.value;render();}; }
const notifiedTid = n => n ? (n.tid || TID_BY_NAME[n.template] || "") : null;
// offen = Status braucht eine Nachricht, und die passende (Abholung/Storno/Warteliste) wurde noch nicht gesendet
function msgOpen(list){ const os=list.filter(o=>o&&["Zugeteilt","Auftrag angelegt","Storniert","Warteliste"].includes(o.status)); if(!os.length) return false;
  const want=autoTplId(os); const n=os.find(o=>o.notified)?.notified; if(!n) return true;
  const got=notifiedTid(n); return Object.values(TID_BY_NAME).includes(got) ? got!==want : false; } // eigene Nachricht gilt als gesendet
function msgClass(n, os){ if(!n || (os && msgOpen(os))) return "msg-new"; const id=notifiedTid(n); return id==="t-storno"?"msg-storno":id==="t-warteliste"?"msg-wait":"msg-ok"; }
function msgBtn(list){ const os=list.filter(Boolean); if(!os.length) return ""; const n=os.find(o=>o.notified)?.notified;
  const q=quickTpl(os);
  return `<span class="row" style="gap:4px;flex-wrap:nowrap">${q?`<button class="sm" data-copy="${os.map(o=>o.id).join(",")}" title="Text „${esc(q.name)}“ mit heutigem Datum kopieren und als gesendet markieren">📋 ${esc(QUICK[q.id]||q.name)}</button>`:""}<button class="sm ${msgClass(n, os)}" data-msg="${os.map(o=>o.id).join(",")}" title="${n?`Zuletzt: ${esc(n.template)} am ${fmtDate(n.date)} (${esc(n.staff||"")})`:"Noch keine Nachricht gesendet"}">${n?"✓ ":""}Nachricht</button>${S.customers[os[0].customerId]?.noWhatsapp?`<span class="pill" style="background:var(--grey-soft)" title="Kunde hat kein WhatsApp: per SMS schicken">SMS</span>`:""}</span>`; }
const firstName = n => (n||"").trim().split(/\s+/)[0] || "";
const WEEKDAYS=["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
const fmtTag = d => d ? WEEKDAYS[new Date(d+"T12:00:00").getDay()]+", "+fmtDate(d) : "";
const spielOf = os => [...new Set(os.map(o=>gameOf(S.products[o.productId||(o.choices||[])[0]])))].join(" und ");
function fillTemplate(text, os, tag){
  const o=os[0], c=S.customers[o.customerId]||{}; const np=nameParts(c);
  const mn=id=>{ const p=S.products[id]; return p?(p.msgName||p.name):"?"; };
  const prod=os.map(x=>x.productId?mn(x.productId):(x.choices||[]).map(mn).join(" oder ")).join(" und ");
  const menge=os.map(x=>x.alloc||x.qty||"").filter(Boolean).join(" + ");
  const map={ Vorname: np.first, Nachname: np.last, Name: c.name||"", Produkt: prod, Menge: String(menge), Mitarbeiter: staffName(), Datum: fmtDate(today()), Spiel: spielOf(os), Tag: fmtTag(tag||today()) };
  return text.replace(/\{(\w+)\}/g, (m,k)=> k in map ? map[k] : m);
}
// Telefon/E-Mail einzeln bearbeiten; sonstiger Text im Kontaktfeld bleibt erhalten
function contactFields(c){ const t=c?.contact||""; const mail=(t.match(/[^\s·,;]+@[^\s·,;]+/)||[])[0]||""; const tel=((t.replace(mail,"").match(/\+?[\d][\d\s/()-]{5,}/)||[])[0]||"").trim();
  const rest=t.replace(mail,"").replace(tel,"").replace(/^[\s·,;]+|[\s·,;]+$/g,"").replace(/\s*[·,;]\s*[·,;]\s*/g," · ").trim(); return { tel, mail, rest }; }
const joinContact = (tel, mail, c) => [tel.trim(), mail.trim(), contactFields(c).rest].filter(Boolean).join(" · ");
function contactParts(c){ const t=c?.contact||""; const mail=(t.match(/[^\s·,;]+@[^\s·,;]+/)||[])[0]||"";
  let tel=(t.replace(mail,"").match(/\+?[\d][\d\s/()-]{5,}/)||[])[0]||""; tel=tel.replace(/[^\d+]/g,"");
  const wa = tel ? (tel.startsWith("+") ? tel.slice(1) : tel.startsWith("00") ? tel.slice(2) : tel.startsWith("0") ? "43"+tel.slice(1) : tel) : "";
  return { mail, tel, wa }; }
function msgDialog(ids){
  const os=ids.map(id=>S.orders[id]).filter(Boolean); if(!os.length) return; const cid=os[0].customerId; let c=S.customers[cid]||{};
  const tpls=templates(); const st=autoTplId(os);
  let cur=tpls.find(t=>t.id===st)||tpls[0]; let tag=today();
  const box=document.createElement("div"); box.className="modal"; document.body.appendChild(box);
  let cp, noWa, edited=null;
  const draw=()=>{ c=S.customers[cid]||c; cp=contactParts(c); noWa=!!c.noWhatsapp; const np=nameParts(c), cf=contactFields(c);
    box.innerHTML=`<div class="panel modal-card" role="dialog" aria-modal="true" aria-labelledby="msgh">
    <div class="row spread"><h2 id="msgh">Nachricht an ${esc(c.name||"Kunde")}</h2><a class="back" href="#kunde-${cid}" id="m-cust">Kundenseite</a></div>
    <details class="wiki" id="m-cd" ${(!nameChecked(c)||!cf.tel)?"open":""}><summary>Kundendaten ${nameChecked(c)?"":'<span class="pill" style="background:var(--warn-soft);color:var(--warn)">Name ungeprüft</span>'} ${cf.tel?"":'<span class="pill" style="background:var(--bad-soft);color:var(--bad)">keine Telefonnummer</span>'}</summary>
      <div class="form" style="margin-top:6px">
        <label>Vorname<input id="m-fn" value="${esc(np.first)}"></label><label>Nachname<input id="m-ln" value="${esc(np.last)}"></label>
        <label><span>&nbsp;</span><button type="button" class="sm" id="m-swap">⇄ Vertauschen</button></label>
        <label>Telefon<input id="m-tel" type="tel" value="${esc(cf.tel)}" placeholder="z. B. 0660 1234567"></label>
        <label>E-Mail<input id="m-mail" type="email" value="${esc(cf.mail)}"></label>
        <label style="display:flex;flex-direction:row;align-items:center;gap:8px;align-self:end;padding-bottom:8px"><input type="checkbox" id="m-wa" style="width:20px;height:20px" ${noWa?"":"checked"}> Hat WhatsApp</label>
      </div><p class="muted">Änderungen werden sofort beim Kunden gespeichert.</p></details>
    <label class="form" style="grid-template-columns:1fr"><span class="muted">Vorlage</span><select id="m-t">${tpls.map(t=>`<option value="${t.id}" ${t.id===cur?.id?"selected":""}>${esc(t.name)}</option>`).join("")}<option value="">Eigene Nachricht</option></select></label>
    <label class="form" style="grid-template-columns:1fr"><span class="muted">Abholbar ab {Tag}</span><input type="date" id="m-d" value="${tag}"></label>
    <textarea id="m-x" rows="9" style="width:100%">${esc(edited!=null?edited:cur?fillTemplate(cur.text,os,tag):`Hallo ${nameParts(c).first},\n\n\nLiebe Grüße\nHive Games\n${staffName()}`)}</textarea>
    ${!staff()?`<div class="note">Tipp: oben dein Kürzel eintragen, dann wird {Mitarbeiter} mit deinem Vornamen ausgefüllt.</div>`:staffRec()?"":`<div class="note">Kürzel „${esc(staff())}“ ist noch nicht unter Einstellungen → Mitarbeiter angelegt.</div>`}
    <div class="row"><button class="pri" id="m-c">Kopieren</button>
      ${cp.wa?`<a class="btn" id="m-w" href="#" target="_blank" rel="noopener" ${noWa?"hidden":""}>WhatsApp öffnen</a>`:""}
      ${cp.tel?`<a class="btn" id="m-sms" href="#" ${noWa?"":"hidden"}>SMS öffnen</a>`:""}
      ${cp.mail?`<a class="btn" id="m-e" href="#">E-Mail öffnen</a>`:""}
      <button id="m-s">Als gesendet markieren</button><button id="m-x2">Schließen</button></div>
    <p class="muted">Kopieren und z. B. in WhatsApp oder SMS einfügen. „Als gesendet markieren“ merkt sich Datum und Vorlage bei der Bestellung.</p></div>`;
    const ta=box.querySelector("#m-x");
    const links=()=>{ const t=encodeURIComponent(ta.value); const w=box.querySelector("#m-w"); if(w) w.href=`https://wa.me/${cp.wa}?text=${t}`; const sm=box.querySelector("#m-sms"); if(sm) sm.href=`sms:${cp.tel}?&body=${t}`;
      const e=box.querySelector("#m-e"); if(e) e.href=`mailto:${cp.mail}?subject=${encodeURIComponent((cur?.name||"Info")+": "+os.map(x=>orderLabel(x)).join(", "))}&body=${t}`; };
    ta.oninput=()=>{ edited=ta.value; links(); }; links();
    box.querySelector("#m-t").onchange=e=>{ cur=tpls.find(t=>t.id===e.target.value)||null; edited=null; draw(); };
    box.querySelector("#m-cust").onclick=()=>box.remove();
    box.querySelector("#m-d").onchange=e=>{ tag=e.target.value||today(); if(cur) draw(); };
    const mark=()=>markSent(os, cur);
    box.querySelector("#m-c").onclick=async()=>{ if(needStaff()) return; if(await copyText(ta.value)){ await mark(); toast("Kopiert und als gesendet markiert"); } else { ta.select(); toast("Text markiert: mit Strg+C kopieren"); } };
    const keepOpen=()=>{ const d=box.querySelector("#m-cd"); return d&&d.open; };
    const save=async(patch,msg)=>{ const open=keepOpen(); if(await write("customers",cid,patch)){ toast(msg); draw(); const d=box.querySelector("#m-cd"); if(d) d.open=open; } };
    const saveName=(fn,ln)=>{ fn=fn.trim(); ln=ln.trim(); if(!fn) return toast("Vorname darf nicht leer sein."); save({firstName:fn,lastName:ln,name:(fn+" "+ln).trim()},"Name gespeichert"); };
    box.querySelector("#m-fn").onchange=box.querySelector("#m-ln").onchange=()=>saveName(box.querySelector("#m-fn").value,box.querySelector("#m-ln").value);
    box.querySelector("#m-swap").onclick=()=>saveName(box.querySelector("#m-ln").value,box.querySelector("#m-fn").value);
    box.querySelector("#m-tel").onchange=box.querySelector("#m-mail").onchange=()=>save({contact:joinContact(box.querySelector("#m-tel").value,box.querySelector("#m-mail").value,c)},"Kontakt gespeichert");
    box.querySelector("#m-wa").onchange=e=>save({noWhatsapp:!e.target.checked}, e.target.checked?"Gespeichert: hat WhatsApp":"Gespeichert: kein WhatsApp");
    for(const sel of ["#m-w","#m-e","#m-sms"]){ const a=box.querySelector(sel); if(a) a.addEventListener("click", e=>{ if(needStaff()){ e.preventDefault(); return; } mark(); }); }
    box.querySelector("#m-s").onclick=async()=>{ if(needStaff()) return; await mark(); toast("Als gesendet markiert"); box.remove(); };
    box.querySelector("#m-x2").onclick=()=>box.remove();
    box.onclick=e=>{ if(e.target===box) box.remove(); };
  };
  draw();
}
function drawStaffList(){ let dl=document.getElementById("staff-dl"); if(!dl){ dl=document.createElement("datalist"); dl.id="staff-dl"; document.body.appendChild(dl); staffEl.setAttribute("list","staff-dl"); }
  dl.innerHTML=Object.values(S.staff||{}).map(m=>`<option value="${esc(m.kuerzel)}">${esc(m.name||"")}</option>`).join("");
  markStaff(); }
function etronPanel(){ const t=(S.config?.etron||{}).customerUrl||"";
  return `<div class="panel"><h2>etron-Kundenkonto verlinken</h2>
    <p class="muted">Damit bei Kunden mit etron-Kundennr. ein Link „In etron öffnen“ erscheint: In etron einen Kunden öffnen, die Adresse aus dem Browser kopieren und hier einfügen. An die Stelle der Kundennummer kommt <b>{Nr}</b>. Steht in der Adresse <code>id=123</code>, wird das automatisch ersetzt.</p>
    <div class="row"><input id="et-url" value="${esc(t)}" placeholder="https://…/web#id={Nr}&model=res.partner&view_type=form" style="flex:1 1 360px"><button id="et-save" class="pri">Speichern</button></div>
    ${t&&!t.includes("{Nr}")?`<div class="note bad">Die Vorlage enthält kein {Nr}. Bitte die Kundennummer in der Adresse durch {Nr} ersetzen.</div>`:""}</div>`; }
function bindEtron(){ const b=$("#et-save"); if(!b) return; b.onclick=()=>{ let v=$("#et-url").value.trim();
  if(v && !/^https?:\/\//.test(v)) return toast("Bitte die vollständige Adresse mit https:// einfügen.");
  if(v && !v.includes("{Nr}") && /([?#&])id=\d+/.test(v)) { v=v.replace(/([?#&])id=\d+/, "$1id={Nr}"); toast("id=… wurde durch {Nr} ersetzt."); }
  write("config","etron",{...(S.config?.etron||{}),customerUrl:v},"set").then(ok=>ok&&toast("Gespeichert")); }; }
// ---------- etron-API: Zugang (nur in der Dropbox, nie im Code) und Verbindungstest
const ETRON_API_FILE = "etron-api.json";
async function etronApiLoad(){ try{ const r=await S.provider.read(ETRON_API_FILE); return r ? { ...r.data, _rev:r.rev } : null; }catch(e){ return { _err:e.message||String(e) }; } }
// Aufruf über den Vermittler (Cloudflare Worker, Code in proxy/etron-worker.js). Zugang liegt in der Dropbox.
async function etronCall(action, data, cfg){ cfg = cfg || S.etronApi || (S.etronApi = await etronApiLoad());
  if(!cfg?.proxy || !cfg?.appToken) throw new Error("etron-Schnittstelle ist nicht eingerichtet (Einstellungen).");
  let r; try{ r=await fetch(cfg.proxy,{method:"POST",headers:{"Content-Type":"application/json","X-App-Token":cfg.appToken},body:JSON.stringify({action,...(data||{})})}); }
  catch(e){ const x=new Error("Vermittler nicht erreichbar. Adresse prüfen."); x.net=true; throw x; }
  let j=null; try{ j=await r.json(); }catch(e){}
  if(!r.ok){ const x=new Error((j&&j.error)||("HTTP "+r.status)); x.http=r.status; throw x; } return j; }
function etronApiPanel(){
  return `<div class="panel"><h2>etron-Schnittstelle</h2>
    <p class="muted">Die App spricht über einen kleinen Vermittler (Cloudflare Worker) mit etron. Der etron-Zugang (Key und Secret) liegt nur im Worker. Hier kommen nur die Adresse des Workers und der App-Schlüssel hinein; beides wird in eurer Dropbox gespeichert (<span class="mono">${ETRON_API_FILE}</span>), nie im Programmcode.</p>
    <div class="form">
      <label class="wide">Adresse des Vermittlers<input id="ea-proxy" placeholder="https://etron-vorbestellungen.….workers.dev" autocomplete="off"></label>
      <label class="wide">App-Schlüssel<span class="row" style="gap:6px;flex-wrap:nowrap"><input id="ea-tok" type="password" autocomplete="new-password" spellcheck="false" style="flex:1"><button type="button" class="sm" id="ea-gen">Neuen erzeugen</button></span></label>
      <button id="ea-save" class="pri">In Dropbox speichern</button><button id="ea-test">Verbindung testen</button><button id="ea-del" class="sm danger">Zugang löschen</button>
    </div><div id="ea-st" class="muted">Lade …</div><div id="ea-res"></div></div>`; }
function bindEtronApi(){ const st=$("#ea-st"); if(!st) return; let cur=null;
  const show=()=>{ st.innerHTML = cur?._err ? `Dropbox nicht lesbar: ${esc(cur._err)}` : cur?.proxy ? `Gespeichert: ${esc(cur.proxy)} (${esc(cur.savedAt||"")}${cur.savedBy?" von "+esc(cur.savedBy):""}). App-Schlüssel leer lassen = unverändert.` : "Noch nicht eingerichtet.";
    if(cur?.secret) st.innerHTML+=` <b>In der Dropbox liegt noch ein altes etron-Secret. Es wird beim nächsten Speichern entfernt.</b>`;
    if(cur?.proxy) $("#ea-proxy").value=cur.proxy; $("#ea-tok").placeholder=cur?.appToken?"gespeichert":""; };
  etronApiLoad().then(c=>{ cur=c; show(); });
  const form=()=>({ proxy:$("#ea-proxy").value.trim()||cur?.proxy||"", appToken:$("#ea-tok").value.trim()||cur?.appToken||"" });
  $("#ea-gen").onclick=()=>{ const a=new Uint8Array(24); crypto.getRandomValues(a); const t=[...a].map(x=>x.toString(16).padStart(2,"0")).join("");
    const el=$("#ea-tok"); el.type="text"; el.value=t; el.select(); copyText(t).then(()=>toast("Neuer App-Schlüssel kopiert. In Cloudflare als APP_TOKEN eintragen und hier speichern.")); };
  $("#ea-save").onclick=async()=>{ if(needStaff()) return; const f=form(); if(!/^(https:\/\/|http:\/\/localhost)/.test(f.proxy)) return toast("Bitte die Adresse des Vermittlers mit https:// eintragen."); if(f.appToken.length<16) return toast("Bitte den App-Schlüssel eintragen (mindestens 16 Zeichen).");
    const data={proxy:f.proxy.replace(/\/+$/,""),appToken:f.appToken,savedAt:new Date().toLocaleString("de-AT"),savedBy:staff()};
    try{ const r=await S.provider.write(ETRON_API_FILE,data,cur&&!cur._err?cur._rev:null); cur={...data,_rev:r.rev}; S.etronApi=cur; $("#ea-tok").value=""; $("#ea-tok").type="password"; show(); toast("In der Dropbox gespeichert"); }
    catch(e){ toast(e.conflict?"Wurde gerade woanders geändert. Seite neu laden.":"Nicht gespeichert: "+(e.message||e)); } };
  $("#ea-del").onclick=async()=>{ if(!cur || cur._err || !cur._rev) return toast("Es ist nichts gespeichert."); try{ const r=await S.provider.write(ETRON_API_FILE,{},cur._rev); cur={_rev:r.rev}; S.etronApi=null; show(); toast("Zugang gelöscht"); }catch(e){ toast("Nicht gelöscht: "+(e.message||e)); } };
  $("#ea-test").onclick=async()=>{ const f=form(); const res=$("#ea-res");
    if(!/^(https:\/\/|http:\/\/localhost)/.test(f.proxy)||!f.appToken) return toast("Bitte Adresse und App-Schlüssel eintragen.");
    res.innerHTML=`<ul class="eatest"><li>… teste</li></ul>`;
    try{ const j=await etronCall("ping",{},f); res.innerHTML=`<ul class="eatest"><li class="ok">✓ Vermittler erreicht, App-Schlüssel stimmt.</li><li class="ok">✓ Anmeldung bei etron und Kunden lesen funktioniert (${j.read} Testdatensatz, Inhalt wird nicht angezeigt).</li></ul>`; }
    catch(e){ const why = e.net ? "Vermittler nicht erreichbar. Adresse prüfen; in Cloudflare muss der Worker „Deployed“ sein."
        : e.http===401 ? "App-Schlüssel stimmt nicht mit APP_TOKEN in Cloudflare überein."
        : e.http===403 ? "Der Vermittler lässt diese Seite nicht zu (ALLOWED_ORIGIN prüfen)."
        : e.http===500 ? esc(e.message)
        : "Vermittler erreicht, aber etron meldet: "+esc(e.message);
      res.innerHTML=`<ul class="eatest">${e.http&&e.http!==500&&e.http!==401&&e.http!==403?'<li class="ok">✓ Vermittler erreicht, App-Schlüssel stimmt.</li>':""}<li class="bad">✗ ${why}</li></ul>`; } }; }
function gamesPanel(){
  const cnt={}; Object.values(S.products).forEach(p=>{ const g=gameOf(p); cnt[g]=(cnt[g]||0)+1; });
  return `<div class="panel"><h2>Spielsysteme</h2>
    <p class="muted">Erscheinen oben im Umschalter und bei der Spiel-Auswahl der Produkte. „${NO_GAME}“ ist immer wählbar, z. B. für Zubehör. Löschen geht nur, wenn kein Produkt mehr dazu gehört.</p>
    <div class="row">${games().map(g=>`<span class="pill" style="background:var(--surface2);padding:4px 6px 4px 10px">${esc(g)} <span class="muted">(${cnt[g]||0})</span> <button class="sm" data-gdel="${esc(g)}" title="Löschen" ${cnt[g]?"disabled":""}>✕</button></span>`).join("")}</div>
    <form class="row" id="gnew"><input id="gnn" placeholder="Neues Spielsystem, z. B. Lorcana" style="flex:1 1 220px" required><button class="pri">Anlegen</button></form></div>`;
}
function bindGames(){
  const f=$("#gnew"); if(f) f.onsubmit=async e=>{ e.preventDefault(); const n=$("#gnn").value.trim().replace(/\s+/g," "); if(!n) return;
    if(n.toLowerCase()===NO_GAME.toLowerCase()||n.toLowerCase()==="alle") return toast("Dieser Name ist reserviert.");
    const ex=games().find(g=>g.toLowerCase()===n.toLowerCase()); if(ex) return toast(`„${ex}“ gibt es schon.`);
    if(await write("games",gameId(n),{id:gameId(n),name:n,hidden:false,createdAt:now()},"set")) toast(`„${n}“ angelegt`); };
  app.querySelectorAll("[data-gdel]").forEach(b=>b.onclick=()=>{ const n=b.dataset.gdel;
    if(Object.values(S.products).some(p=>gameOf(p)===n)) return toast("Es gibt noch Produkte zu diesem Spiel.");
    b.outerHTML=`<button class="sm danger" id="gdok">Wirklich löschen?</button>`;
    $("#gdok").onclick=()=>{ if(BASE_GAMES.includes(n)) write("games",gameId(n),{id:gameId(n),name:n,hidden:true},"set"); else write("games",gameId(n),{},"delete"); if(S.game===n){ S.game="Alle"; store("game","Alle"); } }; });
}
function staffPanel(){
  const list=Object.values(S.staff||{}).sort((a,b)=>a.kuerzel.localeCompare(b.kuerzel));
  return `<div class="panel"><h2>Mitarbeiter</h2>
    <p class="muted">Das Kürzel steht intern (Bestellungen, Protokoll), der Vorname wird in Kundennachrichten für {Mitarbeiter} eingesetzt. Sobald Mitarbeiter angelegt sind, funktionieren nur noch diese Kürzel.</p>
    ${list.length?`<div class="tablebox"><table><thead><tr><th>Kürzel</th><th>Vorname (für Nachrichten)</th><th></th></tr></thead><tbody>${list.map(m=>`<tr><td><b>${esc(m.kuerzel)}</b></td><td><input id="sn-${m.id}" value="${esc(m.name||"")}"></td><td class="nowrap"><button class="sm" data-ssave="${m.id}">Speichern</button> <button class="sm danger" data-sdel="${m.id}">Löschen</button></td></tr>`).join("")}</tbody></table></div>`:`<p>Noch keine Mitarbeiter angelegt.</p>`}
    <form class="row" id="snew"><input id="snk" maxlength="4" placeholder="Kürzel, z. B. TT" style="width:140px;text-transform:uppercase" required><input id="snn" placeholder="Vorname, z. B. Tommy" style="flex:1 1 200px" required><button class="pri">Mitarbeiter anlegen</button></form></div>`;
}
function bindStaff(){
  const f=$("#snew"); if(f) f.onsubmit=async e=>{ e.preventDefault(); const k=$("#snk").value.toUpperCase().trim(), n=$("#snn").value.trim(); if(!k||!n) return;
    if(staffRec(k)) return toast(`Kürzel „${k}“ gibt es schon.`);
    if(await write("staff","s-"+k,{id:"s-"+k,kuerzel:k,name:n},"set")){ toast(`${n} (${k}) angelegt`); if(!staff()){ setStaff(k); } } };
  app.querySelectorAll("[data-ssave]").forEach(b=>b.onclick=()=>{ const id=b.dataset.ssave; const n=$("#sn-"+id).value.trim(); if(!n) return toast("Vorname fehlt."); write("staff",id,{name:n}).then(ok=>ok&&toast("Gespeichert")); });
  app.querySelectorAll("[data-sdel]").forEach(b=>b.onclick=()=>{ const id=b.dataset.sdel; b.outerHTML=`<button class="sm danger" id="sdok-${id}">Wirklich löschen?</button>`; $("#sdok-"+id).onclick=()=>write("staff",id,{},"delete"); });
}
function templatesPanel(){
  return `<div class="panel"><h2>Nachrichtenvorlagen</h2>
    <p class="muted">Platzhalter: {Vorname} {Nachname} {Name} {Spiel} {Produkt} {Menge} {Tag} {Mitarbeiter} {Datum}. {Mitarbeiter} ist der Vorname aus der Mitarbeiterliste. {Spiel} kommt automatisch vom Produkt (z. B. Pokémon), {Tag} ist das Abholdatum (Standard heute, im Nachrichtenfenster änderbar). Die Vorlagen gelten für alle Geräte.</p>
    ${templates().map(t=>`<div class="panel" style="gap:8px"><div class="row"><input id="tn-${t.id}" value="${esc(t.name)}" style="flex:1 1 200px"><button class="sm" data-tsave="${t.id}">Speichern</button><button class="sm danger" data-tdel="${t.id}">Löschen</button></div>
      <textarea id="tt-${t.id}" rows="7" style="width:100%">${esc(t.text)}</textarea></div>`).join("")}
    <div class="row"><button id="tnew">Neue Vorlage</button></div></div>`;
}
function bindTemplates(){
  app.querySelectorAll("[data-tsave]").forEach(b=>b.onclick=()=>{ const id=b.dataset.tsave; const name=$("#tn-"+id).value.trim()||"Vorlage";
    write("templates",id,{id,name,text:$("#tt-"+id).value, order:templates().findIndex(t=>t.id===id)},"set").then(ok=>ok&&toast("Vorlage gespeichert")); });
  app.querySelectorAll("[data-tdel]").forEach(b=>b.onclick=()=>{ const id=b.dataset.tdel; b.outerHTML=`<button class="sm danger" id="tdok-${id}">Wirklich löschen?</button>`;
    $("#tdok-"+id).onclick=()=>{ if(DEFAULT_TEMPLATES.some(t=>t.id===id)) write("templates",id,{id,name:"(gelöscht)",text:"",hidden:true},"set"); else write("templates",id,{},"delete"); }; });
  const n=$("#tnew"); if(n) n.onclick=()=>{ const id=newId("t"); write("templates",id,{id,name:"Neue Vorlage",text:"Hallo {Vorname},\n\n\nLiebe Grüße\nHive Games\n{Mitarbeiter}",order:99},"set"); };
}

// ---------- Zuteilung löschen: eine „egal welches“-Bestellung wird wieder frei (nicht an ein Produkt gebunden, Status Offen)
const isResolvedFlex = o => !!(o && o.productId && (o.choices||[]).length>1 && !LOCKED.has(o.status));
const unflex = o => ({ productId:null, alloc:null, comment:(o.comment||"").split(" · ").filter(x=>!x.startsWith("war: ")).join(" · ") });
function saveAlloc(id, v){ const o=S.orders[id]; if(!o) return;
  if(!(v>0) && isResolvedFlex(o)) return write("orders",id,{...unflex(o), status:(o.status==="Zugeteilt"||o.status==="Warteliste")?"Offen":o.status}).then(ok=>ok&&toast("Zuteilung gelöscht: wieder „egal welches“, Status Offen"));
  const patch={alloc:v}; if(!(v>0) && o.status==="Zugeteilt") patch.status="Offen";
  return write("orders",id,patch).then(ok=>ok&&toast(patch.status?"Zuteilung gelöscht, Status wieder Offen":"Gespeichert")); }

// ---------- Nach der Zuteilung: alle offenen Bestellungen ohne Zuteilung auf einmal auf Warteliste
function bindRest(getOrders){ const b=$("#rest"); if(!b) return;
  b.onclick=()=>{ const list=getOrders().filter(o=>o.status==="Offen"&&!((o.alloc||0)>0)); if(!list.length) return toast("Keine offene Bestellung ohne Zuteilung.");
    if(needStaff()) return;
    b.outerHTML=`<button id="restok" class="danger">${list.length} Bestellung${list.length===1?"":"en"} auf Warteliste setzen?</button>`;
    $("#restok").onclick=async()=>{ const n=await pool(list,o=>S.db.collection("orders").doc(o.id).update({status:"Warteliste"})); toast(`${n} auf Warteliste gesetzt`); render(); }; }; }

// ---------- Stornieren: frei gewordene Ware einem anderen Kunden geben
async function cancelOrders(ids){
  const before = ids.map(id=>({...S.orders[id]})).filter(o=>o.id);
  await pool(ids, id=>S.db.collection("orders").doc(id).update({status:"Storniert",alloc:null}));
  toast("Storniert");
  const freed = {}; for (const o of before){ const pid=o.productId; if(pid) freed[pid]=(freed[pid]||0)+(o.alloc||0); }
  for (const [pid,n] of Object.entries(freed)) await reassignDialog(pid, n, before.map(o=>o.customerId));
}
function candidates(pid, exclude){
  return [...ordersOf(pid), ...flexOf(pid)].filter(o=>!exclude.includes(o.customerId) && (o.qty||0)>0 &&
    (o.status==="Warteliste" || ((o.status==="Offen"||o.status==="Zugeteilt") && (o.alloc||0)<o.qty))).sort(sortOrders);
}
function reassignDialog(pid, freed, exclude){
  return new Promise(done=>{
    const p=S.products[pid]; if(!p) return done();
    let left=freed;
    const box=document.createElement("div"); box.className="modal"; document.body.appendChild(box);
    const close=()=>{ box.remove(); done(); };
    const draw=()=>{ const cs=candidates(pid, exclude).filter(o=>left>0||o.status==="Warteliste");
      if (!cs.length && left<=0) return close();
      box.innerHTML=`<div class="panel modal-card" role="dialog" aria-modal="true" aria-labelledby="mh">
        <h2 id="mh">${left>0?`${left} Stück ${esc(p.name)} sind jetzt frei`:`${esc(p.name)}: Bestellung storniert`}</h2>
        <p class="muted">${left>0?"Soll die Ware einem anderen Kunden zugeteilt werden? Reihenfolge nach Bestelldatum.":"Es war noch nichts zugeteilt. Soll jemand von der Warteliste nachrücken?"}</p>
        ${cs.length?`<div class="tablebox" style="max-height:50vh"><table><thead><tr><th>Kunde</th><th>Wunsch</th><th class="n">Bestellt</th><th class="n">Zugeteilt</th><th>Status</th><th></th></tr></thead><tbody>
        ${cs.map(o=>{const miss=o.qty-(o.alloc||0); const give=Math.min(left,miss);
          return `<tr><td>${esc(S.customers[o.customerId]?.name||"?")}</td><td>${o.productId?"nur dieses":"egal welches"}</td><td class="n">${o.qty}</td><td class="n">${o.alloc||0}</td><td>${pill(o.status)}</td>
          <td class="n">${left>0?`<button class="sm pri" data-give="${o.id}" data-n="${give}">${give} zuteilen</button>`:`<button class="sm" data-up="${o.id}">Nachrücken</button>`}</td></tr>`}).join("")}
        </tbody></table></div>`:`<p>Kein anderer Kunde wartet auf dieses Produkt.</p>`}
        <div class="row"><button id="m-no">${left>0?"Nicht neu zuteilen (bleibt frei)":"Schließen"}</button></div></div>`;
      box.querySelector("#m-no").onclick=close;
      box.querySelectorAll("[data-give]").forEach(b=>b.onclick=async()=>{ const o=S.orders[b.dataset.give]; const n=+b.dataset.n; b.disabled=true;
        const pt={alloc:(o.alloc||0)+n}; if(!o.productId){ pt.productId=pid; pt.comment=[o.comment,`war: ${orderLabel(o)}`].filter(Boolean).join(" · "); }
        if(o.status==="Warteliste") pt.status="Offen";
        await write("orders",o.id,pt); left-=n; toast(`${n} Stück an ${S.customers[o.customerId]?.name||"Kunde"}`); if(left<=0) close(); else draw(); });
      box.querySelectorAll("[data-up]").forEach(b=>b.onclick=async()=>{ await write("orders",b.dataset.up,{status:"Offen"}); toast("Von der Warteliste nachgerückt"); draw(); });
    };
    draw();
  });
}

function orderForm(k, pid, cid, only){
  const prods = Object.values(S.products).filter(p=>!p.archived && (only ? only.includes(p.id) : inGame(p))).sort((a,b)=>gameOf(a).localeCompare(gameOf(b))||a.name.localeCompare(b.name));
  const sib = pid ? siblings(S.products[pid]) : only ? only.map(id=>S.products[id]).filter(Boolean) : [];
  const multi = sib.length>1;
  return `<div class="panel"><h2>Neue Bestellung erfassen</h2>
  <form class="form" id="${k}-f" ${multi?`data-multi="${sib.map(x=>x.id).join(",")}"`:""}>
    ${pid||multi?"":`<label class="wide">Produkt<select id="${k}-p" required><option value="">Produkt wählen</option>${prods.map(p=>`<option value="${p.id}">${S.game==="Alle"?esc(gameOf(p))+" · ":""}${esc(p.name)}</option>`).join("")}</select></label>`}
    ${cid?"":custPicker(k)}
    <label class="wide" id="${k}-ml" hidden>Bei dieser Serie<select id="${k}-m"></select></label>
    ${multi?sib.map(x=>`<label>${esc(x.name)} (Stück)<input type="number" min="0" data-mq="${x.id}" class="mq"></label>`).join("")+`<label title="Kunde will eines davon, egal welches. Die Zuteilung entscheidet.">egal welches (Stück)<input id="${k}-qany" type="number" min="0" class="mq"></label>`
      :`<label>Menge (Stück)<input id="${k}-q" type="number" min="1" required></label>`}
    <label>Bestelldatum<input id="${k}-d" type="date" value="${today()}"></label>
    <label class="wide">Kommentar<input id="${k}-k" placeholder="z. B. 1 Case = 12 Stück"></label>
    <label><span>&nbsp;</span><select id="${k}-s"><option>Offen</option><option>Warteliste</option></select></label>
    <button class="pri" ${S.canWrite?"":"disabled"}>Speichern</button>
  </form><div id="${k}-hint"></div><div id="${k}-ncbox"></div>
  <p class="muted">Nachbestellung = neue Zeile mit der zusätzlichen Menge. Cases vorher in Stück umrechnen.</p></div>`;
}
// mode: one = nur dieses Produkt, any = egal welches der Serie, all = je eine Bestellung pro Produkt der Serie
async function saveOrder(o, mode, sib){
  if (mode==="any") return write("orders",newId("o"),{...o,productId:null,choices:sib},"set");
  if (mode==="all"){ const pair=newId("g"); let ok=true; for(const id of sib) ok = await write("orders",newId("o"),{...o,productId:id,pairId:pair},"set") && ok; return ok; }
  return write("orders",newId("o"),o,"set");
}
// ---------- Kunden: auswählen und gezielt neu anlegen (keine automatischen Neuanlagen mehr)
const digits = t => String(t||"").replace(/\D/g,"").replace(/^(00|0)?43/,"").replace(/^0/,"");
function custLabel(c){ const t=contactFields(c).tel; return `${esc(c.name)}${t?` <span class="muted">${esc(t)}</span>`:""}${c.etronId?` <span class="muted">· Nr. ${esc(c.etronId)}</span>`:""}`; }
function custPicker(k){ const sel=S.pick?.[k] && S.customers[S.pick[k]];
  return `<label class="wide" id="${k}-cpl">Kunde${sel?`<span class="row" style="gap:8px;flex-wrap:nowrap"><span class="picked">${custLabel(sel)}</span><button type="button" class="sm" id="${k}-cx">Anderen wählen</button></span>`
    :`<span class="row" style="gap:6px;flex-wrap:nowrap"><input id="${k}-cq" autocomplete="off" placeholder="Kunde suchen: Vor- oder Nachname, Telefon, etron-Nr." style="flex:1"><button type="button" class="sm" id="${k}-nc">+ Neuer Kunde</button></span>`}</label>`; }
function custFind(q){ q=(q||"").trim(); if(q.length<2) return []; const dq=digits(q);
  return Object.values(S.customers).filter(c=>nameMatch(q,c) || (dq.length>=4 && digits(contactFields(c).tel).includes(dq)) || String(c.etronId||"")===q).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,10); }
function custSimilar(fn, ln, tel){ const n=(fn+" "+ln).trim(); const dt=digits(tel);
  return Object.values(S.customers).filter(c=>(n && similar(c.name,n)) || (ln && norm(nameParts(c).last)===norm(ln) && fn && norm(nameParts(c).first).startsWith(norm(fn).slice(0,2))) || (fn && ln && norm(nameParts(c).first)===norm(ln) && norm(nameParts(c).last)===norm(fn)) || (dt.length>=6 && digits(contactFields(c).tel)===dt)).slice(0,8); }
function custNewForm(k, pre){ const [fn,...rest]=(pre||"").trim().split(/\s+/);
  return `<div class="panel" id="${k}-nf"><h2>Neuen Kunden anlegen</h2><form class="form" id="${k}-nform">
    <label>Vorname<input id="${k}-nfn" required autocomplete="off" value="${esc(rest.length?fn:"")}"></label>
    <label>Nachname<input id="${k}-nln" required autocomplete="off" value="${esc(rest.length?rest.join(" "):fn||"")}"></label>
    <label>Telefon<input id="${k}-ntel" type="tel" autocomplete="off" placeholder="+43 …"></label>
    <label>E-Mail<input id="${k}-nmail" type="email" autocomplete="off"></label>
    <label>etron-Nr.<input id="${k}-net" autocomplete="off" placeholder="falls bekannt"></label>
    <label class="row muted" style="align-self:end"><input type="checkbox" id="${k}-nwa"> kein WhatsApp</label>
    <button class="pri" id="${k}-nok" ${S.canWrite?"":"disabled"}>Kunden anlegen</button><button type="button" id="${k}-nx">Abbrechen</button>
  </form><div id="${k}-nh"></div></div>`; }
// onPick(cid, created) wird mit bestehendem oder neu angelegtem Kunden aufgerufen
function openCustNew(k, box, pre, onPick){ box.innerHTML=custNewForm(k, pre); const v=id=>$("#"+k+"-"+id).value.trim(); let okFor=null;
  const ok=$("#"+k+"-nok"), h=$("#"+k+"-nh");
  const check=()=>{ const fn=v("nfn"), ln=v("nln"), tel=v("ntel"); const key=norm(fn+"|"+ln+"|"+digits(tel));
    const ex=fn&&ln?custByParts(fn,ln):null; const d=custSimilar(fn,ln,tel).filter(c=>c!==ex);
    const btns=list=>list.map(c=>`<button type="button" class="sm" data-cid="${c.id}">${custLabel(c)}</button>`).join(" ");
    if(ex){ h.innerHTML=`<div class="note bad">Diesen Kunden gibt es schon: ${btns([ex])} Bitte den vorhandenen verwenden.</div>`; ok.disabled=true; }
    else if(d.length){ h.innerHTML=`<div class="note">Ähnliche Kunden gibt es schon: ${btns(d)}<br>Ist es einer davon, bitte anklicken. Nur wenn es wirklich jemand anderes ist: „Trotzdem neu anlegen“.</div>`; ok.disabled=!S.canWrite; ok.textContent= okFor===key?"Wirklich neu anlegen":"Trotzdem neu anlegen"; }
    else { h.innerHTML=""; ok.disabled=!S.canWrite; ok.textContent="Kunden anlegen"; }
    h.querySelectorAll("[data-cid]").forEach(b=>b.onclick=()=>{ box.innerHTML=""; onPick(b.dataset.cid,false); });
    return {fn,ln,tel,key,ex,d}; };
  ["nfn","nln","ntel"].forEach(id=>$("#"+k+"-"+id).oninput=check); check();
  $("#"+k+"-nx").onclick=()=>{ box.innerHTML=""; };
  $("#"+k+"-nform").onsubmit=async e=>{ e.preventDefault(); if(needStaff()) return; const r=check(); if(!r.fn||!r.ln) return toast("Bitte Vor- und Nachname eintragen."); if(r.ex) return;
    if(r.d.length && okFor!==r.key){ okFor=r.key; check(); return toast("Bitte die ähnlichen Kunden prüfen, dann nochmal klicken."); }
    const cid=newId("c"); const et=v("net"); const rec={name:r.fn+" "+r.ln,firstName:r.fn,lastName:r.ln,contact:joinContact(r.tel,v("nmail"),null),note:""};
    if(et) rec.etronId=et; if($("#"+k+"-nwa").checked) rec.noWhatsapp=true; if(r.d.length) rec.notDupes=r.d.map(c=>c.id);
    if(await write("customers",cid,rec,"set")){ toast("Kunde angelegt"); box.innerHTML=""; onPick(cid,true); } };
  $("#"+k+"-nfn").focus(); }
function bindOrderForm(k){
  const f=$("#"+k+"-f"); if(!f) return; const hint=$("#"+k+"-hint"), box=$("#"+k+"-ncbox"); S.pick=S.pick||{};
  const redraw=()=>{ $("#"+k+"-cpl").outerHTML=custPicker(k); bindPicker(); };
  const pick=cid=>{ S.pick[k]=cid; hint.innerHTML=""; box.innerHTML=""; redraw(); (f.querySelector("#"+k+"-q, .mq"))?.focus(); };
  const bindPicker=()=>{ const cq=$("#"+k+"-cq");
  if(cq){ const show=()=>{ const q=cq.value.trim(); if(q.length<2){ hint.innerHTML=""; return; } const r=custFind(q);
      hint.innerHTML=`<div class="note">${r.length?`Kunde wählen: ${r.map(c=>`<button type="button" class="sm" data-cid="${c.id}">${custLabel(c)}</button>`).join(" ")}<br>Nicht dabei? `:`Kein Kunde gefunden. `}<button type="button" class="sm" id="${k}-nc2">+ „${esc(q)}“ als neuen Kunden anlegen</button></div>`;
      hint.querySelectorAll("[data-cid]").forEach(b=>b.onclick=()=>pick(b.dataset.cid));
      $("#"+k+"-nc2").onclick=()=>{ hint.innerHTML=""; openCustNew(k, box, q, pick); }; };
    cq.oninput=show; cq.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); const b=hint.querySelector("[data-cid]"); if(b) b.click(); } }; }
  $("#"+k+"-nc")?.addEventListener("click",()=>{ hint.innerHTML=""; openCustNew(k, box, cq?.value||"", pick); });
  $("#"+k+"-cx")?.addEventListener("click",()=>{ delete S.pick[k]; redraw(); $("#"+k+"-cq")?.focus(); }); };
  if($("#"+k+"-cpl")) bindPicker();
  const curPid=()=>{ const h=(location.hash||"").slice(1); return h.startsWith("produkt-")?h.slice(8):($("#"+k+"-p")?.value||""); };
  const modeUi=()=>{ const p=S.products[curPid()]; const sib=siblings(p); const ml=$("#"+k+"-ml"); if(!ml) return;
    ml.hidden = sib.length<2; if(sib.length<2) return;
    const others=sib.filter(x=>x.id!==p.id).map(x=>x.name).join(", ");
    $("#"+k+"-m").innerHTML=`<option value="one">nur ${esc(p.name)}</option><option value="any">egal welches: ${esc(sib.map(x=>x.name).join(" oder "))}</option><option value="all">alle: ${esc(p.name)} und ${esc(others)}</option>`; };
  const ps=$("#"+k+"-p"); if(ps) ps.onchange=modeUi; if(!f.dataset.multi) modeUi();
  f.onsubmit=async e=>{ e.preventDefault();
    const h=(location.hash||"").slice(1); const multi=f.dataset.multi?f.dataset.multi.split(","):null;
    const pid=multi?multi[0]:h.startsWith("produkt-")?h.slice(8):$("#"+k+"-p").value; if(!pid) return toast("Bitte Produkt wählen.");
    const mq=multi?[...f.querySelectorAll("[data-mq]")].map(i=>[i.dataset.mq,num(i.value)]).filter(([,q])=>q>0):[]; const qany=multi?num($("#"+k+"-qany").value):null;
    if(multi && !mq.length && !(qany>0)) return toast("Bitte bei mindestens einem Produkt eine Menge eintragen.");
    let cid = h.startsWith("kunde-")?h.slice(6):null;
    if(needStaff()) return;
    if(!cid){ cid=S.pick[k]; if(!cid||!S.customers[cid]) { $("#"+k+"-cq")?.focus(); return toast("Bitte zuerst einen Kunden auswählen oder mit „+ Neuer Kunde“ anlegen."); } }
    const o={productId:pid,customerId:cid,qty:multi?null:num($("#"+k+"-q").value),date:$("#"+k+"-d").value,staff:staff(),status:$("#"+k+"-s").value,alloc:null,comment:$("#"+k+"-k").value.trim(),createdAt:new Date().toISOString()};
    if(multi){ const pair=mq.length>1?newId("g"):undefined; let ok=true;
      for(const [id,q] of mq) ok = await write("orders",newId("o"),{...o,productId:id,qty:q,...(pair?{pairId:pair}:{})},"set") && ok;
      if(qany>0) ok = await write("orders",newId("o"),{...o,productId:null,choices:multi,qty:qany},"set") && ok;
      if(ok){ toast("Bestellung gespeichert"); delete S.pick[k]; render(); } return; }
    const mode=$("#"+k+"-ml")?.hidden===false ? $("#"+k+"-m").value : "one";
    if(await saveOrder(o, mode, siblings(S.products[pid]).map(x=>x.id))){ toast("Bestellung gespeichert"); delete S.pick[k]; render(); }
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
  rows = rows.filter(r => nameMatch(S.oq, S.customers[r[0]?.customerId])).filter(r => fstat==="alle" || (fstat===MSG_OPEN ? msgOpenType(r) : r.some(o => fstat==="aktiv" ? isActive(o, sug) : o.status===fstat)));
  rows = sortView(rows, r=>r[0]?.customerId);
  const wish = r => { const o=r[0]; if(r.length>1||o.pairId) return "beide"; if(!o.productId) return "egal"; if(o.choices) return "egal → "+(S.products[o.productId]?.name||"?"); return "nur "+(S.products[o.productId]?.name||"?"); };
  const st = sib.map(p=>({p, s:stats(p)}));
  const cell = (r, pid) => { const o = r.find(x=>x.productId===pid);
    if (o) return `<td class="n"><input type="number" min="0" data-f="alloc" data-oid="${o.id}" id="sa-${o.id}" value="${o.alloc??""}" title="Bestellt ${o.qty??"?"}"></td>${sug?`<td class="n" style="font-weight:700;color:var(--accent)">${sug.res[o.id]??""}</td>`:""}`;
    const f = r.find(x=>!x.productId && (x.choices||[]).includes(pid));
    if (f) return `<td class="n"><input type="number" min="0" data-flex="${f.id}" data-pid="${pid}" id="sf-${f.id}-${pid}" placeholder="–"></td>${sug?`<td class="n" style="font-weight:700;color:var(--accent)">${sug.flex[f.id]?.pid===pid?sug.flex[f.id].n:""}</td>`:""}`;
    return `<td class="n muted">·</td>${sug?"<td></td>":""}`; };
  const sugSum = sug ? Object.values(sug.res).reduce((a,b)=>a+b,0)+Object.values(sug.flex).reduce((a,b)=>a+b.n,0) : 0;
  app.innerHTML = `<a class="back" href="#produkte">← Produkte</a>
  <div class="row spread"><div><h1>Serie ${esc(seriesOf(p0))}</h1><p class="sub">${esc(gameOf(p0))} · ${sib.map(p=>`<a class="back" href="#produkt-${p.id}">${esc(p.name)}</a>`).join(" · ")}</p></div>${addVarBtn()}</div><div id="addvbox"></div>
  <div class="tablebox"><table><thead><tr><th>Produkt</th><th class="n">nur dieses</th><th class="n">+ egal</th><th class="n">Wareneingang</th><th class="n">Zugeteilt</th><th class="n">Frei</th></tr></thead><tbody>
  ${st.map(({p,s})=>`<tr><td><a href="#produkt-${p.id}">${esc(p.name)}</a></td><td class="n">${s.pre}</td><td class="n">${s.flex||""}</td>
    <td class="n"><input type="number" min="0" data-rec="${p.id}" id="sr-${p.id}" value="${p.received??""}" placeholder="fehlt"></td><td class="n">${s.alloc||""}</td>
    <td class="n" style="${s.over?"color:var(--bad);font-weight:700":""}">${s.free??""}</td></tr>`).join("")}
  </tbody></table></div>
  <div class="panel"><div class="row spread"><h2>Zuteilung für die ganze Serie</h2><div class="row">
    <select id="mode"><option value="prop">Proportional (fair verteilt)</option><option value="fifo" ${S.mode==="fifo"?"selected":""}>Nach Bestelldatum</option></select>
    <button id="sug" ${st.some(x=>x.s.rec==null)?"disabled":""}>Vorschlag berechnen</button>
    ${sug?`<button class="pri" id="apply">Vorschlag übernehmen (${sugSum} Stück)</button><button id="dis">Verwerfen</button>`:""}
    <button id="close">Zuteilung abschließen</button><button id="rest" title="Alle offenen Bestellungen ohne Zuteilung auf Warteliste setzen">Rest auf Warteliste</button></div></div>
    <p class="muted">${st.some(x=>x.s.rec==null)?"Für den Vorschlag bei allen Produkten den Wareneingang eintragen.":"Zuerst bekommen die festen Wünsche (nur A, nur B, beide) ihre Ware, dann gehen die Reste an „egal“-Kunden, jeweils an das Produkt mit mehr übrig. Zuteilungen kannst du auch direkt in der Tabelle ändern."}</p>
    ${sug?`<p class="muted">Danach übrig: ${sib.map(p=>`${esc(p.name)} ${sug.left[p.id]}`).join(" · ")}</p>`:""}</div>
  ${orderForm("se", null, null, ids)}
  <div class="row spread"><h2>Bestellungen (${rows.length})</h2><span class="row" style="gap:6px">${oqInput()}${sortSel()}<select id="fstat">${["aktiv","alle",...STATUSES,MSG_OPEN].map(x=>`<option value="${x}" ${x===fstat?"selected":""}>${x==="aktiv"?"aktiv (offen + Warteliste)":x}</option>`).join("")}</select>${typeSel(fstat)}</span></div>
  <div class="tablebox"><table><thead><tr><th>Kunde</th><th>Wunsch</th><th class="n">Menge</th><th>Bestellt am</th><th>Status</th>${sib.map(p=>`<th class="n">${esc(p.name)}</th>${sug?'<th class="n">Vorschl.</th>':""}`).join("")}<th>Auftrag</th><th>Nachricht</th><th>Kommentar</th></tr></thead><tbody>
  ${rows.map(r=>{const o=r[0];const c=S.customers[o.customerId];return `<tr data-row="${r.map(x=>x.id).join(",")}" class="${r.every(x=>x.status==="Storniert")?"dim":""}">
    <td>${custFlags(c)}<a href="#kunde-${o.customerId}">${esc(c?.name||"?")}</a></td><td>${esc(wish(r))}</td><td class="n nowrap">${r.length>1?r.map(x=>`<span title="${esc(S.products[x.productId]?.name||"")}">${x.qty??"?"}</span>`).join(" + "):o.qty??""}</td><td>${fmtDate(o.date)}</td>
    <td><select data-rs id="ss-${o.id}">${STATUSES.map(x=>`<option ${x===o.status?"selected":""}>${x}</option>`).join("")}</select></td>
    ${sib.map(p=>cell(r,p.id)).join("")}<td style="text-align:center">${auftragBox(r)}</td><td>${msgBtn(r)}</td><td class="muted">${esc(o.comment||"")}</td></tr>`}).join("")||`<tr><td colspan="9" class="empty">Noch keine Bestellungen für diese Serie.</td></tr>`}
  </tbody></table></div>`;
  app.querySelectorAll("[data-rec]").forEach(el=>el.onchange=()=>write("products",el.dataset.rec,{received:num(el.value)}).then(ok=>ok&&toast("Gespeichert")));
  app.querySelectorAll("input[data-oid]").forEach(el=>el.onchange=()=>saveAlloc(el.dataset.oid, num(el.value)));
  app.querySelectorAll("input[data-flex]").forEach(el=>el.onchange=()=>{ const v=num(el.value); if(!v) return; const o=S.orders[el.dataset.flex];
    write("orders",o.id,{productId:el.dataset.pid,alloc:v,comment:[o.comment,`war: ${orderLabel(o)}`].filter(Boolean).join(" · ")}).then(ok=>ok&&toast("Zugeteilt")); });
  app.querySelectorAll("select[data-rs]").forEach(el=>el.onchange=async()=>{ const ids2=el.closest("tr").dataset.row.split(","); const v=el.value;
    if (v==="Storniert") return cancelOrders(ids2);
    await pool(ids2, id=>S.db.collection("orders").doc(id).update({status:v})); toast("Gespeichert"); });
  $("#fstat").onchange=e=>{S.fstat=e.target.value;render();}; bindTypeSel(); bindOq(); bindSort();
  $("#mode").onchange=e=>{S.mode=e.target.value; if(S.sugg[key]){S.sugg[key]=seriesSuggest(sib,S.mode);render();}};
  $("#sug").onclick=()=>{ S.sugg[key]=seriesSuggest(sib,$("#mode").value); render(); };
  if (sug){ $("#dis").onclick=()=>{delete S.sugg[key];render();};
    $("#apply").onclick=async()=>{ $("#apply").disabled=true;
      const ch=[...Object.entries(sug.res).filter(([id,v])=>S.orders[id]&&S.orders[id].alloc!==v).map(([id,v])=>[id,{alloc:v}]),
                ...Object.entries(sug.flex).filter(([id])=>S.orders[id]&&!S.orders[id].productId).map(([id,f])=>[id,{productId:f.pid,alloc:f.n,comment:[S.orders[id].comment,`war: ${orderLabel(S.orders[id])}`].filter(Boolean).join(" · ")}])];
      try{ await pool(ch,([id,pt])=>S.db.collection("orders").doc(id).update(pt)); delete S.sugg[key]; toast(`${ch.length} Zuteilungen gespeichert`); render(); }catch(e){ toast("Fehler: "+(e.message||e.code)); } }; }
  bindRest(()=>all);
  $("#close").onclick=async()=>{ const ch=all.filter(o=>o.productId&&o.status==="Offen"&&(o.alloc||0)>0); if(!ch.length) return toast("Keine offene Bestellung mit Zuteilung.");
    await pool(ch,o=>S.db.collection("orders").doc(o.id).update({status:"Zugeteilt"})); toast(`${ch.length} Bestellungen auf Zugeteilt gesetzt.`); };
  bindAuftrag(); bindOrderForm("se"); bindAddVar(p0);
}

function renderCustomers(){
  const q=norm(S.cq||""); const onlyD=S.cdup;
  const counts={}; Object.values(S.orders).forEach(o=>{ const c=counts[o.customerId]||(counts[o.customerId]={n:0,open:0}); if(COUNTS(o.status)){c.n++; if(o.status==="Offen"||o.status==="Zugeteilt") c.open+=(o.alloc||o.qty||0);} });
  const cs=Object.values(S.customers).map(c=>({...c,d:dupesOf(c)})).filter(c=>(!q||nameMatch(q,c)||String(c.etronId||"").includes(S.cq.trim())) && (!onlyD||c.d.length) && (!S.cnoe||!c.etronId) && (!S.cunc||!nameChecked(c))).sort((a,b)=>a.name.localeCompare(b.name,"de"));
  const dn=Object.values(S.customers).filter(c=>dupesOf(c).length).length;
  app.innerHTML=`<div class="row spread"><h1>Kunden</h1><button class="pri" id="cnew">+ Neuer Kunde</button></div><div id="cl-ncbox"></div><div><p class="sub">${Object.keys(S.customers).length} Kunden, davon ${Object.values(S.customers).filter(c=>!c.etronId).length} ohne etron-Nr. ${dn?`${dn} sehen nach Dublette aus: <a class="back" href="#dubletten">jetzt prüfen</a>.`:""}</p></div>
  <div class="row"><input id="cq" class="search" placeholder="Kunde suchen" value="${esc(S.cq||"")}"><label class="row muted"><input type="checkbox" id="cdup" ${onlyD?"checked":""}> Nur mögliche Dubletten</label><label class="row muted"><input type="checkbox" id="cnoe" ${S.cnoe?"checked":""}> Nur ohne etron-Nr.</label><label class="row muted"><input type="checkbox" id="cunc" ${S.cunc?"checked":""}> Vor-/Nachname ungeprüft (${Object.values(S.customers).filter(c=>!nameChecked(c)).length})</label></div>
  <div class="tablebox"><table><thead><tr><th>Kunde</th><th>etron-Nr.</th><th>Kontakt</th><th class="n">Bestellungen</th><th class="n">Stück offen</th><th>Ähnlich</th></tr></thead><tbody>
  ${cs.map(c=>`<tr class="click" data-go="kunde-${c.id}"><td>${custFlags(c)}<a href="#kunde-${c.id}">${esc(c.name)}</a></td><td><input data-cf="${c.id}" id="e-${c.id}" style="width:110px" value="${esc(c.etronId||"")}" placeholder="fehlt">${etronUrl(c)?` <a href="${esc(etronUrl(c))}" target="_blank" rel="noopener" title="In etron öffnen">↗</a>`:""}</td><td>${esc(c.contact||"")}</td><td class="n">${counts[c.id]?.n||0}</td><td class="n">${counts[c.id]?.open||""}</td><td>${c.d.map(x=>esc(x.name)).join(", ")}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">Kein Kunde gefunden.</td></tr>`}
  </tbody></table></div>`;
  $("#cq").oninput=e=>{S.cq=e.target.value;render();};
  $("#cdup").onchange=e=>{S.cdup=e.target.checked;renderCustomers();};
  $("#cnew").onclick=()=>openCustNew("cl", $("#cl-ncbox"), S.cq||"", cid=>{ location.hash="kunde-"+cid; });
  $("#cnoe").onchange=e=>{S.cnoe=e.target.checked;renderCustomers();};
  $("#cunc").onchange=e=>{S.cunc=e.target.checked;renderCustomers();};
  app.querySelectorAll("[data-cf]").forEach(el=>{ el.onclick=e=>e.stopPropagation(); el.onchange=()=>saveEtron(el.dataset.cf, el.value); });
  app.querySelectorAll("tr[data-go]").forEach(tr=>tr.onclick=e=>{ if(e.target.tagName!=="A"&&e.target.tagName!=="INPUT") location.hash=tr.dataset.go; });
}

function renderCustomer(cid){
  const c=S.customers[cid]; if(!c){ app.innerHTML=`<a class="back" href="#kunden">← Kunden</a><div class="empty">Diesen Kunden gibt es nicht mehr (evtl. zusammengeführt).</div>`; return; }
  const os=Object.values(S.orders).filter(o=>o.customerId===cid).sort((a,b)=>(S.products[a.productId]?.name||"").localeCompare(S.products[b.productId]?.name||"")||sortOrders(a,b));
  const d=dupesOf(c); const others=Object.values(S.customers).filter(x=>x.id!==cid).sort((a,b)=>a.name.localeCompare(b.name,"de"));
  const pickup=os.filter(o=>(o.status==="Zugeteilt"||o.status==="Auftrag angelegt")&&(o.alloc||0)>0);
  app.innerHTML=`<a class="back" href="#kunden">← Kunden</a>
  <div><h1>${esc(c.name)}</h1><p class="sub"><a class="back" href="#protokoll" data-logq="${esc(c.name)}">Verlauf</a> · ${os.length} Bestellungen${pickup.length?` · ${pickup.reduce((s,o)=>s+o.alloc,0)} Stück bereit zur Abholung`:""}</p></div>
  ${d.length?`<div class="note">Ähnliche Schreibweise: ${d.map(x=>`<a href="#kunde-${x.id}">${esc(x.name)}</a>`).join(", ")}. Falls es dieselbe Person ist, unten zusammenführen.</div>`:""}
  <div class="panel"><h2>Kundendaten</h2>${nameChecked(c)?"":`<div class="note">Vor- und Nachname wurden automatisch aufgeteilt. Bitte prüfen und mit „Stimmt so“ bestätigen, oder mit „Vertauschen“ bzw. direkt im Feld korrigieren.</div>`}<div class="form">
    <label>Vorname<input id="cd-fn" value="${esc(nameParts(c).first)}"></label>
    <label>Nachname<input id="cd-ln" value="${esc(nameParts(c).last)}"></label>
    <label><span>&nbsp;</span><span class="row" style="gap:6px"><button type="button" class="sm" id="cd-swap">⇄ Vertauschen</button>${nameChecked(c)?"":`<button type="button" class="sm pri" id="cd-ok">Stimmt so</button>`}</span></label>
    <label>etron-Kundennr.${etronLink(c)?` <span style="float:right">${etronLink(c)}</span>`:""}<input id="cd-etronId" value="${esc(c.etronId||"")}" placeholder="fehlt"></label>
    <label>Kontakt (Telefon/E-Mail)<input id="cd-contact" value="${esc(c.contact||"")}"></label>
    <label class="row muted" style="gap:6px;align-self:end"><input type="checkbox" id="cd-wa" ${c.noWhatsapp?"":"checked"}> Hat WhatsApp</label>
    <label class="wide">Notiz<input id="cd-note" value="${esc(c.note||"")}"></label></div></div>
  ${orderForm("cu", null, cid)}
  <div class="tablebox"><table><thead><tr><th>Produkt</th><th>Release</th><th class="n">Menge</th><th>Bestellt am</th><th>Status</th><th class="n">Zuteilung</th><th>Auftrag</th><th>Nachricht</th><th>Kommentar</th></tr></thead><tbody>
  ${os.map(o=>{const p=S.products[o.productId||(o.choices||[])[0]];return `<tr data-o="${o.id}" class="${o.status==="Storniert"?"dim":""}"><td><a href="#produkt-${p?.id||""}">${esc(orderLabel(o))}</a><span class="gtag">${esc(gameOf(p))}</span></td><td>${esc(relTxt(p?.release))}</td>
    <td class="n"><input type="number" min="0" data-f="qty" id="q-${o.id}" value="${o.qty??""}"></td><td>${fmtDate(o.date)}</td>
    <td><select data-f="status" id="s-${o.id}">${STATUSES.map(x=>`<option ${x===o.status?"selected":""}>${x}</option>`).join("")}</select></td>
    <td class="n">${o.alloc??""}</td><td style="text-align:center">${auftragBox([o])}</td><td>${msgBtn([o])}</td><td><input class="c" data-f="comment" id="k-${o.id}" value="${esc(o.comment||"")}"></td></tr>`}).join("")||`<tr><td colspan="8" class="empty">Keine Bestellungen.</td></tr>`}
  </tbody></table></div>
  <div class="panel"><h2>Mit anderem Kunden zusammenführen</h2>
    <p class="muted">Alle Bestellungen von „${esc(c.name)}“ wandern zum gewählten Kunden, danach wird „${esc(c.name)}“ gelöscht.</p>
    <div class="row"><select id="mt"><option value="">Ziel-Kunde wählen</option>${[...d,...others.filter(x=>!d.includes(x))].map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select>
    <button id="mg" class="danger" ${S.canWrite?"":"disabled"}>Zusammenführen</button><span id="mgc"></span></div></div>`;
  ["contact","note"].forEach(f=>{ const el=$("#cd-"+f); el.onchange=()=>{ const v=el.value.trim(); write("customers",cid,{[f]:v}).then(ok=>ok&&toast("Gespeichert")); }; });
  const saveName=(fn,ln)=>{ fn=fn.trim(); ln=ln.trim(); if(!fn) return toast("Vorname darf nicht leer sein.");
    const dup=custByParts(fn,ln); if(dup&&dup.id!==cid) toast(`Achtung: „${dup.name}“ gibt es schon. Bitte unten zusammenführen.`);
    write("customers",cid,{firstName:fn,lastName:ln,name:(fn+" "+ln).trim()}).then(ok=>ok&&!(dup&&dup.id!==cid)&&toast("Name gespeichert")); };
  $("#cd-fn").onchange=$("#cd-ln").onchange=()=>saveName($("#cd-fn").value,$("#cd-ln").value);
  $("#cd-swap").onclick=()=>saveName($("#cd-ln").value,$("#cd-fn").value);
  if($("#cd-ok")) $("#cd-ok").onclick=()=>saveName($("#cd-fn").value,$("#cd-ln").value);
  $("#cd-wa").onchange=e=>write("customers",cid,{noWhatsapp:!e.target.checked}).then(ok=>ok&&toast("Gespeichert"));
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
// ---------- Odoo-Import (etron onRetail = Odoo 16): Verkaufsaufträge, ein Auftrag pro Kunde, Folgezeilen ohne Kopfdaten
const odooCfg = () => ({ key: "id", ...(S.config?.odoo || {}) }); // etron-Kundennr. = Odoo-Partner-ID (Tommy, 23.11.)
function odooCsv(rows){
  const cfg=odooCfg(); const q=v=>{v=String(v??"");return /[,"\n]/.test(v)?`"${v.replace(/"/g,'""')}"`:v};
  const tag=(cfg.tag||"").split(",").map(x=>x.trim()).filter(Boolean).join(",");
  const head=[cfg.key==="id"?"partner_id/.id":"partner_id","client_order_ref",...(tag?["tag_ids"]:[]),"order_line/product_id","order_line/product_uom_qty"];
  const byC={}; rows.forEach(o=>(byC[o.customerId]=byC[o.customerId]||[]).push(o));
  const out=[head];
  for(const [cid,list] of Object.entries(byC)){ const c=S.customers[cid]||{}; if(!c.etronId) continue;
    list.forEach((o,i)=>{ const p=S.products[o.productId]||{};
      out.push([i?"":(c.etronId||""), i?"":`Vorbestellung ${fmtDate(today())}`, ...(tag?[i?"":tag]:[]), p.articleNo||p.name||"", o.alloc]); }); }
  return "\ufeff"+out.map(r=>r.map(q).join(",")).join("\r\n");
}
// Link zum Kundenkonto in etron: Vorlage aus den Einstellungen, {Nr} = etron-Kundennr.
const etronUrl = c => { const t=(S.config?.etron||{}).customerUrl||""; if(!t||!c?.etronId||!/^https?:\/\//.test(t)) return ""; return t.replace(/\{Nr\}/g, encodeURIComponent(String(c.etronId).trim())); };
const etronLink = (c, label="In etron öffnen") => { const u=etronUrl(c); return u?`<a class="back" href="${esc(u)}" target="_blank" rel="noopener" title="Kundenkonto in etron öffnen">${label} ↗</a>`:""; };
function odooPanel(rows){
  const cfg=odooCfg(); const noC=[...new Set(rows.filter(o=>!S.customers[o.customerId]?.etronId).map(o=>S.customers[o.customerId]?.name||"?"))];
  const noA=[...new Set(rows.filter(o=>!S.products[o.productId]?.articleNo).map(o=>S.products[o.productId]?.name||"?"))];
  return `<details class="panel wiki"><summary>Odoo-Import für etron (Aufträge per Datei anlegen)</summary><div>
    <ol><li>„Odoo-Import herunterladen“ klicken.</li><li>In etron: Verkauf → Aufträge → ⚙ bzw. Favoriten → <b>Datensätze importieren</b> → Datei hochladen.</li>
    <li>Oben „Test“ klicken. Meldet Odoo keine Fehler, auf „Importieren“ klicken.</li><li>Danach hier „Alle als ‚Auftrag angelegt‘ markieren“.</li></ol>
    <p>Pro Kunde entsteht ein Auftrag mit allen zugeteilten Positionen. Der Kunde wird über die etron-Kundennr. gefunden, das Produkt über die Artikelnummer (sonst über den Produktnamen).</p>
    <label class="row muted" style="gap:6px">etron-Kundennr. ist in Odoo <select id="odoo-key"><option value="ref" ${cfg.key==="ref"?"selected":""}>die Referenz des Kontakts</option><option value="id" ${cfg.key==="id"?"selected":""}>die interne ID des Kontakts</option></select></label>
    <label class="row muted" style="gap:6px">Stichwörter für die Aufträge <input id="odoo-tag" list="odoo-tags" value="${esc(cfg.tag||"")}" placeholder="z. B. Lager" style="width:220px"><datalist id="odoo-tags"><option value="Lager"><option value="Séparée"><option value="Büro"></datalist></label>
    <p class="muted">Mehrere Stichwörter mit Komma trennen. Sie müssen in etron schon genau so angelegt sein (Verkauf → Konfiguration → Stichwörter), sonst meldet der Test einen Fehler. Leer = keine Stichwörter.</p>
    ${noC.length?`<div class="note bad">Ohne etron-Kundennr., kommen nicht in die Datei (erst unter Kunden nachtragen): ${noC.map(esc).join(", ")}</div>`:""}
    ${noA.length?`<div class="note">Ohne Artikelnummer, es wird der Produktname verwendet: ${noA.map(esc).join(", ")}</div>`:""}
    <div class="row"><button id="odl" class="pri" ${rows.length?"":"disabled"}>Odoo-Import herunterladen</button></div></div></details>`;
}
function bindOdoo(rows){
  const k=$("#odoo-key"); if(k) k.onchange=e=>write("config","odoo",{...odooCfg(),key:e.target.value},"set").then(ok=>ok&&toast("Gespeichert"));
  const t=$("#odoo-tag"); if(t) t.onchange=e=>write("config","odoo",{...odooCfg(),tag:e.target.value.trim()},"set").then(ok=>ok&&toast("Stichwort gespeichert"));
  const b=$("#odl"); if(b) b.onclick=async()=>{ const data=odooCsv(rows); const name=`odoo-auftraege-${today()}.csv`;
    if(S.downloads){ try{ await S.downloads.save({filename:name,data:new Blob([data],{type:"text/csv;charset=utf-8"})}); return; }catch(e){ if(e&&e.code==="dismissed") return; } }
    showText(data); };
}
function csv(rows){ const q=v=>{v=String(v??"");return /[;"\n]/.test(v)?`"${v.replace(/"/g,'""')}"`:v}; const head=["etron-Kundennr.","Kunde","Kontakt","Spiel","Artikelnummer","Produkt","Menge","Bestelldatum","Mitarbeiter","Kommentar","Vorbestell-Nr"];
  return "﻿"+[head,...rows.map(o=>{const c=S.customers[o.customerId]||{},p=S.products[o.productId]||{};return [c.etronId,c.name,c.contact,gameOf(p),p.articleNo,p.name,o.alloc,fmtDate(o.date),o.staff,o.comment,o.id]})].map(r=>r.map(q).join(";")).join("\r\n"); }
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
  shownRows.filter(o=>nameMatch(S.oq, S.customers[o.customerId])).forEach(o=>(byC[o.customerId]=byC[o.customerId]||[]).push(o));
  app.innerHTML=`<div><h1>etron-Export${S.game==="Alle"?"":" · "+esc(S.game)}</h1><p class="sub">Alle Bestellungen mit Status „Zugeteilt“. Daraus werden in etron onRetail die Aufträge angelegt. Danach pro Position den Haken bei „Auftrag angelegt“ setzen. Abgehakte bleiben bis zum Neuladen grau sichtbar, falls du dich verklickt hast.</p></div>
  <div class="tiles"><div class="tile"><b>${new Set(rows.map(o=>o.customerId)).size}</b><span>Kunden offen</span></div><div class="tile"><b>${rows.length}</b><span>Positionen</span></div><div class="tile"><b>${rows.reduce((s,o)=>s+o.alloc,0)}</b><span>Stück</span></div></div>
  ${Object.keys(byC).some(id=>!S.customers[id]?.etronId)?`<div class="note">${Object.keys(byC).filter(id=>!S.customers[id]?.etronId).length} Kunden haben noch keine etron-Nr. Bitte vor dem Anlegen der Aufträge unter Kunden eintragen.</div>`:""}
  <div class="row">${oqInput()}</div>
  ${odooPanel(rows)}
  <div class="row"><button class="pri" id="dl" ${rows.length?"":"disabled"}>CSV herunterladen</button><button id="cp" ${rows.length?"":"disabled"}>Als Text kopieren</button><button id="mk" ${rows.length&&S.canWrite?"":"disabled"}>Alle als „Auftrag angelegt“ markieren</button><span id="mkc"></span></div>
  ${shownRows.length?Object.entries(byC).map(([cid,list])=>{const c=S.customers[cid]||{};return `<div class="panel"><div class="row spread"><h2>${custFlags({...c,id:cid})}<a class="back" href="#kunde-${cid}">${esc(c.name||"?")}</a></h2><span class="muted">${c.etronId?"etron-Nr. "+esc(c.etronId)+" "+etronLink({...c,id:cid}):'<span style="color:var(--bad);font-weight:600">etron-Nr. fehlt</span>'} · ${esc(c.contact||"")}</span></div>
    <div class="tablebox"><table><thead><tr><th>Produkt</th><th class="n">Menge</th><th>Kommentar</th><th>Auftrag angelegt</th><th>Nachricht</th></tr></thead><tbody>${list.map(o=>`<tr class="${o.status==="Auftrag angelegt"?"dim":""}"><td>${esc(S.products[o.productId]?.name||"?")}${S.products[o.productId]?.articleNo?` <span class="muted">Art.-Nr. ${esc(S.products[o.productId].articleNo)}</span>`:""}${/^https?:\/\//.test(S.products[o.productId]?.etronUrl||"")?` <a href="${esc(S.products[o.productId].etronUrl)}" target="_blank" rel="noopener">etron</a>`:""}</td><td class="n">${o.alloc}</td><td>${esc(o.comment||"")}</td><td style="text-align:center">${auftragBox([o])}</td><td>${msgBtn([o])}</td></tr>`).join("")}</tbody></table></div></div>`}).join(""):`<div class="empty">Gerade nichts zu exportieren. Sobald bei einem Produkt die Zuteilung abgeschlossen ist, erscheinen die Kunden hier.</div>`}
  <div class="panel"><h2>Gesamtsicherung</h2><p class="muted">Alle Produkte, Kunden und Bestellungen als eine JSON-Datei, z. B. für den Umzug in die Dropbox.</p><div class="row"><button id="bk">Alle Daten exportieren (JSON)</button></div></div>
  <textarea id="ta" hidden rows="6" style="width:100%"></textarea>`;
  $("#bk").onclick=backup; bindAuftrag();
  if(!rows.length) return;
  bindOq();
  bindOdoo(rows);
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
// ---------- Änderungsprotokoll: pro Monat eine Datei protokoll/JJJJ-MM.json in der Dropbox
const LOG_DIR = "protokoll";
const AREA = { games: "Spielsystem", orders: "Bestellung", products: "Produkt", customers: "Kunde", templates: "Vorlage", staff: "Mitarbeiter" };
const FIELD = { noWhatsapp: "Kein WhatsApp", firstName: "Vorname", lastName: "Nachname", status: "Status", qty: "Menge", alloc: "Zuteilung", comment: "Kommentar", productId: "Produkt", customerId: "Kunde", date: "Datum", staff: "Kürzel", choices: "Auswahl",
  name: "Name", contact: "Kontakt", note: "Notiz", etronId: "etron-Nr.", received: "Eingang", supplierOrdered: "Beim Lieferanten bestellt", supplierConfirmed: "Bestätigt", release: "Release",
  archived: "Archiviert", series: "Serie", game: "Spiel", kuerzel: "Kürzel", unit: "Einheit", variant: "Variante", group: "Gruppe", text: "Text", msgName: "Name in Nachrichten", articleNo: "Artikelnummer", etronUrl: "etron-Link" };
const LOG_SKIP = new Set(["updatedAt", "_ft", "createdAt", "notDupes", "pairId", "order", "hidden"]);
function logVal(k, v){
  if (v == null || v === "") return "–";
  if (k === "productId") return S.products[v]?.name || v;
  if (k === "customerId") return S.customers[v]?.name || v;
  if (k === "choices") return (v || []).map(id => S.products[id]?.name || id).join(" oder ");
  if (typeof v === "boolean") return v ? "ja" : "nein";
  if (typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v)) return fmtDate(v);
  const t = typeof v === "object" ? JSON.stringify(v) : String(v);
  return t.length > 60 ? t.slice(0, 57) + "…" : t;
}
function logChange(c, id, b, a){
  if (!AREA[c]) return;
  const bd = !b || b.deleted, ad = !a || a.deleted || a.hidden; if (bd && ad) return;
  const r = ad ? b : a; let text;
  if (bd) text = c === "orders" ? `Neu angelegt: Menge ${r.qty ?? "–"}, Status ${r.status || "–"}` : "Neu angelegt";
  else if (ad) text = "Gelöscht";
  else {
    const ch = [];
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (LOG_SKIP.has(k) || stable(b[k] ?? null) === stable(a[k] ?? null)) continue;
      if (k === "notified") { if (a[k]) ch.push(`Nachricht „${a[k].template}“ gesendet`); continue; }
      ch.push(`${FIELD[k] || k}: ${logVal(k, b[k])} → ${logVal(k, a[k])}`);
    }
    if (!ch.length) return; text = ch.join("; ");
  }
  const name = c === "orders" ? `${S.customers[r.customerId]?.name || "?"} – ${orderLabel(r)}` : c === "staff" ? `${r.kuerzel} (${r.name || ""})` : (r.name || "");
  const link = c === "orders" ? (r.customerId ? "#kunde-" + r.customerId : "") : c === "products" ? "#produkt-" + id : c === "customers" ? "#kunde-" + id : "#einstellungen";
  logAdd({ area: AREA[c], ref: id, name, text, link: ad ? "" : link });
}
function openLog(){
  const m = today().slice(0, 7);
  if (S.logP?.m !== m) S.logP = { m, p: openLogMonth(m) };
  return S.logP.p;
}
async function openLogMonth(m){
  try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith("vb.log:") && k !== "vb.log:" + m) localStorage.removeItem(k); } } catch (e) { }
  const d = new SyncDoc(S.provider, `${LOG_DIR}/${m}.json`, null, "vb.log:" + m);
  if (!(await d.loadCache())) d.obj = { meta: { version: 1, updatedAt: 0 }, log: {} };
  let n = -1; d.on(() => { const c = Object.keys(d.obj?.log || {}).length; if (c !== n) { n = c; if (h0() === "protokoll") render(); } });
  S.log = { m, doc: d }; d.scheduleSync(1500);
  return d;
}
function logAdd(e){
  const t = now(); const entry = { t, staff: staff() || "?", ...e, updatedAt: t };
  openLog().then(d => d.update(o => { (o.log ||= {})[newId("l")] = entry; })).catch(err => console.warn("Protokoll", err));
}
const lnorm = s => (s || "").toLowerCase().replace(/ß/g, "ss").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const fmtTime = t => new Date(t).toLocaleString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
S.lg = { m: null, q: "", months: null, data: {} };
document.addEventListener("click", e => { const a = e.target.closest("[data-logq]"); if (a) { S.lg.q = a.dataset.logq; S.lg.m = null; } });
function renderLog(){
  const cur = S.log?.m || today().slice(0, 7); const m = S.lg.m || cur;
  if (!S.lg.months) { S.lg.months = [cur];
    S.provider.list(LOG_DIR).then(ns => { S.lg.months = [...new Set([cur, ...ns.filter(x => /^\d{4}-\d\d\.json$/.test(x)).map(x => x.slice(0, 7))])].sort().reverse(); if (h0() === "protokoll") render(); }).catch(() => {}); }
  let list = m === cur ? Object.values(S.log?.doc.obj?.log || {}) : S.lg.data[m];
  if (list === undefined) { S.lg.data[m] = null;
    S.provider.read(`${LOG_DIR}/${m}.json`).then(r => { S.lg.data[m] = Object.values(r?.data?.log || {}); render(); }).catch(e => { S.lg.data[m] = []; toast("Protokoll nicht lesbar: " + e.message); render(); }); }
  const words = lnorm(S.lg.q).split(/\s+/).filter(Boolean);
  const rows = (list || []).filter(e => e && !e.deleted).filter(e => { const hay = lnorm([fmtTime(e.t), e.staff, e.area, e.name, e.text].join(" ")); return words.every(w => hay.includes(w)); }).sort((a, b) => b.t - a.t);
  const MAX = 500;
  const monthName = k => new Date(k + "-15").toLocaleDateString("de-AT", { month: "long", year: "numeric" });
  app.innerHTML = `<div class="row spread"><div><h1>Protokoll</h1><p class="sub">Alle Änderungen mit Kürzel und Uhrzeit. Gespeichert pro Monat ${S.provider.kind === "local" ? "in diesem Browser" : "in der Dropbox unter Apps › TCG Preorder › protokoll"}.</p></div></div>
  <div class="panel"><div class="row"><input id="lq" type="search" placeholder="Suchen: Kunde, Produkt, Kürzel, Status, Datum …" value="${esc(S.lg.q)}" style="flex:1 1 260px">
    <select id="lm">${S.lg.months.map(k => `<option value="${k}" ${k === m ? "selected" : ""}>${monthName(k)}</option>`).join("")}</select></div>
  <p class="muted">${list === null ? "Wird geladen …" : `${rows.length} ${rows.length === 1 ? "Eintrag" : "Einträge"}${rows.length > MAX ? `, die neuesten ${MAX} werden angezeigt` : ""}`}</p>
  <div class="tablebox"><table><thead><tr><th>Zeit</th><th>Kürzel</th><th>Bereich</th><th>Betrifft</th><th>Änderung</th></tr></thead><tbody>
  ${rows.slice(0, MAX).map(e => `<tr><td class="nowrap">${fmtTime(e.t)}</td><td>${esc(e.staff || "")}</td><td>${esc(e.area || "")}</td><td>${e.link ? `<a href="${esc(e.link)}">${esc(e.name || "")}</a>` : esc(e.name || "")}</td><td>${esc(e.text || "")}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">${list === null ? "" : "Keine Einträge."}</td></tr>`}
  </tbody></table></div></div>`;
  $("#lq").oninput = e => { S.lg.q = e.target.value; render(); };
  $("#lm").onchange = e => { S.lg.m = e.target.value; render(); };
}
function makeDb(doc){
  const logged = (c, id, fn) => { const before = clone(doc.obj?.[c]?.[id]); fn(); try { logChange(c, id, before, doc.obj?.[c]?.[id]); } catch (e) { console.warn("Protokoll", e); } };
  const col = c => ({ doc: id => ({
    set: async d => logged(c, id, () => doc.update(o => { const old=(o[c] ||= {})[id]; const t=Math.max(now(), (old?.updatedAt||0)+1); o[c][id] = { ...d, _ft: {"*": t}, updatedAt: t }; })),
    update: async d => { const cur = doc.obj[c]?.[id]; if (!cur || cur.deleted) throw { code: "not_found", message: "Eintrag gibt es nicht mehr" };
      logged(c, id, () => doc.update(o => { const old=o[c][id]; const t=Math.max(now(), (old.updatedAt||0)+1); const ft=old._ft?{...old._ft}:{"~":old.updatedAt||0}; for(const f of Object.keys(d)) ft[f]=t;
        o[c][id] = { ...old, ...d, _ft: ft, updatedAt: t }; })); },
    delete: async () => logged(c, id, () => doc.update(o => { const old=(o[c] ||= {})[id]; o[c][id] = { deleted: true, updatedAt: Math.max(now(), (old?.updatedAt||0)+1) }; })),
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
  S.products = live(o.products); S.customers = live(o.customers); S.orders = live(o.orders); S.templates = live(o.templates); S.staff = live(o.staff); S.config = live(o.config); S.games = live(o.games); drawStaffList();
  S.loaded = { p: true, c: true, o: true };
  drawGames();
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
  logAdd({ area: "Import", name: "Sicherung", text: `Sicherung eingespielt: ${d.products.length} Produkte, ${d.customers.length} Kunden, ${d.orders.length} Bestellungen` });
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
const WIKI = [
  ["So funktioniert das Programm", `<p>Die App ersetzt die Excel-Warteliste. Es gibt drei Dinge: <b>Produkte</b> (z. B. ein Display oder eine ETB), <b>Kunden</b> und <b>Bestellungen</b> (Kunde X möchte Y Stück von Produkt Z).</p>
    <p>Alle Daten liegen in unserer Dropbox und gleichen sich automatisch zwischen allen Geräten ab. Oben rechts siehst du, ob gespeichert ist. Jede Änderung wird mit deinem Kürzel im <a href="#protokoll">Protokoll</a> festgehalten.</p>
    <p>Oben kannst du nach Spiel filtern (One Piece, Pokémon, Riftbound, Magic, Yu-Gi-Oh! oder Alle).</p>`],
  ["Bevor du loslegst: Kürzel eintragen", `<p>Jeder Mitarbeiter wird einmal unter Einstellungen → <b>Mitarbeiter</b> mit Kürzel und Vorname angelegt. Der Vorname steht dann unter den Kundennachrichten, das Kürzel intern bei Bestellungen und im Protokoll.</p><p>Die PCs werden geteilt: Klick beim Arbeitsbeginn oben rechts auf <b>„Wer bist du?“</b> und wähle deinen Namen. Spätestens beim Anlegen einer Bestellung oder beim Senden einer Nachricht fragt die App danach. Die Auswahl gilt nur für dieses Fenster und wird nach 30 Minuten ohne Eingabe oder beim Schließen der App gelöscht. Wer übernimmt, klickt auf den Namen oben rechts und wählt sich selbst. Solange das Feld rot ist, kannst du keine Bestellungen anlegen und keine Nachrichten senden.</p>`],
  ["Neuen Artikel (Produkt) anlegen", `<ol><li>Reiter <b>Produkte</b> öffnen und ganz nach unten zu „Neues Produkt anlegen“ scrollen.</li>
    <li>Produktname eintragen, Spiel wählen, Release (Datum, „Q3 2027“ oder leer) und Einheit (Display, Case, Stück).</li>
    <li><b>Anlegen</b> klicken. Die Produktseite öffnet sich.</li></ol>
    <p>Varianten (Decks, Artworks) als eigenes Produkt anlegen, z. B. „ST45 | Rot“. Gehören zwei Produkte zu einem Doppel-Release, auf beiden Produktseiten unter <b>Produktdaten</b> dieselbe <b>Serie</b> eintragen. Dann gibt es eine gemeinsame Liste („Ganze Serie zuteilen“).</p>`],
  ["Vorbestellung aufnehmen (und neuen Kunden anlegen)", `<ol><li>Produkt in der Liste anklicken (oder einen Kunden unter <b>Kunden</b> öffnen).</li>
    <li>Bei „Neue Bestellung erfassen“ im Feld <b>Kunde</b> den Namen (oder Telefon / etron-Nr.) eintippen und den Kunden aus der Liste <b>auswählen</b>. Ohne ausgewählten Kunden kann keine Bestellung gespeichert werden.</li>
    <li>Gibt es den Kunden noch nicht: <b>+ Neuer Kunde</b> anklicken (auch unter <b>Kunden</b> oben rechts) und Vorname, Nachname und Telefon eintragen. Die App zeigt ähnliche Kunden an (Name oder gleiche Telefonnummer). Ist es einer davon, bitte diesen anklicken statt neu anzulegen.</li>
    <li>Menge, Bestelldatum und eventuell einen Kommentar eintragen. Stehen mehrere Produkte in einer gemeinsamen Liste (Serie), gibt es ein Mengenfeld je Produkt, z. B. IB-09: 2 und IB-10: 1, plus „egal welches“ für Kunden, denen es egal ist. Ein weiteres Produkt kommt über <b>+ Weiteres Produkt in diese Liste</b> auf der Produktseite dazu.</li>
    <li><b>Speichern</b>.</li></ol>
    <p>Danach beim Kunden (Reiter <b>Kunden</b>, Name anklicken) <b>Telefon/E-Mail</b> und, wenn bekannt, die <b>etron-Kundennummer</b> eintragen. Die Telefonnummer braucht man für WhatsApp-Nachrichten, die etron-Nr. für den Export.</p>
    <p>Größere Listen können unter Einstellungen → „Excel-Liste importieren“ auf einmal eingelesen werden.</p>`],
  ["Ware ist da: zuteilen", `<ol><li>Auf der Produktseite unter Produktdaten den <b>Wareneingang</b> eintragen. Ist eine <b>Verpackungseinheit</b> hinterlegt (z. B. 8 Displays pro Karton), kann die Menge auch direkt in VE eingetragen werden; die Stückzahl wird dann ausgerechnet.</li>
    <li>Bei „Zuteilung“ wählen: <b>Proportional</b> (fair verteilt) oder <b>Nach Bestelldatum</b>. Dann <b>Vorschlag berechnen</b>.</li>
    <li>Vorschlag prüfen, eventuell einzelne Zahlen in der Tabelle ändern, dann <b>Vorschlag übernehmen</b>.</li>
    <li><b>Zuteilung abschließen</b> setzt alle Bestellungen mit Zuteilung auf „Zugeteilt“. Wer nichts bekommt, kann auf „Warteliste“ gesetzt werden.</li></ol>`],
  ["Auftrag in etron anlegen", `<p>Reiter <b>etron-Export</b> zeigt alle zugeteilten Bestellungen nach Kunde. Den Auftrag in etron anlegen und danach den <b>Haken</b> in der Spalte „Auftrag“ setzen. Der Haken geht auch direkt auf der Produktseite. Ohne etron-Nr. beim Kunden bitte zuerst die Nummer nachtragen.</p>`],
  ["Kunden benachrichtigen", `<p>In jeder Bestellzeile gibt es zwei Knöpfe:</p>
    <ul><li><b>📋 Abholung / Storno / Warteliste</b>: kopiert mit einem Klick den passenden Text (mit Spiel, Produkt und Abholdatum heute). In WhatsApp oder SMS einfügen. Die Nachricht gilt danach als gesendet.</li>
    <li><b>Nachricht</b>: öffnet das Fenster zum Anpassen (anderes Abholdatum, andere Vorlage, eigener Text) und kann WhatsApp oder E-Mail direkt öffnen.</li></ul>
    <p>Farbe des Nachricht-Knopfs: <span class="pill" style="background:#1d4ed8;color:#fff">blau</span> noch nichts gesendet, <span class="pill" style="background:#17803d;color:#fff">grün</span> Abholnachricht gesendet, <span class="pill" style="background:#f5c518;color:#1f1a00">gelb</span> Warteliste, <span class="pill" style="background:#b42318;color:#fff">rot</span> Storno. Ändert sich der Status (z. B. von Warteliste auf Zugeteilt), wird der Knopf wieder blau. Im Filter über der Bestellliste zeigt „Nachricht noch nicht gesendet“ alle, die noch eine Nachricht brauchen. Die Texte lassen sich unten unter „Nachrichtenvorlagen“ ändern.</p>`],
  ["Abholung, Storno, Doppelte", `<ul><li>Holt der Kunde ab: Status auf <b>Abgeholt</b> setzen.</li>
    <li>Storniert ein Kunde: Status auf <b>Storniert</b>. Die App fragt dann, ob die frei gewordene Ware an jemand anderen gehen soll.</li>
    <li>Reiter <b>Dubletten</b> zeigt Kunden, die vermutlich doppelt angelegt sind. Dort zusammenführen oder als „Kein Duplikat“ markieren.</li>
    <li>Wer hat was geändert? Reiter <b>Protokoll</b>, oder „Verlauf“ bei Kunde oder Produkt.</li></ul>`],
];
const wikiPanel = () => `<div class="panel"><h2>Kurzanleitung</h2>${WIKI.map(([t,b])=>`<details class="wiki"><summary>${t}</summary><div>${b}</div></details>`).join("")}</div>`;
function renderSettings(){
  const isDb = S.provider.kind === "dropbox";
  app.innerHTML = `<div><h1>Einstellungen</h1><p class="sub">Version ${esc(APP_VERSION)} · ${isDb ? "Daten in der Dropbox (App-Ordner, Datei vorbestellungen.json)" : "Nur ausprobieren: Daten liegen nur in diesem Browser"}</p></div>
  ${wikiPanel()}
  <div class="panel"><h2>Speicher</h2><p>Status: <b>${esc(SYNC_TXT[S.doc.status] || S.doc.status)}</b>${S.doc.error ? ` <span class="muted">(${esc(S.doc.error)})</span>` : ""}</p>
    <div class="row"><button id="syncnow">Jetzt abgleichen</button><button id="logout" class="danger">${isDb ? "Dropbox auf diesem Gerät trennen" : "Ausprobieren beenden"}</button></div>
    <p class="muted">Trennen entfernt nur den Zugang auf diesem Gerät. Die Daten in der Dropbox bleiben.</p></div>
  ${isDb ? `<div class="panel"><h2>Kollegen einladen</h2>
    <p class="muted">Mit diesem Code kann ein weiteres Gerät auf denselben Dropbox-App-Ordner zugreifen (nicht auf den Rest der Dropbox). Nur an Mitarbeiter weitergeben.</p>
    <div class="row"><button id="inv">Einladungscode anzeigen</button></div><textarea id="invt" hidden rows="3" style="width:100%" readonly></textarea></div>` : ""}
  ${etronPanel()}
  ${etronApiPanel()}
  ${gamesPanel()}
  ${staffPanel()}
  ${templatesPanel()}
  <div class="panel"><h2>Sicherung</h2>
    <div class="row"><button id="bk2">Alle Daten herunterladen (JSON)</button></div>
    <p class="muted">Importieren ergänzt bzw. überschreibt Einträge mit gleicher ID. Dropbox hebt frühere Versionen der Datei 30 Tage auf.</p>
    <div class="row"><input type="file" id="impf2" accept=".json,application/json"><span id="impst2" class="muted"></span></div></div>
  <div class="panel"><h2>Excel-Liste importieren</h2>
    <p class="muted">Liest eine Excel-Liste (z. B. Name, Telefon, E-Mail, Produkt A, Produkt B) nur hier im Browser ein. In den Produktspalten zählt eine Zahl als Menge, jeder andere Eintrag als 1 Stück.</p>
    <div class="row"><input type="file" id="xlf" accept=".xlsx,.xls,.csv"></div><div id="xlui"></div></div>`;
  $("#xlf").onchange = e => xlStart(e.target.files[0]);
  $("#syncnow").onclick = () => S.doc.sync(); bindTemplates(); bindStaff(); bindGames(); bindEtron(); bindEtronApi();
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
      <label>Spiel<select id="xl-g">${gameOptions(X.game || "Pokémon")}</select></label>
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
    if (needStaff()) return err("Bitte oben rechts ein gültiges Kürzel eintragen, dann noch einmal auf Importieren klicken.");
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
  await openLog();
  await S.doc.sync();
  if (!S.doc.obj) {
    if (S.doc.status === "ok") { S.doc.obj = emptyData(); S.doc.dirty = true; await S.doc.sync(); }
    else { app.innerHTML = `<div class="note bad">Dropbox nicht erreichbar: ${esc(S.doc.error || "unbekannter Fehler")}. <button id="rt">Erneut versuchen</button> <a class="back" href="#einstellungen">Einstellungen</a></div>`; $("#rt").onclick = () => location.reload(); return; }
  }
  if (cred.kind === "local" && !Object.keys(S.doc.obj.products || {}).length && !LS.get("vb.demo")) { LS.set("vb.demo", "1"); importObj(demoData()); }
  setInterval(() => { if (document.visibilityState === "visible" && !S.doc.dirty) S.doc.sync(); if (document.visibilityState === "visible") openLog().then(d => d.sync()); }, 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { S.doc.sync(); S.log?.doc.sync(); } });
}
window.addEventListener("hashchange", () => { S.oq = ""; S.osort = ""; route(); }); // Standard: chronologisch
// Höhe der Kopfleiste für fixierte Tabellenköpfe
const setHdr=()=>document.documentElement.style.setProperty("--hdr", (document.querySelector(".bar")?.offsetHeight||100)+"px");
window.addEventListener("resize", setHdr); setHdr();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
