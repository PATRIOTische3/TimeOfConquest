// ══════════════════════════════════════════════════════════
//  UI — HUD, Side Panel, Popups, Modal, Province Popup
// ══════════════════════════════════════════════════════════

// ── HUD / UI ──────────────────────────────────────────────
function updateHUD(){
  const mr=regsOf(G.playerNation);let ta=0,tp=0,tsat=0,tinc=0;
  const io=ideol();
  const curTax=G.taxRate??25;
  const taxFactor=0.4+(curTax/100)*2.4;
  mr.forEach(r=>{
    ta+=G.army[r];tp+=G.pop[r];tsat+=G.satisfaction[r]??70;
    let inc=G.income[r];
    if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
    if((G.buildings[r]||[]).includes('palace'))inc=Math.floor(inc*1.15);
    tinc+=Math.floor(inc*io.income*taxFactor);
  });
  const avgSat=mr.length?Math.round(tsat/mr.length):70;
  const debt=G.loans.reduce((s,l)=>s+l.amount,0);
  sEl('h-date',dateStr());
  sEl('h-gld',fa(G.gold[G.playerNation]));
  sEl('h-pop',fm(tp));
  // Income
  const incEl=document.getElementById('h-inc');
  if(incEl){incEl.textContent='+'+fa(tinc)+'g';incEl.style.color='#6ed46e';}
  const loanSt=document.getElementById('h-loan-st');
  if(loanSt){loanSt.style.display=debt>0?'flex':'none';sEl('h-debt',fa(debt));}
  // Satisfaction display
  const satEl=document.getElementById('h-sat');
  if(satEl){
    satEl.textContent=avgSat+'%';
    const satSt=document.getElementById('h-sat-st');
    if(satSt){
      satSt.classList.toggle('warn',avgSat<40);
      satSt.style.display='flex';
    }
  }
  // Tax rate display
  const taxEl=document.getElementById('h-tax');
  if(taxEl){
    const tr=G.taxRate??25;
    taxEl.textContent=tr+'%';
    taxEl.style.color=tr<=25?'var(--green2)':tr<=50?'var(--gold)':tr<=75?'#e07030':'#ff4040';
  }
  // sp-tax-sub update
  const taxSubEl=document.getElementById('sp-tax-sub');
  if(taxSubEl){const tr=G.taxRate??25;taxSubEl.textContent=`Tax: ${tr}% · Avg satisfaction: ${avgSat}%`;}
  // Reform indicator
  const refEl=document.getElementById('h-reform-st');
  if(refEl){
    refEl.style.display=G.reforming?'flex':'none';
    if(G.reforming)sEl('h-reform-txt',`⚖ ${G.reformTurnsLeft}mo left`);
  }
}
function updateIdeoHUD(){const io=ideol(),el=document.getElementById('hud-ideo');if(!el)return;el.innerHTML=`<div class="hsl">Ideology</div><div class="hsv" style="color:${io.color}">${io.icon} ${io.name}</div>`;}
function updateSeasonUI(){
  const s=season();
  sEl('h-season',s.icon);
  const sb=document.getElementById('season-banner');
  if(sb)sb.textContent=s.icon+' '+s.name+(s.moveMod<1?` — movement ×${s.moveMod}`:'');
}
var sEl=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
var sHTML=(id,v)=>{const e=document.getElementById(id);if(e)e.innerHTML=v;};



function showSeaZoneInfo(zi){
  if(!window._seaZonePositions || !_seaZonePositions[zi]) return;
  const z = _seaZonePositions[zi];
  const name = z.t || 'Sea Zone';

  // Update name fields (desktop + mobile)
  const spNm = document.getElementById('sp-nm');
  if(spNm) spNm.textContent = name;
  const riNm = document.getElementById('ri-nm');
  if(riNm) riNm.textContent = name;

  // Clear owner / status badge
  const spBdg = document.getElementById('sp-bdg');
  if(spBdg) spBdg.innerHTML = '<span class="badge neut">🌊 Sea Zone</span>';
  const riBdg = document.getElementById('ri-bdg');
  if(riBdg) riBdg.innerHTML = '<span class="badge neut">🌊 Sea Zone</span>';
  const owEl = document.getElementById('sp-ow');
  if(owEl){ owEl.textContent = ''; }
  const riOw = document.getElementById('ri-ow');
  if(riOw){ riOw.textContent = ''; }

  // Blank out stats — sea zones have no army/pop/income
  sEl('sp-ar', '—'); sEl('sp-pp', '—'); sEl('sp-in', '—'); sEl('sp-as', '—');
  sEl('ri-ar', '—'); sEl('ri-pp', '—'); sEl('ri-in', '—'); sEl('ri-as', '—');
  sHTML('sp-res', ''); sHTML('sp-blds', '');
  sHTML('ri-res', ''); sHTML('ri-blds', '');

  // Change tab icon to 🌊 on mobile
  const tabInfo = document.getElementById('tab-info');
  if(tabInfo) tabInfo.innerHTML = '🌊 Region';
}

