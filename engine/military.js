// ══════════════════════════════════════════════════════════
//  MILITARY — Movement, Conscription, Attack, Battle queue
// ══════════════════════════════════════════════════════════

const PEACE_WEEKS = 10;
function inPeacePeriod(){ return (G.tick||0) < PEACE_WEEKS; }
function peaceTurnsLeft(){ return Math.max(0, PEACE_WEEKS - (G.tick||0)); }

function chkBtns(){
  const si=G.sel,PN=G.playerNation;
  const peace=inPeacePeriod();

  // Own province selected → Move mode
  const isOwn = si>=0 && G.owner[si]===PN && G.army[si]>100;
  // Enemy province selected → Attack mode
  const isEnemy = si>=0 && G.owner[si]!==PN;
  const canAtk = !peace && isEnemy;
  const fr = canAtk ? regsOf(PN).find(r=>G.army[r]>100&&NB[r]?.includes(si)) : undefined;
  const atkOk = fr!==undefined && canAtk;

  // Smart button state
  const smartEnabled = isOwn || atkOk;
  const smartIsAtk = !isOwn && atkOk;

  // Update both desktop and mobile smart buttons
  ['sp-btn-smart','mob-btn-smart'].forEach(id=>{
    const b=document.getElementById(id);
    if(!b)return;
    b.disabled=!smartEnabled;
    b.className='abtn'+(smartIsAtk?' war-btn':'');
  });

  // Icon and label
  const smartIc = isOwn ? '🚶' : atkOk ? '⚔' : '⚔';
  const smartAm = isOwn ? 'Move Army' : atkOk ? 'Attack' : 'Move / Attack';
  let smartSub;
  if(isOwn) smartSub = `From ${PROVINCES[si].short}`;
  else if(atkOk) smartSub = `${PROVINCES[fr].short}→${PROVINCES[si].short}`;
  else if(peace) smartSub = `Peace — ${peaceTurnsLeft()} weeks left`;
  else smartSub = 'Select a territory first';

  ['sp-smart-ic','mob-smart-ic'].forEach(id=>sEl(id,smartIc));
  ['sp-smart-am','mob-smart-am'].forEach(id=>sEl(id,smartAm));
  sEl('sp-smart-sub', smartSub);

  if(atkOk){window._af=fr;window._at=si;}
}

// Smart action: move if own province selected, attack if enemy
function smartMilitaryAction(){
  const si=G.sel,PN=G.playerNation;
  if(si<0){popup('Select a territory first!');return;}
  if(G.owner[si]===PN){
    // Own province → move
    toggleMoveMode();
  } else {
    // Enemy province → attack
    openAttack();
  }
}

// NOTE: openMo/closeMo/openModal/closeModal/popup/addLog/setEB live in ui.js

// Escape key closes popup and cancels modes
document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){
    hideProvPopup();
    if(_atkSelectMode) cancelAtkSelect();
    if(G.moveMode) cancelMove();
    if(G.navalMode) cancelNaval();
  }
});


// ── MOVEMENT ──────────────────────────────────────────────
function toggleMoveMode(){
  if(G.navalMode)cancelNaval();
  if(G.moveMode){cancelMove();return;}
  const si=G.sel;
  if(si<0||G.owner[si]!==G.playerNation||G.army[si]<1){popup('Select your territory first!');return;}
  G.moveFrom=si;G.moveMode=true;
  const mb=document.getElementById('move-banner');if(mb)mb.style.display='block';
  ['sp-btn-smart','mob-btn-smart'].forEach(id=>{const b=document.getElementById(id);if(b){b.classList.add('active-mode');const am=b.querySelector('.am');if(am)am.textContent='Cancel Move';}});
  scheduleDraw();popup('Move mode — click adjacent territory');
}
function cancelMove(){
  G.moveFrom=-1;G.moveMode=false;
  const mb=document.getElementById('move-banner');if(mb)mb.style.display='none';
  ['sp-btn-smart','mob-btn-smart'].forEach(id=>{const b=document.getElementById(id);if(b){b.classList.remove('active-mode');const am=b.querySelector('.am');if(am)am.textContent=G.sel>=0&&G.owner[G.sel]===G.playerNation?'Move Army':'Attack';}});
  scheduleDraw();
}
// How many troops are available in province (actual minus committed to queues)
function availableArmy(prov){
  let committed=0;
  (G.battleQueue||[]).forEach(b=>{if(b.fr===prov)committed+=b.force;});
  (G.moveQueue||[]).forEach(m=>{if(m.from===prov)committed+=m.amount;});
  return Math.max(0,(G.army[prov]||0)-committed);
}
// ── MOVE TARGET CHECK ─────────────────────────────────────
// Only the correct version: own territory or neutral (o<0).
// Enemy provinces use the Attack path, not Move.
function isMoveTgt(i){
  if(!G.moveMode || G.moveFrom < 0 || i === G.moveFrom) return false;
  if(!NB[G.moveFrom]?.includes(i)) return false;
  const o = G.owner[i];
  // Disallow moving into any owned-by-enemy province — use Attack for that
  if(o >= 0 && o !== G.playerNation) return false;
  return true;
}


