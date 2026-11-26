// TCG Vorbestellungen: Oberfläche und Logik.
// Daten liegen ausschließlich in der Dropbox (App-Ordner) oder beim Ausprobieren im Browser.
import { LS, LocalProvider, DropboxProvider, DiskProvider, desktopInfo, desk, startDropboxLogin, finishDropboxLogin, makeInvite, parseInvite, redirectUri } from './storage.js';
import { SyncDoc, DATA_PATH, emptyData, now, stable, clone, merge } from './store.js';
import { APP_VERSION } from './version.js';

const STATUSES = ["Offen","Zugeteilt","Auftrag angelegt","Abgeholt","Warteliste","Storniert"];
const LOCKED = new Set(["Auftrag angelegt","Abgeholt"]);         // Zuteilung steht fest
const COUNTS = s => s !== "Storniert" && s !== "Warteliste";       // zählt zur Vorbestellung
const S = { products:{}, customers:{}, orders:{}, loaded:{p:false,c:false,o:false}, db:null, canWrite:true, downloads:null, err:null, sugg:{} };
try{ S.min1 = localStorage.getItem("vb.min1")==="1"; }catch(e){}
const $ = s => document.querySelector(s);
const app = $("#app");
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const num = v => (v === "" || v == null || isNaN(+v)) ? null : +v;
const today = () => { const d=new Date(); return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
const fmtDate = d => d ? d.split("-").reverse().join(".") : "";
const pill = s => `<span class="pill s-${esc((s||"").split(" ")[0])}">${esc(s)}</span>`;
function toast(t,ms=2600){const el=$("#toast");el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,ms)}
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
// Dubletten: ähnlicher Name, gleiche etron-Nr., gleiche Telefonnummer oder gleiche E-Mail (automatisch geprüft)
const CKEYS = new WeakMap();
const ckeys = c => { let k=CKEYS.get(c); if(!k){ const cf=contactFields(c); k={tel:telKey(cf.tel), mail:String(cf.mail||"").trim().toLowerCase()}; CKEYS.set(c,k); } return k; };
const sameTel = (a,b) => { const x=ckeys(a).tel; return !!x && x===ckeys(b).tel; };
const sameMail = (a,b) => { const x=ckeys(a).mail; return !!x && x===ckeys(b).mail; };
const dupeWhy = (a,b) => [similar(a.name,b.name)&&"ähnlicher Name", sameEtron(a,b)&&"gleiche etron-Nr.", sameTel(a,b)&&"gleiche Telefonnummer", sameMail(a,b)&&"gleiche E-Mail"].filter(Boolean);
const dupesOf = c => Object.values(S.customers).filter(x => x.id!==c.id && !notDupe(c,x) && (similar(x.name,c.name) || sameEtron(x,c) || sameTel(x,c) || sameMail(x,c)));
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
// Release als sortierbarer Schlüssel (JJJJ-MM-TT). Versteht: 2027-05-15, 15.05.2027, 15.5.27, 05/2027, 5.2027, 2027-05, Mai 2027, Q2 2027, H1 2027, 2027. Unbekannt/leer ans Ende.
const MONTHS = {jan:1,jän:1,jaen:1,feb:2,mär:3,maer:3,mar:3,apr:4,mai:5,may:5,jun:6,jul:7,aug:8,sep:9,okt:10,oct:10,nov:11,dez:12,dec:12};
const relKey = r => { r=String(r||"").trim(); if(!r) return "9999"; const P=n=>String(n).padStart(2,"0"), Y=y=>y.length===2?"20"+y:y; let m;
  if(m=r.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)) return `${m[1]}-${P(m[2])}-${P(m[3])}`;
  if(m=r.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)) return `${Y(m[3])}-${P(m[2])}-${P(m[1])}`;
  if(m=r.match(/^(\d{4})-(\d{1,2})$/)) return `${m[1]}-${P(m[2])}-32`;
  if(m=r.match(/^(\d{1,2})[./](\d{4})$/)) return `${m[2]}-${P(m[1])}-32`;
  if(m=r.match(/Q\s*(\d)\D*(\d{4})/i)) return `${m[2]}-${P(m[1]*3)}-33`;
  if(m=r.match(/H\s*([12])\D*(\d{4})/i)) return `${m[2]}-${m[1]==="1"?"06":"12"}-34`;
  if(m=r.match(/([A-Za-zÄÖÜäöü]{3,})\.?\s*(\d{4})/)){ const mo=MONTHS[m[1].toLowerCase().slice(0,3)]||MONTHS[m[1].toLowerCase().slice(0,4)]; if(mo) return `${m[2]}-${P(mo)}-32`; }
  if(m=r.match(/^(\d{4})$/)) return `${m[1]}-12-35`;
  if(m=r.match(/(\d{4})/)) return `${m[1]}-12-36`;
  return "9998"; };
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
  else {
    // Option „Jeder mindestens 1 Stück“: zuerst 1 Stück pro Kunde (nach Bestelldatum; reicht die Ware nicht für alle, bekommen die Früheren eins),
    // der Rest wird wie gewählt verteilt. Kunden, die schon fest zugeteilt (Zugeteilt/Abgeholt …) etwas haben, zählen als versorgt.
    const base = {}; let a = avail;
    if (S.min1) { const had = new Set(fixed.filter(o=>(o.alloc||0)>0).map(o=>o.customerId));
      for (const o of flex){ if(a<=0) break; if(had.has(o.customerId)) continue; base[o.id]=1; had.add(o.customerId); a--; } }
    const need = o => o.qty-(base[o.id]||0), wantR = flex.reduce((t,o)=>t+need(o),0);
    flex.forEach(o=>res[o.id]=base[o.id]||0);
    if (mode==="fifo"){ for(const o of flex){ const g=Math.min(need(o),a); res[o.id]+=g; a-=g; } }
    else if (wantR>0 && a>0) {
      let used=0; const rest=[];
      flex.forEach((o,i)=>{ const exact=need(o)*a/wantR; const b=Math.floor(exact+1e-9); res[o.id]+=b; used+=b; rest.push({o,r:exact-b,i}); });
      rest.sort((x,y)=> y.r-x.r || x.i-y.i);
      for (const {o} of rest){ if(used>=a) break; if(res[o.id]<o.qty){ res[o.id]++; used++; } }
    }
  }
  if (noFlex) return res;
  // Was übrig bleibt, geht an „egal welches“-Bestellungen der Serie (nach Bestelldatum)
  let left = avail - Object.values(res).reduce((a,b)=>a+b,0);
  for (const o of flexOf(p.id).filter(o=>o.status==="Offen" && (o.qty||0)>0).sort(sortOrders)){ if(left<=0) break; const g=Math.min(o.qty,left); res[o.id]=g; left-=g; }
  return res;
}