function restoreRegionTab(){
  const tabInfo = document.getElementById('tab-info');
  if(tabInfo) tabInfo.innerHTML = '📍 Region';
}

function updateSP(i){
  if(i<0)return;
  const p=PROVINCES[i],o=G.owner[i];
  let inc=G.income[i];
  if((G.buildings[i]||[]).includes('factory'))inc=Math.floor(inc*1.8);
  if(o===G.playerNation)inc=Math.floor(inc*ideol().income);
  const maxBld=p.isCapital?MAX_BLD_CAP:MAX_BLD_NORM;
  const bldC=(G.buildings[i]||[]).length;
  const inst=G.instab[i],resist=G.resistance[i];
  const navalRch=canLaunchNaval(i)?navalDests(i).length:0;
  const allyIdx=o>=0?G.allianceOf[o]:-1;
  const allyName=allyIdx>=0?G.alliance[allyIdx]?.name:'';

  let bdg='';
  if(o===G.playerNation){
    bdg='';
    if(p.isCapital)bdg+='<span class="badge cap">★ Capital</span>';
    if(inst>40)bdg+='<span class="badge war">⚡ Unstable</span>';
  } else if(o<0)bdg='';
  else if(atWar(G.playerNation,o))bdg='<span class="badge war">⚔ War</span>';
  else if(G.pact[G.playerNation][o])bdg=`<span class="badge pact">🤝 Pact(${G.pLeft[G.playerNation][o]}mo)</span>`;
  else if(areAllies(G.playerNation,o))bdg=`<span class="badge ally">🤝 ${allyName}</span>`;
  else bdg='<span class="badge neut">○ Neutral</span>';
  if(resist>20)bdg+=`<span class="badge resist">🔥 Resist ${Math.round(resist)}%</span>`;
  if(G.puppet.includes(o))bdg+='<span class="badge pact">🎭 Puppet</span>';
  // Disease badge
  const epId=G.provDisease?.[i];
  if(epId){
    const ep=G.epidemics?.find(e=>e.id===epId&&e.active);
    if(ep)bdg+=`<span class="badge war" style="border-color:${ep.color};color:${ep.color}">${ep.icon} ${ep.name}</span>`;
  }

  const RES_ICONS={oil:'🛢️',coal:'⚫',grain:'🌾',steel:'⚙️',iron:'🔩',wood:'🪵',stone:'🪨',gold:'🥇'};
  const resHtml=Object.entries(G.resBase[i]||{}).filter(([,v])=>v>0).map(([k,v])=>`<span class="res-chip">${RES_ICONS[k]||k} ${v}</span>`).join('');
  const bldHtml=bldC?G.buildings[i].map(k=>`<span class="bld-tag">${BUILDINGS[k]?.icon||k}</span>`).join(''):'';

  sEl('sp-nm',p.name);
  sHTML('sp-bdg',bdg);
  const owEl=document.getElementById('sp-ow');
  if(owEl){
    owEl.textContent=o>=0?ownerName(o):'Rebels';
    owEl.style.color=o===G.playerNation?'rgba(100,210,120,.75)':'rgba(201,168,76,.40)';
  }
  const avArmy=G.owner[i]===G.playerNation?availableArmy(i):G.army[i];
  // Army display: own/ally/puppet = exact, enemy = fog-of-war intel (matches map labels)
  let armyDisplay;
  if(o===G.playerNation){
    armyDisplay=avArmy<G.army[i]
      ?`${fa(avArmy)} <span style="color:var(--dim);font-size:9px">(${fa(G.army[i])})</span>`
      :fa(G.army[i]);
  } else if(o>=0&&(areAllies(G.playerNation,o)||G.puppet.includes(o))){
    armyDisplay=fa(G.army[i]);
  } else {
    const intel=typeof getArmyIntel==='function'?getArmyIntel(i):{visible:false,value:null};
    if(!intel.visible||intel.value==null) armyDisplay='?';
    else {
      const isFar=(typeof _armyBFSDist==='function'?_armyBFSDist()[i]:99)>1;
      armyDisplay=(isFar?'~':'')+fm(intel.value);
    }
  }
  sHTML('sp-ar',armyDisplay);sEl('sp-pp',fm(G.pop[i]));sEl('sp-in',inc+'/mo');
  sEl('sp-as',o===G.playerNation?Math.round(G.assim[i])+'%':'—');
  sHTML('sp-res',resHtml);sHTML('sp-blds',bldHtml);
  const spif=document.getElementById('sp-if'),spiv=document.getElementById('sp-iv');
  if(spif){spif.style.width=inst+'%';spif.style.background=inst>70?'#c82808':inst>40?'#c08020':'#389828';}
  if(spiv)spiv.textContent=Math.round(inst)+'%';
  const spibar=document.getElementById('sp-ibar');if(spibar)spibar.style.display='none';
  // Satisfaction bar
  const sat=G.satisfaction[i]??70;
  const spsat=document.getElementById('sp-sat-fill'),spsatv=document.getElementById('sp-sat-val');
  const spsatbar=document.getElementById('sp-sat-bar');
  if(spsatbar)spsatbar.style.display=o===G.playerNation?'block':'none';
  if(spsat){spsat.style.width=sat+'%';spsat.style.background=sat<40?'#c83020':sat<60?'#c08020':'#389828';}
  if(spsatv)spsatv.textContent=Math.round(sat)+'%';
  // Construction progress
  const con=G.construction[i];
  const spcon=document.getElementById('sp-con');
  if(spcon){
    if(con&&o===G.playerNation){
      const b=BUILDINGS[con.building];
      const pct=Math.round((con.totalTurns-con.turnsLeft)/con.totalTurns*100);
      spcon.style.display='block';
      spcon.innerHTML=`<div style="display:flex;justify-content:space-between;font-size:7.5px;color:var(--dim);margin-bottom:2px"><span>🏗 ${b?.name}</span><span>${con.totalTurns-con.turnsLeft}/${con.totalTurns}mo</span></div><div style="height:3px;background:rgba(255,255,255,.06);border-radius:2px"><div style="height:100%;background:var(--gold);border-radius:2px;width:${pct}%"></div></div>`;
    }else spcon.style.display='none';
  }
  sEl('sp-bld-sub',o===G.playerNation?(con?`Building: ${BUILDINGS[con.building]?.name}`:`${bldC}/${maxBld} slots`):'Select your territory');
  // Move/naval btns
  const canMove=o===G.playerNation&&G.army[i]>100;
  ['sp-btn-move','mob-btn-move'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=!canMove;});
  sEl('sp-move-sub',canMove?`From ${p.short}`:'Select your territory');
  const canNaval=canLaunchNaval(i);
  ['sp-btn-naval','mob-btn-naval'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=!canNaval;});
  sEl('sp-naval-sub',canNaval?`${navalRch} ports in range`:'Need port + coastal');
  // Mobile
  sEl('ri-nm',p.name);sHTML('ri-bdg',bdg);sEl('ri-ow',o>=0?ownerName(o):'Rebels');
  sEl('ri-ar',fa(G.army[i]));sEl('ri-pp',fm(G.pop[i]));sEl('ri-in',inc+'/mo');sEl('ri-as',o===G.playerNation?Math.round(G.assim[i])+'%':'—');
  sHTML('ri-res',resHtml);sHTML('ri-blds',bldHtml);
  const riif=document.getElementById('ri-if'),riiv=document.getElementById('ri-iv');
  if(riif){riif.style.width=inst+'%';riif.style.background=inst>70?'#c82808':inst>40?'#c08020':'#389828';}
  if(riiv)riiv.textContent=Math.round(inst)+'%';
}