function openMoveDialog(from,to){
  cancelMove();
  const toOwner=G.owner[to];
  const PN=G.playerNation;

  // Moving onto ENEMY territory → offer attack instead
  if(toOwner>=0&&toOwner!==PN&&!atWar(PN,toOwner)){
    if(inPeacePeriod()){popup(`Peace period — ${peaceTurnsLeft()} weeks remaining`);return;}
    openMo('ENTER HOSTILE TERRITORY',
      `<p class="mx">Moving into <b style="color:#ff7070">${PROVINCES[to].name}</b> (${ownerName(toOwner)}) will start a war.</p>
       <p class="mx" style="color:var(--dim)">Declare war and attack, or cancel?</p>`,
      [{lbl:'Cancel',cls:'dim'},
       {lbl:'⚔ Declare War & Attack',cls:'red',cb:()=>{G.sel=to;window._af=from;window._at=to;launchAtkFromMove(from,to);}}]
    );
    return;
  }

  const avail=availableArmy(from);
  if(avail<=0){popup('No available troops (all committed to orders)!');return;}

  const s=season();
  const terrMod=s.winterTerrain&&s.winterTerrain.includes(PROVINCES[to].terrain)?s.moveMod:1.0;
  const movNote=terrMod<1?`<p class="mx" style="color:#80c8ff">${s.icon} ${s.name}: movement ×${terrMod}</p>`:'';
  openMo('TROOP MOVEMENT',
    `<p class="mx"><b>${PROVINCES[from].short}</b> → <b style="color:var(--gold)">${PROVINCES[to].name}</b></p>
     ${movNote}
     <p class="mx">Available: <b>${fa(avail)}</b> · Total in province: <b style="color:var(--dim)">${fa(G.army[from])}</b></p>
     <div class="slider-w"><div class="slider-l"><span>Soldiers to send</span><span class="slider-v" id="msv">${fa(avail)}</span></div>
     <input type="range" id="msl" min="1" max="${avail}" value="${avail}" oninput="updSl('msl','msv')"></div>
     <p class="mx" style="font-size:9px;color:var(--dim)">Remaining troops stay — you can issue more orders this turn.</p>`,
    [{lbl:'Cancel',cls:'dim'},{lbl:'→ Queue Move',cls:'grn',cb:()=>confirmMove(from,to)}]
  );
  setTimeout(()=>document.getElementById('msl')&&document.getElementById('msl').style.setProperty('--pct','100%'),40);
}

function confirmMove(from,to){
  const v=+(document.getElementById('msl')&&document.getElementById('msl').value||availableArmy(from));
  if(!v)return;
  const avail=availableArmy(from);
  if(v>avail){popup(`Only ${fa(avail)} available!`);return;}
  // Add to move queue
  if(!G.moveQueue)G.moveQueue=[];
  G.moveQueue.push({from,to,amount:v});
  closeMo();
  const remaining=availableArmy(from);
  addLog(`🚶 Move queued: ${fa(v)} from ${PROVINCES[from].short} → ${PROVINCES[to].short}. ${fa(remaining)} remain.`,'move');
  popup(`✓ Move queued — ${fa(remaining)} still available in ${PROVINCES[from].short}`);
  scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);chkBtns();
}
function launchAtkFromMove(from,to){
  const en=G.owner[to],PN=G.playerNation;
  if(en>=0)G.war[PN][en]=G.war[en][PN]=true;
  const force=availableArmy(from);
  if(force<=0){popup('No available troops!');return;}
  if(!G.battleQueue)G.battleQueue=[];
  G.battleQueue.push({fr:from,to,force,isPlayer:true});
  addLog(`⚔ Attack ordered: ${PROVINCES[from].short} → ${PROVINCES[to].name}`, 'war');
  popup(`⚔ Attack queued — executes next turn`);
  scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);chkBtns();
}
// NOTE: updSl lives in ui.js

// ── NAVAL ─────────────────────────────────────────────────