// ---------- Nachzuteilen: nach abgeschlossener Zuteilung wird wieder Menge frei (Storno, Nachlieferung).
// Bestehende Zuteilungen bleiben, nur die freie Menge geht an Bestellungen, die noch nicht alles haben
// (alle außer Storniert, die weniger als bestellt haben). Hat die Bestellung schon einen etron-Auftrag („Auftrag angelegt“/„Abgeholt“),
// bleibt der Status, und im Kommentar steht, dass die Menge im etron-Auftrag angepasst werden muss (Tommy, 25.11.).
const NACH = new Set(["Offen","Warteliste","Zugeteilt","Auftrag angelegt","Abgeholt"]);
function nachCands(p){ return ordersOf(p.id).filter(o=>NACH.has(o.status)&&(o.qty||0)>(o.alloc||0)).sort(sortOrders); }
function nachFree(p){ const r=num(p.received); if(r==null) return 0; return Math.max(0, r-ordersOf(p.id).filter(o=>o.status!=="Storniert").reduce((t,o)=>t+(o.alloc||0),0)); }
function suggestRest(p, mode){
  const cand = nachCands(p); let a = nachFree(p); const res = {};
  cand.forEach(o=>res[o.id]=o.alloc||0);
  const need = o => o.qty-res[o.id];
  if (S.min1) { const had = new Set(ordersOf(p.id).filter(o=>o.status!=="Storniert"&&(o.alloc||0)>0).map(o=>o.customerId));
    for (const o of cand){ if(a<=0) break; if(had.has(o.customerId)) continue; res[o.id]++; had.add(o.customerId); a--; } }
  const wantR = cand.reduce((t,o)=>t+need(o),0);
  if (wantR<=a){ cand.forEach(o=>res[o.id]=o.qty); a-=wantR; }
  else if (mode==="fifo"){ for(const o of cand){ const g=Math.min(need(o),a); res[o.id]+=g; a-=g; } }
  else if (wantR>0 && a>0){ const base=a; let used=0; const rest=[];
    cand.forEach((o,i)=>{ const exact=need(o)*base/wantR; const b=Math.floor(exact+1e-9); res[o.id]+=b; used+=b; rest.push({o,r:exact-b,i}); });
    rest.sort((x,y)=> y.r-x.r || x.i-y.i);
    for (const {o} of rest){ if(used>=base) break; if(res[o.id]<o.qty){ res[o.id]++; used++; } } a-=used; }
  for (const o of flexOf(p.id).filter(o=>o.status==="Offen" && (o.qty||0)>0).sort(sortOrders)){ if(a<=0) break; const g=Math.min(o.qty,a); res[o.id]=g; a-=g; }
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
// Ruhig neu zeichnen (Tommy, 26.11.): Während die Maustaste gedrückt ist, wird nicht neu gezeichnet (sonst geht der Klick verloren).
// Scrollposition (Seite und Tabellen), Fokus und ein gerade getippter Wert bleiben erhalten.
// Höchstens 700 ms warten (z. B. öffnet eine Auswahlliste und Chrome meldet das Loslassen nicht), danach wird auf jeden Fall gezeichnet.
S.ptr = 0; S.renderLater = false;
const ptrFlush = () => { if (S.renderLater) { S.renderLater = false; render(); } };
addEventListener("pointerdown", e => { if (e.target?.closest?.("select")) return; S.ptr = Date.now(); clearTimeout(S.ptrT); S.ptrT = setTimeout(() => { S.ptr = 0; ptrFlush(); }, 700); }, true);
const ptrUp = () => { if (!S.ptr) return; S.ptr = 0; clearTimeout(S.ptrT); setTimeout(ptrFlush, 120); };
addEventListener("pointerup", ptrUp, true); addEventListener("pointercancel", ptrUp, true); addEventListener("blur", ptrUp);
function render(){
  if (S.ptr && Date.now() - S.ptr < 700 && S.loaded?.o && S.rh === h0()) { S.renderLater = true; return; }
  S.renderLater = false;
  const same = S.rh === h0(); S.rh = h0(); if (!same) return renderNow();
  const ae = document.activeElement, typing = ae && ae.id && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && !/^(checkbox|radio|file|button|submit)$/.test(ae.type||"") && ae.value !== ae.defaultValue ? ae.value : null;
  const boxes = [...document.querySelectorAll("#app .tablebox")].map(b => [b.scrollTop, b.scrollLeft]); const sx = scrollX, sy = scrollY;
  renderNow();
  document.querySelectorAll("#app .tablebox").forEach((b, i) => { if (boxes[i]) { b.scrollTop = boxes[i][0]; b.scrollLeft = boxes[i][1]; } });
  if (scrollY !== sy || scrollX !== sx) scrollTo(sx, sy);
  if (typing != null && ae.id) { const el = document.getElementById(ae.id); if (el && el !== ae && /^(INPUT|TEXTAREA)$/.test(el.tagName) && el.value !== typing) el.value = typing; }
}
function renderNow(){
  if (S.err) { app.innerHTML = `<div class="note bad">${esc(S.err)}</div>`; return; }
  if (!(S.loaded.p&&S.loaded.c&&S.loaded.o)) return;
  if (!S.skipImport && !Object.keys(S.products).length && !Object.keys(S.orders).length && h0()!=="einstellungen") return renderImport();
  const h=h0();
  const keepFocus = document.activeElement && document.activeElement.id; const sel = keepFocus && document.activeElement.selectionStart;
  S.waqPage = h.startsWith("produkt-") || h.startsWith("serie-");
  try{ const nk=document.querySelector('#nav a[data-v="kunden"]'); if(nk){ const nd=Object.values(S.customers).filter(c=>dupesOf(c).length).length; nk.innerHTML=`Kunden${nd?` <span class="pill s-Warteliste" title="${nd} Kunden sehen nach Dublette aus (Name, etron-Nr., Telefon oder E-Mail)" style="font-size:11px;padding:0 6px">${nd}</span>`:""}`; } }catch(e){}
  if (h.startsWith("produkt-")) renderProduct(h.slice(8));
  else if (h.startsWith("kunde-")) renderCustomer(h.slice(6));
  else if (h.startsWith("serie-")) renderSeries(h.slice(6));
  else if (h==="kunden") renderCustomers();
  else if (h==="dubletten") renderDupes();
  else if (h==="export") renderExport();
  else if (h==="einstellungen") renderSettings();
  else if (h==="protokoll") renderLog();
  else renderProducts();
  if (keepFocus){ const el=document.getElementById(keepFocus); if(el){ el.focus({preventScroll:true}); try{ if(sel!=null) el.setSelectionRange(sel,sel);}catch(e){} } }
}

function renderImport(){
  app.innerHTML = `<div class="panel setup"><h1>Noch keine Daten</h1>
  <p class="sub">Die Datei <span class="mono">vorbestellungen.json</span> in der Dropbox ist leer. Du kannst eine Sicherung übernehmen (z. B. den JSON-Export der bisherigen App) oder direkt unter Produkte loslegen.</p>
  <div class="row"><label class="row"><input type="file" id="impf" accept=".json,application/json"></label><span id="impst" class="muted"></span></div>
  <div class="row"><button id="start">Ohne Daten starten</button>${S.provider?.kind==="local"?'<button id="demo">Beispieldaten laden</button>':""}</div></div>
  ${S.provider?.kind==="disk"?migratePanel():""}`;
  if (S.provider?.kind==="disk") bindMigrate();
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
// Abgeschlossen (Feld archived) = Zuteilung erledigt. Wieder geöffnet für Nachlieferung = Feld restock, deutlich markiert (Tommy, 25.11.).
const RESTOCK_PILL = `<span class="pill s-Warteliste" title="Wieder geöffnet: neue Einträge für eine zukünftige Nachlieferung">Wartend auf Nachlieferung</span>`;
function seriesRow({sib}){
  const st=sib.map(stats); const sum=k=>st.reduce((a,s)=>a+(s[k]||0),0); const flex=Math.max(...st.map(s=>s.flex||0));
  const rec=st.some(s=>s.rec!=null)?sum("rec"):null; const pre=sum("pre")+flex; const pct=rec&&pre?Math.min(100,Math.round(rec/pre*100)):0; const free=rec==null?null:rec-sum("alloc");
  return `<tr class="click" data-go="serie-${sib[0].id}"><td><a href="#serie-${sib[0].id}"><b>Serie ${esc(seriesOf(sib[0]))}</b></a> <span class="muted">${sib.map(x=>esc(x.name)).join(" + ")}</span>${sib.some(x=>x.restock)?" "+RESTOCK_PILL:""}${S.game==="Alle"?`<span class="gtag">${esc(gameOf(sib[0]))}</span>`:""}</td>
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
    ${ps.some(p=>p.restock)?`<div class="tile"><b>${ps.filter(p=>p.restock).length}</b><span>wartend auf Nachlieferung</span></div>`:""}
  </div>
  <div class="row"><input id="pq" class="search" placeholder="Produkt suchen, z. B. OP19" value="${esc(S.pq||"")}"><label class="row muted"><input type="checkbox" id="parch" ${showArch?"checked":""}> Abgeschlossene Zuteilungen zeigen</label></div>
  <div class="tablebox"><table><thead><tr><th>Produkt</th><th>Release</th><th class="n">Vorbestellt</th><th class="n">Bestellungen</th><th class="n">Wareneingang</th><th class="n">Zugeteilt</th><th>Deckung</th><th class="n">Frei</th></tr></thead><tbody>
  ${listRows(ps).map(p=>{ if(p.isSeries) return seriesRow(p); const s=stats(p);const pct=s.rec&&s.pre?Math.min(100,Math.round(s.rec/s.pre*100)):0;return `<tr class="click ${p.archived?"dim":""}" data-go="produkt-${p.id}">
    <td><a href="#produkt-${p.id}">${esc(p.name)}</a>${seriesOf(p)?` <a class="gtag" href="#serie-${p.id}">Serie ${esc(seriesOf(p))}</a>`:""}${S.game==="Alle"?`<span class="gtag">${esc(gameOf(p))}</span>`:""}${p.archived?' <span class="muted">(Zuteilung abgeschlossen)</span>':""}${p.restock&&!p.archived?" "+RESTOCK_PILL:""}</td><td>${esc(relTxt(p.release))}</td>
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
      ${etSearchHtml("np","")}<div class="wide muted" id="np-etsel"></div>
      <button class="pri" ${S.canWrite?"":"disabled"}>Anlegen</button>
    </form><p class="muted">Varianten (Decks, Artworks) als eigenes Produkt anlegen, z. B. „ST45 | Rot“. Dann zählt jede Variante getrennt. Mehrere Produkte in einer gemeinsamen Liste (z. B. zwei Sets am selben Release): erstes Produkt anlegen, dann auf seiner Seite „+ Weiteres Produkt in diese Liste“.</p></div>`;
  $("#pq").oninput = e => { S.pq=e.target.value; render(); };
  const sa=$("#showall"); if(sa) sa.onclick=()=>setGame("Alle");
  $("#parch").onchange = e => { S.parch=e.target.checked; renderProducts(); };
  app.querySelectorAll("tr[data-go]").forEach(tr=>tr.onclick=e=>{ if(e.target.tagName!=="A"&&e.target.tagName!=="INPUT") location.hash=tr.dataset.go; });
  let npEt=null; bindEtSearch("np", x=>{ npEt=x; const n=$("#np-name"); if(!n.value.trim()) n.value=x.name; $("#np-etsel").innerHTML=`<span class="ok">✓ etron-Artikel ${esc(String(x.id))}${x.code?", Art.-Nr. "+esc(x.code):""} wird verknüpft.</span>`; $("#np-etsr").innerHTML=""; });
  $("#np").onsubmit = async e => { e.preventDefault(); const name=$("#np-name").value.trim(); if(!name) return;
    if (Object.values(S.products).some(p=>p.name.toLowerCase()===name.toLowerCase())) return toast("Dieses Produkt gibt es schon.");
    const id = "p-"+name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,50)+"-"+Date.now().toString(36).slice(-4);
    if (await write("products",id,{name,group:name.split("|")[0].trim(),variant:(name.split("|")[1]||"").trim(),release:$("#np-rel").value.trim(),unit:$("#np-unit").value.trim(),game:$("#np-game").value,...(npEt?{etronArtId:String(npEt.id),...(npEt.code?{articleNo:npEt.code}:{})}:{}),received:null,supplierOrdered:null,supplierConfirmed:null,archived:false},"set")) { toast("Produkt angelegt"); location.hash="produkt-"+id; } };
}

// etron-Artikelsuche (Name, Referenz, Barcode): Treffer anklicken -> onPick({id,code,name})
function etSearchHtml(k, q, linked){ if(!etronOn()) return ""; return `<div class="${k==="np"?"wide":"panel"}" id="${k}-etbox">${k==="np"?"":`<h2>etron-Artikel${linked?` <span class="ok" style="font-size:.8em">✓ verknüpft (ID ${esc(String(linked))})</span>`:""}</h2>`}
  <div class="row" style="gap:6px"><input id="${k}-etq" value="${esc(q||"")}" placeholder="In etron suchen: Name oder Nummer, z. B. OP-18" style="flex:1"><button type="button" id="${k}-ets" class="sm">Artikel in etron suchen</button></div><div id="${k}-etsr" class="muted"></div></div>`; }
function bindEtSearch(k, onPick){ const ets=$("#"+k+"-ets"); if(!ets) return; const q0=$("#"+k+"-etq");
  q0.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); ets.click(); } };
  ets.onclick=async()=>{ const out=$("#"+k+"-etsr"), q=q0.value.trim(); if(q.length<2) return toast("Bitte mindestens 2 Zeichen eingeben."); out.innerHTML="… suche"; ets.disabled=true;
    try{ const it=(await etronCall("product_search",{q})).items||[];
      out.innerHTML=it.length?`<p>Bitte den passenden Artikel anklicken:</p><div class="tablebox"><table><thead><tr><th>Artikel in etron</th><th>Interne Referenz</th><th>Barcode</th><th>ID</th><th></th></tr></thead><tbody>${it.map((x,n)=>`<tr${x.active?"":' class="dim"'}><td>${esc(x.name)}${x.active?"":" (archiviert)"}</td><td class="mono">${esc(x.code||"–")}</td><td class="mono">${esc(x.barcode||"–")}</td><td class="mono">${esc(String(x.id))}</td><td><button type="button" class="sm pri" data-etpick="${n}">Übernehmen</button></td></tr>`).join("")}</tbody></table></div>`:`<p class="bad">Kein Artikel gefunden. Anderen Suchbegriff probieren, z. B. nur „OP-18“ oder „OP18“. Wenn gar nichts gefunden wird: unter Einstellungen „Verbindung testen“ zeigt, ob der Zugang Artikel lesen darf.</p>`;
      out.querySelectorAll("[data-etpick]").forEach(b=>b.onclick=()=>onPick(it[+b.dataset.etpick])); }
    catch(e){ out.innerHTML=`<p class="bad">✗ ${esc(e.message||e)}</p>`; } ets.disabled=false; }; }

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
  const sugSum = sug ? Object.entries(sug.map).reduce((a,[id,v])=>a+v-(sug.nach?(S.orders[id]?.productId?(S.orders[id].alloc||0):0):0),0) : 0;
  const nFree = nachFree(p), nCand = nFree>0 ? nachCands(p).length + flexOf(pid).filter(o=>o.status==="Offen"&&(o.qty||0)>0).length : 0;
  const closed = ordersOf(pid).some(o=>o.status==="Zugeteilt"||LOCKED.has(o.status));
  app.innerHTML = `
  <a class="back" href="#produkte">← Produkte</a>
  <div class="row spread"><div><h1>${esc(p.name)}</h1><p class="sub"><a class="back" href="#protokoll" data-logq="${esc(p.name)}">Verlauf</a>${/^https?:\/\//.test(p.etronUrl||"")?` · <a class="back" href="${esc(p.etronUrl)}" target="_blank" rel="noopener">In etron öffnen</a>`:""} · ${p.articleNo?"Art.-Nr. "+esc(p.articleNo)+" · ":""}${esc(gameOf(p))} · Release ${esc(relTxt(p.release))}${p.unit?" · Einheit "+esc(p.unit):""}${siblings(p).length>1?` · <a class="back" href="#serie-${p.id}">Ganze Serie „${esc(seriesOf(p))}“ zuteilen →</a>`:""}</p></div>
   <div class="row">${addVarBtn()}${p.archived?`<button class="sm" id="arch" title="Für neue Einträge wieder öffnen. Das Produkt ist dann als „Wartend auf Nachlieferung“ markiert.">Für Nachlieferung wieder öffnen</button>`:`<button class="sm" id="arch" title="Zuteilung ist erledigt: Produkt aus der Liste nehmen (mit „Abgeschlossene Zuteilungen zeigen“ weiter sichtbar)">Zu „Abgeschlossene Zuteilungen“</button>`}<button class="sm danger" id="del">Löschen</button><span id="delc"></span></div></div>
  <div id="addvbox"></div>
  ${etSearchHtml("pd",(p.group||p.name||"").split("|")[0].trim(),p.etronArtId)}
  ${p.archived?`<div class="note">Die Zuteilung für dieses Produkt ist abgeschlossen. Es erscheint nur mit „Abgeschlossene Zuteilungen zeigen“ in der Produktliste. Für neue Einträge oben „Für Nachlieferung wieder öffnen“.</div>`:p.restock?`<div class="note warn">${RESTOCK_PILL} Dieses Produkt wurde für eine zukünftige Nachlieferung wieder geöffnet. Neue Einträge sind möglich. Wenn die Nachlieferung zugeteilt ist, oben „Zu Abgeschlossene Zuteilungen“ klicken.</div>`:""}
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
      <label>etron-Artikel-ID <span class="muted">(optional, hat Vorrang)</span><input id="pd-etronArtId" value="${esc(p.etronArtId||"")}" placeholder="z. B. 47411"></label>
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
      <select id="mode"><option value="prop">Proportional (fair verteilt)</option><option value="fifo" ${S.mode==="fifo"?"selected":""}>Nach Bestelldatum (wer zuerst kommt)</option></select><label class="row muted" style="gap:4px" title="Zuerst bekommt jeder Kunde 1 Stück (nach Bestelldatum, falls nicht genug für alle da ist), der Rest wird wie gewählt verteilt."><input type="checkbox" id="min1" ${S.min1?"checked":""}> Jeder mind. 1 Stück</label>
      <button id="sug" ${s.rec==null?"disabled":""}>Vorschlag berechnen</button>
      ${sug?`<button class="pri" id="apply" ${S.canWrite?"":"disabled"}>${sug.nach?`Nachzuteilung übernehmen (+${sugSum} Stück)`:`Vorschlag übernehmen (${sugSum} Stück)`}</button><button id="dis">Verwerfen</button>`:""}
      <button id="close" ${s.alloc?"":"disabled"} title="Alle offenen Bestellungen mit Zuteilung auf Zugeteilt setzen">Zuteilung abschließen</button>
      <button id="rest" title="Alle offenen Bestellungen ohne Zuteilung auf Warteliste setzen">Rest auf Warteliste</button>
    </div></div>
    ${!sug&&closed&&nFree>0&&!nCand?`<div class="note">Es sind ${nFree} Stück frei, aber keine Bestellung wartet noch auf Ware (alle haben ihre bestellte Menge oder sind storniert). Wer wieder Interesse hat: Status auf „Warteliste“ oder „Offen“ setzen, dann erscheint hier „Freie Menge nachzuteilen“.</div>`:""}
    ${sug?.nach&&Object.keys(sug.map).some(id=>LOCKED.has(S.orders[id]?.status)&&sug.map[id]>(S.orders[id].alloc||0))?`<div class="note">Einige Bestellungen mit mehr Stück haben schon einen etron-Auftrag. Ihr Status bleibt, im Kommentar steht dann „Menge im etron-Auftrag anpassen“. Das bitte in etron von Hand ändern.</div>`:""}
    ${!sug&&closed&&nFree>0&&nCand?`<div class="note">Es sind wieder <b>${nFree} Stück frei</b> (z. B. durch Storno oder Nachlieferung) und ${nCand} Bestellungen haben noch nicht alles bekommen. <button class="pri sm" id="nach">Freie Menge nachzuteilen</button><br><span class="muted">Bestehende Zuteilungen bleiben. Verteilt wird wie oben gewählt (proportional oder nach Bestelldatum, „mind. 1 Stück“ zählt mit). „Auftrag angelegt“ und „Abgeholt“ bleiben unverändert.</span></div>`:""}
    ${s.rec==null?'<p class="muted">Erst den Wareneingang eintragen, dann kann ein Vorschlag berechnet werden.</p>':sug?.nach?'<p class="muted">Nachzuteilung steht in der Spalte „Vorschlag“ (neue Gesamtmenge, in Klammern das Plus). Noch nichts gespeichert. Beim Übernehmen bekommen diese Bestellungen den Status „Zugeteilt“ und die Abholnachricht gilt wieder als offen.</p>':sug?'<p class="muted">Vorschlag steht in der Spalte „Vorschlag“. Noch nichts gespeichert.</p>':'<p class="muted">Zuteilungen können auch direkt in der Tabelle eingetragen werden. Bestellungen mit Status „Auftrag angelegt“ oder „Abgeholt“ bleiben beim Vorschlag unverändert.</p>'}
  </div>
  ${orderForm("pr", pid)}
  <div class="row spread"><h2>Bestellungen (${shown.length})</h2>
    <span class="row" style="gap:6px">${waBtn(waGroups(os.filter(o=>nameMatch(S.oq, S.customers[o.customerId])).map(o=>[o])))}${oqInput()}${sortSel()}<select id="fstat">${["aktiv","alle",...STATUSES,MSG_OPEN].map(x=>`<option value="${x}" ${x===fstat?"selected":""}>${x==="aktiv"?"aktiv (offen, Warteliste, Nachricht offen)":x}</option>`).join("")}</select>${typeSel(fstat)}</span></div>
  <div id="waq-box">${waqHtml()}</div>
  <div class="tablebox"><table><thead><tr><th>Kunde</th><th class="n">Menge</th><th>Bestellt am</th><th>MA</th><th>Status</th><th class="n">Zuteilung</th>${sug?'<th class="n">Vorschlag</th>':""}<th>Auftrag</th><th>Nachricht</th><th>Kommentar</th></tr></thead><tbody>
  ${shown.map(o=>{const c=S.customers[o.customerId];const d=c?dupesOf(c):[];return `<tr data-o="${o.id}" class="${o.status==="Storniert"?"dim":""}">
    <td>${custFlags(c)}<a href="#kunde-${o.customerId}">${esc(c?.name||"?")}</a>${!o.productId?` <span class="pill s-Offen" title="${esc(orderLabel(o))}">egal welches</span>`:o.pairId?` <span class="gtag">Teil von „beide“</span>`:""}${d.length?` <span class="pill s-Warteliste" title="Ähnlich: ${esc(d.map(x=>x.name).join(", "))}">Dublette?</span>`:""}</td>
    <td class="n"><input type="number" min="0" data-f="qty" id="q-${o.id}" value="${o.qty??""}"></td>
    <td><input type="date" data-f="date" id="d-${o.id}" value="${esc(o.date||"")}"></td>
    <td class="mono">${esc(o.staff||"")}</td>
    <td><select data-f="status" id="s-${o.id}">${STATUSES.map(x=>`<option ${x===o.status?"selected":""}>${x}</option>`).join("")}</select></td>
    <td class="n"><input type="number" min="0" data-f="alloc" id="a-${o.id}" value="${o.alloc??""}"></td>
    ${sug?`<td class="n" style="font-weight:700;color:var(--accent)">${sug.map[o.id]??""}${sug.nach&&sug.map[o.id]!=null&&o.productId&&sug.map[o.id]>(o.alloc||0)?` <span class="muted">(+${sug.map[o.id]-(o.alloc||0)})</span>`:""}</td>`:""}
    <td style="text-align:center">${auftragBox([o])}</td><td>${msgBtn([o])}</td>
    <td><input class="c" data-f="comment" id="k-${o.id}" value="${esc(o.comment||"")}"></td></tr>`}).join("") || `<tr><td colspan="8" class="empty">Noch keine Bestellungen. Unten die erste erfassen.</td></tr>`}
  </tbody></table></div>`;
  // product fields
  $("#pd-game").onchange=e=>write("products",pid,{game:e.target.value}).then(ok=>ok&&toast("Gespeichert"));
  ["name","msgName","articleNo","etronArtId","etronUrl","release","series","unit","packSize","supplierOrdered","supplierConfirmed","received"].forEach(f=>{ const el=$("#pd-"+f); el.onchange=()=>{ const v=el.type==="number"?num(el.value):el.value.trim(); if(f==="packSize"&&v!=null&&!(v>=1&&Number.isInteger(v))){ el.value=p.packSize??""; return toast("Bitte eine ganze Zahl ab 1 eintragen."); } if(f==="name"&&!v){ el.value=p.name; return toast("Produktname darf nicht leer sein."); } if(f==="etronArtId"&&v&&!artIdOf(v)){ el.value=p.etronArtId||""; return toast("Bitte nur die Zahl eintragen, z. B. 47411."); } if(f==="etronUrl"&&v&&!/^https?:\/\//.test(v)) return toast("Bitte die vollständige Adresse mit https:// einfügen."); write("products",pid,{[f]:v}).then(ok=>ok&&toast("Gespeichert")); }; });
  bindEtSearch("pd", async x=>{ const patch={etronArtId:String(x.id)}; if(x.code) patch.articleNo=x.code; if(await write("products",pid,patch)) toast(`Übernommen: etron-Artikel ${x.id}${x.code?", Art.-Nr. "+x.code:""}`,5000); });
  if(p.packSize) ["supplierOrdered","supplierConfirmed","received"].forEach(f=>{ const el=$("#ve-"+f); el.onchange=()=>{ const v=num(el.value); write("products",pid,{[f]:v==null?null:v*p.packSize}).then(ok=>ok&&toast(v==null?"Gespeichert":`Gespeichert: ${v*p.packSize} Stück`)); }; });
  bindAddVar(p);
  $("#arch").onclick=()=>write("products",pid,p.archived?{archived:false,restock:true}:{archived:true,restock:false}).then(ok=>ok&&toast(p.archived?"Wieder geöffnet: wartend auf Nachlieferung":"Zuteilung abgeschlossen"));
  $("#del").onclick=()=>{ const own=ordersOf(pid), fl=flexOf(pid);
    $("#delc").innerHTML=` <button class="sm danger" id="delok">Ja: Produkt und ${own.length} Bestellungen endgültig löschen</button>`;
    $("#delok").onclick=()=>{ const t=now(); S.doc.update(o=>{ o.products[pid]={deleted:true,updatedAt:t};
        for(const x of own) o.orders[x.id]={deleted:true,updatedAt:t};
        for(const x of fl){ const ch=(o.orders[x.id].choices||[]).filter(c=>c!==pid); o.orders[x.id]= ch.length>1 ? {...o.orders[x.id],choices:ch,_ft:undefined,updatedAt:t} : ch.length===1 ? {...o.orders[x.id],choices:undefined,_ft:undefined,productId:ch[0],updatedAt:t} : {deleted:true,updatedAt:t}; } });
      toast("Produkt gelöscht"); location.hash="produkte"; }; };
  $("#fstat").onchange=e=>{S.fstat=e.target.value;render();}; bindTypeSel(); bindOq(); bindSort(); bindWaq();
  const reSug=()=>{ const m=$("#mode").value; S.sugg[pid]=S.sugg[pid].nach?{map:suggestRest(p,m),nach:true}:{map:suggest(p,m)}; };
  $("#mode").onchange=e=>{S.mode=e.target.value; if(S.sugg[pid]){reSug();render();}};
  $("#min1").onchange=e=>{S.min1=e.target.checked; try{localStorage.setItem("vb.min1",S.min1?"1":"");}catch(x){} if(S.sugg[pid]) reSug(); render();};
  const nb=$("#nach"); if(nb) nb.onclick=()=>{ S.sugg[pid]={map:suggestRest(p,$("#mode").value),nach:true}; dlog("INFO",`Nachzuteilung berechnet: ${nFree} frei`); render(); };
  $("#sug").onclick=()=>{ S.sugg[pid]={map:suggest(p,$("#mode").value)}; render(); };
  if (sug){ $("#dis").onclick=()=>{delete S.sugg[pid];render();};
    $("#apply").onclick=async()=>{ const b=$("#apply"); b.disabled=true; const ch=Object.entries(sug.map).filter(([id,v])=>S.orders[id] && (S.orders[id].alloc!==v || !S.orders[id].productId) && !(!S.orders[id].productId && !v));
      // Nachzuteilung: wer mehr bekommt, steht danach auf „Zugeteilt“; eine schon gesendete Abholnachricht gilt wieder als offen (neue Stückzahl).
      const patchOf=(id,v)=>{ const o=S.orders[id]; const pt=o.productId?{alloc:v}:{alloc:v,productId:pid,comment:[o.comment,`war: ${orderLabel(o)}`].filter(Boolean).join(" · ")};
        const plus=v-(o.productId?(o.alloc||0):0);
        if(sug.nach&&plus>0){ if(LOCKED.has(o.status)) pt.comment=[o.comment,`+${plus} nachzugeteilt am ${fmtDate(today())}: Menge im etron-Auftrag${o.etronOrder?" "+o.etronOrder:""} anpassen`].filter(Boolean).join(" · "); else pt.status="Zugeteilt"; if(o.notified) pt.notified=null; } return pt; };
      try{ await pool(ch, ([id,v])=>S.db.collection("orders").doc(id).update(patchOf(id,v))); delete S.sugg[pid]; if(sug.nach) dlog("INFO",`Nachzuteilung übernommen: ${ch.length} Bestellungen`); toast(sug.nach?`${ch.length} Bestellungen nachzugeteilt (Status Zugeteilt). Abholnachrichten sind offen.`:`${ch.length} Zuteilungen gespeichert`,5000); render(); }catch(e){ toast("Nicht alles gespeichert: "+(e.message||e.code)); b.disabled=false; } }; }
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
  { id: "t-abholbereit", name: "Abholbereit", text: "Hallo {Vorname},\nDeine Vorbestellung von {Stück}x {Spiel} {Produkt} ist angekommen.\nDu kannst sie ab {Tag} im Shop abholen.\n\nLiebe Grüße\nHive Games\n{Mitarbeiter}" },
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
// Eine noch nicht gesendete Nachricht (Abholung/Storno/Warteliste) ist eine offene Aufgabe und zählt deshalb auch als aktiv (Tommy, 25.11.).
const isActive = (o, sug) => o.status==="Offen" || o.status==="Warteliste" || (!!sug && o.status==="Zugeteilt") || msgOpen([o]);
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
  let wa1 = ""; if(S.waqPage && q && msgOpenType(os)){ const c=S.customers[os[0].customerId], cp=contactParts(c); const ids=os.map(o=>o.id).join(",");
    wa1 = cp.wa&&!c?.noWhatsapp ? `<a class="btn sm" data-wa1="${ids}" href="${esc(waLink(cp.wa,fillTemplate(q.text,os,today())))}" ${waTarget()} title="WhatsApp mit fertigem Text öffnen (${esc(q.name)})">📱</a>` : `<button class="sm" data-wa1="${ids}" title="WhatsApp nur für diesen Kunden: keine Nummer oder kein WhatsApp, Text kopieren">📱</button>`; }
  return `<span class="row" style="gap:4px;flex-wrap:wrap;min-width:0">${wa1}${q?`<button class="sm" data-copy="${os.map(o=>o.id).join(",")}" title="Text „${esc(q.name)}“ mit heutigem Datum kopieren und als gesendet markieren">📋 ${esc(QUICK[q.id]||q.name)}</button>`:""}<button class="sm ${msgClass(n, os)}" data-msg="${os.map(o=>o.id).join(",")}" title="${n?`Zuletzt: ${esc(n.template)} am ${fmtDate(n.date)} (${esc(n.staff||"")})`:"Noch keine Nachricht gesendet"}">${n?"✓ ":""}Nachricht</button>${S.customers[os[0].customerId]?.noWhatsapp?`<span class="pill" style="background:var(--grey-soft)" title="Kunde hat kein WhatsApp: per SMS schicken">SMS</span>`:""}</span>`; }
const firstName = n => (n||"").trim().split(/\s+/)[0] || "";
const WEEKDAYS=["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
const fmtTag = d => d ? WEEKDAYS[new Date(d+"T12:00:00").getDay()]+", "+fmtDate(d) : "";
const spielOf = os => [...new Set(os.map(o=>gameOf(S.products[o.productId||(o.choices||[])[0]])))].join(" und ");
function fillTemplate(text, os, tag){
  const o=os[0], c=S.customers[o.customerId]||{}; const np=nameParts(c);
  const mn=id=>{ const p=S.products[id]; return p?(p.msgName||p.name):"?"; };
  const prod=os.map(x=>x.productId?mn(x.productId):(x.choices||[]).map(mn).join(" oder ")).join(" und ");
  const menge=os.map(x=>x.alloc||x.qty||"").filter(Boolean).join(" + ");
  // {Bestellt}: bestellte Menge. {Teillieferung}: nur wenn weniger zugeteilt als bestellt ein fertiger Satz, sonst leer (Tommy, 25.11.).
  const bestellt=os.map(x=>x.qty||"").filter(Boolean).join(" + ");
  const part=os.filter(x=>(x.alloc||0)>0&&(x.qty||0)>(x.alloc||0));
  const teil=part.length?`Leider konnten wir ${part.length===1?`nur ${part[0].alloc} von ${part[0].qty} bestellten Stück`:"nicht alle bestellten Stück"} für dich reservieren.`:"";
  const map={ Bestellt: String(bestellt), Teillieferung: teil, Vorname: np.first, Nachname: np.last, Name: c.name||"", Produkt: prod, Menge: String(menge), "Stück": String(os.map(x=>x.alloc||x.qty||"").filter(Boolean).join(" + ")), Stueck: String(menge), Mitarbeiter: staffName(), Datum: fmtDate(today()), Spiel: spielOf(os), Tag: fmtTag(tag||today()) };
  return text.replace(/\{([\wÄÖÜäöüß]+)\}/g, (m,k)=> k in map ? map[k] : m).replace(/[ \t]+\n/g,"\n").replace(/\n{3,}/g,"\n\n");
}
// Telefon/E-Mail einzeln bearbeiten; sonstiger Text im Kontaktfeld bleibt erhalten
function contactFields(c){ const t=c?.contact||""; const mail=(t.match(/[^\s·,;]+@[^\s·,;]+/)||[])[0]||""; const tel=((t.replace(mail,"").match(/\+?[\d][\d\s/()-]{5,}/)||[])[0]||"").trim();
  const rest=t.replace(mail,"").replace(tel,"").replace(/^[\s·,;]+|[\s·,;]+$/g,"").replace(/\s*[·,;]\s*[·,;]\s*/g," · ").trim(); return { tel, mail, rest }; }
const joinContact = (tel, mail, c) => [tel.trim(), mail.trim(), contactFields(c).rest].filter(Boolean).join(" · ");
function contactParts(c){ const t=c?.contact||""; const mail=(t.match(/[^\s·,;]+@[^\s·,;]+/)||[])[0]||"";
  let tel=(t.replace(mail,"").match(/\+?[\d][\d\s/()-]{5,}/)||[])[0]||""; tel=tel.replace(/[^\d+]/g,"");
  const wa = tel ? (tel.startsWith("+") ? tel.slice(1) : tel.startsWith("00") ? tel.slice(2) : tel.startsWith("0") ? "43"+tel.slice(1) : tel) : "";
  return { mail, tel, wa }; }
// ---------- WhatsApp nacheinander (halbautomatisch): die App öffnet WhatsApp mit fertigem Text, gesendet wird von Hand.
// Nichts geht über fremde Server: der Text steht nur im Link, den WhatsApp auf diesem PC öffnet.
const waGroups = list => list.filter(r=>r.length&&msgOpenType(r)&&quickTpl(r));
const waBtn = groups => groups.length?`<button class="sm" id="waq-go" data-wag="${esc(groups.map(r=>r.map(o=>o.id).join(",")).join(";"))}" title="Für alle mit offener Nachricht nacheinander WhatsApp mit dem fertigen Text öffnen">📱 WhatsApp nacheinander (${groups.length})</button>`:"";
// Womit WhatsApp geöffnet wird: Einstellung pro PC (Einstellungen → WhatsApp). Standard: WhatsApp-App am PC (Tommy, 25.11.).
const waMode = () => { try{ return localStorage.getItem("vb.wamode3")||"app"; }catch(e){ return "app"; } };
const setWaMode = v => { try{ localStorage.setItem("vb.wamode3", v==="web"?"web":"app"); }catch(e){} dlog("INFO","WhatsApp-Modus: "+v); };
const waTarget = () => waMode()==="web" ? 'target="_blank" rel="noopener"' : "";
// Einmalige Bereinigung (Tommy, 25.11.): importierte Bestellungen ohne „Bestellt am“ bekommen 01.11.2026, leeres Kürzel wird „TU“. Nichts Vorhandenes wird überschrieben.
const FIX_DATE="2026-11-01", FIX_STAFF="TU";
// Auch unlesbare Daten (z. B. „1.11.2026“ oder Excel-Zahlen aus dem Import), fehlendes Kürzel und fehlender Status werden erkannt.
const isoOk = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d||""));
const isoFix = d => { const t=String(d??"").trim(); if(!t) return FIX_DATE; let m;
  if(m=t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  if(m=t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/)) return `${m[3].length===2?"20"+m[3]:m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  if(/^\d{5}(\.\d+)?$/.test(t)){ const x=new Date(Date.UTC(1899,11,30)+Math.floor(+t)*864e5); return x.toISOString().slice(0,10); }
  return FIX_DATE; };
const fixNeed = o => !isoOk(o.date) || !String(o.staff||"").trim() || !STATUSES.includes(o.status);
const fixTargets = () => Object.entries(S.orders).filter(([id,o])=>o&&!o.deleted&&fixNeed(o));
function fixPanel(){ const t=fixTargets(); if(!t.length) return "";
  const nd=t.filter(([,o])=>!isoOk(o.date)).length, ns=t.filter(([,o])=>!String(o.staff||"").trim()).length, nt=t.filter(([,o])=>!STATUSES.includes(o.status)).length;
  return `<div class="panel"><h2>Unvollständige Bestellungen</h2><p>${t.length} Bestellungen sind unvollständig: ${[nd?`${nd} ohne gültiges „Bestellt am“`:"",ns?`${ns} ohne Mitarbeiter-Kürzel`:"",nt?`${nt} ohne Status`:""].filter(Boolean).join(", ")}.</p>
  <div class="row"><button id="fixd" ${S.canWrite?"":"disabled"}>Ergänzen</button><span id="fixc"></span></div>
  <p class="muted">Fehlendes Datum wird ${fmtDate(FIX_DATE)} (ein lesbares Datum wie „1.11.2026“ wird nur umgewandelt), fehlendes Kürzel ${FIX_STAFF}, fehlender Status „Offen“. Vorhandene Angaben bleiben unverändert.</p></div>`; }
function bindFix(){ const b=$("#fixd"); if(!b) return; b.onclick=()=>{ const t=fixTargets();
  $("#fixc").innerHTML=` <button class="sm danger" id="fixok">Ja, ${t.length} Bestellungen ändern</button>`;
  $("#fixok").onclick=()=>{ const ts=now(); let n=0; S.doc.update(d=>{ for(const [id] of t){ const o=d.orders[id]; if(!o||o.deleted||!fixNeed(o)) continue; if(!isoOk(o.date)) o.date=isoFix(o.date); if(!String(o.staff||"").trim()) o.staff=FIX_STAFF; if(!STATUSES.includes(o.status)) o.status="Offen"; o.updatedAt=ts; n++; } });
    dlog("INFO",`Bereinigung: ${n} unvollständige Bestellungen ergänzt`); toast(`${n} Bestellungen ergänzt`); render(); }; }; }
function waPanel(){ return `<div class="panel"><h2>WhatsApp</h2><p class="muted">Gilt für den 📱-Knopf und „WhatsApp nacheinander“ auf diesem PC.</p>
  <div class="row"><label class="row" style="gap:6px"><input type="radio" name="wamode" value="app" ${waMode()==="app"?"checked":""}> WhatsApp-App am PC</label><label class="row" style="gap:6px"><input type="radio" name="wamode" value="web" ${waMode()==="web"?"checked":""}> WhatsApp Web (Browser-Tab)</label></div>
  <p class="muted">Bei der App fragt Chrome beim ersten Mal „WhatsApp öffnen?“. Dort „Immer erlauben“ anhaken, dann geht sie künftig direkt auf.</p></div>`; }
// Web: immer derselbe Tab (Name "vb-whatsapp"), damit nicht für jeden Kunden ein neuer Tab aufgeht
const waWeb = (num, txt) => `https://web.whatsapp.com/send?phone=${num}&text=${encodeURIComponent(txt)}`;
// WhatsApp Web immer im selben Tab „vb-wa“ öffnen, damit nicht pro Kunde ein neuer Tab entsteht (Tommy, 25.11.).
// Klappt das nicht (Pop-up blockiert), läuft der Klick normal weiter über den Link (neuer Tab) mit Prüfung und Hinweis.
function waTab(e, url){ if(waMode()!=="web") return false; let w=null; try{ w=window.open(url,"vb-wa"); }catch(x){ dlog("WARN","WhatsApp-Tab: "+(x.message||x)); }
  if(!w){ dlog("WARN","WhatsApp-Tab blockiert, öffne als neuen Tab"); return false; } e.preventDefault(); try{ w.focus(); }catch(x){} dlog("INFO","WhatsApp Web im selben Tab geöffnet"); return true; }
const waLink = (num, txt) => waMode()==="web" ? waWeb(num,txt) : `whatsapp://send?phone=${num}&text=${encodeURIComponent(txt)}`;
function waqHtml(){ const q=S.waq; if(!q) return ""; const n=q.list.length;
  if(q.i>=n){ return `<div class="panel" id="waq"><div class="row spread"><h2>WhatsApp: fertig</h2><button class="sm" id="waq-x">Schließen</button></div>
    <p>${q.sent} Nachrichten erledigt und als gesendet markiert.${q.skipped.length?` Übersprungen (${q.skipped.length}): ${q.skipped.map(ids=>{ const o=S.orders[ids[0]]; const c=S.customers[o?.customerId]; return c?`<a href="#kunde-${o.customerId}">${esc(c.name)}</a>`:""; }).join(", ")}`:""}</p>
    <p class="muted">Bitte in WhatsApp kurz prüfen, ob alle wirklich gesendet sind. Eine nicht gesendete Nachricht kannst du beim Kunden über „Nachricht“ erneut schicken.</p></div>`; }
  const os=q.list[q.i].map(id=>S.orders[id]).filter(Boolean); const c=S.customers[os[0]?.customerId]||{}; const cp=contactParts(c); const t=os.length?quickTpl(os):null;
  const canWa=!!cp.wa&&!c.noWhatsapp&&!!t; if(q.txtI!==q.i||q.txtTag!==q.tag){ q.txt=t?fillTemplate(t.text,os,q.tag):""; q.txtI=q.i; q.txtTag=q.tag; } const txt=q.txt;
  const needTag=q.list.some(ids=>{ const l=ids.map(id=>S.orders[id]).filter(Boolean); return l.length&&autoTplId(l)==="t-abholbereit"; });
  return `<div class="panel" id="waq"><div class="row spread"><h2>${n>1?`WhatsApp nacheinander · ${q.i+1} von ${n}`:"WhatsApp an einen Kunden"}</h2><span class="row" style="gap:6px">
      ${needTag?`<label class="row muted" style="gap:4px">Abholung ab <input type="date" id="waq-tag" value="${esc(q.tag)}"></label>`:""}
      <select id="waq-mode" title="Womit WhatsApp geöffnet wird"><option value="web" ${waMode()==="web"?"selected":""}>WhatsApp Web (Browser-Tab)</option><option value="app" ${waMode()==="app"?"selected":""}>WhatsApp-App am PC</option></select>
      <button class="sm" id="waq-x">Beenden</button></span></div>
    <p><b><a href="#kunde-${os[0]?.customerId||""}">${esc(c.name||"?")}</a></b> <span class="muted">${esc(cp.tel||"keine Telefonnummer")} · Vorlage „${esc(t?.name||"-")}“</span></p>
    ${canWa?"":`<div class="note bad">${!t?"Für diesen Kunden ist keine Nachricht mehr offen.":!cp.wa?"Keine Telefonnummer hinterlegt.":"Bei diesem Kunden ist „kein WhatsApp“ eingetragen."} ${t?"Text kopieren und anders schicken, oder überspringen.":"Bitte überspringen."}</div>`}
    <textarea id="waq-t" rows="6" style="width:100%">${esc(txt)}</textarea>
    <div class="row">${canWa?`<a class="btn pri" id="waq-open" href="${esc(waLink(cp.wa,txt))}" ${waTarget()}>WhatsApp öffnen und weiter</a>`:t?`<button class="pri" id="waq-copy">Text kopieren, als gesendet markieren und weiter</button>`:""}
      <button id="waq-skip">Überspringen</button><span class="muted">In WhatsApp nur noch auf Senden drücken, dann hier weiter.</span></div>
    ${canWa?`<details class="muted"><summary>Geht nichts auf?</summary><p>1. <button type="button" class="sm" id="waq-win">Anders öffnen</button> 2. <button type="button" class="sm" id="waq-cpl">Link kopieren</button> und in einem Chrome-Tab in die Adresszeile einfügen. 3. Oder den Text oben kopieren und in WhatsApp selbst einfügen.</p><p class="mono" style="word-break:break-all;font-size:11px">${esc(waLink(cp.wa,txt).slice(0,160))}…</p></details>`:""}<div id="waq-fb">${waqFb(q,cp)}</div></div>`; }
// Hinweis nach dem Klick: steht in S.waq, damit er ein Neuzeichnen der Seite übersteht.
function waqFb(q,cp){ const u=q.txt!=null?q.txt:""; if(!q.fb) return "";
  if(q.fb==="opened") return `<div class="note">Geöffnet. Nach dem Senden: <button class="sm pri" id="waq-ok">Als gesendet markieren und weiter</button></div>`;
  if(q.fb==="blocked") return `<div class="note bad">Chrome hat das Fenster blockiert. Oben rechts in der Adresszeile auf das Symbol „Pop-up blockiert“ klicken und für diese Seite immer erlauben, dann nochmal „Anders öffnen“.</div>`;
  return `<div class="note bad">WhatsApp scheint sich nicht geöffnet zu haben${q.fbMode==="app"?" (die WhatsApp-App ist auf diesem PC vermutlich nicht installiert oder Chrome darf sie nicht öffnen)":" (vielleicht hat Chrome das neue Fenster blockiert: oben rechts in der Adresszeile erlauben)"}. Die Nachricht ist noch nicht als gesendet markiert. <a class="btn" id="waq-web" href="${esc(waWeb(cp.wa,u))}" target="_blank" rel="noopener">Mit WhatsApp Web öffnen</a> <button class="sm" id="waq-ok">Ist doch offen: als gesendet markieren und weiter</button></div>`; }
function drawWaq(){ const b=$("#waq-box"); if(!b) return; b.innerHTML=waqHtml(); bindWaq(); }
function bindWaq(){ const go=$("#waq-go"); if(go) go.onclick=()=>{ if(needStaff()) return; const list=go.dataset.wag.split(";").map(x=>x.split(",")).filter(r=>r[0]);
    S.waq={list,i:0,tag:today(),sent:0,skipped:[]}; dlog("INFO",`WhatsApp nacheinander gestartet: ${list.length} Nachrichten`); drawWaq(); $("#waq")?.scrollIntoView({block:"start",behavior:"smooth"}); };
  app.querySelectorAll("[data-wa1]").forEach(b=>b.onclick=e=>{ e.stopPropagation(); if(needStaff()){ e.preventDefault(); return; } S.waq={list:[b.dataset.wa1.split(",")],i:0,tag:today(),sent:0,skipped:[]};
    const direct=b.tagName==="A"; dlog("INFO",direct?`WhatsApp einzeln direkt geöffnet (${waMode()})`:"WhatsApp einzeln gestartet"); drawWaq(); if(direct){ if(waTab(e, b.href)) S.waq?.done?.(); else S.waq?.watch?.(); } else $("#waq")?.scrollIntoView({block:"start",behavior:"smooth"}); });
  const q=S.waq; if(!q||!$("#waq")) return;
  const x=$("#waq-x"); if(x) x.onclick=()=>{ dlog("INFO",`WhatsApp nacheinander beendet: ${q.sent} geöffnet, ${q.skipped.length} übersprungen`); S.waq=null; drawWaq(); };
  const tg=$("#waq-tag"); if(tg) tg.onchange=e=>{ q.tag=e.target.value||today(); drawWaq(); };
  const md=$("#waq-mode"); if(md) md.onchange=e=>{ setWaMode(e.target.value); render(); };
  if(q.i>=q.list.length) return;
  const os=q.list[q.i].map(id=>S.orders[id]).filter(Boolean), c=S.customers[os[0]?.customerId]||{}, cp=contactParts(c), t=os.length?quickTpl(os):null;
  const ta=$("#waq-t"), op=$("#waq-open"); if(ta) ta.oninput=()=>{ q.txt=ta.value; if(op) op.href=waLink(cp.wa,ta.value); };
  const next=()=>{ q.i++; q.fb=null; drawWaq(); if(q.i>=q.list.length) dlog("INFO",`WhatsApp nacheinander fertig: ${q.sent} geöffnet, ${q.skipped.length} übersprungen`); };
  const done=()=>{ q.sent++; markSent(os, t); next(); };
  // Prüfen, ob sich WhatsApp wirklich geöffnet hat (Fenster verliert den Fokus). Sonst nicht als gesendet markieren, sondern WhatsApp Web anbieten.
  const win=$("#waq-win"); if(win) win.onclick=()=>{ const u=waLink(cp.wa,ta?.value||""); let w=null; try{ w=window.open(u,waMode()==="web"?"vb-wa":"_blank"); }catch(e){ dlog("ERROR","WhatsApp window.open: "+(e.message||e)); }
    dlog(w?"INFO":"WARN",`WhatsApp anders öffnen (${waMode()}): ${w?"Fenster geöffnet":"vom Browser blockiert"}`);
    q.fb=w?"opened":"blocked"; drawWaq(); };
  const ok=$("#waq-ok"); if(ok) ok.onclick=done;
  const wb=$("#waq-web"); if(wb) wb.onclick=()=>{ dlog("INFO","WhatsApp Web über Hinweis geöffnet"); q.fb="opened"; setTimeout(drawWaq,300); };
  const cpl=$("#waq-cpl"); if(cpl) cpl.onclick=async()=>{ const ok=await copyText(waLink(cp.wa,ta?.value||"")); toast(ok?"Link kopiert: in einem Chrome-Tab in die Adresszeile einfügen":"Kopieren nicht möglich"); };
  // Nach dem Öffnen: hat sich WhatsApp wirklich geöffnet (Fenster verliert den Fokus)? Dann als gesendet markieren, sonst Hinweis zeigen.
  q.watch=()=>{ if(q.busy) return; q.busy=1; const i0=q.i; let left=false; const away=()=>{ left=true; };
    window.addEventListener("blur",away); document.addEventListener("visibilitychange",away);
    setTimeout(()=>{ window.removeEventListener("blur",away); document.removeEventListener("visibilitychange",away); q.busy=0;
      if(S.waq!==q||q.i!==i0) return; if(left) return done();
      dlog("WARN",`WhatsApp (${waMode()}) hat sich nicht geöffnet`);
      q.fb="notopen"; q.fbMode=waMode(); drawWaq(); }, 1500); };
  q.done=done;
  if(op) op.onclick=e=>{ dlog("INFO",`WhatsApp-Link geklickt (${waMode()})`); if(waTab(e, op.href)) return done(); q.watch(); };
  const cpb=$("#waq-copy"); if(cpb) cpb.onclick=async()=>{ if(!await copyText(ta.value)) return toast("Kopieren nicht möglich"); await markSent(os,t); q.sent++; toast("Kopiert und als gesendet markiert"); next(); };
  const sk=$("#waq-skip"); if(sk) sk.onclick=()=>{ q.skipped.push(q.list[q.i]); next(); }; }

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
      <button id="m-s">Als gesendet markieren</button>${os.some(o=>o.notified)?`<button id="m-un" title="Gesendet-Markierung entfernen, die Nachricht gilt dann wieder als offen">Als ungesendet markieren</button>`:""}<button id="m-x2">Schließen</button></div>
    ${(()=>{ const n=os.find(o=>o.notified)?.notified; return n?`<p class="muted">Zuletzt als gesendet markiert: „${esc(n.template||"")}“ am ${esc(fmtDate(n.date))}${n.staff?" von "+esc(n.staff):""}.</p>`:""; })()}
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
    const un=box.querySelector("#m-un"); if(un) un.onclick=async()=>{ if(needStaff()) return; un.disabled=true; try{ await pool(os.filter(o=>o.notified),o=>S.db.collection("orders").doc(o.id).update({notified:null})); toast("Wieder als ungesendet markiert"); box.remove(); }catch(e){ un.disabled=false; toast("Nicht gespeichert: "+(e.message||e)); } };
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
// Schritte und Fehler ins Log des Programms (logs\<PC>.log). Nur IDs, Artikelnummern, Anzahlen, keine Namen/Telefonnummern.
const redactTxt = t => String(t).replace(/[^\s"'<>,;:]+@[^\s"'<>,;:]+\.[A-Za-z]{2,}/g,"[E-Mail]").replace(/\+?\d[\d /().-]{6,}\d/g,"[Nummer]").replace(/[\r\n]+/g," ");
function dlog(level, msg){ msg=String(msg).slice(0,1500);
  if(S.desktop){ try{ desk("/api/clientlog",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({level,msg})}).catch(()=>{}); }catch(e){} return; }
  try{ const k="vb.dlog"; const a=JSON.parse(localStorage.getItem(k)||"[]"); const d=new Date(); a.push(`${d.toLocaleDateString("de-AT")} ${d.toLocaleTimeString("de-AT")}.${String(d.getMilliseconds()).padStart(3,"0")} ${level.padEnd(5)} ${redactTxt(msg)}`); if(a.length>3000) a.splice(0,a.length-3000); localStorage.setItem(k,JSON.stringify(a)); }catch(e){} }
// etron-Anfragen laufen über das Programm (Vorbestellungen.exe) direkt zu etron. Der Zugang liegt in etron-zugang.json im Dropbox-Ordner.
async function etronCall(action, data){
  if(!S.desktop) return etronWeb(action, data||{});
  const r=await desk("/api/etron",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,...(data||{})})});
  let j=null; try{ j=await r.json(); }catch(e){}
  if(!r.ok){ const x=new Error((j&&j.error)||("HTTP "+r.status)); x.http=r.status; x.etron=j&&j.status; throw x; } return j; }
const etronOn = () => !!(S.desktop || S.extOk);

// ---------- etron in der Web-Version: über die Chrome-Erweiterung „TCG Vorbestellungen – etron-Verbindung“ (Ordner erweiterung/)
// Die Erweiterung reicht nur Anfragen an https://<instanz>.wawi.onretail.eu/api/… weiter. Zugang (Adresse, Key, Secret) liegt in der Dropbox.
const ETRON_EXT_ID = "fcfmfmnppjflcimfmfeajncklmodkdel";
const ETRON_FILE = "etron-zugang.json";
function extSend(msg){ return new Promise((ok,no)=>{ const rt=globalThis.chrome?.runtime; const miss=()=>no(Object.assign(new Error("Die etron-Erweiterung ist in diesem Browser nicht installiert oder ausgeschaltet (siehe Einstellungen → etron-Schnittstelle)."),{noext:true}));
  if(!rt?.sendMessage) return miss(); try{ rt.sendMessage(ETRON_EXT_ID,msg,r=>{ if(rt.lastError||!r) return miss(); ok(r); }); }catch(e){ miss(); } }); }
async function extCheck(){ try{ const r=await extSend({type:"hello"}); S.extOk=r?.version||true; }catch(e){ S.extOk=false; } return S.extOk; }
const EW = { tok:null, until:0, cfg:null };
async function ewCfg(force){ if(EW.cfg&&!force) return EW.cfg; const r=await S.provider.read(ETRON_FILE); EW.cfg=r&&r.data&&r.data.key?{...r.data}:null; EW.rev=r?r.rev:null; return EW.cfg; }
const ewBase = c => { let u=String(c.url||"").trim().replace(/\/+$/,""); const i=u.indexOf("/api/"); if(i>0) u=u.slice(0,i); return u+"/api/v2"; };
async function ewFetch(url,opt){ const r=await extSend({type:"fetch",url,...opt}); if(r.error) throw new Error("etron nicht erreichbar: "+r.error); return r; }
function ewShape(t){ let v; try{ v=JSON.parse(t); }catch(e){ return `kein JSON (${String(t).length} Zeichen)`; } const f=(x,d)=>x===null?"null":Array.isArray(x)?`Liste(${x.length})${x.length&&d<2?" von "+f(x[0],d+1):""}`:typeof x==="object"?"{"+Object.keys(x).sort().map(k=>k==="id"?"id="+x[k]:k==="error"?"error="+redactTxt(JSON.stringify(x[k])).slice(0,200):k).join(", ")+"}":typeof x==="number"?"Zahl "+x:typeof x==="string"?`Text(${x.length})`:String(x); return f(v,0); }
async function ewToken(c,force){ if(!force&&EW.tok&&Date.now()<EW.until) return EW.tok;
  const r=await ewFetch(ewBase(c)+"/authentication/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+btoa(c.key+":"+c.secret),"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
  dlog("INFO",`ETRON Anmeldung -> HTTP ${r.status}`);
  if(r.status!==200) throw Object.assign(new Error(`etron-Anmeldung abgelehnt (HTTP ${r.status}): ${r.text.slice(0,200)}`),{etron:r.status});
  const j=JSON.parse(r.text); if(!j.access_token) throw new Error("etron-Anmeldung: unerwartete Antwort"); EW.tok=j.access_token; EW.until=Date.now()+Math.max(60,(j.expires_in||3600)-60)*1000; return EW.tok; }
const ewQuery = p => p ? "?"+Object.keys(p).sort().map(k=>k+"="+encodeURIComponent(typeof p[k]==="string"?p[k]:JSON.stringify(p[k]))).join("&") : "";
async function ewCall(c,method,path,params,body){
  for(let a=0;a<2;a++){ const t=await ewToken(c,a>0); const t0=Date.now();
    const r=await ewFetch(ewBase(c)+path+ewQuery(params),{method,headers:{Authorization:"Bearer "+t,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
    dlog("INFO",`ETRON ${method} ${path}${path.includes("product.")&&params?.domain?" Suche "+JSON.stringify(params.domain):""} -> HTTP ${r.status}, ${Date.now()-t0} ms, Antwort: ${ewShape(r.text)}`);
    if(r.status===401&&a===0) continue;
    if(r.status>=300){ dlog("WARN","ETRON Fehlertext: "+r.text.slice(0,600)); throw Object.assign(new Error(ewNice(r.status,r.text)),{etron:r.status}); }
    try{ return JSON.parse(r.text); }catch(e){ return r.text; } }
  throw new Error("etron: Anmeldung abgelaufen"); }
// etron-Fehler verständlich machen (Rechte-Fehler aus Odoo)
function ewNice(st, txt){ let m=""; try{ const j=JSON.parse(txt); m=String((j.arguments&&j.arguments[0])||j.message||j.error?.message||j.error||""); }catch(e){} if(!m) m=String(txt||"");
  const ar=m.match(/keinen Zugriff auf Datensätze\s*„([^“]+)“\s*\(([^)]+)\)/)||m.match(/not allowed to access '([^']+)' \(([^)]+)\)/i);
  if(ar) return `etron verweigert den Zugriff auf „${ar[1]}“ (${ar[2]}). Der Benutzer hinter dem API-Zugang hat dafür zu wenig Rechte. In etron unter Einstellungen → Benutzer diesen Benutzer öffnen: Benutzertyp „Interner Benutzer“ und bei Verkauf mindestens „Benutzer: Nur eigene Dokumente“ setzen. Danach erneut versuchen.`;
  return `etron HTTP ${st}: ${m.replace(/\s+/g," ").slice(0,300)}`; }
const ewList = v => Array.isArray(v)?v:(v&&(v.data||v.result||v.records))||[];
const ewStr = (v,n=120) => String(v??"").trim().slice(0,n);
const EW_PARTNER_FIELDS = ["id","name","firstname","lastname","ref","phone","mobile","email","type","parent_id","is_company"];
const EW_ACTIONS = {
  async ping(c){ await ewToken(c,true); const r=await ewCall(c,"GET","/search_extract/res.partner",{fields:["id"],limit:1});
    let prod=null, perr=""; try{ prod=ewList(await ewCall(c,"GET","/search_read/product.product",{domain:[],fields:["id"],limit:5})).length; }catch(e){ perr=String(e.message||e).slice(0,200); }
    let diag=""; if(prod===0){ const tries=[["Leserecht Artikel","/access/rights/product.product/read"],["Leserecht Artikel","/access/product.product/read"],["Anzahl Artikel","/search_count/product.product"]];
      const parts=[]; for(const [lbl,pth] of tries){ try{ const v=await ewCall(c,"GET",pth,pth.includes("search_count")?{domain:[]}:null); parts.push(`${lbl}: ${typeof v==="object"?ewShape(JSON.stringify(v)):ewStr(v,40)}`); if(lbl.startsWith("Leserecht")) tries.splice(1,1); }catch(e){ if(e.etron!==404) parts.push(`${lbl}: ${ewStr(e.message,80)}`); } }
      try{ const u=await ewCall(c,"GET","/user"); const uu=Array.isArray(u)?u[0]:u; if(uu&&typeof uu==="object") parts.push(`API-Benutzer: ${ewStr(uu.login||uu.name||uu.id,60)}${uu.company_id?", Firma "+ewStr(Array.isArray(uu.company_id)?uu.company_id[1]:uu.company_id,60):""}`); }catch(e){}
      diag=parts.join(" · "); dlog("INFO","Diagnose Artikel: "+diag); }
    return {ok:true,read:ewList(r).length,prod,perr,diag}; },
  async partner_search(c,b){ const q=ewStr(b.q,60); if(q.length<2) return {items:[]};
    const domain=/^\d+$/.test(q)?["|","|","|",["id","=",+q],["ref","=",q],["phone","ilike",q],["mobile","ilike",q]]:["|","|","|","|",["name","ilike",q],["email","ilike",q],["phone","ilike",q],["mobile","ilike",q],["ref","=ilike",q]];
    return {items:ewList(await ewCall(c,"GET","/search_extract/res.partner",{domain,fields:EW_PARTNER_FIELDS,limit:15,order:"name"}))}; },
  async partner_create(c,b){ const firstname=ewStr(b.firstname), lastname=ewStr(b.lastname); if(!firstname||!lastname) throw new Error("Vor- und Nachname fehlen");
    if(!ewStr(b.phone)&&!ewStr(b.email)) throw new Error("Telefon oder E-Mail ist Pflicht");
    const values={firstname,lastname,type:"contact",customer_rank:1}; if(ewStr(b.phone)) values.phone=ewStr(b.phone,40); /* ins Feld „Telefon“: „Mobil“ sieht man in der etron-Übersicht nicht (Tommy, 25.11.) */ if(ewStr(b.email)) values.email=ewStr(b.email);
    const cc=ewStr(b.country||"AT",2).toUpperCase(); if(/^[A-Z]{2}$/.test(cc)){ const cs=ewList(await ewCall(c,"GET","/search_read/res.country",{domain:[["code","=",cc]],fields:["id","code"],limit:1})); if(cs[0]?.id) values.country_id=cs[0].id; else throw new Error(`Land ${cc} in etron nicht gefunden`); }
    return {result:await ewCall(c,"POST","/create/res.partner",null,{values})}; },
  async product_find(c,b){ const codes=(b.codes||[]).map(x=>ewStr(x,60)).filter(Boolean).slice(0,50); if(!codes.length) return {items:[]};
    const F=["id","default_code","barcode","name","active"], norm=x=>String(x||"").trim().toUpperCase();
    const items=ewList(await ewCall(c,"GET","/search_read/product.product",{domain:[["default_code","in",codes]],fields:F})); const have=new Set(items.map(p=>norm(p.default_code))); const near={};
    // nicht gefunden: auch archivierte Artikel, ohne Groß/Klein, Barcode und Teiltreffer
    for(const code of codes.filter(x=>!have.has(norm(x)))){
      const hits=ewList(await ewCall(c,"GET","/search_read/product.product",{domain:["&",["active","in",[true,false]],"|","|",["default_code","=ilike",code],["barcode","=",code],["default_code","ilike",code]],fields:F,limit:10}));
      const exact=hits.filter(p=>norm(p.default_code)===norm(code)||norm(p.barcode)===norm(code));
      if(exact.length===1){ items.push({...exact[0],default_code:code}); } else near[code]=hits.map(p=>({id:p.id,code:p.default_code||"",barcode:p.barcode||"",name:ewStr(p.name,80),active:p.active!==false}));
      dlog("INFO",`Artikelsuche erweitert ${code}: ${hits.length} Treffer${hits.length?" ("+hits.map(p=>(p.default_code||"-")+"/"+(p.barcode||"-")+(p.active===false?" archiviert":"")+"→"+p.id).join(", ")+")":""}`); }
    return {items,near}; },
  // Artikel über die interne ID: zuerst als Artikel (product.product), sonst als Produktvorlage (product.template)
  async product_search(c,b){ const q=ewStr(b.q,60); if(q.length<2) return {items:[]};
    const r=ewList(await ewCall(c,"GET","/search_read/product.product",{domain:["&",["active","in",[true,false]],"|","|",["name","ilike",q],["default_code","ilike",q],["barcode","ilike",q]],fields:["id","default_code","barcode","name","active"],limit:25}));
    dlog("INFO",`Artikelsuche nach Name/Nummer: ${r.length} Treffer`); return {items:r.map(p=>({id:p.id,code:p.default_code||"",barcode:p.barcode||"",name:ewStr(p.name,120),active:p.active!==false}))}; },
  async product_by_id(c,b){ const n=parseInt(b.id,10); if(!(n>0)) throw new Error("ungültige etron-Artikel-ID"); const F=["id","default_code","name","active"];
    const hits=ewList(await ewCall(c,"GET","/search_read/product.product",{domain:["&",["active","in",[true,false]],["id","=",n]],fields:F,limit:2}));
    const p=hits.find(x=>x.id===n); dlog("INFO",`Artikel-ID ${n}: ${p?(p.default_code||"ohne Nr.")+(p.active===false?" archiviert":""):"nicht gefunden"}`);
    if(!p) throw new Error(`etron-Artikel-ID ${n} gibt es in etron nicht. Bitte oben auf der Produktseite mit „Artikel in etron suchen“ den Artikel neu übernehmen.`);
    const code=String(b.code||"").trim().toUpperCase(), pc=String(p.default_code||"").trim().toUpperCase();
    if(code&&pc&&code!==pc) throw new Error(`etron-Artikel-ID ${n} ist „${ewStr(p.name,60)}“ (Art.-Nr. ${p.default_code}), beim Produkt steht aber Art.-Nr. ${b.code}. Sicherheitshalber kein Auftrag. Bitte oben auf der Produktseite den richtigen Artikel neu übernehmen.`);
    return {id:p.id,default_code:p.default_code||"",name:ewStr(p.name,80),active:p.active!==false}; },
  async order_confirm(c,b){ const id=parseInt(b.id,10); if(!id) throw new Error("Auftragsnummer fehlt"); await ewCall(c,"POST","/call/sale.order/action_confirm",null,{ids:[id],args:[],kwargs:{}}); return {ok:true}; },
  async order_lines_find(c,b){ const partner=parseInt(b.partner_id,10), ids=(b.product_ids||[]).map(x=>parseInt(x,10)).filter(Boolean); if(!partner||!ids.length) return {items:[]};
    const r=ewList(await ewCall(c,"GET","/search_read/sale.order.line",{domain:["&","&",["order_partner_id","=",partner],["product_id","in",ids],["state","!=","cancel"]],fields:["order_id","product_id","product_uom_qty","state"],limit:50}));
    const idOf=v=>Array.isArray(v)?v[0]:v, nameOf=v=>Array.isArray(v)?String(v[1]||v[0]):String(v);
    return {items:r.map(l=>({order:nameOf(l.order_id),order_id:idOf(l.order_id),product_id:idOf(l.product_id),qty:+l.product_uom_qty||0,state:l.state}))}; },
  async order_create(c,b){ const partner=parseInt(b.partner_id,10); if(!partner) throw new Error("etron-Kundennummer fehlt");
    const lines=(b.lines||[]).slice(0,50).map(l=>({product_id:parseInt(l.product_id,10),product_uom_qty:Math.max(1,Math.min(9999,parseInt(l.qty,10)||0))})).filter(l=>l.product_id);
    if(!lines.length) throw new Error("Keine Auftragszeilen");
    const values={partner_id:partner,origin:ewStr(b.origin,60)||"Vorbestellung",order_line:lines.map(l=>[0,0,l])}; if(ewStr(b.note)) values.note=ewStr(b.note,500);
    const names=ewStr(b.tag,200).split(",").map(x=>x.trim()).filter(Boolean);
    if(names.length){ const tags=ewList(await ewCall(c,"GET","/search_read/crm.tag",{domain:[["name","in",names]],fields:["id","name"]})); const ids=tags.map(t=>parseInt(t.id,10)).filter(Boolean);
      if(ids.length<names.length) throw new Error(`Stichwort „${names.join(", ")}“ gibt es in etron nicht (genaue Schreibweise prüfen)`); values.tag_ids=[[6,0,ids]]; }
    return {result:await ewCall(c,"POST","/create/sale.order",null,{values})}; },
};
async function etronWeb(action, data){ const c=await ewCfg(); if(!c||!c.key||!c.secret||!c.url) throw new Error("etron-Zugang ist nicht eingerichtet (Einstellungen → etron-Schnittstelle).");
  const f=EW_ACTIONS[action]; if(!f) throw new Error("unbekannte Aktion");
  try{ return await f(c,data); }catch(e){ dlog("ERROR",`ETRON ${action} FEHLER: ${e.message||e}`); throw e; } }
// ---------- etron direkt (nur im Programm): Kunden suchen/anlegen, Aufträge anlegen
// Antwort von create: Zahl, [Zahl] oder {id: Zahl}
function etronIdOf(r){ const v=r?.result??r; if(typeof v==="number") return v; if(Array.isArray(v)) return etronIdOf(v[0]); if(v&&typeof v==="object") return etronIdOf(v.id??v.result??v.data); const n=parseInt(v,10); return n>0?n:null; }
const etronTel = p => [p.mobile,p.phone].filter(x=>x&&x!==false).join(" / ");
async function etronFindPartners(fn, ln, tel){ const qs=[]; const d=String(tel||"").replace(/\D/g,""); if(d.length>=6) qs.push(d.slice(-8)); if((ln||"").trim().length>=2) qs.push(ln.trim()); else if((fn||"").trim().length>=2) qs.push(fn.trim());
  const seen=new Map(); for(const q of qs){ const r=await etronCall("partner_search",{q}); for(const p of r.items||[]) if(p&&p.id&&!seen.has(p.id)) seen.set(p.id,p); }
  const f=norm(fn||""); return [...seen.values()].sort((a,b)=>(norm(b.name||"").includes(f)?1:0)-(norm(a.name||"").includes(f)?1:0)).slice(0,10); }
function etronHitsHtml(list){ return list.map(p=>`<button type="button" class="sm" data-epid="${p.id}">Nr. ${p.id}: ${esc(p.name||"")}${etronTel(p)?` <span class="muted">${esc(etronTel(p))}</span>`:""}${p.email?` <span class="muted">${esc(p.email)}</span>`:""}</button>`).join(" "); }
const COUNTRIES = [["AT","Österreich"],["DE","Deutschland"],["CH","Schweiz"],["IT","Italien"],["SI","Slowenien"],["HU","Ungarn"],["CZ","Tschechien"],["SK","Slowakei"],["LI","Liechtenstein"]];
const countrySel = (id, v="AT") => `<select id="${id}">${COUNTRIES.map(([c,n])=>`<option value="${c}" ${c===v?"selected":""}>${n}</option>`).join("")}</select>`;
async function etronCreatePartner(fn, ln, tel, mail, country="AT"){ if(!String(tel||"").trim()&&!String(mail||"").trim()) throw new Error("Für etron bitte Telefon oder E-Mail eintragen (eines ist Pflicht)");
  dlog("INFO",`Kunde in etron anlegen (Land ${country})`); const r=await etronCall("partner_create",{firstname:fn,lastname:ln,phone:tel,email:mail,country}); const id=etronIdOf(r); if(!id){ dlog("ERROR","Kunde in etron anlegen: keine Kundennummer in der Antwort"); throw new Error("etron hat keine Kundennummer zurückgegeben"); } dlog("INFO",`Kunde in etron angelegt: Partner ${id}`); return id; }
// Auftrag für einen Kunden: zugeteilte Positionen -> etron-Auftrag (Entwurf)
async function etronOrderFor(cid, list){ const c=S.customers[cid]; if(!c?.etronId) throw new Error("keine etron-Nr.");
  const cfg=odooCfg(); let partner=parseInt(c.etronId,10);
  if(cfg.key==="ref"){ const r=await etronCall("partner_search",{q:String(c.etronId)}); const p=(r.items||[]).find(x=>String(x.ref)===String(c.etronId)); if(!p) throw new Error(`Kunde mit Kundennr. ${c.etronId} in etron nicht gefunden`); partner=p.id; }
  const aidOf=o=>artIdOf(S.products[o.productId]?.etronArtId), artById=new Map();
  for(const o of list.filter(aidOf)){ const pid=o.productId; if(artById.has(pid)) continue; const r=await etronCall("product_by_id",{id:aidOf(o),code:S.products[pid].articleNo||""}); artById.set(pid,r.id); }
  const byId=list.filter(aidOf); list=list.filter(o=>!aidOf(o)); const allList=[...byId,...list];
  const miss=list.filter(o=>!S.products[o.productId]?.articleNo); if(miss.length){ dlog("WARN",`Auftrag Kunde ${cid}: Artikelnummer fehlt bei Produkt ${miss.map(o=>o.productId).join(", ")}`); } if(miss.length) throw new Error("Artikelnummer fehlt bei: "+[...new Set(miss.map(o=>S.products[o.productId]?.name||"?"))].join(", "));
  const codes=[...new Set(list.map(o=>S.products[o.productId].articleNo.trim()))];
  const pf=codes.length?await etronCall("product_find",{codes}):{items:[]}; const found=pf.items||[]; const byCode=new Map(found.map(p=>[String(p.default_code).trim(),p.id]));
  dlog("INFO",`Artikelsuche ${codes.join(", ")}: gefunden ${found.map(p=>p.default_code+"→"+p.id).join(", ")||"nichts"}`);
  const nf=codes.filter(x=>!byCode.has(x)); if(nf.length) throw new Error("Artikelnummer in etron nicht gefunden: "+nf.map(x=>{ const n=(pf.near||{})[x]||[]; return n.length?`${x} (ähnlich: ${n.slice(0,3).map(p=>(p.code||p.barcode)+(p.active?"":" archiviert")).join(", ")})`:x; }).join(", ")+". In etron beim Artikel das Feld „Interne Referenz“ prüfen.");
  const artOf=o=>artById.get(o.productId)??byCode.get(S.products[o.productId].articleNo.trim());
  // Doppelte vermeiden: gibt es in etron schon eine (nicht stornierte) Auftragszeile für diesen Kunden und Artikel?
  const ex=(await etronCall("order_lines_find",{partner_id:partner,product_ids:[...new Set(allList.map(artOf))]})).items||[]; const linked=[];
  if(ex.length){ const byProd=new Map(); ex.forEach(l=>{ if(!byProd.has(l.product_id)) byProd.set(l.product_id,[]); byProd.get(l.product_id).push(l); });
    for(const o of [...allList]){ const hit=byProd.get(artOf(o)); if(!hit) continue; const qty=hit.reduce((a,l)=>a+(l.qty||0),0), nm=[...new Set(hit.map(l=>l.order))].join(", ");
      linked.push({o,order:nm,qty}); allList.splice(allList.indexOf(o),1); }
    dlog("INFO",`Kunde ${cid}: schon in etron vorhanden: ${linked.map(x=>x.o.id+" in "+x.order+" ("+x.qty+" Stk.)").join(", ")}`);
    await pool(linked,x=>S.db.collection("orders").doc(x.o.id).update({status:"Auftrag angelegt",etronOrder:x.order})); }
  if(!allList.length) return {oid:null,linked};
  const lines=allList.map(o=>({product_id:artOf(o),qty:o.alloc}));
  dlog("INFO",`Auftrag anlegen: Kunde ${cid}, etron-Partner ${partner}, Positionen ${allList.map(o=>o.id+"="+(S.products[o.productId].articleNo||"").trim()+"→Artikel "+artOf(o)+" x"+o.alloc).join(", ")}, Stichwort "${cfg.tag||""}"`);
  const r=await etronCall("order_create",{partner_id:partner,origin:`Vorbestellung ${fmtDate(today())}`,tag:cfg.tag||"",note:"",lines});
  const oid=etronIdOf(r); if(!oid){ dlog("ERROR",`Auftrag für Kunde ${cid}: etron hat keine Auftragsnummer zurückgegeben`); throw new Error("etron hat keine Auftragsnummer zurückgegeben. Bitte in etron nachsehen, ob der Auftrag trotzdem angelegt wurde, und das Log schicken."); }
  dlog("INFO",`Auftrag angelegt: Kunde ${cid}, etron-Auftrag ${oid}`);
  let confirmed=false, confErr=""; if(cfg.confirm){ try{ await etronCall("order_confirm",{id:oid}); confirmed=true; dlog("INFO",`Auftrag ${oid} bestätigt`); }catch(e){ confErr=String(e.message||e); dlog("ERROR",`Auftrag ${oid} bestätigen fehlgeschlagen: ${confErr}`); } }
  await pool(allList,o=>S.db.collection("orders").doc(o.id).update({status:"Auftrag angelegt",etronOrder:oid})); return {oid,linked,n:allList.length,confirmed,confErr}; }
// "47.411", "47411", "#47411" -> 47411
function artIdOf(v){ const t=String(v||"").replace(/[\s.#']/g,""); return /^\d{1,9}$/.test(t)&&+t>0?+t:0; }
function etronApiPanel(){
  if(!S.desktop) return etronWebPanel();
  return `<div class="panel"><h2>etron-Schnittstelle</h2>
    <p class="muted">Zugang aus etron (API &amp; Hooks → Authentication → Client Credentials). Mit dem Firmenkonto anlegen: der Benutzer braucht „Interner Benutzer“ und Verkaufsrechte, sonst können keine Aufträge angelegt werden. Er wird nur im Dropbox-Ordner des Programms gespeichert (<span class="mono">etron-zugang.json</span>), nie im Programmcode. Das Programm spricht direkt mit etron, nichts läuft über fremde Server.</p>
    <div class="form">
      <label class="wide">etron-Adresse<input id="ea-url" placeholder="https://xxxxxx.wawi.onretail.eu" autocomplete="off"></label>
      <label>Client Key<input id="ea-key" autocomplete="off" spellcheck="false"></label>
      <label>Client Secret<input id="ea-sec" type="password" autocomplete="new-password" spellcheck="false"></label>
      <button id="ea-save" class="pri">Speichern</button><button id="ea-test">Verbindung testen</button><button id="ea-del" class="sm danger">Zugang löschen</button>
    </div><div id="ea-st" class="muted">Lade …</div><div id="ea-res"></div></div>`; }
function etronWebPanel(){
  return `<div class="panel"><h2>etron-Schnittstelle</h2>
    <p class="muted">Für etron braucht jeder PC einmal die Chrome-Erweiterung „TCG Vorbestellungen – etron-Verbindung“ (Ordner <span class="mono">erweiterung</span>, Anleitung in der Wiki). Sie darf nur mit eurer etron-Adresse sprechen und nur Anfragen von dieser App annehmen. Der Zugang aus etron (API &amp; Hooks → Authentication, Benutzer mit wenig Rechten) liegt in eurer Dropbox (<span class="mono">${ETRON_FILE}</span>), nie im Programmcode.</p>
    <p id="ea-ext" class="muted">Prüfe Erweiterung …</p>
    <div class="form">
      <label class="wide">etron-Adresse<input id="ea-url" placeholder="https://xxxxxx.wawi.onretail.eu" autocomplete="off"></label>
      <label>Client Key<input id="ea-key" autocomplete="off" spellcheck="false"></label>
      <label>Client Secret<input id="ea-sec" type="password" autocomplete="new-password" spellcheck="false"></label>
      <button id="ea-save" class="pri">In Dropbox speichern</button><button id="ea-test">Verbindung testen</button><input id="ea-art" placeholder="Art.-Nr. oder Artikel-ID" style="width:14em"><button id="ea-arts">Artikel suchen</button><button id="ea-del" class="sm danger">Zugang löschen</button>
    </div><div id="ea-st" class="muted">Lade …</div><div id="ea-res"></div>
    <div class="row" style="margin-top:8px"><button class="sm" id="ea-log">Log herunterladen</button><span class="muted">Schritte und Fehler dieses Browsers, ohne Kundennamen/Telefonnummern.</span></div></div>`; }
function bindEtronWeb(){ const st=$("#ea-st"); if(!st) return;
  extCheck().then(v=>{ const e=$("#ea-ext"); if(e) e.innerHTML = v ? `<span class="ok">✓ Erweiterung aktiv (Version ${esc(String(v))}).</span>` : `<span class="bad">✗ Erweiterung nicht gefunden.</span> In Chrome: <span class="mono">chrome://extensions</span> → oben rechts „Entwicklermodus“ ein → „Entpackte Erweiterung laden“ → den Ordner <span class="mono">erweiterung</span> aus dem Dropbox-Ordner wählen. Danach diese Seite neu laden.`; });
  const show=()=>{ const c=EW.cfg; st.innerHTML = c ? `Zugang gespeichert (Key …${esc(String(c.key).slice(-4))}${c.savedAt?", "+esc(c.savedAt):""}${c.savedBy?" von "+esc(c.savedBy):""}). Key/Secret leer lassen = unverändert.` : "Noch kein Zugang gespeichert.";
    if(c?.url) $("#ea-url").value=c.url; $("#ea-key").placeholder=c?"gespeichert":""; $("#ea-sec").placeholder=c?"gespeichert":""; };
  ewCfg(true).then(show).catch(e=>{ st.textContent="Dropbox nicht lesbar: "+(e.message||e); });
  $("#ea-save").onclick=async()=>{ if(needStaff()) return; const c=EW.cfg||{}; const url=$("#ea-url").value.trim()||c.url||"", key=$("#ea-key").value.trim()||c.key||"", secret=$("#ea-sec").value.trim()||c.secret||"";
    if(!/^https:\/\/[^/]+\.wawi\.onretail\.eu/.test(url)) return toast("Bitte die etron-Adresse eintragen: https://xxxxxx.wawi.onretail.eu"); if(!key||!secret) return toast("Bitte Client Key und Client Secret eintragen.");
    const data={url,key,secret,savedAt:new Date().toLocaleString("de-AT"),savedBy:staff()};
    try{ await ewCfg(true); const r=await S.provider.write(ETRON_FILE,data,EW.rev||null); EW.cfg=data; EW.rev=r.rev; EW.tok=null; $("#ea-key").value=""; $("#ea-sec").value=""; show(); toast("etron-Zugang in der Dropbox gespeichert"); }
    catch(e){ toast(e.conflict?"Wurde gerade woanders geändert. Bitte nochmal speichern.":"Nicht gespeichert: "+(e.message||e)); } };
  $("#ea-del").onclick=async()=>{ if(!EW.cfg) return toast("Es ist kein Zugang gespeichert."); try{ await ewCfg(true); const r=await S.provider.write(ETRON_FILE,{},EW.rev); EW.cfg=null; EW.rev=r.rev; EW.tok=null; show(); toast("Zugang gelöscht"); }catch(e){ toast("Nicht gelöscht: "+(e.message||e)); } };
  $("#ea-test").onclick=async()=>{ const res=$("#ea-res"); res.innerHTML=`<ul class="eatest"><li>… teste</li></ul>`;
    try{ const j=await etronCall("ping"); res.innerHTML=`<ul class="eatest"><li class="ok">✓ Erweiterung aktiv.</li><li class="ok">✓ Anmeldung bei etron erfolgreich.</li><li class="ok">✓ Kunden lesen funktioniert (${j.read} Testdatensatz, Inhalt wird nicht angezeigt).</li>${j.prod==null&&!j.perr?"":j.prod?`<li class="ok">✓ Artikel lesen funktioniert.</li>`:`<li class="bad">✗ Artikel lesen: ${j.perr?esc(j.perr):"etron liefert keinen einzigen Artikel. Der API-Zugang darf vermutlich keine Artikel sehen."}${j.diag?`<br><span class="muted">${esc(j.diag)}</span>`:""}</li>`}</ul>`; }
    catch(e){ res.innerHTML=`<ul class="eatest"><li class="bad">✗ ${esc(e.message||e)}</li></ul>`; } };
  $("#ea-arts").onclick=async()=>{ const res=$("#ea-res"), code=$("#ea-art").value.trim(); if(!code) return toast("Bitte eine Artikelnummer eintragen."); res.innerHTML=`<ul class="eatest"><li>… suche ${esc(code)}</li></ul>`;
    try{ let j; if(artIdOf(code)&&!/[a-z]/i.test(code)){ try{ const h=await etronCall("product_by_id",{id:artIdOf(code)}); j={items:[h],near:{}}; }catch(e){ j=await etronCall("product_find",{codes:[code]}); if(!(j.items||[]).length) throw e; } } else j=await etronCall("product_find",{codes:[code]}); const hit=(j.items||[])[0]; let near=(j.near||{})[code]||[];
      if(!hit&&!near.length){ near=((await etronCall("product_search",{q:code})).items||[]); }
      res.innerHTML=`<ul class="eatest">${hit?`<li class="ok">✓ Gefunden: ${esc(hit.name||"")} (etron-Artikel ${esc(String(hit.id))}${hit.active===false?", archiviert":""})</li>`:`<li class="bad">✗ Keine Artikelnummer „${esc(code)}“.${near.length?" Treffer nach Name oder Teilnummer (zum Verknüpfen oben auf der Produktseite „Artikel in etron suchen“ nutzen):":""}</li>${near.map(p=>`<li>Treffer: ${esc(p.name)}${p.active?"":" (archiviert)"} · Art.-Nr. ${esc(p.code||"-")} · ID ${esc(String(p.id))}</li>`).join("")}`}</ul>`; }
    catch(e){ res.innerHTML=`<ul class="eatest"><li class="bad">✗ ${esc(e.message||e)}</li></ul>`; } };
  $("#ea-log").onclick=()=>{ let a=[]; try{ a=JSON.parse(localStorage.getItem("vb.dlog")||"[]"); }catch(e){} saveFile(`vorbestellungen-log-${today()}.txt`, new Blob([a.join("\r\n")||"(leer)"],{type:"text/plain;charset=utf-8"})); }; }
function bindEtronApi(){ if(!S.desktop) return bindEtronWeb(); const st=$("#ea-st"); if(!st) return; let cur={};
  const load=async()=>{ try{ cur=await (await desk("/api/etron/config")).json(); }catch(e){ cur={}; }
    st.innerHTML = cur.set ? `Zugang gespeichert (Key …${esc(cur.keyTail||"")}${cur.savedAt?", "+esc(cur.savedAt):""}${cur.savedBy?" von "+esc(cur.savedBy):""}). Key/Secret leer lassen = unverändert.` : "Noch kein Zugang gespeichert.";
    if(cur.url) $("#ea-url").value=cur.url; $("#ea-key").placeholder=cur.set?"gespeichert":""; $("#ea-sec").placeholder=cur.set?"gespeichert":""; };
  load();
  $("#ea-save").onclick=async()=>{ if(needStaff()) return; const url=$("#ea-url").value.trim(), key=$("#ea-key").value.trim(), secret=$("#ea-sec").value.trim();
    if(!/^(https:\/\/|http:\/\/127\.0\.0\.1:)/.test(url||cur.url||"")) return toast("Bitte die etron-Adresse mit https:// eintragen.");
    if(!cur.set&&(!key||!secret)) return toast("Bitte Client Key und Client Secret eintragen.");
    const r=await desk("/api/etron/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url,key,secret,savedAt:new Date().toLocaleString("de-AT"),savedBy:staff()})});
    if(!r.ok){ let j={}; try{ j=await r.json(); }catch(e){} return toast("Nicht gespeichert: "+(j.error||r.status)); }
    $("#ea-key").value=""; $("#ea-sec").value=""; toast("etron-Zugang gespeichert"); load(); };
  $("#ea-del").onclick=async()=>{ if(!cur.set) return toast("Es ist kein Zugang gespeichert."); await desk("/api/etron/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({delete:true})}); toast("Zugang gelöscht"); load(); };
  $("#ea-test").onclick=async()=>{ const res=$("#ea-res"); if(!cur.set) return toast("Bitte zuerst den Zugang speichern.");
    res.innerHTML=`<ul class="eatest"><li>… teste</li></ul>`;
    try{ const j=await etronCall("ping"); res.innerHTML=`<ul class="eatest"><li class="ok">✓ Anmeldung bei etron erfolgreich.</li><li class="ok">✓ Kunden lesen funktioniert (${j.read} Testdatensatz, Inhalt wird nicht angezeigt).</li>${j.prod==null&&!j.perr?"":j.prod?`<li class="ok">✓ Artikel lesen funktioniert.</li>`:`<li class="bad">✗ Artikel lesen: ${j.perr?esc(j.perr):"etron liefert keinen einzigen Artikel. Der API-Zugang darf vermutlich keine Artikel sehen."}${j.diag?`<br><span class="muted">${esc(j.diag)}</span>`:""}</li>`}</ul>`; }
    catch(e){ const auth=e.etron===401||e.etron===400||e.etron===403;
      res.innerHTML=`<ul class="eatest">${!auth&&/HTTP/.test(e.message)&&!/Anmeldung/.test(e.message)?'<li class="ok">✓ Anmeldung bei etron erfolgreich.</li>':""}<li class="bad">✗ ${esc(e.message)}${auth&&/Anmeldung/.test(e.message)?" Client Key/Secret prüfen.":""}</li></ul>`; } }; }

// ---------- Übernahme aus dem alten System (Web-App mit Dropbox-App-Ordner) ins Programm
// Abgleich: gleiche ID = derselbe Eintrag (neuerer Stand gewinnt). Bei paralleler Nutzung können dieselben Dinge
// aber in beiden Systemen getrennt angelegt worden sein (andere ID). Eindeutige Fälle werden zusammengelegt,
// unklare als mögliche Dubletten gemeldet.
const IMPORT_COLS = ["products","customers","orders","templates","staff","config","games"];
function snapshot(o){ const s={}; for(const c of IMPORT_COLS){ s[c]={}; for(const [id,r] of Object.entries(o?.[c]||{})) s[c][id]=stable(r); } return s; }
const digitsOnly = t => String(t||"").replace(/\D/g,"").replace(/^(00|0)?43/,"").replace(/^0/,"");
async function dedupeAfterImport(before, src){
  const st={ cols:{}, newTotal:0, updTotal:0, prodMerged:0, custMerged:0, orderDup:0, dupes:0 };
  const after=S.doc.obj;
  for(const c of IMPORT_COLS){ const x={neu:0,abgeglichen:0,gleich:0};
    for(const id of Object.keys(src?.[c]||{})){ const r=after?.[c]?.[id]; if(!r||r.deleted) continue;
      if(!(id in before[c])) x.neu++; else if(before[c][id]!==stable(r)) x.abgeglichen++; else x.gleich++; }
    st.cols[c]=x; st.newTotal+=x.neu; st.updTotal+=x.abgeglichen; }
  const isNew=(c,id)=>!(id in before[c]);
  // Produkte: gleicher Name und gleiches Spiel -> zusammenlegen
  for(const p of Object.values(S.products).filter(p=>isNew("products",p.id))){
    const x=Object.values(S.products).find(q=>q.id!==p.id && !isNew("products",q.id) && q.name.trim().toLowerCase()===p.name.trim().toLowerCase() && gameOf(q)===gameOf(p)); if(!x) continue;
    for(const o of Object.values(S.orders)){ if(o.productId===p.id) await write("orders",o.id,{productId:x.id});
      else if((o.choices||[]).includes(p.id)) await write("orders",o.id,{choices:[...new Set(o.choices.map(c=>c===p.id?x.id:c))]}); }
    const pt={}; for(const f of ["articleNo","etronArtId","etronUrl","msgName","series","release","unit","packSize","received","supplierOrdered","supplierConfirmed"]) if((x[f]==null||x[f]==="")&&p[f]!=null&&p[f]!=="") pt[f]=p[f];
    if(Object.keys(pt).length) await write("products",x.id,pt);
    await write("products",p.id,null,"delete"); st.prodMerged++; pull(); }
  // Kunden: gleicher Vor-/Nachname (auch vertauscht), Telefon passt (gleich oder eines leer), etron-Nr. widerspricht nicht
  for(const c of Object.values(S.customers).filter(c=>isNew("customers",c.id))){
    const tc=digitsOnly(contactFields(c).tel), np=nameParts(c);
    const x=Object.values(S.customers).find(q=>{ if(q.id===c.id||isNew("customers",q.id)) return false; const a=norm(q.name);
      if(a!==norm(np.first+" "+np.last) && a!==norm(np.last+" "+np.first)) return false;
      const tq=digitsOnly(contactFields(q).tel); if(tc&&tq&&tc!==tq) return false;
      return !(c.etronId&&q.etronId&&String(c.etronId)!==String(q.etronId)); });
    if(x && await mergeCustomers(c.id,x.id)){ st.custMerged++; pull(); } }
  // Bestellungen: gleicher Kunde, gleiches Produkt, gleiche Menge, gleiches Datum -> doppelt
  const key=o=>[o.customerId,o.productId||"",(o.choices||[]).slice().sort().join("+"),o.qty,o.date||""].join("|");
  const old=new Map(Object.values(S.orders).filter(o=>!isNew("orders",o.id)).map(o=>[key(o),o]));
  for(const o of Object.values(S.orders).filter(o=>isNew("orders",o.id))){ if(old.has(key(o))){ await write("orders",o.id,null,"delete"); st.orderDup++; } }
  pull();
  st.dupes=Object.values(S.customers).filter(c=>isNew("customers",c.id) && dupesOf(c).length).length;
  return st; }
function importReport(st){ const L={products:"Produkte",customers:"Kunden",orders:"Bestellungen",templates:"Vorlagen",staff:"Mitarbeiter",config:"Einstellungen",games:"Spiele"};
  const rows=IMPORT_COLS.filter(c=>st.cols[c]&&(st.cols[c].neu+st.cols[c].abgeglichen+st.cols[c].gleich)).map(c=>`<tr><td>${L[c]}</td><td class="n">${st.cols[c].neu}</td><td class="n">${st.cols[c].abgeglichen}</td><td class="n">${st.cols[c].gleich}</td></tr>`).join("");
  return `<div class="tablebox" style="margin-top:6px"><table><thead><tr><th></th><th class="n">neu</th><th class="n">abgeglichen</th><th class="n">schon gleich</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p>${st.prodMerged?`✓ ${st.prodMerged} doppelt angelegte Produkte (gleicher Name) zusammengelegt. `:""}${st.custMerged?`✓ ${st.custMerged} doppelt angelegte Kunden (gleicher Name, Telefon passt) zusammengeführt. `:""}${st.orderDup?`✓ ${st.orderDup} doppelte Bestellungen (gleicher Kunde, Produkt, Menge, Datum) entfernt. `:""}</p>
    ${st.dupes?`<div class="note">${st.dupes} neu übernommene Kunden sehen anderen Kunden ähnlich. Bitte unter <a href="#dubletten">Dubletten</a> prüfen.</div>`:`<p class="ok">Keine weiteren möglichen Dubletten.</p>`}`; }
function migratePanel(){
  return `<div class="panel"><h2>Daten aus dem alten System übernehmen</h2>
    <p class="muted">Übernimmt alle Produkte, Kunden, Bestellungen, Vorlagen, Mitarbeiter, Einstellungen und das Protokoll aus dem bisherigen Dropbox-App-Ordner (<span class="mono">Dropbox\\Apps\\…</span>) in den Ordner dieses Programms. Vorher wird eine Sicherung angelegt. Vorhandene Daten werden nicht gelöscht, sondern abgeglichen: gleiche Einträge werden zusammengeführt (der neuere Stand gewinnt), doppelt angelegte Produkte, Kunden und Bestellungen werden erkannt. Die Übernahme kann beliebig oft wiederholt werden, z. B. solange die Web-Version parallel läuft. Liegt das Programm schon im alten Ordner, ist nichts zu tun.</p>
    <div id="mg-c" class="muted">Suche alten Ordner …</div>
    <div class="row" style="margin-top:8px"><input id="mg-p" placeholder="oder Ordner von Hand: C:\\Users\\…\\Dropbox\\Apps\\…" style="flex:1 1 360px"><button id="mg-go" class="pri">Übernehmen</button></div>
    <div id="mg-r">${S.lastImport?`<p><b>Ergebnis der letzten Übernahme:</b></p>`+importReport(S.lastImport):""}</div></div>`; }
function bindMigrate(){ const c=$("#mg-c"); if(!c) return;
  desk("/api/migrate/candidates").then(r=>r.json()).then(list=>{
    if(!list.length){ c.innerHTML="Kein alter Ordner mit <span class=\"mono\">vorbestellungen.json</span> gefunden. Bitte den Ordner unten von Hand eintragen."; return; }
    c.innerHTML=`Gefunden: ${list.map((x,i)=>`<label class="row" style="gap:6px"><input type="radio" name="mg" value="${esc(x.folder)}" ${i?"":"checked"}> <span class="mono">${esc(x.folder)}</span> <span class="muted">(zuletzt geändert ${esc(x.modified)}, ${x.logs} Protokollmonate)</span></label>`).join("")}`;
  }).catch(()=>{ c.textContent="Suche nicht möglich."; });
  $("#mg-go").onclick=async()=>{ if(needStaff()) return; const src=$("#mg-p").value.trim()||document.querySelector('input[name=mg]:checked')?.value; const out=$("#mg-r");
    if(!src) return toast("Bitte einen Ordner wählen oder eintragen.");
    const b=$("#mg-go"); b.disabled=true; const say=(t,cls="")=>{ out.innerHTML+=`<p class="${cls}">${t}</p>`; };
    out.innerHTML="";
    try{
      const q="src="+encodeURIComponent(src);
      const lr=await desk("/api/migrate/list?"+q); const files=await lr.json(); if(!lr.ok) throw new Error(files.error||lr.status);
      const bk=await (await desk("/api/backup",{method:"POST"})).json(); if(bk.error) throw new Error("Sicherung fehlgeschlagen: "+bk.error);
      say(`✓ Sicherung angelegt: <span class="mono">${esc(bk.folder)}</span> (${bk.files} Dateien)`,"ok");
      let n=0, stats=null;
      for(const f of files){
        const sr=await desk("/api/migrate/read?"+q+"&path="+encodeURIComponent(f)); if(!sr.ok) continue; const srcObj=JSON.parse(await sr.text());
        if(f==="vorbestellungen.json"){ await S.doc.sync(); const before=snapshot(S.doc.obj);
          S.doc.update(o=>{ const m=merge(o,srcObj); for(const k of Object.keys(o)) delete o[k]; Object.assign(o,m); }); pull();
          stats=await dedupeAfterImport(before, srcObj); await S.doc.sync(); }
        else { for(let t=0;t<5;t++){ const cur=await S.provider.read(f); const m=cur?merge(cur.data,srcObj):srcObj; try{ await S.provider.write(f,m,cur?cur.rev:null); break; }catch(e){ if(!e.conflict) throw e; } } }
        n++;
      }
      say(`✓ ${n} Dateien übernommen (Daten und ${n-1} Protokollmonate). Anzahl jetzt: ${Object.keys(S.products).length} Produkte, ${Object.keys(S.customers).length} Kunden, ${Object.keys(S.orders).length} Bestellungen.`,"ok");
      if(stats) say(importReport(stats),"");
      say(`Bitte kurz prüfen. Die Web-Version arbeitet weiter mit dem alten Ordner; neue Einträge dort kann man jederzeit erneut übernehmen.`,"muted");
      dlog("INFO",`Übernahme: ${n} Dateien, Sicherung ${bk.folder}${stats?`, neu ${stats.newTotal}, abgeglichen ${stats.updTotal}, Produkte zusammengelegt ${stats.prodMerged}, Kunden zusammengeführt ${stats.custMerged}, doppelte Bestellungen ${stats.orderDup}, mögliche Dubletten ${stats.dupes}`:""}`);
      S.log=null; S.logP=null; S.lastImport=stats; toast(`Übernahme fertig: ${stats?stats.newTotal+" neu, "+stats.updTotal+" abgeglichen, ":""}${stats?.dupes?stats.dupes+" mögliche Dubletten, ":""}Sicherung in ${bk.folder}`,8000); pull(); render(); }
    catch(e){ dlog("ERROR","Übernahme fehlgeschlagen: "+(e.message||e)); say("✗ "+esc(e.message||e),"bad"); }
    b.disabled=false; }; }

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
    <p class="muted">Platzhalter: {Vorname} {Nachname} {Name} {Spiel} {Produkt} {Stück} {Bestellt} {Teillieferung} {Tag} {Mitarbeiter} {Datum}. {Stück} ist die zugeteilte Stückzahl (ohne Zuteilung die bestellte Menge; {Menge} geht weiterhin), {Bestellt} die bestellte Menge, z. B. „{Stück} von {Bestellt} Stück“. {Teillieferung} ergibt nur bei weniger als bestellt den Satz „Leider konnten wir nur 1 von 2 bestellten Stück für dich reservieren.“, sonst bleibt es leer. {Mitarbeiter} ist der Vorname aus der Mitarbeiterliste. {Spiel} kommt automatisch vom Produkt (z. B. Pokémon), {Tag} ist das Abholdatum (Standard heute, im Nachrichtenfenster änderbar). Die Vorlagen gelten für alle Geräte.</p>
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
    ${etronOn()?`<label class="row muted" style="align-self:end" id="${k}-necl"><input type="checkbox" id="${k}-nec" checked> auch in etron anlegen</label><label id="${k}-ncl">Land (etron)${countrySel(k+"-ncty")}</label>`:""}
    <button class="pri" id="${k}-nok" ${S.canWrite?"":"disabled"}>Kunden anlegen</button><button type="button" id="${k}-nx">Abbrechen</button>
  </form><div id="${k}-nh"></div>${etronOn()?`<div id="${k}-neh" class="muted"></div>`:""}</div>`; }
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
  // etron: passende Kunden zeigen (Name/Telefon), Klick übernimmt die etron-Nr.
  let etT=null, etSeq=0; const neh=$("#"+k+"-neh");
  const etUi=()=>{ const has=!!v("net"); const l=$("#"+k+"-necl"); if(l) l.hidden=has; const cl=$("#"+k+"-ncl"); if(cl) cl.hidden=has||!$("#"+k+"-nec")?.checked; };
  const nec=$("#"+k+"-nec"); if(nec) nec.onchange=etUi;
  const etSearch=()=>{ if(!neh) return; clearTimeout(etT); etT=setTimeout(async()=>{ if(!$("#"+k+"-nfn")) return; const fn=v("nfn"), ln=v("nln"), tel=v("ntel"); if(ln.length<2 && tel.replace(/\D/g,"").length<6){ neh.innerHTML=""; return; }
      const my=++etSeq; neh.textContent="Suche in etron …"; try{ const list=await etronFindPartners(fn,ln,tel); if(my!==etSeq) return;
        neh.innerHTML=list.length?`In etron gefunden (anklicken übernimmt die etron-Nr.): ${etronHitsHtml(list)}`:"In etron kein passender Kunde gefunden.";
        neh.querySelectorAll("[data-epid]").forEach(b=>b.onclick=()=>{ const p=list.find(x=>String(x.id)===b.dataset.epid); $("#"+k+"-net").value=p.id; if(!v("ntel")&&etronTel(p)) $("#"+k+"-ntel").value=(p.phone||p.mobile); if(!v("nmail")&&p.email) $("#"+k+"-nmail").value=p.email; etUi(); neh.innerHTML=`✓ etron-Nr. ${p.id} übernommen (${esc(p.name||"")}).`; }); }
      catch(e){ if(my===etSeq) neh.textContent="etron-Suche nicht möglich: "+(e.message||e); } },450); };
  ["nfn","nln","ntel"].forEach(id=>$("#"+k+"-"+id).oninput=()=>{ check(); etSearch(); }); $("#"+k+"-net").oninput=etUi; check(); etSearch();
  $("#"+k+"-nx").onclick=()=>{ box.innerHTML=""; };
  $("#"+k+"-nform").onsubmit=async e=>{ e.preventDefault(); if(needStaff()) return; const r=check(); if(!r.fn||!r.ln) return toast("Bitte Vor- und Nachname eintragen."); if(r.ex) return;
    if(r.d.length && okFor!==r.key){ okFor=r.key; check(); return toast("Bitte die ähnlichen Kunden prüfen, dann nochmal klicken."); }
    const cid=newId("c"); const et=v("net"); const rec={name:r.fn+" "+r.ln,firstName:r.fn,lastName:r.ln,contact:joinContact(r.tel,v("nmail"),null),note:""};
    if(!et && etronOn() && $("#"+k+"-nec")?.checked){ if(!r.tel.trim()&&!v("nmail")) return toast("Für etron bitte Telefon oder E-Mail eintragen (eines ist Pflicht). Oder Haken „auch in etron anlegen“ entfernen.");
      ok.disabled=true; try{ const id=await etronCreatePartner(r.fn,r.ln,r.tel,v("nmail"),$("#"+k+"-ncty")?.value||"AT"); rec.etronId=String(id); toast(`In etron angelegt: Nr. ${id}`); }
      catch(e){ ok.disabled=false; return toast("In etron nicht angelegt: "+(e.message||e)+". Haken „auch in etron anlegen“ entfernen, um nur hier anzulegen."); } }
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
  // Eine Zeile pro Kunde (Tommy, 25.11.): alle Bestellungen des Kunden in dieser Serie, je Produkt Menge und Zuteilung nebeneinander.
  const rowsMap = new Map();
  for (const o of all.sort(sortOrders)){ const k = o.customerId || o.id; if(!rowsMap.has(k)) rowsMap.set(k, []); rowsMap.get(k).push(o); }
  let rows = [...rowsMap.values()]; const waAll = waGroups(rows.filter(r => nameMatch(S.oq, S.customers[r[0]?.customerId])));
  rows = rows.filter(r => nameMatch(S.oq, S.customers[r[0]?.customerId])).filter(r => fstat==="alle" || (fstat===MSG_OPEN ? msgOpenType(r) : (fstat==="aktiv" && msgOpen(r)) || r.some(o => fstat==="aktiv" ? isActive(o, sug) : o.status===fstat)));
  rows = sortView(rows, r=>r[0]?.customerId);
  const st = sib.map(p=>({p, s:stats(p)}));
  const hasFlex = all.some(o=>!o.productId);
  const shortN = (()=>{ const w=sib.map(p=>String(p.name||"").split(/\s+/)); let k=0; while(sib.length>1 && w.every(x=>x.length>k+1 && x[k].toLowerCase()===w[0][k].toLowerCase())) k++;
    return w.map((x,i)=>{ const t=x.slice(k).join(" ")||sib[i].name; const code=(t.match(/\b[A-Z]{1,4}-?\d{1,3}[A-Z]?\b/)||[])[0]; return code||(t.length>14?t.slice(0,13)+"…":t); }); })();
  const live = r => r.filter(x=>x.status!=="Storniert").length ? r.filter(x=>x.status!=="Storniert") : r;
  // Kompakt (Tommy, 25.11.): pro Produkt eine schmale Spalte, oben bestellt, darunter zugeteilt. Leeres Feld oben = neue Vorbestellung.
  const sv = x => sug && x!=="" && x!=null ? `<div class="sv" title="Vorschlag">→ ${x}</div>` : "";
  const cell = (r, pid) => { const os = live(r).filter(x=>x.productId===pid); const f = live(r).find(x=>!x.productId && (x.choices||[]).includes(pid)); const cid=r[0].customerId;
    let top, bot, sg="";
    if (!os.length) top = `<input type="number" min="0" class="sq" data-newq="${cid}" data-pid="${pid}" id="sn-${cid}-${pid}" placeholder="+" title="Neue Vorbestellung: Menge eintragen">`;
    else if (os.length===1) top = `<input type="number" min="0" class="sq" data-q="${os[0].id}" id="sq-${os[0].id}" value="${os[0].qty??""}" title="Bestellt">`;
    else top = `<div class="sq" title="${os.length} Bestellungen, einzeln auf der Produktseite änderbar">${os.reduce((t,x)=>t+(x.qty||0),0)}</div>`;
    if (os.length===1) { bot = `<input type="number" min="0" class="sa" data-f="alloc" data-oid="${os[0].id}" id="sa-${os[0].id}" value="${os[0].alloc??""}" title="Zugeteilt (bestellt ${os[0].qty??"?"})">`; sg = sug?.res[os[0].id]??""; }
    else if (os.length>1) { bot = `<div class="sa" title="Zugeteilt">${os.reduce((t,x)=>t+(x.alloc||0),0)||"–"}</div>`; sg = os.reduce((t,x)=>t+(sug?.res[x.id]||0),0)||""; }
    else bot = "";
    if (f) { bot += `<input type="number" min="0" class="sa" data-flex="${f.id}" data-pid="${pid}" id="sf-${f.id}-${pid}" placeholder="egal" title="„egal welches“ diesem Produkt zuteilen">`; if(sug?.flex[f.id]?.pid===pid) sg = (Number(sg)||0)+sug.flex[f.id].n; }
    return `<td class="pc">${top}${bot}${sv(sg)}</td>`; };
  const stSel = r => { const ss=[...new Set(r.map(x=>x.status))]; const one=ss.length===1?ss[0]:null;
    return `<select data-rs id="ss-${r[0].id}" title="${one?"":"Gemischt: "+esc(ss.join(", "))+". Eine Auswahl gilt für alle Bestellungen des Kunden in dieser Serie."}">${one?"":`<option selected disabled>gemischt</option>`}${STATUSES.map(x=>`<option ${x===one?"selected":""}>${x}</option>`).join("")}</select>`; };
  const sugSum = sug ? Object.values(sug.res).reduce((a,b)=>a+b,0)+Object.values(sug.flex).reduce((a,b)=>a+b.n,0) : 0;
  app.innerHTML = `<a class="back" href="#produkte">← Produkte</a>
  <div class="row spread"><div><h1>Serie ${esc(seriesOf(p0))}</h1><p class="sub">${esc(gameOf(p0))} · ${sib.map(p=>`<a class="back" href="#produkt-${p.id}">${esc(p.name)}</a>`).join(" · ")}</p></div>${addVarBtn()}</div><div id="addvbox"></div>
  <div class="tablebox"><table><thead><tr><th>Produkt</th><th class="n">nur dieses</th><th class="n">+ egal</th><th class="n">Wareneingang</th><th class="n">Zugeteilt</th><th class="n">Frei</th></tr></thead><tbody>
  ${st.map(({p,s})=>`<tr><td><a href="#produkt-${p.id}">${esc(p.name)}</a></td><td class="n">${s.pre}</td><td class="n">${s.flex||""}</td>
    <td class="n"><input type="number" min="0" data-rec="${p.id}" id="sr-${p.id}" value="${p.received??""}" placeholder="fehlt"></td><td class="n">${s.alloc||""}</td>
    <td class="n" style="${s.over?"color:var(--bad);font-weight:700":""}">${s.free??""}</td></tr>`).join("")}
  </tbody></table></div>
  <div class="panel"><div class="row spread"><h2>Zuteilung für die ganze Serie</h2><div class="row">
    <select id="mode"><option value="prop">Proportional (fair verteilt)</option><option value="fifo" ${S.mode==="fifo"?"selected":""}>Nach Bestelldatum</option></select><label class="row muted" style="gap:4px" title="Zuerst bekommt jeder Kunde 1 Stück (nach Bestelldatum, falls nicht genug für alle da ist), der Rest wird wie gewählt verteilt."><input type="checkbox" id="min1" ${S.min1?"checked":""}> Jeder mind. 1 Stück</label>
    <button id="sug" ${st.some(x=>x.s.rec==null)?"disabled":""}>Vorschlag berechnen</button>
    ${sug?`<button class="pri" id="apply">Vorschlag übernehmen (${sugSum} Stück)</button><button id="dis">Verwerfen</button>`:""}
    <button id="close">Zuteilung abschließen</button><button id="rest" title="Alle offenen Bestellungen ohne Zuteilung auf Warteliste setzen">Rest auf Warteliste</button></div></div>
    <p class="muted">${st.some(x=>x.s.rec==null)?"Für den Vorschlag bei allen Produkten den Wareneingang eintragen.":"Zuerst bekommen die festen Wünsche (nur A, nur B, beide) ihre Ware, dann gehen die Reste an „egal“-Kunden, jeweils an das Produkt mit mehr übrig. Zuteilungen kannst du auch direkt in der Tabelle ändern."}</p>
    ${sug?`<p class="muted">Danach übrig: ${sib.map(p=>`${esc(p.name)} ${sug.left[p.id]}`).join(" · ")}</p>`:""}</div>
  ${orderForm("se", null, null, ids)}
  <div class="row spread"><h2>Bestellungen (${rows.length})</h2><span class="row" style="gap:6px">${waBtn(waAll)}${oqInput()}${sortSel()}<select id="fstat">${["aktiv","alle",...STATUSES,MSG_OPEN].map(x=>`<option value="${x}" ${x===fstat?"selected":""}>${x==="aktiv"?"aktiv (offen, Warteliste, Nachricht offen)":x}</option>`).join("")}</select>${typeSel(fstat)}</span></div>
  <div id="waq-box">${waqHtml()}</div>
  <p class="muted" style="margin:4px 0">Je Produkt: oben bestellt, darunter <span style="color:var(--accent);font-weight:600">zugeteilt</span>${sug?", „→“ ist der Vorschlag":""}. In ein leeres Feld „+“ eine Menge eintragen legt eine neue Vorbestellung an.</p>
  <div class="tablebox"><table class="sertab"><thead><tr><th>Kunde</th>${sib.map((p,i)=>`<th class="pc" title="${esc(p.name)}">${esc(shortN[i])}</th>`).join("")}${hasFlex?'<th class="pc" title="Kunde will eines davon, egal welches">egal</th>':""}<th>Bestellt am</th><th title="Wer die Vorbestellung aufgenommen hat">MA</th><th>Status</th><th>Auftrag</th><th>Nachricht</th><th>Kommentar</th></tr></thead><tbody>
  ${rows.map(r=>{const o=r[0];const c=S.customers[o.customerId];const fl=live(r).filter(x=>!x.productId);const cm=[...new Set(r.map(x=>x.comment).filter(Boolean))].join(" · ");return `<tr data-row="${r.map(x=>x.id).join(",")}" class="${r.every(x=>x.status==="Storniert")?"dim":""}">
    <td>${custFlags(c)}<a href="#kunde-${o.customerId}">${esc(c?.name||"?")}</a></td>
    ${sib.map(p=>cell(r,p.id)).join("")}${hasFlex?`<td class="pc">${fl.reduce((t,x)=>t+(x.qty||0),0)||'<span class="muted">·</span>'}</td>`:""}
    <td>${fmtDate(o.date)}</td><td class="mono">${esc([...new Set(r.map(x=>x.staff).filter(Boolean))].join(", "))}</td><td>${stSel(r)}</td>
    <td style="text-align:center">${auftragBox(r)}</td><td>${msgBtn(r)}</td><td class="muted">${esc(cm)}</td></tr>`}).join("")||`<tr><td colspan="${8+sib.length}" class="empty">Noch keine Bestellungen für diese Serie.</td></tr>`}
  </tbody></table></div>`;
  app.querySelectorAll("[data-rec]").forEach(el=>el.onchange=()=>write("products",el.dataset.rec,{received:num(el.value)}).then(ok=>ok&&toast("Gespeichert")));
  app.querySelectorAll("input[data-oid]").forEach(el=>el.onchange=()=>saveAlloc(el.dataset.oid, num(el.value)));
  app.querySelectorAll("input[data-newq]").forEach(el=>el.onchange=async()=>{ const v=num(el.value); if(!(v>0)){ el.value=""; return; } if(needStaff()){ el.value=""; return; }
    const ok=await write("orders",newId("o"),{productId:el.dataset.pid,customerId:el.dataset.newq,qty:v,date:today(),staff:staff(),status:"Offen",alloc:null,comment:"",createdAt:new Date().toISOString()},"set");
    if(ok){ dlog("INFO",`Vorbestellung in Serienansicht angelegt: ${v} Stück`); toast(`Vorbestellung angelegt: ${v}× ${S.products[el.dataset.pid]?.name||""}`); } });
  app.querySelectorAll("input[data-q]").forEach(el=>el.onchange=()=>{ const v=num(el.value); if(!(v>0)){ el.value=S.orders[el.dataset.q]?.qty??""; return toast("Menge muss mindestens 1 sein. Zum Entfernen den Status auf Storniert setzen."); } write("orders",el.dataset.q,{qty:v}).then(ok=>ok&&toast("Gespeichert")); });
  app.querySelectorAll("input[data-flex]").forEach(el=>el.onchange=()=>{ const v=num(el.value); if(!v) return; const o=S.orders[el.dataset.flex];
    write("orders",o.id,{productId:el.dataset.pid,alloc:v,comment:[o.comment,`war: ${orderLabel(o)}`].filter(Boolean).join(" · ")}).then(ok=>ok&&toast("Zugeteilt")); });
  app.querySelectorAll("select[data-rs]").forEach(el=>el.onchange=async()=>{ const v=el.value; const ids2=el.closest("tr").dataset.row.split(",").filter(id=>v==="Storniert"||S.orders[id]?.status!=="Storniert");
    if (v==="Storniert") return cancelOrders(ids2);
    await pool(ids2, id=>S.db.collection("orders").doc(id).update({status:v})); toast("Gespeichert"); });
  $("#fstat").onchange=e=>{S.fstat=e.target.value;render();}; bindTypeSel(); bindOq(); bindSort(); bindWaq();
  $("#mode").onchange=e=>{S.mode=e.target.value; if(S.sugg[key]){S.sugg[key]=seriesSuggest(sib,S.mode);render();}};
  $("#min1").onchange=e=>{S.min1=e.target.checked; try{localStorage.setItem("vb.min1",S.min1?"1":"");}catch(x){} if(S.sugg[key]){S.sugg[key]=seriesSuggest(sib,$("#mode").value);} render();};
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

// ---------- Abgleich: Kunden ohne etron-Nr. in etron suchen. Nichts wird in etron angelegt oder geändert.
const telKey = t => { let d=String(t||"").replace(/\D/g,""); if(d.startsWith("00")) d=d.slice(2); d=d.replace(/^(43|49|41)/,""); d=d.replace(/^0+/,""); return d.length>=6?d.slice(-9):""; };
// Cardmarket-Konto erkennen: das Konto mit Kundenreferenz (darüber wird der Cardmarket-Account geprüft), nur wenn genau eines eine hat
function cetCm(p, cands){ const withRef=cands.filter(x=>x.p.ref&&x.p.ref!==false&&String(x.p.ref).trim()); return withRef.length===1&&withRef[0].p.id===p.id; }
function cetScore(c, p){ const cf=contactFields(c), tk=telKey(cf.tel), mail=(cf.mail||"").toLowerCase();
  const why=[]; const ptels=[p.mobile,p.phone].filter(x=>x&&x!==false).map(telKey).filter(Boolean);
  const telOk=tk&&ptels.includes(tk), telBad=tk&&ptels.length&&!telOk; if(telOk) why.push("Telefon");
  const mailOk=mail&&p.email&&String(p.email).toLowerCase()===mail; if(mailOk) why.push("E-Mail");
  const a=norm(c.name), b=norm(p.name||""), fl=norm(`${c.firstName||""} ${c.lastName||""}`), lf=norm(`${c.lastName||""} ${c.firstName||""}`);
  const nameOk=b&&(b===a||b===fl||b===lf); if(nameOk) why.push("Name");
  return {score:(telOk?2:0)+(mailOk?2:0)+(nameOk?1:0)-(telBad&&!mailOk?1:0), why}; }
async function cetSearch(c){ const cf=contactFields(c), qs=[]; const tk=telKey(cf.tel); if(tk) qs.push(tk.slice(-7)); if(cf.mail) qs.push(cf.mail);
  const ln=(c.lastName||"").trim()||(c.name||"").trim().split(/\s+/).pop(); if(ln&&ln.length>=2) qs.push(ln);
  const seen=new Map(); for(const q of qs){ const r=await etronCall("partner_search",{q}); for(const p of r.items||[]) if(p&&p.id&&!seen.has(p.id)) seen.set(p.id,p); }
  return [...seen.values()].map(p=>({p,...cetScore(c,p)})).filter(x=>x.why.length).sort((x,y)=>y.score-x.score).slice(0,8); }
async function runCet(){ if(needStaff()) return; const todo=Object.values(S.customers).filter(c=>!String(c.etronId||"").trim());
  S.cet={running:true,done:0,total:todo.length,rows:[]}; dlog("INFO",`etron-Abgleich gestartet: ${todo.length} Kunden ohne etron-Nr.`); drawCet();
  const q=[...todo]; const worker=async()=>{ while(q.length){ const c=q.shift(); let cands=[], err="";
    try{ cands=await cetSearch(c); }catch(e){ err=String(e.message||e); }
    // nur vorauswählen, wenn genau ein Treffer und der über Telefon/E-Mail oder exakt den Namen passt
    const pick=!err&&cands.length===1&&cands[0].score>=1?cands[0].p.id:null;
    S.cet.rows.push({cid:c.id,cands,err,pick}); S.cet.done++; drawCet(); } };
  await Promise.all([worker(),worker(),worker()]); S.cet.running=false;
  const r=S.cet.rows; dlog("INFO",`etron-Abgleich fertig: ${r.filter(x=>x.pick).length} eindeutig, ${r.filter(x=>!x.pick&&x.cands.length).length} zur Auswahl, ${r.filter(x=>!x.cands.length&&!x.err).length} ohne Treffer, ${r.filter(x=>x.err).length} Fehler`); drawCet(); }
function cetHtml(){ const st=S.cet; if(!st) return ""; const rows=[...st.rows].sort((a,b)=>(S.customers[a.cid]?.name||"").localeCompare(S.customers[b.cid]?.name||"","de"));
  const grp=(t,list)=>list.length?`<h3>${t} (${list.length})</h3><div class="tablebox"><table><thead><tr><th>Kunde in der App</th><th>Treffer in etron</th></tr></thead><tbody>${list.map(r=>{ const c=S.customers[r.cid]; if(!c) return "";
    return `<tr><td><a href="#kunde-${r.cid}">${esc(c.name)}</a><br><span class="muted">${esc(c.contact||"")}</span></td><td>${r.err||!r.cands.length?`${r.err?`<span class="bad">✗ ${esc(r.err)}</span>`:`<span class="muted">nicht in etron gefunden</span>`}<br><input data-cetin="${r.cid}" placeholder="etron-Nr. eintragen" style="width:150px" inputmode="numeric"> <span class="muted">Enter oder Tab speichert</span>`:r.cands.map(x=>`<label class="row" style="gap:6px;align-items:flex-start${r.cands.length>1&&cetCm(x.p,r.cands)?";background:var(--okbg,rgba(0,160,80,.08));border-radius:6px":""}"><input type="radio" name="cet-${r.cid}" data-cet="${r.cid}" value="${x.p.id}" ${r.pick===x.p.id?"checked":""}> <span>${r.cands.length>1&&cetCm(x.p,r.cands)?`<b class="ok">★ Empfehlung: Cardmarket-Konto</b><br>`:""}<b>Nr. ${x.p.id}</b>${x.p.ref?` · Referenz <span class="mono">${esc(String(x.p.ref))}</span>`:""}: ${esc(x.p.name||"")}${Array.isArray(x.p.parent_id)?` <span class="muted">(gehört zu ${esc(String(x.p.parent_id[1]||""))})</span>`:""}<br><span class="muted">${esc(etronTel(x.p))}${x.p.email?" · "+esc(x.p.email):""} · passt: ${x.why.join(", ")||"-"}</span></span></label>`).join("")+`<label class="row muted"><input type="radio" name="cet-${r.cid}" data-cet="${r.cid}" value="" ${r.pick?"":"checked"}> keiner davon</label>`+`<div style="margin-top:4px"><input data-cetin="${r.cid}" placeholder="andere etron-Nr." style="width:150px" inputmode="numeric"></div>`+(r.cands.length>1?`<p class="muted" style="margin:4px 0 0">Mehrere Konten: am besten in etron auf das Cardmarket-Konto zusammenführen (geht nur ohne offene Kassensitzung).</p>`:"")}</td></tr>`; }).join("")}</tbody></table></div>`:"";
  const sure=rows.filter(r=>r.cands.length===1&&!r.err), multi=rows.filter(r=>r.cands.length>1&&!r.err), none=rows.filter(r=>!r.cands.length||r.err); const n=rows.filter(r=>r.pick).length;
  return `<div class="panel"><div class="row spread"><h2>Abgleich mit etron</h2><button class="sm" id="cet-x">Schließen</button></div>
    <p class="muted">${st.running?`… suche ${st.done} von ${st.total}`:`${st.total} Kunden ohne etron-Nr. geprüft.`} Ein einzelner passender Treffer ist vorausgewählt. Bei mehreren Konten (z. B. Laden, Webshop, Cardmarket) wird nie automatisch gewählt: bitte das Konto mit der richtigen Kundenreferenz wählen. In etron wird nichts geändert.</p>
    ${grp("Ein Treffer",sure)}${grp("Mehrere mögliche Konten: bitte wählen",multi)}${grp("Nicht gefunden",none)}
    ${st.running?"":`<div class="row"><button class="pri" id="cet-ok" ${n?"":"disabled"}>${n} etron-Nr. übernehmen</button>${multi.length?`<button id="cet-cp">Liste mehrfacher Konten kopieren (${multi.length})</button>`:""}</div><textarea id="cet-ta" hidden rows="8" style="width:100%"></textarea>`}</div>`; }
// Textliste der Kunden mit mehreren etron-Konten (zum Einfügen z. B. in Asana)
function cetMultiText(){ const rows=(S.cet?.rows||[]).filter(r=>r.cands.length>1&&!r.err&&S.customers[r.cid]).sort((a,b)=>S.customers[a.cid].name.localeCompare(S.customers[b.cid].name,"de"));
  return `Doppelte etron-Konten (${rows.length} Kunden), Stand ${fmtDate(today())}\n\n`+rows.map(r=>{ const c=S.customers[r.cid]; const cm=r.cands.find(x=>cetCm(x.p,r.cands));
    return `${c.name}${cm?` → zusammenführen auf Nr. ${cm.p.id} (Cardmarket, Referenz ${cm.p.ref})`:" → Cardmarket-Konto unklar"}\n`+r.cands.map(x=>`  - Nr. ${x.p.id}${x.p.ref?`, Referenz ${x.p.ref}`:", keine Referenz"}: ${x.p.name||""}`).join("\n"); }).join("\n\n"); }
function drawCet(){ const box=$("#cet-box"); if(!box) return; box.innerHTML=cetHtml(); bindCet(); }
function bindCet(){ const x=$("#cet-x"); if(x) x.onclick=()=>{ S.cet=null; drawCet(); };
  app.querySelectorAll("[data-cetin]").forEach(el=>{ el.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); el.blur(); } };
    el.onchange=async()=>{ const v=el.value.replace(/[\s.#]/g,""); if(!v) return; if(!/^\d+$/.test(v)) return toast("Bitte nur die Zahl eintragen.");
      const cid=el.dataset.cetin; el.disabled=true; await saveEtron(cid,v); if(String(S.customers[cid]?.etronId||"")===v){ S.cet.rows=S.cet.rows.filter(r=>r.cid!==cid); drawCet(); const nx=app.querySelector("[data-cetin]"); if(nx) nx.focus(); } else el.disabled=false; }; });
  app.querySelectorAll("[data-cet]").forEach(el=>el.onchange=()=>{ const r=S.cet.rows.find(r=>r.cid===el.dataset.cet); if(r) r.pick=el.value?+el.value:null; const b=$("#cet-ok"); if(b){ const n=S.cet.rows.filter(r=>r.pick).length; b.textContent=`${n} etron-Nr. übernehmen`; b.disabled=!n; } });
  const cp=$("#cet-cp"); if(cp) cp.onclick=async()=>{ const t=cetMultiText(); try{ await navigator.clipboard.writeText(t); toast("Liste kopiert. Jetzt einfügen, z. B. im Asana-Task."); }catch(e){ const ta=$("#cet-ta"); ta.hidden=false; ta.value=t; ta.focus(); ta.select(); toast("Kopieren nicht möglich: Text unten markieren und kopieren."); } };
  const ok=$("#cet-ok"); if(ok) ok.onclick=async()=>{ if(needStaff()) return; ok.disabled=true; const rows=S.cet.rows.filter(r=>r.pick&&S.customers[r.cid]&&!String(S.customers[r.cid].etronId||"").trim());
    const used=new Map(Object.values(S.customers).filter(c=>c.etronId).map(c=>[String(c.etronId).trim(),c.id])); let n=0, dup=0, nf=0, nd=0;
    for(const r of rows){ const id=String(r.pick); if(used.has(id)&&used.get(id)!==r.cid) dup++; const p=r.cands.find(x=>x.p.id===r.pick)?.p; if(await write("customers",r.cid,{etronId:id,...(p?.ref?{etronRef:String(p.ref)}:{})})){ n++; used.set(id,r.cid); const fr=p?await etronFillContact(r.cid,p):null; if(fr){ nf+=fr.filled.length?1:0; nd+=fr.differ.length?1:0; } } }
    dlog("INFO",`etron-Abgleich übernommen: ${n} Kunden${dup?`, ${dup} mit schon vergebener Nr.`:""}`);
    S.cet.rows=S.cet.rows.filter(r=>!rows.includes(r)); toast(`${n} etron-Nummern gespeichert${nf?`, bei ${nf} Kontakt aus etron ergänzt`:""}${nd?`, bei ${nd} weicht der Kontakt von etron ab (beim Kunden abgleichen)`:""}${dup?`. Achtung: ${dup} Nummern sind schon bei einem anderen Kunden eingetragen (siehe Dubletten).`:""}`, dup?9000:4000); drawCet(); }; }

function renderCustomers(){
  const q=norm(S.cq||""); const onlyD=S.cdup;
  const counts={}; Object.values(S.orders).forEach(o=>{ const c=counts[o.customerId]||(counts[o.customerId]={n:0,open:0}); if(COUNTS(o.status)){c.n++; if(o.status==="Offen"||o.status==="Zugeteilt") c.open+=(o.alloc||o.qty||0);} });
  const eq=String(S.ceq||"").replace(/[\s.#]/g,"");
  const cs=Object.values(S.customers).map(c=>({...c,d:dupesOf(c)})).filter(c=>(!q||nameMatch(q,c)||String(c.etronId||"").includes(S.cq.trim())) && (!eq||String(c.etronId||"").trim()===eq||String(c.etronRef||"").trim().toLowerCase()===eq.toLowerCase()) && (!onlyD||c.d.length) && (!S.cnoe||!c.etronId) && (!S.cunc||!nameChecked(c))).sort((a,b)=>a.name.localeCompare(b.name,"de"));
  const dn=Object.values(S.customers).filter(c=>dupesOf(c).length).length;
  app.innerHTML=`<div class="row spread"><h1>Kunden</h1><div class="row">${etronOn()?`<button id="cet" ${S.cet?.running?"disabled":""}>Mit etron abgleichen</button>`:""}<button class="pri" id="cnew">+ Neuer Kunde</button></div></div><div id="cl-ncbox"></div><div id="cet-box">${cetHtml()}</div><div><p class="sub">${Object.keys(S.customers).length} Kunden, davon ${Object.values(S.customers).filter(c=>!c.etronId).length} ohne etron-Nr. ${dn?`${dn} sehen nach Dublette aus: <a class="back" href="#dubletten">jetzt prüfen</a>.`:""}</p></div>
  <div class="row"><input id="cq" class="search" placeholder="Kunde suchen" value="${esc(S.cq||"")}"><input id="ceq" class="search" style="max-width:190px" placeholder="etron-Nr. oder Referenz" value="${esc(S.ceq||"")}"><label class="row muted"><input type="checkbox" id="cdup" ${onlyD?"checked":""}> Nur mögliche Dubletten</label><label class="row muted"><input type="checkbox" id="cnoe" ${S.cnoe?"checked":""}> Nur ohne etron-Nr.</label><label class="row muted"><input type="checkbox" id="cunc" ${S.cunc?"checked":""}> Vor-/Nachname ungeprüft (${Object.values(S.customers).filter(c=>!nameChecked(c)).length})</label></div>
  ${eq?`<div class="note" id="ceq-info">${cs.length?`${cs.length} Kunde${cs.length>1?"n":""} mit etron-Nr./Referenz ${esc(eq)}${cs.length>1?" (Dublette?)":""}.`:`Kein Kunde in der App hat die etron-Nr. oder Referenz ${esc(eq)}.`}${etronOn()?` <button class="sm" id="ceq-et">In etron nachsehen</button> <span id="ceq-r"></span>`:""}</div>`:""}
  <div class="tablebox"><table><thead><tr><th>Kunde</th><th>etron-Nr.</th><th>Kontakt</th><th class="n">Bestellungen</th><th class="n">Stück offen</th><th>Ähnlich</th></tr></thead><tbody>
  ${cs.map(c=>`<tr class="click" data-go="kunde-${c.id}"><td>${custFlags(c)}<a href="#kunde-${c.id}">${esc(c.name)}</a></td><td><input data-cf="${c.id}" id="e-${c.id}" style="width:110px" value="${esc(c.etronId||"")}" placeholder="fehlt">${etronUrl(c)?` <a href="${esc(etronUrl(c))}" target="_blank" rel="noopener" title="In etron öffnen">↗</a>`:""}</td><td>${esc(c.contact||"")}</td><td class="n">${counts[c.id]?.n||0}</td><td class="n">${counts[c.id]?.open||""}</td><td>${c.d.map(x=>esc(x.name)).join(", ")}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">Kein Kunde gefunden.</td></tr>`}
  </tbody></table></div>`;
  $("#cq").oninput=e=>{S.cq=e.target.value;render();};
  $("#ceq").oninput=e=>{S.ceq=e.target.value;render();};
  const ceb=$("#ceq-et"); if(ceb) ceb.onclick=async()=>{ const out=$("#ceq-r"); out.textContent="… suche"; ceb.disabled=true;
    try{ const r=await etronCall("partner_search",{q:eq}); const hits=(r.items||[]).filter(p=>String(p.id)===eq||String(p.ref||"").toLowerCase()===eq.toLowerCase());
      out.innerHTML=hits.length?hits.map(p=>{ const inApp=Object.values(S.customers).find(c=>String(c.etronId||"")===String(p.id)); return `<b>Nr. ${p.id}</b>${p.ref?` · Ref. ${esc(String(p.ref))}`:""}: ${esc(p.name||"")} <span class="muted">${esc(etronTel(p))}${p.email?" · "+esc(p.email):""}</span>${inApp?` → in der App: <a href="#kunde-${inApp.id}">${esc(inApp.name)}</a>`:" → noch mit keinem Kunden in der App verknüpft"}`; }).join("<br>"):`<span class="bad">In etron gibt es keinen Kunden mit Nr. oder Referenz ${esc(eq)}.</span>`; }
    catch(e){ out.innerHTML=`<span class="bad">✗ ${esc(e.message||e)}</span>`; } ceb.disabled=false; };
  $("#cdup").onchange=e=>{S.cdup=e.target.checked;renderCustomers();};
  $("#cnew").onclick=()=>openCustNew("cl", $("#cl-ncbox"), S.cq||"", cid=>{ location.hash="kunde-"+cid; });
  $("#cnoe").onchange=e=>{S.cnoe=e.target.checked;renderCustomers();};
  const cet=$("#cet"); if(cet) cet.onclick=()=>{ cet.disabled=true; runCet().catch(e=>toast("Abgleich: "+(e.message||e))); }; bindCet();
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
    ${etronOn()&&c.etronId?`<div class="wide"><button type="button" class="sm" id="cd-etc">Kontakt mit etron abgleichen</button> <span id="cd-etcr" class="muted"></span></div>`:""}
    ${etronOn()&&!c.etronId?`<div class="wide" id="cd-et"><button type="button" class="sm" id="cd-ets">etron-Kunde suchen oder anlegen</button> <span id="cd-eth" class="muted"></span></div>`:""}
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
  const etc=$("#cd-etc"); if(etc) etc.onclick=async()=>{ const h=$("#cd-etcr"); h.textContent="Lese etron …";
    try{ const p=await etronPartner(c.etronId); if(!p){ h.innerHTML=`<span class="bad">etron-Nr. ${esc(c.etronId)} nicht gefunden.</span>`; return; }
      const r=await etronFillContact(cid,p); const cc=S.customers[cid]; const d=etronContactDiff(cc,p);
      const line=(lbl,x,f)=>x.same?"":`<div>${lbl}: App <b>${esc(x.app||"–")}</b>, etron <b>${esc(x.etron)}</b> <button type="button" class="sm" data-etk="${f}">etron-Wert übernehmen</button></div>`;
      const diffs=line("Telefon",d.tel,"tel")+line("E-Mail",d.mail,"mail");
      h.innerHTML=(r?.filled.length?`<span class="ok">✓ ${r.filled.join(" und ")} aus etron ergänzt.</span> `:"")+(diffs||(r?.filled.length?"":`<span class="ok">✓ Telefon und E-Mail stimmen mit etron überein.</span>`));
      h.querySelectorAll("[data-etk]").forEach(b=>b.onclick=async()=>{ const c2=S.customers[cid], cf=contactFields(c2); const tel=b.dataset.etk==="tel"?d.tel.etron:cf.tel, mail=b.dataset.etk==="mail"?d.mail.etron:cf.mail;
        if(await write("customers",cid,{contact:joinContact(tel||"",mail||"",c2)})) toast("Aus etron übernommen"); }); }
    catch(e){ h.textContent="etron nicht lesbar: "+(e.message||e); } };
  const ets=$("#cd-ets"); if(ets) ets.onclick=async()=>{ const h=$("#cd-eth"); const np=nameParts(c), tel=contactFields(c).tel; h.textContent="Suche in etron …";
    try{ const list=await etronFindPartners(np.first,np.last,tel);
      h.innerHTML=(list.length?`Gefunden (anklicken übernimmt die etron-Nr.): ${etronHitsHtml(list)} `:"In etron kein passender Kunde. ")+`${countrySel("cd-ncty")} <button type="button" class="sm pri" id="cd-etn">Neu in etron anlegen</button>`;
      h.querySelectorAll("[data-epid]").forEach(b=>b.onclick=async()=>{ const p=list.find(x=>String(x.id)===b.dataset.epid); if(await write("customers",cid,{etronId:b.dataset.epid,...(p?.ref?{etronRef:String(p.ref)}:{})})){ const r=await etronFillContact(cid,p); toast("etron-Nr. übernommen."+fillMsg(r),6000); } });
      $("#cd-etn").onclick=async()=>{ if(needStaff()) return; const b=$("#cd-etn"); b.disabled=true; try{ const id=await etronCreatePartner(np.first,np.last,tel,contactFields(c).mail,$("#cd-ncty")?.value||"AT"); await write("customers",cid,{etronId:String(id)}); toast(`In etron angelegt: Nr. ${id}`); }catch(e){ b.disabled=false; toast("Nicht angelegt: "+(e.message||e)); } }; }
    catch(e){ h.textContent="etron-Suche nicht möglich: "+(e.message||e); } };
  if($("#cd-ok")) $("#cd-ok").onclick=()=>saveName($("#cd-fn").value,$("#cd-ln").value);
  $("#cd-wa").onchange=e=>write("customers",cid,{noWhatsapp:!e.target.checked}).then(ok=>ok&&toast("Gespeichert"));
  $("#cd-etronId").onchange=e=>saveEtron(cid,e.target.value);
  bindRows(); bindOrderForm("cu");
  $("#mg").onclick=()=>{ const t=$("#mt").value; if(!t) return toast("Bitte Ziel-Kunde wählen."); const tn=S.customers[t].name;
    $("#mgc").innerHTML=`<span class="muted">${os.length} Bestellungen zu „${esc(tn)}“ verschieben?</span> <button class="sm danger" id="mgok">Ja, zusammenführen</button>`;
    $("#mgok").onclick=async()=>{ if(await mergeCustomers(cid,t)) location.hash="kunde-"+t; }; };
}

// Telefon/E-Mail aus etron: leere Felder in der App füllen, abweichende nur melden (nie still überschreiben)
async function etronPartner(id){ const r=await etronCall("partner_search",{q:String(id)}); return (r.items||[]).find(p=>String(p.id)===String(id))||null; }
function etronContactDiff(c, p){ const cf=contactFields(c), ph=String(p.phone&&p.phone!==false?p.phone:"").trim(), mo=String(p.mobile&&p.mobile!==false?p.mobile:"").trim(), et=ph||mo, em=String(p.email&&p.email!==false?p.email:"").trim();
  return {tel:{app:cf.tel||"",etron:et,same:!et||!!cf.tel&&[ph,mo].filter(Boolean).some(x=>telKey(x)===telKey(cf.tel))},mail:{app:cf.mail||"",etron:em,same:!em||em.toLowerCase()===(cf.mail||"").toLowerCase()}}; }
async function etronFillContact(cid, p){ try{ const c=S.customers[cid]; if(!c||!etronOn()) return null; p=p||await etronPartner(c.etronId); if(!p) return null;
    const d=etronContactDiff(c,p), cf=contactFields(c); const tel=!cf.tel&&d.tel.etron?d.tel.etron:cf.tel, mail=!cf.mail&&d.mail.etron?d.mail.etron:cf.mail; const filled=[];
    if(tel!==cf.tel) filled.push("Telefon"); if(mail!==cf.mail) filled.push("E-Mail");
    if(filled.length) await write("customers",cid,{contact:joinContact(tel||"",mail||"",c)});
    const differ=[]; if(cf.tel&&!d.tel.same) differ.push("Telefon"); if(cf.mail&&!d.mail.same) differ.push("E-Mail");
    dlog("INFO",`Kontakt aus etron für Kunde ${cid}: ergänzt ${filled.join("+")||"nichts"}${differ.length?", abweichend "+differ.join("+"):""}`); return {filled,differ}; }
  catch(e){ dlog("WARN",`Kontakt aus etron für Kunde ${cid}: ${e.message||e}`); return null; } }
const fillMsg = r => r ? (r.filled.length?` ${r.filled.join(" und ")} aus etron ergänzt.`:"")+(r.differ.length?` ${r.differ.join(" und ")} weicht von etron ab: beim Kunden „Kontakt mit etron abgleichen“.`:"") : "";
async function saveEtron(cid,v){
  v=String(v||"").trim(); const c=S.customers[cid]; if(!c) return;
  const other=v && Object.values(S.customers).find(x=>x.id!==cid && String(x.etronId||"").trim()===v);
  if(await write("customers",cid,{etronId:v})){ toast(other?`Gespeichert. Achtung: ${other.name} hat dieselbe etron-Nr. und steht jetzt bei den Dubletten.`:"etron-Nr. gespeichert"); if(v&&!other){ const r=await etronFillContact(cid); const m=fillMsg(r); if(m) toast("etron-Nr. gespeichert."+m,7000); } }
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
  app.innerHTML=`<div><h1>Dubletten</h1><p class="sub">${pairs.length} mögliche doppelte Einträge (ähnlicher Name, gleiche etron-Nr., Telefonnummer oder E-Mail). Die App prüft das automatisch bei jeder Änderung. Gehören zwei Einträge wirklich zu verschiedenen Personen (z. B. Familie mit einer Nummer), „Kein Duplikat“ klicken. Beim Zusammenführen wandern alle Bestellungen zum behaltenen Kunden, Kontakt und etron-Nr. werden übernommen, falls dort leer.</p></div>
  ${pairs.length?pairs.map(([a,b])=>`<div class="panel"><div class="row spread"><h2>${dupeWhy(a,b).map(w=>`<span class="pill ${w==="ähnlicher Name"?"s-Warteliste":"s-Storniert"}" style="text-decoration:none">${w}</span> `).join("")}${esc(a.name)} / ${esc(b.name)}</h2>
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
  // Erweiterung beim Start nicht erkannt (z. B. noch nicht bereit)? Hier erneut prüfen und dann die etron-Knöpfe zeigen.
  if(!S.desktop && !S.extOk && Date.now()-(S.extT||0)>3000){ S.extT=Date.now(); extCheck().then(v=>{ dlog(v?"INFO":"WARN",`etron-Erweiterung im Export ${v?"erkannt "+v:"nicht erkannt"}`); if(v && h0()==="export") render(); }); }
  const rows=exportRows(); const byC={};
  const shownRows=[...rows, ...[...S.doneNow].map(id=>S.orders[id]).filter(o=>o&&o.status==="Auftrag angelegt"&&inGame(S.products[o.productId]))];
  shownRows.filter(o=>nameMatch(S.oq, S.customers[o.customerId])).forEach(o=>(byC[o.customerId]=byC[o.customerId]||[]).push(o));
  app.innerHTML=`<div><h1>etron-Export${S.game==="Alle"?"":" · "+esc(S.game)}</h1><p class="sub">Alle Bestellungen mit Status „Zugeteilt“. Daraus werden in etron onRetail die Aufträge angelegt. Danach pro Position den Haken bei „Auftrag angelegt“ setzen. Abgehakte bleiben bis zum Neuladen grau sichtbar, falls du dich verklickt hast.</p></div>
  <div class="tiles"><div class="tile"><b>${new Set(rows.map(o=>o.customerId)).size}</b><span>Kunden offen</span></div><div class="tile"><b>${rows.length}</b><span>Positionen</span></div><div class="tile"><b>${rows.reduce((s,o)=>s+o.alloc,0)}</b><span>Stück</span></div></div>
  ${Object.keys(byC).some(id=>!S.customers[id]?.etronId)?`<div class="note">${Object.keys(byC).filter(id=>!S.customers[id]?.etronId).length} Kunden haben noch keine etron-Nr. Bitte vor dem Anlegen der Aufträge unter Kunden eintragen.</div>`:""}
  ${(()=>{ const pend=Object.values(S.orders).filter(o=>o.status==="Offen"&&(o.alloc||0)>0&&o.productId&&inGame(S.products[o.productId])); if(!pend.length) return "";
    const ps=[...new Set(pend.map(o=>o.productId))]; return `<div class="note">${pend.length} Bestellungen haben schon eine Zuteilung, stehen aber noch auf „Offen“ und erscheinen deshalb hier nicht. Auf der Produktseite „Zuteilung abschließen“ klicken: ${ps.map(id=>`<a href="#produkt-${id}">${esc(S.products[id]?.name||"?")}</a>`).join(", ")}</div>`; })()}
  <div class="row">${oqInput()}</div>
  ${!etronOn()&&rows.length?`<div class="note bad">Die etron-Erweiterung wird in diesem Fenster nicht erkannt, deshalb fehlt „In etron anlegen“. Bitte unter <a href="#einstellungen">Einstellungen → etron-Schnittstelle</a> prüfen, ob die Erweiterung aktiv ist. In Chrome unter chrome://extensions muss „TCG Vorbestellungen – etron-Verbindung“ eingeschaltet sein. Danach die App einmal neu laden.</div>`:""}
  ${etronOn()&&(rows.length||S.etRes?.length)?`<div class="panel"><h2>Aufträge direkt in etron anlegen</h2><p class="muted">Legt pro Kunde einen Auftrag ${odooCfg().confirm?`an und <b>bestätigt ihn sofort</b>`:`als <b>Angebot (Entwurf)</b> an`} (Artikel über die Artikelnummer, Stichwort aus den Einstellungen unten) und setzt die Positionen auf „Auftrag angelegt“.${odooCfg().confirm?"":" In etron prüfen und bestätigen."}</p>
    <label class="row" style="gap:6px"><input type="checkbox" id="et-conf" ${odooCfg().confirm?"checked":""}> Aufträge direkt bestätigen statt Angebot anlegen</label>
    <p class="muted" style="margin-top:0">${odooCfg().confirm?`<span class="bad">An:</span> `:"Aus (empfohlen, bis alles geprüft ist). "}Bestätigte Aufträge reservieren in etron sofort Ware im Lager und erzeugen Lieferungen. Sie lassen sich nur in etron wieder stornieren.</p>
    <div class="row"><button class="pri" id="eall">Alle ${new Set(rows.filter(o=>S.customers[o.customerId]?.etronId).map(o=>o.customerId)).size} Kunden in etron anlegen</button><span id="eallc"></span></div><div id="eres">${(S.etRes||[]).join("")}</div></div>`:""}
  ${odooPanel(rows)}
  <div class="row"><button class="pri" id="dl" ${rows.length?"":"disabled"}>CSV herunterladen</button><button id="cp" ${rows.length?"":"disabled"}>Als Text kopieren</button><button id="mk" ${rows.length&&S.canWrite?"":"disabled"}>Alle als „Auftrag angelegt“ markieren</button><span id="mkc"></span></div>
  ${shownRows.length?Object.entries(byC).map(([cid,list])=>{const c=S.customers[cid]||{};return `<div class="panel"><div class="row spread"><h2>${custFlags({...c,id:cid})}<a class="back" href="#kunde-${cid}">${esc(c.name||"?")}</a></h2><span class="muted">${etronOn()&&c.etronId&&list.some(o=>o.status==="Zugeteilt")?`<button class="sm" data-eone="${cid}">In etron anlegen</button> `:""}${c.etronId?"etron-Nr. "+esc(c.etronId)+" "+etronLink({...c,id:cid}):`<span style="color:var(--bad);font-weight:600">etron-Nr. fehlt</span>${etronOn()?` <button class="sm" data-exs="${cid}">In etron suchen</button>`:""}`} <span id="exs-${cid}"></span> · ${esc(c.contact||"")}</span></div>
    <div class="tablebox"><table><thead><tr><th>Produkt</th><th class="n">Menge</th><th>Kommentar</th><th>Auftrag angelegt</th><th>Nachricht</th></tr></thead><tbody>${list.map(o=>`<tr class="${o.status==="Auftrag angelegt"?"dim":""}"><td>${esc(S.products[o.productId]?.name||"?")}${S.products[o.productId]?.articleNo?` <span class="muted">Art.-Nr. ${esc(S.products[o.productId].articleNo)}</span>`:""}${/^https?:\/\//.test(S.products[o.productId]?.etronUrl||"")?` <a href="${esc(S.products[o.productId].etronUrl)}" target="_blank" rel="noopener">etron</a>`:""}</td><td class="n">${o.alloc}</td><td>${esc(o.comment||"")}</td><td style="text-align:center">${auftragBox([o])}</td><td>${msgBtn([o])}</td></tr>`).join("")}</tbody></table></div></div>`}).join(""):`<div class="empty">Gerade nichts zu exportieren. Sobald bei einem Produkt die Zuteilung abgeschlossen ist, erscheinen die Kunden hier.</div>`}
  <div class="panel"><h2>Gesamtsicherung</h2><p class="muted">Alle Produkte, Kunden und Bestellungen als eine JSON-Datei, z. B. für den Umzug in die Dropbox.</p><div class="row"><button id="bk">Alle Daten exportieren (JSON)</button></div></div>
  <textarea id="ta" hidden rows="6" style="width:100%"></textarea>`;
  $("#bk").onclick=backup; bindAuftrag();
  if(!rows.length) return;
  bindOq();
  bindOdoo(rows);
  const runEt=async(cids)=>{ if(needStaff()) return; S.etRes=[]; const log=(t,cls)=>{ S.etRes.push(`<p class="${cls||""}">${t}</p>`); const res=$("#eres"); if(res) res.innerHTML=S.etRes.join(""); };
    let ok=0, lk=0, errs=[]; dlog("INFO",`etron-Aufträge anlegen gestartet für Kunden ${cids.join(", ")}`); for(const cid of cids){ const list=rows.filter(o=>o.customerId===cid&&S.orders[o.id]?.status==="Zugeteilt"); if(!list.length){ dlog("WARN",`Kunde ${cid}: keine zugeteilten Positionen mehr`); errs.push("keine zugeteilten Positionen"); continue; } const name=esc(S.customers[cid]?.name||"?");
      try{ const r=await etronOrderFor(cid,list); lk+=r.linked.length; if(r.oid){ ok++; log(`✓ ${name}: ${r.confirmed?"Auftrag":"Angebot"} ${esc(String(r.oid))} angelegt${r.confirmed?" und bestätigt":""} (${r.n} Positionen)`,"ok"); if(r.confErr) log(`✗ ${name}: Angebot ${esc(String(r.oid))} ist angelegt, aber das Bestätigen hat nicht geklappt: ${esc(r.confErr)}. Bitte in etron bestätigen.`,"bad"); }
        for(const x of r.linked) log(`↺ ${name}: ${esc(S.products[x.o.productId]?.name||"?")} ist in etron schon im Auftrag ${esc(x.order)} (${x.qty} Stk.${x.qty!==x.o.alloc?`, in der App ${x.o.alloc} Stk.: bitte prüfen`:""}). Nicht doppelt angelegt, nur verknüpft.`, x.qty!==x.o.alloc?"bad":"ok"); }catch(e){ dlog("ERROR",`Auftrag Kunde ${cid} fehlgeschlagen: ${e.message||e}`); errs.push(String(e.message||e)); log(`✗ ${name}: ${esc(e.message||e)}`,"bad"); } }
    const box=$("#eres"); if(box) box.scrollIntoView({behavior:"smooth",block:"center"});
    toast((errs.length?`${ok} Aufträge angelegt. Fehler: ${errs[0]}`:`${ok} Aufträge in etron angelegt`)+(lk?`. ${lk} Positionen waren schon in etron und wurden nur verknüpft.`:""), errs.length?12000:4000); return ok; };
  const ea=$("#eall"); if(ea) ea.onclick=()=>{ const cids=[...new Set(rows.filter(o=>S.customers[o.customerId]?.etronId).map(o=>o.customerId))];
    $("#eallc").innerHTML=` <button class="sm danger" id="eallok">Ja, ${cids.length} Aufträge anlegen</button>`; $("#eallok").onclick=async()=>{ $("#eallok").disabled=true; ea.disabled=true; await runEt(cids); }; };
  const ecf=$("#et-conf"); if(ecf) ecf.onchange=async()=>{ if(needStaff()){ ecf.checked=!ecf.checked; return; } const on=ecf.checked; if(await write("config","odoo",{...odooCfg(),confirm:on},"set")){ dlog("INFO","Aufträge direkt bestätigen: "+(on?"an":"aus")); toast(on?"Aufträge werden ab jetzt direkt bestätigt.":"Aufträge werden wieder als Angebot angelegt."); } };
  app.querySelectorAll("[data-exs]").forEach(b=>b.onclick=async()=>{ const cid=b.dataset.exs, c=S.customers[cid], out=$("#exs-"+cid); b.disabled=true; out.textContent=" … suche";
    try{ const cands=await cetSearch(c); if(!cands.length){ out.innerHTML=` <span class="muted">In etron nicht gefunden. Auf der Kundenseite kannst du ihn neu anlegen.</span>`; b.disabled=false; return; }
      out.innerHTML=" "+cands.map((x,n)=>`<button class="sm${cands.length>1&&cetCm(x.p,cands)?" pri":""}" data-exp="${n}" title="passt: ${esc(x.why.join(", "))}">${cands.length>1&&cetCm(x.p,cands)?"★ Cardmarket · ":""}Nr. ${x.p.id}${x.p.ref?" · Ref. "+esc(String(x.p.ref)):""}: ${esc(x.p.name||"")} <span class="muted">${esc(etronTel(x.p))}</span></button>`).join(" ")+(cands.length>1?` <span class="muted">Mehrere Konten: richtiges wählen, am besten das Cardmarket-Konto.</span>`:"");
      out.querySelectorAll("[data-exp]").forEach(e=>e.onclick=async()=>{ if(needStaff()) return; const p=cands[+e.dataset.exp].p; const other=Object.values(S.customers).find(x=>x.id!==cid&&String(x.etronId||"").trim()===String(p.id));
        if(await write("customers",cid,{etronId:String(p.id),...(p.ref?{etronRef:String(p.ref)}:{})})){ const r=await etronFillContact(cid,p); toast(`etron-Nr. ${p.id} übernommen.`+fillMsg(r)+(other?` Achtung: ${other.name} hat dieselbe Nr.`:""),7000); } }); }
    catch(e){ out.innerHTML=` <span class="bad">✗ ${esc(e.message||e)}</span>`; b.disabled=false; } });
  app.querySelectorAll("[data-eone]").forEach(b=>b.onclick=async()=>{ b.disabled=true; await runEt([b.dataset.eone]); });
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
  archived: "Zuteilung abgeschlossen", restock: "Wartend auf Nachlieferung", series: "Serie", game: "Spiel", kuerzel: "Kürzel", unit: "Einheit", variant: "Variante", group: "Gruppe", text: "Text", msgName: "Name in Nachrichten", articleNo: "Artikelnummer", etronArtId: "etron-Artikel-ID", etronUrl: "etron-Link" };
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
  ["etron auf einem PC einrichten (einmalig)", `<ol><li>Die App in <b>Chrome</b> öffnen (https://electronicfallout.github.io/TCG-Preorder/) und mit der Dropbox verbinden (Einladungscode aus Einstellungen → Kollegen einladen).</li>
    <li>Als App installieren: Chrome-Menü ⋮ → „Streamen, speichern und teilen“ → „Seite als App installieren“. Dann gibt es ein eigenes Fenster und ein Symbol auf dem Desktop.</li>
    <li>Erweiterung laden: in Chrome <span class="mono">chrome://extensions</span> öffnen → oben rechts <b>Entwicklermodus</b> einschalten → <b>Entpackte Erweiterung laden</b> → den Ordner <span class="mono">erweiterung</span> aus dem Dropbox-Ordner wählen. Den Ordner danach nicht verschieben.</li>
    <li>App neu laden. Unter Einstellungen → etron-Schnittstelle steht dann „✓ Erweiterung aktiv“. Den Zugang muss nur ein PC einmal speichern (liegt in der Dropbox).</li>
    <li>Zugang anlegen (nur einmal): in etron mit dem <b>Firmenkonto</b> anmelden (Benutzertyp „Interner Benutzer“ mit Verkaufsrechten, nicht das private Konto) → API &amp; Hooks → Authentication → Client Credentials. Adresse, Client Key und Secret unter Einstellungen → etron eintragen und „Verbindung testen“.</li>
    <li>Danach einmal in der Kundenliste <b>„Mit etron abgleichen“</b> und bei den Produkten oben <b>„Artikel in etron suchen“</b> → „Übernehmen“.</li></ol>`],
  ["Kunden per WhatsApp benachrichtigen (nacheinander)", `<ol><li>Auf der Produkt- oder Serienseite oben bei den Bestellungen auf <b>„📱 WhatsApp nacheinander“</b> klicken. Die Zahl sagt, wie viele Nachrichten noch offen sind (Abholung, Storno, Warteliste).</li>
    <li>Die App zeigt den ersten Kunden mit dem fertigen Text (Vorlage mit {Stück}, {Tag} usw.). Der Text kann vorher noch geändert werden. „Abholung ab“ setzt das Datum für alle.</li>
    <li><b>„WhatsApp öffnen und weiter“</b>: WhatsApp öffnet sich mit dem Text, dort nur noch <b>Senden</b> drücken. Die Nachricht wird in der App als gesendet markiert, und der nächste Kunde kommt.</li>
    <li>Ohne Telefonnummer oder mit „kein WhatsApp“: Text kopieren oder überspringen. Übersprungene stehen am Ende in der Liste.</li>
    <li>Oben wählst du, ob die <b>WhatsApp-App am PC</b> (empfohlen) oder <b>WhatsApp Web</b> geöffnet wird. Beim ersten Mal fragt Chrome, ob WhatsApp geöffnet werden darf: „Immer erlauben“ anhaken.</li></ol>`],
  ["Ware ist da: zuteilen", `<ol><li>Auf der Produktseite unter Produktdaten den <b>Wareneingang</b> eintragen. Ist eine <b>Verpackungseinheit</b> hinterlegt (z. B. 8 Displays pro Karton), kann die Menge auch direkt in VE eingetragen werden; die Stückzahl wird dann ausgerechnet.</li>
    <li>Bei „Zuteilung“ wählen: <b>Proportional</b> (fair verteilt) oder <b>Nach Bestelldatum</b>. Mit <b>„Jeder mind. 1 Stück“</b> bekommt zuerst jeder Kunde eins (reicht die Ware nicht für alle, nach Bestelldatum), der Rest wird dann wie gewählt verteilt. Dann <b>Vorschlag berechnen</b>.</li>
    <li>Vorschlag prüfen, eventuell einzelne Zahlen in der Tabelle ändern, dann <b>Vorschlag übernehmen</b>.</li>
    <li><b>Zuteilung abschließen</b> setzt alle Bestellungen mit Zuteilung auf „Zugeteilt“. Wer nichts bekommt, kann auf „Warteliste“ gesetzt werden.</li>
    <li>Wird danach wieder etwas frei (Storno oder Nachlieferung im Wareneingang erhöhen), erscheint <b>„Freie Menge nachzuteilen“</b>. Bestehende Zuteilungen bleiben, nur die freie Menge wird an Warteliste und Teil-Zuteilungen verteilt.</li></ol>`],
  ["Auftrag in etron anlegen", `<p>Reiter <b>etron-Export</b> zeigt alle zugeteilten Bestellungen nach Kunde. Den Auftrag in etron anlegen und danach den <b>Haken</b> in der Spalte „Auftrag“ setzen. Der Haken geht auch direkt auf der Produktseite. Ohne etron-Nr. beim Kunden bitte zuerst die Nummer nachtragen.</p>`],
  ["Kunden benachrichtigen", `<p>In jeder Bestellzeile gibt es zwei Knöpfe:</p>
    <ul><li><b>📋 Abholung / Storno / Warteliste</b>: kopiert mit einem Klick den passenden Text (mit Spiel, Produkt und Abholdatum heute). In WhatsApp oder SMS einfügen. Die Nachricht gilt danach als gesendet.</li>
    <li><b>Nachricht</b>: öffnet das Fenster zum Anpassen (anderes Abholdatum, andere Vorlage, eigener Text) und kann WhatsApp oder E-Mail direkt öffnen.</li></ul>
    <p>Im Filter „aktiv“ stehen neben offenen Bestellungen und der Warteliste auch alle, bei denen die Nachricht (Abholung, Storno, Warteliste) noch nicht gesendet ist. Mit 📱 startest du WhatsApp für einen einzelnen Kunden, im Nachrichtenfenster kannst du eine Nachricht wieder „als ungesendet markieren“.</p>
    <p>Farbe des Nachricht-Knopfs: <span class="pill" style="background:#1d4ed8;color:#fff">blau</span> noch nichts gesendet, <span class="pill" style="background:#17803d;color:#fff">grün</span> Abholnachricht gesendet, <span class="pill" style="background:#f5c518;color:#1f1a00">gelb</span> Warteliste, <span class="pill" style="background:#b42318;color:#fff">rot</span> Storno. Ändert sich der Status (z. B. von Warteliste auf Zugeteilt), wird der Knopf wieder blau. Im Filter über der Bestellliste zeigt „Nachricht noch nicht gesendet“ alle, die noch eine Nachricht brauchen. Die Texte lassen sich unten unter „Nachrichtenvorlagen“ ändern.</p>`],
  ["Abholung, Storno, Doppelte", `<ul><li>Holt der Kunde ab: Status auf <b>Abgeholt</b> setzen.</li>
    <li>Storniert ein Kunde: Status auf <b>Storniert</b>. Die App fragt dann, ob die frei gewordene Ware an jemand anderen gehen soll.</li>
    <li>Reiter <b>Dubletten</b> zeigt Kunden, die vermutlich doppelt angelegt sind. Dort zusammenführen oder als „Kein Duplikat“ markieren.</li>
    <li>Wer hat was geändert? Reiter <b>Protokoll</b>, oder „Verlauf“ bei Kunde oder Produkt.</li></ul>`],
];
const wikiPanel = () => `<div class="panel"><h2>Kurzanleitung</h2>${WIKI.map(([t,b])=>`<details class="wiki"><summary>${t}</summary><div>${b}</div></details>`).join("")}</div>`;
function renderSettings(){
  const isDb = S.provider.kind === "dropbox", isDisk = S.provider.kind === "disk";
  app.innerHTML = `<div><h1>Einstellungen</h1><p class="sub">Version ${esc(APP_VERSION)} · ${isDisk ? `Programm auf diesem PC · Daten im Ordner <span class="mono">${esc(S.desktop.folder)}</span>` : isDb ? "Daten in der Dropbox (App-Ordner, Datei vorbestellungen.json)" : "Nur ausprobieren: Daten liegen nur in diesem Browser"}</p></div>
  ${wikiPanel()}
  <div class="panel"><h2>Speicher</h2><p>Status: <b>${esc(SYNC_TXT[S.doc.status] || S.doc.status)}</b>${S.doc.error ? ` <span class="muted">(${esc(S.doc.error)})</span>` : ""}</p>
    <div class="row"><button id="syncnow">Jetzt abgleichen</button>${isDisk ? `<button id="openlog">Log öffnen</button><button id="openlogdir">Log-Ordner öffnen</button><button id="quit" class="danger">Programm beenden</button>` : `<button id="logout" class="danger">${isDb ? "Dropbox auf diesem Gerät trennen" : "Ausprobieren beenden"}</button>`}</div>
    <p class="muted">${isDisk ? "Der Dropbox-Client gleicht den Ordner zwischen den PCs ab. Speichern zwei PCs gleichzeitig, führt das Programm die Konfliktkopien automatisch zusammen." : "Trennen entfernt nur den Zugang auf diesem Gerät. Die Daten in der Dropbox bleiben."}</p></div>
  ${isDisk ? migratePanel() : ""}
  ${isDb ? `<div class="panel"><h2>Kollegen einladen</h2>
    <p class="muted">Mit diesem Code kann ein weiteres Gerät auf denselben Dropbox-App-Ordner zugreifen (nicht auf den Rest der Dropbox). Nur an Mitarbeiter weitergeben.</p>
    <div class="row"><button id="inv">Einladungscode anzeigen</button></div><textarea id="invt" hidden rows="3" style="width:100%" readonly></textarea></div>` : ""}
  ${etronPanel()}
  ${etronApiPanel()}
  ${fixPanel()}
  ${waPanel()}
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
  $("#syncnow").onclick = () => S.doc.sync(); bindTemplates(); bindStaff(); bindGames(); bindEtron(); bindEtronApi(); bindFix(); document.querySelectorAll('input[name="wamode"]').forEach(r=>r.onchange=()=>{ setWaMode(r.value); toast(r.value==="web"?"WhatsApp Web wird verwendet":"WhatsApp-App am PC wird verwendet"); });
  if (isDisk) { bindMigrate();
    $("#openlog").onclick = () => desk("/api/openlog", { method: "POST" }).then(r => r.json()).then(j => toast("Log: " + j.path, 6000));
    $("#openlogdir").onclick = () => desk("/api/openlog?folder=1", { method: "POST" }).then(r => r.json()).then(j => toast("Ordner: " + j.path, 6000)); $("#quit").onclick = async () => { await S.doc.sync(); try { await desk("/api/quit", { method: "POST" }); } catch (e) {}
    app.innerHTML = `<div class="panel setup"><h1>Programm beendet</h1><p class="sub">Alle Änderungen sind gespeichert. Dieses Fenster kann geschlossen werden.</p></div>`; setTimeout(() => window.close(), 800); }; }
  if ($("#logout")) $("#logout").onclick = () => { $("#logout").outerHTML = `<button id="lo2" class="danger">Wirklich trennen?</button>`; $("#lo2").onclick = () => { LS.del("vb.cred"); LS.del("vb.cache"); location.hash = ""; location.reload(); }; };
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
  S.desktop = await desktopInfo();
  if (S.desktop) cred = { kind: "disk" };
  if (!cred) { try { cred = JSON.parse(LS.get("vb.cred") || "null"); } catch { cred = null; } }
  if (!cred) return renderConnect();
  S.cred = cred;
  S.provider = cred.kind === "disk" ? new DiskProvider() : cred.kind === "dropbox" ? new DropboxProvider(cred) : new LocalProvider();
  addEventListener("error", e => dlog("ERROR", `${e.message} (${(e.filename||"").split("/").pop()}:${e.lineno})`));
  addEventListener("unhandledrejection", e => dlog("ERROR", "Unbehandelt: " + (e.reason?.message || e.reason)));
  dlog("INFO", `Fenster geöffnet, Version ${APP_VERSION}, ${S.desktop ? "Programm" : "Web"}, Kürzel ${staff() || "-"}`);
  if (!S.desktop) extCheck().then(v => { if (v) { dlog("INFO", "etron-Erweiterung aktiv " + v); if (S.loaded?.p) render(); } });
  if (S.desktop) { document.title = "TCG Vorbestellungen";
    // beim Programm an- und abmelden, damit es sich beendet, sobald kein Fenster mehr offen ist
    const wid = Math.random().toString(36).slice(2, 12); const ping = () => desk("/api/ping?id=" + wid).catch(() => {});
    ping(); setInterval(ping, 20000); document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") ping(); });
    // Links nach außen (etron, WhatsApp, E-Mail) im Standardbrowser von Windows öffnen statt im App-Fenster
    document.addEventListener("click", e => { const a = e.target.closest && e.target.closest("a[href]"); if (!a) return; const href = a.getAttribute("href") || "";
      if (!/^(https?:|mailto:|sms:|tel:|whatsapp:)/i.test(href) || href.startsWith(location.origin)) return;
      e.preventDefault(); desk("/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: a.href }) }).then(r => { if (!r.ok) toast("Link konnte nicht geöffnet werden."); }).catch(() => toast("Link konnte nicht geöffnet werden.")); }, true);
    addEventListener("pagehide", () => { try { navigator.sendBeacon("/api/bye?id=" + wid); } catch (e) {} }); }
  S.doc = new SyncDoc(S.provider, DATA_PATH, null, "vb.cache");
  const cached = await S.doc.loadCache();
  S.db = makeDb(S.doc);
  let seen = "";
  let lastSt = "";
  S.doc.on(() => {
    drawSync();
    if (S.doc.status !== lastSt && S.doc.status !== "syncing") { if (S.doc.status === "error" || S.doc.status === "offline" || lastSt === "error" || lastSt === "offline") dlog(S.doc.status === "ok" ? "INFO" : "WARN", `Abgleich: ${S.doc.status}${S.doc.error ? " (" + S.doc.error + ")" : ""}`); lastSt = S.doc.status; }
    if (!S.doc.obj) return;
    // Nur neu zeichnen, wenn sich die Daten wirklich geändert haben (nicht nach jedem erfolgreichen Speichern in die Dropbox).
    const key = JSON.stringify(S.doc.obj);
    // Erst nach dem aktuellen Ereignis zeichnen: sonst verschwindet z. B. bei Tab das nächste Feld, bevor es den Fokus bekommt.
    if (key === seen) return; seen = key; pull(); clearTimeout(S.rt); S.rt = setTimeout(route, 0);
  });
  if (cached) { pull(); route(); }
  await openLog();
  await S.doc.sync();
  if (!S.doc.obj) {
    if (S.doc.status === "ok") { S.doc.obj = emptyData(); S.doc.dirty = true; await S.doc.sync(); }
    else { app.innerHTML = `<div class="note bad">Dropbox nicht erreichbar: ${esc(S.doc.error || "unbekannter Fehler")}. <button id="rt">Erneut versuchen</button> <a class="back" href="#einstellungen">Einstellungen</a></div>`; $("#rt").onclick = () => location.reload(); return; }
  }
  if (cred.kind === "local" && !Object.keys(S.doc.obj.products || {}).length && !LS.get("vb.demo")) { LS.set("vb.demo", "1"); importObj(demoData()); }
  setInterval(() => { if (document.visibilityState === "visible" && !S.doc.dirty) S.doc.sync(); if (document.visibilityState === "visible") openLog().then(d => d.sync()); }, S.desktop ? 10000 : 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { S.doc.sync(); S.log?.doc.sync(); } });
}
window.addEventListener("hashchange", () => { S.oq = ""; S.osort = ""; route(); }); // Standard: chronologisch
// Höhe der Kopfleiste für fixierte Tabellenköpfe
const setHdr=()=>document.documentElement.style.setProperty("--hdr", (document.querySelector(".bar")?.offsetHeight||100)+"px");
window.addEventListener("resize", setHdr); setHdr();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