// NOTE: chkBtns() lives in military.js

// ── MODAL ─────────────────────────────────────────────────
function openMo(title,body,btns){
  sEl('mo-t',title);sHTML('mo-b',body);
  const bw=document.getElementById('mo-btns');bw.innerHTML='';
  btns.forEach(({lbl,cls,cb})=>{const b=document.createElement('button');b.className='btn '+(cls||'');b.textContent=lbl;b.onclick=()=>{closeMo();cb&&cb();};bw.appendChild(b);});
  document.getElementById('mo').classList.add('on');
}
function closeMo(){const m=document.getElementById('mo');if(m){m.classList.remove('on');m.style.zIndex='200';}}
function moOut(e){if(e.target===document.getElementById('mo'))closeMo();}function moOut(e){if(e.target===document.getElementById('mo'))closeMo();}
// Aliases used by save system in index.html
function openModal(title,body,btnsHtml){
  sEl('mo-t',title);sHTML('mo-b',body);
  const bw=document.getElementById('mo-btns');
  bw.innerHTML=btnsHtml||'';
  document.getElementById('mo').classList.add('on');
}
function closeModal(){closeMo();}

function popup(msg,dur=2600){const p=document.getElementById('popup');if(!p)return;p.textContent=msg;p.classList.add('on');clearTimeout(_popT);_popT=setTimeout(()=>p.classList.remove('on'),dur);}
function addLog(msg,type='info'){
  const entryHtml=`<div class="le le-new"><span class="lt">${dateStr()}</span><span class="lm ${type}">${msg}</span></div>`;
  ['log','mob-log'].forEach(id=>{
    const l=document.getElementById(id);if(!l)return;
    // Clear placeholder
    if(id==='log'&&l.children.length===1&&l.children[0].style?.textAlign==='center')l.innerHTML='';
    l.insertAdjacentHTML('afterbegin',entryHtml);
    // Trigger animation on the new entry
    const newEl=l.firstElementChild;
    if(newEl){
      void newEl.offsetWidth; // reflow
      newEl.classList.add('le-anim');
      setTimeout(()=>newEl?.classList.remove('le-new','le-anim'),600);
    }
    while(l.children.length>100)l.removeChild(l.lastChild);
  });
}
function setEB(d){['end-btn','end-btn-mob'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=d;});}