// ── CONSCRIPTION ──────────────────────────────────────────
function openDraft(){
  const mr=PROVINCES.map((_,i)=>i).filter(i=>G.owner[i]===G.playerNation);
  if(!mr.length){popup('No territories!');return;}
  const io=ideol();
  // Current province (selected or capital)
  let cur=G.sel>=0&&G.owner[G.sel]===G.playerNation?G.sel:-1;
  if(cur<0){const ci=mr.find(i=>PROVINCES[i].isCapital&&PROVINCES[i].nation===G.playerNation);cur=ci!=null?ci:mr[0];}
  window._dr=cur;

  function isDrafting(r){return (G.draftQueue||[]).some(d=>d.prov===r&&d.nation===G.playerNation);}

  function draftCap(r){
    const hb=(G.buildings[r]||[]).includes('barracks');
    const sat=G.satisfaction[r]??70;
    const satMod=sat<40?0.5:sat<60?0.75:1.0;
    const refMod=G.reforming?0.8:1.0;
    // conscriptMod not defined in IDEOLOGIES — derive from atk (aggressive ideologies draft faster)
    const conscriptMod=io.conscriptMod||(2.0-Math.min(io.atk||1,1.5));
    return Math.max(0,Math.min(
      Math.floor(G.pop[r]*0.20*(hb?1.5:1)/conscriptMod*satMod*refMod),
      G.gold[G.playerNation]
    ));
  }
  function rowHtml(r,isPrimary){
    const cap=draftCap(r);
    const isOrig=PROVINCES[r].nation===G.playerNation;
    const name=PROVINCES[r].name+(PROVINCES[r].isCapital&&isOrig?'★':isOrig?'':' ⚑');
    const hb=(G.buildings[r]||[]).includes('barracks');
    const drafting=isDrafting(r);
    const draftEntry=drafting?(G.draftQueue||[]).find(d=>d.prov===r&&d.nation===G.playerNation):null;
    if(isPrimary){
      // Province already being drafted — show frozen state
      if(drafting){
        return`<div id="draft-primary" style="background:rgba(80,140,60,.08);border:1px solid rgba(114,243,114,.35);padding:10px 12px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-family:Cinzel,serif;font-size:12px;color:#72F372">${name}</span>
            <span style="font-size:9px;color:var(--dim)">⚔ ${fm(G.army[r])} · pop ${fm(G.pop[r])}${hb?' · 🏕barracks':''}</span>
          </div>
          <div style="font-size:10px;color:#72F372;font-style:italic;text-align:center;padding:8px 0">
            🪖 Conscripting ${fa(draftEntry.amount)} soldiers — ${draftEntry.weeksLeft}w remaining
          </div>
          <button class="btn dim" style="width:100%;padding:7px;margin-top:4px" onclick="closeMo()">Close</button>
        </div>`;
      }
      const initVal=Math.min(2000,Math.floor(cap/2));
      return`<div id="draft-primary" style="background:rgba(201,168,76,.06);border:1px solid var(--gold);padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-family:Cinzel,serif;font-size:12px;color:var(--gold)">${name}</span>
          <span style="font-size:9px;color:var(--dim)">⚔ ${fm(G.army[r])} · pop ${fm(G.pop[r])}${hb?' · 🏕barracks':''}</span>
        </div>
        ${cap>0?`
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:9px;color:var(--dim);flex-shrink:0">Soldiers</span>
          <input type="range" id="dsl" min="100" max="${cap}" value="${initVal}" oninput="updSl('dsl','dsv')" style="flex:1">
          <span style="font-family:Cinzel,serif;font-size:13px;color:var(--gold);min-width:38px;text-align:right" id="dsv">${fm(initVal)}</span>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn dim" style="flex:1;padding:7px" onclick="closeMo()">Cancel</button>
          <button class="btn grn" style="flex:2;padding:7px" onclick="confirmDraft()">⚔ Conscript ${fm(initVal)}</button>
        </div>`:`<div style="font-size:10px;color:var(--dim);font-style:italic;text-align:center;padding:6px 0">Cannot conscript here — no funds or population</div>
        <button class="btn dim" style="width:100%;padding:7px;margin-top:4px" onclick="closeMo()">Cancel</button>`}
      </div>`;
    }
    // Other province row — frozen if already drafting
    if(drafting){
      return`<div class="ti" id="dr${r}" onclick="switchDraftProv(${r})" style="padding:5px 9px;opacity:.65;cursor:pointer">
        <span class="tn" style="font-size:10px;color:#72F372">${name} <span style="font-size:8px">🪖</span></span>
        <span class="ta" style="font-size:8px;color:#72F372">Drafting ${fm(draftEntry.amount)} · ${draftEntry.weeksLeft}w</span>
      </div>`;
    }
    return`<div class="ti" id="dr${r}" onclick="switchDraftProv(${r})" style="padding:5px 9px">
      <span class="tn" style="font-size:10px">${name}</span>
      <span class="ta" style="font-size:8px">⚔${fm(G.army[r])} · Max ${fm(cap)}</span>
    </div>`;
  }

  const others=mr.filter(r=>r!==cur);
  const html=`
    <p class="mx" style="font-size:10px;margin-bottom:6px">Cost: <b>1,000 pop + 1 gold</b>/soldier · ${io.icon} ×${(1/io.conscriptMod).toFixed(2)} · Treasury: <b>${fa(G.gold[G.playerNation])}g</b></p>
    ${rowHtml(cur,true)}
    ${others.length?`<div style="font-size:8px;color:var(--dim);letter-spacing:2px;text-transform:uppercase;padding:4px 0 3px;border-bottom:1px solid rgba(42,36,24,.3);margin-bottom:4px">Other Territories</div>
    <div class="tlist" style="margin:0;max-height:220px;overflow-y:auto">${others.map(r=>rowHtml(r,false)).join('')}</div>`:''}
  `;
  openMo('CONSCRIPTION', html, []);
  // Update conscript button label live
  const sl=document.getElementById('dsl');
  if(sl) sl.addEventListener('input', ()=>{
    const btn=document.querySelector('#mo .btn.grn');
    if(btn)btn.textContent=`⚔ Conscript ${fm(+sl.value)}`;
  });
}

window.switchDraftProv=function(r){
  // Rebuild modal with new primary province
  window._dr=r;
  G.sel=r; // update selection too
  openDraft();
};

function pickDR(r){ window.switchDraftProv(r); } // legacy alias

function confirmDraft(){
  const r=window._dr; if(r<0||r===undefined)return;
  const v=+(document.getElementById('dsl')&&document.getElementById('dsl').value||0); if(!v)return;
  const io=ideol();
  // Guard: cannot draft in province already in queue
  if((G.draftQueue||[]).some(d=>d.prov===r&&d.nation===G.playerNation)){popup('Already conscripting here!');return;}
  if(G.pop[r]<v+1000){popup('Not enough population!');return;}
  if(G.gold[G.playerNation]<v){popup('Not enough gold!');return;}

  // ── Draft queue: conscription takes time ──────────────
  // Dictators (nazism/fascism/stalinism/militarism/communism): always 1 week
  // Others: 1 week for small draft (<5% pop), up to 2 weeks for large
  const dictatorIdeologies=['nazism','fascism','stalinism','militarism','communism'];
  const isDictator=dictatorIdeologies.includes(G.ideology);
  const popPct=v/G.pop[r];
  let draftWeeks;
  if(isDictator){
    draftWeeks=1;
  } else {
    draftWeeks=popPct<0.05?1:2;
  }

  // Immediate cost (pop + gold committed now)
  const minPop=Math.max(500, Math.floor(G.pop[r]*0.05)); // keep at least 5% pop
  G.pop[r]=Math.max(minPop,G.pop[r]-v);
  G.gold[G.playerNation]-=v;

  // Add to draft queue
  if(!G.draftQueue) G.draftQueue=[];
  G.draftQueue.push({
    prov: r,
    amount: v,
    weeksLeft: draftWeeks,
    totalWeeks: draftWeeks,
    nation: G.playerNation
  });

  closeMo();
  scheduleDraw(); updateHUD(); if(G.sel>=0)updateSP(G.sel);
  addLog(`🪖 ${PROVINCES[r].short}: ${fa(v)} being conscripted — arrive in ${draftWeeks} week${draftWeeks>1?'s':''}.`,'info');
  popup(`🪖 ${fa(v)} conscription started — ${draftWeeks}w until ready`);
}

// Process draft queue — called every week in endTurn
function processDraftQueue(){
  if(!G.draftQueue||!G.draftQueue.length) return;
  const done=[];
  G.draftQueue=G.draftQueue.filter(entry=>{
    entry.weeksLeft--;
    if(entry.weeksLeft<=0){
      G.army[entry.prov]=(G.army[entry.prov]||0)+entry.amount;
      done.push(entry);
      return false;
    }
    return true;
  });
  for(const entry of done){
    const isPlayer=entry.nation===G.playerNation;
    if(isPlayer){
      addLog(`✅ ${PROVINCES[entry.prov].short}: ${fa(entry.amount)} soldiers reporting for duty!`,'info');
      popup(`✅ ${fa(entry.amount)} troops ready in ${PROVINCES[entry.prov].short}!`,2500);
    }
  }
}


// ── ATTACK / BATTLE ───────────────────────────────────────
// ── ATTACK SOURCE SELECTION ───────────────────────────────
// When player clicks Attack, if multiple border provinces → highlight them for selection
var _atkSelectMode = false;
var _atkTarget = -1;

function cancelAtkSelect(){
  _atkSelectMode = false;
  _atkTarget = -1;
  const mb=document.getElementById('move-banner');
  if(mb){mb.style.display='none';mb.className='';}
  scheduleDraw();
}

// Highlight attack sources on map (reuse move highlight color but red)
function isAtkSrc(i){
  return _atkSelectMode && _atkTarget>=0 && G.owner[i]===G.playerNation && G.army[i]>100 && NB[i]?.includes(_atkTarget);
}

function openAttack(){
  if(inPeacePeriod()){popup(`Peace period — ${peaceTurnsLeft()} weeks remaining`);return;}
  const si=G.sel;
  if(si<0||G.owner[si]===G.playerNation){popup('Select an enemy territory!');return;}
  const PN=G.playerNation;
  const sources=regsOf(PN).filter(r=>G.army[r]>100&&NB[r]?.includes(si));
  if(!sources.length){popup('No army on the border!');return;}

  if(sources.length===1){
    // Only one border province — go straight to attack dialog
    window._af=sources[0];window._at=si;
    showAttackDialog(sources[0],si);
  } else {
    // Multiple border provinces → switch to selection mode
    _atkSelectMode=true;
    _atkTarget=si;
    hideProvPopup();
    const mb=document.getElementById('move-banner');
    if(mb){mb.style.display='block';mb.className='';mb.style.cssText='display:block;background:rgba(80,10,10,.88);border-color:rgba(255,80,80,.5);color:#ff8080;'+mb.style.cssText.replace(/display:[^;]+;/,'');}
    if(mb)mb.textContent=`⚔ Choose attack province (${sources.length} available) — Esc to cancel`;
    scheduleDraw();
    popup(`${sources.length} border provinces — click one to attack from`);
  }
}

function showAttackDialog(fr,to){
  window._af=fr;window._at=to;
  const en=G.owner[to],PN=G.playerNation;
  const hasPact=en>=0&&G.pact[PN][en],hasAlly=en>=0&&areAllies(PN,en);
  const hasFort=(G.buildings[to]||[]).includes('fortress');
  const io=ideol(),terrain=TERRAIN[PROVINCES[to].terrain||'plains'];
  const defBonus=terrain.defB*(hasFort?1.6:1),effDef=Math.round(G.army[to]*defBonus);
  const resist=G.resistance[to];
  const avail=availableArmy(fr);
  let html='';
  if(hasPact)html+=`<p class="mx" style="color:#e07030">⚠ This will break your non-aggression pact!</p>`;
  if(hasAlly)html+=`<p class="mx" style="color:#ff6040">⚠ ${NATIONS[en]&&NATIONS[en].short} is your ALLY!</p>`;
  if(hasFort)html+=`<p class="mx" style="color:#c09040">🏰 Fortress: defense ×1.6</p>`;
  if(resist>20)html+=`<p class="mx" style="color:#ff9040">🔥 Resistance bonus</p>`;
  html+=`<p class="mx">${io.icon} ${io.name}: atk ×${io.atk.toFixed(2)} · ${terrain.name} def ×${terrain.defB.toFixed(1)}</p>`;
  html+=`<p class="mx"><b>${PROVINCES[fr].short}</b> → <b style="color:#ff7070">${PROVINCES[to].name}</b></p>`;
  html+=`<p class="mx">Available: <b>${fa(avail)}</b> · Enemy effective: <b style="color:#ff7070">${fa(effDef)}</b></p>`;
  if(avail>0){
    html+=`<div class="slider-w"><div class="slider-l"><span>Force to commit</span><span class="slider-v" id="asv">${fa(avail)}</span></div><input type="range" id="asl" min="1" max="${avail}" value="${avail}" oninput="updSl('asl','asv')"></div>`;
    html+=`<p class="mx" style="font-size:9px;color:var(--dim)">Remaining troops stay — you can order more attacks this turn.</p>`;
  } else {
    html+=`<p class="mx" style="color:#ff6040">⚠ All troops already committed to other orders!</p>`;
  }
  const canFight=avail>0;
  const btns=hasPact||hasAlly
    ?[{lbl:'Cancel',cls:'dim'},{lbl:'Break & Queue Attack',cls:'red',cb:()=>canFight&&launchAtk(true)}]
    :[{lbl:'Cancel',cls:'dim'},{lbl:'⚔ Queue Attack',cls:'red',cb:()=>canFight&&launchAtk(false)}];
  openMo('QUEUE ATTACK',html,btns);
  setTimeout(()=>document.getElementById('asl')&&document.getElementById('asl').style.setProperty('--pct','100%'),40);
}
// (first launchAtk removed — duplicate that called runBattle directly, bypassing queue)