// Escape key closes popup and cancels modes
document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){
    hideProvPopup();
    if(_atkSelectMode) cancelAtkSelect();
    if(G.moveMode) cancelMove();
    if(G.navalMode) cancelNaval();
  }
});



// ── PROVINCE POPUP ────────────────────────────────────────
var _ppProvince = -1;

function showProvPopup(i, screenX, screenY){
  const p=PROVINCES[i], o=G.owner[i], PN=G.playerNation;
  _ppProvince = i;

  const isOurs = o === PN;
  const isEnemy = o >= 0 && o !== PN;
  const isIndep = o < 0;
  const ideo = o >= 0 ? IDEOLOGIES[NATIONS[o]&&NATIONS[o].ideology] : null;
  const ownerTxt = o < 0 ? '⚡ Rebels' : (NATIONS[o]&&NATIONS[o].name) || '?';

  let inc = G.income[i];
  if((G.buildings[i]||[]).includes('factory')) inc = Math.floor(inc*1.8);
  if(isOurs) inc = Math.floor(inc * ideol().income);

  const peace = inPeacePeriod();
  const canAtk = !peace && (isEnemy||isIndep) && regsOf(PN).some(r=>G.army[r]>100&&(NB[r]||[]).includes(i));
  const canMove = isOurs && G.army[i]>100;

  const epId = G.provDisease&&G.provDisease[i];
  const ep = epId ? G.epidemics&&G.epidemics.find(e=>e.id===epId&&e.active) : null;

  // Stats grid — pick most relevant 4 stats
  const stats = [];
  const avail_army = isOurs ? availableArmy(i) : G.army[i];
  let armyStr;
  if(isOurs){
    armyStr = avail_army < G.army[i] ? `${fm(avail_army)}/${fm(G.army[i])}` : fm(G.army[i]);
  } else if(o>=0&&(areAllies(PN,o)||G.puppet.includes(o))){
    armyStr = fm(G.army[i]);
  } else {
    const intel=typeof getArmyIntel==='function'?getArmyIntel(i):{visible:false,value:null};
    if(!intel.visible||intel.value==null) armyStr='?';
    else {
      const isFar=(typeof _armyBFSDist==='function'?_armyBFSDist()[i]:99)>1;
      armyStr=(isFar?'~':'')+fm(intel.value);
    }
  }
  // Army strength bar: compare to largest army among all provinces
  const maxArmy = Math.max(1, ...PROVINCES.map((_,idx)=>G.army[idx]||0));
  const armyRatio = Math.min(1, (G.army[i]||0) / maxArmy);
  const BAR_TOTAL = 5;
  const barFilled = Math.round(armyRatio * BAR_TOTAL);
  const armyBar = '\u25ac'.repeat(barFilled) + '\u25ad'.repeat(BAR_TOTAL - barFilled);
  const barColor = barFilled>=4?'#e06050':barFilled>=2?'#c0a030':'#5090c0';
  const armyCell = `${armyStr} <span style="font-size:9px;letter-spacing:1px;color:${barColor}">${armyBar}</span>`;

  stats.push({l:'Army', v: armyCell, html:true});
  stats.push({l:'Pop', v: fm(G.pop[i])});
  stats.push({l:'Income', v: inc+'/mo'});
  if(isOurs){
    stats.push({l:'Satisfaction', v: Math.round(G.satisfaction[i]||0)+'%'});
  } else {
    stats.push({l:'Terrain', v: TERRAIN[p.terrain||'plains']&&TERRAIN[p.terrain||'plains'].name||'Plains'});
  }

  const gridHtml = stats.map(s=>`<div class="pp-cell"><div class="pp-label">${s.l}</div><div class="pp-val">${s.html?s.v:s.v}</div></div>`).join('');

  const diseaseHtml = ep ? `<div class="pp-disease" style="color:${ep.color};border-color:${ep.color}">${ep.icon} ${ep.name}</div>` : '';

  // Action buttons
  const btns = [];
  if(isEnemy||isIndep){
    btns.push({icon:'⚔',lbl:'Attack',cls:'red',disabled:!canAtk,onclick:`hideProvPopup();G.sel=${i};chkBtns();openAttack()`});
  }
  if(isOurs&&canMove&&G.mapMode!=='instab'){
    btns.push({icon:'🚶',lbl:'Move',cls:'grn',onclick:`hideProvPopup();G.sel=${i};toggleMoveMode()`});
  }
  if(isOurs&&G.mapMode==='instab'){
    // In Unrest mode: show Assimilate instead of Build/Draft
    const instabVal=G.instab[i]||0;
    const hasAssim=G.assimQueue&&G.assimQueue[i];
    const canAssim=instabVal>25;
    if(hasAssim){
      btns.push({icon:'🔄',lbl:'Assimilating…',cls:'',disabled:true,onclick:''});
    } else if(canAssim){
      btns.push({icon:'🏛',lbl:'Assimilate',cls:'',onclick:`hideProvPopup();G.sel=${i};openAssim(${i})`});
    } else {
      btns.push({icon:'✅',lbl:'Stable',cls:'',disabled:true,onclick:''});
    }
  } else if(isOurs&&G.mapMode!=='instab'){
    btns.push({icon:'🏗',lbl:'Build',cls:'',onclick:`hideProvPopup();G.sel=${i};openBuild()`});
    const _hasDraft=(G.draftQueue||[]).some(d=>d.prov===i&&d.nation===G.playerNation);
    btns.push({icon:'🪖',lbl:_hasDraft?'Drafting…':'Draft',cls:'',disabled:_hasDraft,onclick:_hasDraft?'':(`hideProvPopup();G.sel=${i};openDraft()`)});
  }
  btns.push({icon:'📋',lbl:'Details',cls:'',onclick:`hideProvPopup();G.sel=${i};updateSP(${i});scheduleDraw()`});

  const btnsHtml = btns.map(b=>`<button class="pp-act${b.cls?' '+b.cls:''}" ${b.disabled?'disabled':''} onclick="${b.onclick}"><span class="pp-act-icon">${b.icon}</span><span class="pp-act-lbl">${b.lbl}</span></button>`).join('');

  const html = `
    <button class="pp-close" onclick="hideProvPopup()">✕</button>
    <div class="pp-head">
      <div class="pp-name">${p.name||p.short||'Province'}${p.isCapital?' ★':''}</div>
      <div class="pp-sub">${ownerTxt}${ideo?' · '+ideo.icon+' '+ideo.name:''}</div>
    </div>
    <div class="pp-grid">${gridHtml}</div>
    ${diseaseHtml}
    <div class="pp-actions">${btnsHtml}</div>
  `;

  const pp = document.getElementById('prov-popup');
  const pi = document.getElementById('prov-popup-inner');
  if(!pp||!pi) return;
  pi.innerHTML = html;
  pi.classList.remove('pp-anim');
  void pi.offsetWidth;
  pi.classList.add('pp-anim');

  pp.style.display = 'block';
  const ppW = pi.offsetWidth || 260;
  const ppH = pi.offsetHeight || 180;
  const wrap = document.getElementById('map-wrap');
  const wrapRect = wrap ? wrap.getBoundingClientRect() : {left:0,top:0,width:window.innerWidth,height:window.innerHeight};
  const canvasEl = document.getElementById('map-canvas');
  const canvasRect = canvasEl ? canvasEl.getBoundingClientRect() : wrapRect;
  // Adjust screenX/Y from canvas-space to map-wrap-space
  const adjX = screenX + (canvasRect.left - wrapRect.left);
  const adjY = screenY + (canvasRect.top - wrapRect.top);
  let x = adjX - ppW/2;
  let y = adjY - ppH - 14;
  if(x < 4) x = 4;
  if(x + ppW > wrapRect.width - 4) x = wrapRect.width - ppW - 4;
  if(y < 4) y = adjY + 22;
  if(y + ppH > wrapRect.height - 4) y = wrapRect.height - ppH - 4;
  pp.style.left = x + 'px';
  pp.style.top = y + 'px';
}