function launchAtk(breakDiplo){
  const fr=window._af,to=window._at;
  const force=+(document.getElementById('asl')&&document.getElementById('asl').value||availableArmy(fr));
  const avail=availableArmy(fr);
  if(force<=0||force>avail){popup(`Only ${fa(avail)} available!`);return;}
  const en=G.owner[to],PN=G.playerNation;
  if(breakDiplo&&en>=0){
    G.pact[PN][en]=G.pact[en][PN]=false;G.pLeft[PN][en]=G.pLeft[en][PN]=0;
    const ai=G.allianceOf[PN];
    if(ai>=0&&G.alliance[ai]&&G.alliance[ai].members.includes(en)){
      G.alliance[ai].members=G.alliance[ai].members.filter(m=>m!==PN);
      G.allianceOf[PN]=-1;
      addLog(`Alliance broken: attacked ally ${ownerName(en)}!`,'diplo');
    }
  }
  if(en>=0)G.war[PN][en]=G.war[en][PN]=true;
  const enAlly=G.allianceOf[en];
  if(enAlly>=0){
    G.alliance[enAlly].members.filter(m=>m!==en&&m!==PN).forEach(m=>{
      G.war[PN][m]=G.war[m][PN]=true;
      addLog(`${ownerName(m)} joined the war as ally of ${ownerName(en)}!`,'war');
    });
  }
  // Queue — allow MULTIPLE attacks from same province (don't filter by fr)
  if(!G.battleQueue)G.battleQueue=[];
  G.battleQueue.push({fr,to,force});
  const remaining=availableArmy(fr);
  addLog(`⚔ Attack queued: ${PROVINCES[fr].short} → ${PROVINCES[to].name} (${fa(force)} troops). ${fa(remaining)} remain.`,'war');
  popup(`⚔ Attack queued — ${fa(remaining)} still available in ${PROVINCES[fr].short}`);
  closeMo();
  scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);chkBtns();
}

// ── FAST MODE ─────────────────────────────────────────────
// When active: battle/move overlays skip instantly, no zoom animation
var _fastMode = false;
function toggleFastMode(){
  _fastMode = !_fastMode;
  const btn = document.getElementById('fast-mode-btn');
  if(btn){
    btn.style.color = _fastMode ? 'var(--gold)' : 'var(--dim)';
    btn.style.borderColor = _fastMode ? 'var(--gold)' : 'var(--border)';
    btn.title = _fastMode ? 'Fast mode ON — click to disable' : 'Fast mode — skip battle animations';
  }
  popup(_fastMode ? '▶▶ Fast mode ON' : '▶ Normal mode', 1500);
}
// Called from endTurn — runs all queued player battles in sequence with animation
function executeMoveQueue(){
  if(!G.moveQueue||!G.moveQueue.length) return;
  const queue=[...G.moveQueue];
  G.moveQueue=[];
  const s=season();
  for(const {from,to,amount} of queue){
    if(G.owner[from]!==G.playerNation) continue; // lost province
    const actual=Math.min(amount, G.army[from]);
    if(actual<=0) continue;
    const terrMod=s.winterTerrain&&s.winterTerrain.includes(PROVINCES[to]&&PROVINCES[to].terrain)?s.moveMod:1.0;
    const moved=Math.round(actual*terrMod);
    G.army[from]=Math.max(0,G.army[from]-actual);
    G.army[to]=(G.army[to]||0)+moved;
    if(moved<actual) addLog(`${s.icon} Winter: ${fa(actual-moved)} lost to cold!`,'season');
    if(G.owner[to]<0) G.owner[to]=G.playerNation; // claim independent
    addLog(`🚶 ${fa(moved)} moved: ${PROVINCES[from].short} → ${PROVINCES[to]&&PROVINCES[to].short||'?'}.`,'move');
  }
}