function hideProvPopup(){
  const pp = document.getElementById('prov-popup');
  if(pp) pp.style.display = 'none';
  _ppProvince = -1;
}

function hexToRgb(hex){
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

function onCanvasClick(wx,wy){
  const i=hitProv(wx,wy);

  // ── Port icon click → enter naval mode ───────────────
  // Check if user clicked near the port icon of a coastal province with port
  if(!G.navalMode && !G.moveMode && !_atkSelectMode){
    const PN=G.playerNation;
    for(let pi=0;pi<PROVINCES.length;pi++){
      if(G.owner[pi]!==PN) continue;
      if(!(G.buildings[pi]||[]).includes('port')) continue;
      const hpos=_provCentroid&&_provCentroid[pi]&&_provCentroid[pi].x?_provCentroid[pi]:PROVINCES[pi];
      const px=hpos.x||hpos.cx, py=hpos.y||hpos.cy;
      const labelR=_hexCache?HEX_GRID.hexR:8;
      // Compute port offset (same logic as drawMap)
      let portOffX=labelR*0.8, portOffY=labelR*0.6;
      const edges=window._provBorderEdges&&window._provBorderEdges[pi];
      if(edges){
        let sdx=0,sdy=0,sc=0;
        for(const e of edges){if(!e.isProvBorder){sdx+=(e.x0+e.x1)/2-px;sdy+=(e.y0+e.y1)/2-py;sc++;}}
        if(sc>0){const len=Math.sqrt(sdx*sdx+sdy*sdy)||1;portOffX=(sdx/len)*labelR*0.85;portOffY=(sdy/len)*labelR*0.75;}
      }
      const portX=px+portOffX, portY=py+portOffY;
      const hitR=Math.max(labelR*0.6,5);
      const dx=wx-portX,dy=wy-portY;
      if(dx*dx+dy*dy<hitR*hitR){
        // Port icon clicked — enter naval mode
        G.sel=pi;G.selSea=-1;G.selStage=1;G.selHex=null;
        toggleNavalMode();
        return;
      }
    }
  }


  if(G.navalMode&&G.navalFrom>=0){
    if(i<0){
      const zi=(typeof hitSeaZone==='function')?hitSeaZone(wx,wy):-1;
      if(zi>=0){
        G.selSea=zi;G.navalSeaZone=zi;
        scheduleDraw();
        popup('⚓ Sea zone selected — click a coastal province to land troops');
        return;
      }
      cancelNaval();return;
    }
    if(navalDests(G.navalFrom).includes(i))openNavalDialog(G.navalFrom,i);
    else if(G.owner[i]===G.playerNation&&canLaunchNaval(i)){G.navalFrom=i;scheduleDraw();updateSP(i);}
    else cancelNaval();
    return;
  }
  if(G.moveMode&&G.moveFrom>=0){
    if(i<0){
      const zi=(typeof hitSeaZone==='function')?hitSeaZone(wx,wy):-1;
      if(zi>=0&&(typeof canLaunchNaval==='function')&&canLaunchNaval(G.moveFrom)){
        const fromProv=G.moveFrom;
        cancelMove();
        G.navalFrom=fromProv;G.navalMode=true;
        G.selSea=zi;G.navalSeaZone=zi;
        const mb=document.getElementById('move-banner');
        if(mb){mb.style.display='block';mb.className='naval';mb.textContent='⚓ NAVAL MODE — click destination coast';}
        ['sp-btn-naval','mob-btn-naval'].forEach(id=>{
          const b=document.getElementById(id);
          if(b){b.classList.add('active-naval');const am=b.querySelector('.am');if(am)am.textContent='Cancel Naval';}
        });
        scheduleDraw();
        popup('⚓ Naval via '+((typeof SEA_ZONES!=='undefined'&&SEA_ZONES[zi])?SEA_ZONES[zi].name:'sea')+' — click a coast to land');
        return;
      }
      cancelMove();return;
    }
    if(isMoveTgt(i))openMoveDialog(G.moveFrom,i);
    else if(G.owner[i]===G.playerNation&&G.army[i]>100){G.moveFrom=i;scheduleDraw();updateSP(i);}
    else cancelMove();
    return;
  }
  if(_atkSelectMode&&_atkTarget>=0){
    if(i<0){cancelAtkSelect();return;}
    if(isAtkSrc(i)){const tgt=_atkTarget;cancelAtkSelect();showAttackDialog(i,tgt);}
    else cancelAtkSelect();
    return;
  }

  hideProvPopup();

  if(i<0){
    const zi=(typeof hitSeaZone==='function')?hitSeaZone(wx,wy):-1;
    if(zi>=0){
      G.selSea=zi;G.sel=-1;G.selStage=0;G.selHex=null;
      forceRedraw();chkBtns();
      // Draw overlay once after the main canvas has redrawn
      setTimeout(function(){if(typeof _drawSeaZoneOverlay==='function')_drawSeaZoneOverlay();},50);
      if(typeof showSeaZoneInfo==='function')showSeaZoneInfo(zi);
      if(window.innerWidth<=900)switchTab('info');
      return;
    }
    G.selSea=-1;G.sel=-1;G.selStage=0;G.selHex=null;
    if(typeof restoreRegionTab==='function')restoreRegionTab();
    scheduleDraw();chkBtns();return;
  }

  if(G.sel!==i){
    G.sel=i;G.selStage=1;G.selHex=null;G.selSea=-1;
    if(window._instabAnimY)window._instabAnimY[i]=undefined;
    restoreRegionTab();scheduleDraw();updateSP(i);chkBtns();
    if(window.innerWidth<=900)switchTab('info');
    panToProvince(i);
  } else {
    const h=(typeof hitHex==='function')?hitHex(wx,wy):null;
    if(G.selStage===1){
      G.selStage=2;G.selHex=h;scheduleDraw();
    } else if(G.selStage===2){
      if(h&&G.selHex&&h.r===G.selHex.r&&h.c===G.selHex.c){
        G.sel=-1;G.selStage=0;G.selHex=null;scheduleDraw();chkBtns();
      } else {
        G.selHex=h;scheduleDraw();
      }
    }
  }
}


function updSl(slId,vId){
  const sl=document.getElementById(slId),vEl=document.getElementById(vId);
  if(!sl||!vEl)return;const v=+sl.value;
  vEl.textContent=fa(v);sl.style.setProperty('--pct',+sl.max?(v/+sl.max*100)+'%':'0%');
}