function _restoreVP(){
  if(!window._preBattleVP)return;
  const saved=window._preBattleVP;
  window._preBattleVP=null;
  const startScale=vp.scale,startTx=vp.tx,startTy=vp.ty;
  const ANIM_MS=500;const startT=performance.now();
  function easeInOut(t){return t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2;}
  function frame(now){
    const t=easeInOut(Math.min((now-startT)/ANIM_MS,1));
    vp.scale=startScale+(saved.scale-startScale)*t;
    vp.tx=startTx+(saved.tx-startTx)*t;
    vp.ty=startTy+(saved.ty-startTy)*t;
    scheduleDraw();
    if(t<1)requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Approximate enemy force display (fog of war)
function approxForce(real){
  // Round to nearest "nice" number to simulate intel uncertainty
  if(real<50) return real;
  const magnitude=Math.pow(10,Math.floor(Math.log10(real)));
  const factor=magnitude>=1000?500:magnitude>=100?50:10;
  const base=Math.round(real/factor)*factor;
  // Add small random offset ±15%
  const jitter=Math.round((rf(-0.12,0.12)*real)/factor)*factor;
  return Math.max(factor,base+jitter);
}

function executeBattleQueue(onAllDone){
  const rawQueue=G.battleQueue&&G.battleQueue.length?[...G.battleQueue]:[];
  G.battleQueue=[];
  const enemyQueue=G._enemyAttackQueue&&G._enemyAttackQueue.length?[...G._enemyAttackQueue]:[];
  G._enemyAttackQueue=[];

  if(!rawQueue.length&&!enemyQueue.length){onAllDone();return;}

  // Merge multi-province attacks on the same target into one battle
  const mergedMap={};
  rawQueue.forEach(function(b){
    if(!mergedMap[b.to]) mergedMap[b.to]={to:b.to,attackers:[],totalForce:0};
    mergedMap[b.to].attackers.push({fr:b.fr,force:b.force});
    mergedMap[b.to].totalForce+=b.force;
  });
  const playerQueue=Object.values(mergedMap);

  window._preBattleVP={scale:vp.scale,tx:vp.tx,ty:vp.ty};
  let pidx=0;

  function runPlayerNext(){
    if(pidx>=playerQueue.length){runEnemyQueue(onAllDone);return;}
    const battle=playerQueue[pidx++];
    const to=battle.to;
    if(G.owner[to]===G.playerNation&&(!G.occupied||!G.occupied[to])){runPlayerNext();return;}
    const valid=battle.attackers.filter(function(a){return G.owner[a.fr]===G.playerNation&&G.army[a.fr]>0;});
    if(!valid.length){runPlayerNext();return;}
    let totalForce=0;
    valid.forEach(function(a){a.actual=Math.min(a.force,G.army[a.fr]);totalForce+=a.actual;});
    if(totalForce<1){runPlayerNext();return;}
    const fr=valid[0].fr;
    valid.slice(1).forEach(function(a){G.army[a.fr]=Math.max(0,G.army[a.fr]-a.actual);});
    runBattle(fr,to,totalForce,G.playerNation,function(){
      scheduleDraw();updateHUD();chkVic();
      setTimeout(runPlayerNext,600);
    });
  }

  function runEnemyQueue(done){
    if(!enemyQueue.length){_restoreVP();done();return;}
    let eidx=0;
    function showNext(){
      if(eidx>=enemyQueue.length){_restoreVP();done();return;}
      const ev=enemyQueue[eidx++];
      showEnemyAttackOverlay(ev,()=>setTimeout(showNext,300));
    }
    showNext();
  }

  runPlayerNext();
}

// Skip current battle animation — called when player clicks battle card
window.skipBattleAnim=function(){
  if(window._battleSkipFn) window._battleSkipFn();
};

function runBattle(fr,to,atkF,atker,done){
  const df=G.army[to],isP=atker===G.playerNation;
  const io2=isP?ideol():IDEOLOGIES[NATIONS[atker]?.ideology||'nationalism'];
  const hasFort=(G.buildings[to]||[]).includes('fortress');
  const defM=provTerrainDef(to)*(hasFort?1.6:1);
  const instPen=isP?Math.max(.7,1-G.instab[fr]/150):1.0;
  const capPen=G.capitalPenalty[atker]>0?.85:1.0;
  const hasArsenal=(G.buildings[fr]||[]).includes('arsenal');
  const resistBonus=isP?1+(G.resistance[to]/200):1.0;
  const effAtk=atkF*io2.atk*instPen*capPen*(hasArsenal?1.2:1)*resistBonus;
  const effDef=Math.round(df*defM);
  const ap=effAtk/(effAtk+effDef)*100;

  const av=effAtk*rf(.78,1.25),dv=effDef*rf(.78,1.25),win=av>dv;
  const al=Math.min(atkF-1,Math.floor(atkF*rf(.13,.36))),dl=Math.min(df,Math.floor(df*rf(.15,.42)));

  function applyOutcome(){
    // Init occupation map if needed
    if(!G.occupied) G.occupied={};

    if(win){
      G.army[fr]-=atkF;G.army[to]=Math.max(50,atkF-al);
      const prev=G.owner[to];

      // ── OCCUPATION: attacker occupies, original owner stays as "occupied by" ──
      if(prev>=0 && prev!==atker){
        // Record occupation: who is occupying and who originally owned it
        G.occupied[to]={by:atker, originalOwner:prev};
      } else {
        // Neutral or rebel — just take it
        delete G.occupied[to];
      }
      G.owner[to]=atker;
      G.gold[atker]+=G.income[to]*3;

      if(atker===G.playerNation){
        G.instab[to]=ri(82,95);
        G.satisfaction[to]=ri(8,18);
        G.assim[to]=ri(5,22);
        if(!G.assimQueue)G.assimQueue=PROVINCES.map(()=>null);
        G.assimQueue[to]=null;
        if(hasFort)G.buildings[to]=G.buildings[to].filter(b=>b!=='fortress');
        if(PROVINCES[to].isCapital&&prev>=0){G.capitalPenalty[atker]=3;addLog(`★ ${PROVINCES[to].name} captured!`,'war');}
        G.resistance[to]=ri(20,50);
      }
      if(isP){
        addLog(`✦ ${PROVINCES[to].name} taken! Lost ${fa(al)}.`,'vic');
        if(!_fastMode) setTimeout(function(){_animZoomTo(fr,to,0.40);},80);
      }
      if(prev>=0&&regsOf(prev).length===0){
        G.war[atker][prev]=G.war[prev][atker]=false;
        if(isP)addLog(`${ownerName(prev)} eliminated.`,'war');
      }
    }else{
      G.army[fr]=Math.max(0,G.army[fr]-al);G.army[to]=Math.max(50,df-dl);
      if(isP)addLog(`✗ ${PROVINCES[to].name} held. Lost ${fa(al)}.`,'war');
    }
  }

  if(!isP){
    applyOutcome();
    done();
    return;
  }

  // Player battle — apply then show overlay
  applyOutcome();
  showBattleOverlay(fr, to, win, atkF, al, effAtk, effDef, ap, done);
}

// ── BATTLE OVERLAY ────────────────────────────────────────────
// Shown inline over the game map — no screen switch needed.
// The s-battle screen is kept for legacy but we use an overlay div instead.
function showBattleOverlay(fr, to, win, atkF, al, effAtk, effDef, ap, done){
  if(_fastMode){done();return;}

  // ── Safely abort any in-flight overlay WITHOUT calling done() again ──
  // We clear the skip fn and timer, hide the old overlay synchronously,
  // then proceed. The previous done() was already called by executeBattleQueue
  // before it called us, so we must NOT call it again here.
  if(window._battleSkipFn){
    // Neutralise the skip fn so it can't fire done() of a dead battle
    window._battleSkipFn = null;
  }
  if(window._battleAutoTimer){
    clearTimeout(window._battleAutoTimer);
    window._battleAutoTimer = null;
  }

  // Always destroy and recreate the overlay element so animation reliably replays
  const old = document.getElementById('_battle_overlay');
  if(old) old.parentNode.removeChild(old);

  if(!document.getElementById('_bov_style')){
    const st=document.createElement('style');st.id='_bov_style';
    st.textContent='@keyframes _bov_in{from{opacity:0}to{opacity:1}}'+
      '@keyframes _bov_slide{from{transform:translateY(18px);opacity:0}to{transform:translateY(0);opacity:1}}';
    document.head.appendChild(st);
  }

  const ov=document.createElement('div');
  ov.id='_battle_overlay';
  ov.style.cssText=[
    'position:fixed','inset:0','z-index:200',
    'display:flex','align-items:center','justify-content:center',
    'background:rgba(6,8,14,.72)',
    'backdrop-filter:blur(3px)','-webkit-backdrop-filter:blur(3px)',
    'animation:_bov_in .22s ease',
    'opacity:1',
  ].join(';');
  document.body.appendChild(ov);

  const frName=PROVINCES[fr]?.short||'?';
  const toName=PROVINCES[to]?.name||'?';
  const winColor=win?'#90ff80':'#ff9080';
  const winLabel=win?'✦ VICTORY':'✗ REPELLED';
  const winBg=win?'rgba(40,100,20,.22)':'rgba(100,20,20,.22)';
  const winBorder=win?'rgba(60,160,40,.5)':'rgba(160,40,40,.5)';
  const atkPct=Math.min(95,Math.round(effAtk/(effAtk+effDef)*100));
  const defPct=100-atkPct;
  const lostTxt=win?`Lost ${fa(al)}`:`Repelled — lost ${fa(al)}`;
  const bonusTxt=[];
  if((G.buildings[fr]||[]).includes('arsenal'))bonusTxt.push('⚙ Arsenal +20% atk');
  if((G.buildings[to]||[]).includes('fortress'))bonusTxt.push('🏰 Fortress ×1.6 def');
  if(G.resistance[to]>20)bonusTxt.push('🔥 Resistance +def');

  ov.innerHTML=`<div style="
    background:linear-gradient(160deg,#1e1208,#0c0804);
    border:1px solid rgba(201,168,76,.35);
    width:min(380px,92vw);
    font-family:'Cinzel',serif;
    animation:_bov_slide .28s ease;
    position:relative;
  " onclick="window.skipBattleAnim&&window.skipBattleAnim()">
    <div style="font-size:12px;color:var(--gold,#c9a84c);text-align:center;letter-spacing:3px;padding:14px 16px 10px;border-bottom:1px solid rgba(42,36,24,.5)">⚔ Battle Report ⚔</div>
    <div style="font-size:9px;color:var(--dim,#8a7848);text-align:center;padding:4px 0 0;letter-spacing:1px">tap to skip</div>

    <div style="display:flex;padding:12px 16px;gap:0;border-bottom:1px solid rgba(42,36,24,.35)">
      <div style="flex:1;text-align:center">
        <div style="font-size:8px;color:var(--dim,#8a7848);letter-spacing:1px;margin-bottom:4px">ATTACKING FROM</div>
        <div style="font-size:14px;color:var(--gold,#c9a84c)">${frName}</div>
        <div style="font-size:11px;color:#e8d5a3;margin-top:2px">${fa(atkF)} troops</div>
      </div>
      <div style="display:flex;align-items:center;padding:0 10px;font-size:18px;color:var(--dim,#8a7848)">VS</div>
      <div style="flex:1;text-align:center">
        <div style="font-size:8px;color:var(--dim,#8a7848);letter-spacing:1px;margin-bottom:4px">DEFENDING</div>
        <div style="font-size:14px;color:#ff7070">${toName}</div>
        <div style="font-size:11px;color:#e8d5a3;margin-top:2px">${fa(G.army[to])} troops</div>
      </div>
    </div>

    <div style="padding:10px 16px">
      <div style="display:flex;justify-content:space-between;font-size:8px;color:var(--dim,#8a7848);margin-bottom:3px">
        <span>⚔ Attack power</span><span style="color:var(--gold,#c9a84c)">${Math.round(effAtk)}</span>
      </div>
      <div style="height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden;margin-bottom:8px">
        <div style="height:100%;background:linear-gradient(90deg,#c9a84c,#f0d080);border-radius:3px;width:${atkPct}%;transition:width .6s ease"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:8px;color:var(--dim,#8a7848);margin-bottom:3px">
        <span>🛡 Defense power</span><span style="color:#ff7070">${Math.round(effDef)}</span>
      </div>
      <div style="height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden">
        <div style="height:100%;background:linear-gradient(90deg,#c03030,#ff6060);border-radius:3px;width:${defPct}%;transition:width .6s ease"></div>
      </div>
      ${bonusTxt.length?`<div style="font-size:8px;color:var(--dim,#8a7848);margin-top:8px;line-height:1.8">${bonusTxt.join(' · ')}</div>`:''}
    </div>

    <div style="
      margin:0 16px 14px;
      padding:10px 14px;
      background:${winBg};
      border:1px solid ${winBorder};
      border-radius:1px;
      text-align:center;
    ">
      <div style="font-size:14px;color:${winColor};letter-spacing:2px;margin-bottom:3px">${winLabel}</div>
      <div style="font-size:9px;color:var(--dim,#8a7848)">${lostTxt} · Win chance was ~${Math.round(ap)}%</div>
    </div>
  </div>`;

  let closed=false;
  function closeOverlay(){
    if(closed)return;
    closed=true;
    window._battleSkipFn=null;
    window._battleAutoTimer=null;
    ov.style.transition='opacity .18s ease';
    ov.style.opacity='0';
    setTimeout(function(){
      if(ov.parentNode) ov.parentNode.removeChild(ov);
      done();
    },220);
  }
  window._battleAutoTimer=setTimeout(closeOverlay,2800);
  window._battleSkipFn=function(){
    if(window._battleAutoTimer){clearTimeout(window._battleAutoTimer);window._battleAutoTimer=null;}
    closeOverlay();
  };
}

// ── ENEMY ATTACK OVERLAY ──────────────────────────────────────
function _animZoomTo(fr, to, offsetY){
  if(_fastMode) return;
  const tp=PROVINCES[to], fp=fr>=0?PROVINCES[fr]:tp;
  if(!tp||!fp||typeof CW==='undefined'||CW<=0||typeof CH==='undefined'||CH<=0) return;
  const midX=(tp.cx+(fp?fp.cx:tp.cx))/2;
  const midY=(tp.cy+(fp?fp.cy:tp.cy))/2;
  const dist=fp!==tp?Math.sqrt((tp.cx-fp.cx)**2+(tp.cy-fp.cy)**2):0;
  const targetScale=Math.min(CW,CH)/(Math.max(dist*4,20)*1.0);
  const endScale=Math.max(1.5,Math.min(targetScale,10));
  const endTx=CW/2-midX*endScale;
  const endTy=(CH*(offsetY||0.40))-midY*endScale;
  const startScale=vp.scale,startTx=vp.tx,startTy=vp.ty;
  const ANIM_MS=550; const startT=performance.now();
  function easeOut(t){return 1-Math.pow(1-t,3);}
  function frame(now){
    const t=easeOut(Math.min((now-startT)/ANIM_MS,1));
    vp.scale=startScale+(endScale-startScale)*t;
    vp.tx=startTx+(endTx-startTx)*t;
    vp.ty=startTy+(endTy-startTy)*t;
    scheduleDraw();
    if(t<1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function showEnemyAttackOverlay(ev, done){
  if(_fastMode){done();return;}
  const {fr, to, atker, send, win, al} = ev;

  // Zoom camera to the battle site
  if(typeof _animZoomTo==='function') _animZoomTo(fr, to, 0.38);

  // Neutralise any lingering skip fn WITHOUT calling its done()
  window._battleSkipFn = null;
  if(window._battleAutoTimer){clearTimeout(window._battleAutoTimer);window._battleAutoTimer=null;}

  // Always destroy and recreate so animation replays cleanly
  const old = document.getElementById('_battle_overlay');
  if(old) old.parentNode.removeChild(old);

  if(!document.getElementById('_bov_style')){
    const st=document.createElement('style');st.id='_bov_style';
    st.textContent='@keyframes _bov_in{from{opacity:0}to{opacity:1}}'+
      '@keyframes _bov_slide{from{transform:translateY(18px);opacity:0}to{transform:translateY(0);opacity:1}}';
    document.head.appendChild(st);
  }

  const ov = document.createElement('div');
  ov.id = '_battle_overlay';
  ov.style.cssText = [
    'position:fixed','inset:0','z-index:200',
    'display:flex','align-items:center','justify-content:center',
    'background:rgba(6,8,14,.72)',
    'backdrop-filter:blur(3px)','-webkit-backdrop-filter:blur(3px)',
    'animation:_bov_in .22s ease',
    'opacity:1',
  ].join(';');
  document.body.appendChild(ov);

  const atkerName = NATIONS[atker]?.name || ownerName(atker);
  const toName    = PROVINCES[to]?.name  || '?';
  const frName    = PROVINCES[fr]?.short || '?';
  const approxSend = approxForce(send);
  const approxDef  = approxForce(G.army[to] || 0);
  const resColor   = win ? '#ff8060' : '#a0c880';
  const resText    = win
    ? `☠ ${atkerName} seized ${toName}!`
    : `✦ ${toName} repelled the attack!`;
  const resBg      = win ? 'rgba(100,20,20,.22)' : 'rgba(20,80,10,.22)';
  const resBorder  = win ? 'rgba(160,40,40,.5)'  : 'rgba(60,160,40,.5)';

  ov.innerHTML=`<div style="
    background:linear-gradient(160deg,#1a0808,#0a0404);
    border:1px solid rgba(180,40,40,.5);
    width:min(420px,94vw);
    font-family:'Cinzel',serif;
    animation:_bov_slide .30s ease;
    position:relative;
  ">
    <div style="font-size:12px;color:#c06040;text-align:center;letter-spacing:3px;padding:14px 16px 8px;border-bottom:1px solid rgba(100,30,30,.5)">⚔ Enemy Attack ⚔</div>
    <div style="font-size:9px;color:#4a2820;text-align:center;padding:5px 0 0;letter-spacing:2px">${atkerName} → ${toName}</div>
    <div style="font-size:8px;color:#2a1810;text-align:center;padding:2px 0 10px;letter-spacing:1px">tap to continue</div>

    <div style="display:flex;gap:0;margin:0 16px 12px;border:1px solid rgba(80,30,30,.35)">
      <div style="flex:1;text-align:center;padding:12px 10px;background:rgba(70,16,16,.35)">
        <div style="font-size:8px;color:#c85050;letter-spacing:2px;margin-bottom:5px">ENEMY FORCE</div>
        <div style="font-size:11px;color:#e8d5a3;margin-bottom:3px">${atkerName}</div>
        <div style="font-size:32px;font-weight:700;color:#e87070;line-height:1">~${fa(approxSend)}</div>
      </div>
      <div style="display:flex;align-items:center;padding:0 14px;font-size:22px;color:#c09040;font-family:'Cinzel Decorative',serif">VS</div>
      <div style="flex:1;text-align:center;padding:12px 10px;background:rgba(20,50,20,.35)">
        <div style="font-size:8px;color:#80c860;letter-spacing:2px;margin-bottom:5px">YOUR FORCE</div>
        <div style="font-size:11px;color:#e8d5a3;margin-bottom:3px">${toName}</div>
        <div style="font-size:32px;font-weight:700;color:#a0e870;line-height:1">${fa(approxDef)}</div>
      </div>
    </div>

    <div style="margin:0 16px 14px;padding:11px 14px;background:${resBg};border:1px solid ${resBorder};text-align:center">
      <div style="font-size:14px;color:${resColor};letter-spacing:2px">${resText}</div>
    </div>
  </div>`;

  let closed = false;
  function closeOverlay(){
    if(closed) return; closed = true;
    window._battleSkipFn = null;
    window._battleAutoTimer = null;
    ov.style.transition = 'opacity .18s ease';
    ov.style.opacity = '0';
    setTimeout(()=>{ if(ov.parentNode) ov.parentNode.removeChild(ov); done(); }, 200);
  }
  window._battleAutoTimer = setTimeout(closeOverlay, 3200);
  window._battleSkipFn = ()=>{ if(window._battleAutoTimer){clearTimeout(window._battleAutoTimer);window._battleAutoTimer=null;} closeOverlay(); };
  ov.onclick = ()=>{ if(window._battleAutoTimer){clearTimeout(window._battleAutoTimer);window._battleAutoTimer=null;} closeOverlay(); };
}
