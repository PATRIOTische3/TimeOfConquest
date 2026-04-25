// ══════════════════════════════════════════════════════════
//  NAVAL SYSTEM
//  canLaunchNaval, navalDests, getNavalZones were previously
//  called but never defined anywhere — implemented here.
// ══════════════════════════════════════════════════════════

/**
 * Returns true if the player can launch naval transport from province i.
 * Requires: player owns it, has a port building, and is coastal.
 */
function canLaunchNaval(i){
  if(G.owner[i] !== G.playerNation) return false;
  if(!(G.buildings[i]||[]).includes('port')) return false;
  // Province must be coastal (has 'coast' terrain, or isCoastal flag, or adjacent to sea hex)
  const p = PROVINCES[i];
  if(p.isCoastal || p.terrain === 'coast') return true;
  // Fallback: check if any neighbour is sea
  return (NB[i]||[]).some(nb => PROVINCES[nb]?.isSea);
}

/**
 * Returns province indices reachable by naval transport from province `from`.
 * Reachable = player or neutral coastal province within MAX_NAVAL_RANGE hops
 * through sea zones that `from` connects to.
 * Uses SEA_ZONES adjacency if available, otherwise simple sea-neighbour BFS.
 */
function navalDests(from){
  const MAX_RANGE = 8; // max sea-hop distance
  const PN = G.playerNation;

  // Collect sea hexes reachable from `from` via NB
  const visited  = new Set();
  const frontier = [(NB[from]||[]).filter(nb => PROVINCES[nb]?.isSea)].flat();
  frontier.forEach(nb => visited.add(nb));

  for(let depth = 0; depth < MAX_RANGE; depth++){
    const next = [];
    for(const s of visited){
      (NB[s]||[]).forEach(nb => {
        if(!visited.has(nb) && PROVINCES[nb]?.isSea){ visited.add(nb); next.push(nb); }
      });
    }
    if(!next.length) break;
  }

  // All land provinces adjacent to those sea hexes
  const result = [];
  visited.forEach(s => {
    (NB[s]||[]).forEach(nb => {
      if(!PROVINCES[nb]?.isSea && nb !== from){
        const o = G.owner[nb];
        // Can land on own, neutral, or enemy (if at war)
        const canLand = o === PN || o < 0 || atWar(PN, o);
        if(canLand && !result.includes(nb)) result.push(nb);
      }
    });
  });
  return result;
}

/**
 * Returns names of sea zones the province touches (for display in dialog).
 * Falls back to generic label if SEA_ZONES not defined or province not coastal.
 */
function getNavalZones(provId){
  if(typeof SEA_ZONES === 'undefined' || !SEA_ZONES?.length) return ['Open Sea'];
  const idx = PROVINCES.findIndex(p => p.id === provId || PROVINCES.indexOf(p) === provId);
  if(idx < 0) return ['Open Sea'];
  const zones = [];
  (NB[idx]||[]).forEach(nb => {
    if(!PROVINCES[nb]?.isSea) return;
    // Find which sea zone this sea province belongs to
    SEA_ZONES.forEach(z => {
      if(z.hexIds && _seaZonePositions){
        const pos = _seaZonePositions.find(p => p.t === z.name);
        if(pos && pos.hexIds && _hexCache){
          // Check if any of the zone hexes are adjacent to nb's position
          // Simple: just return zone name if nb is a sea hex nearby
          if(!zones.includes(z.name)) zones.push(z.name);
        }
      } else if(!zones.includes(z.name)){
        zones.push(z.name);
      }
    });
  });
  return zones.length ? zones.slice(0, 3) : ['Open Sea'];
}

// ── NAVAL MOVEMENT UI ────────────────────────────────────
function toggleNavalMode(){
  if(G.moveMode) cancelMove();
  if(G.navalMode){ cancelNaval(); return; }
  const si = G.sel;
  if(si < 0 || !canLaunchNaval(si)){ popup('Need coastal territory with port!'); return; }
  G.navalFrom = si; G.navalMode = true;
  const mb = document.getElementById('move-banner');
  if(mb){ mb.style.display='block'; mb.className='naval'; mb.textContent='⚓ NAVAL MODE — click destination'; }
  ['sp-btn-naval','mob-btn-naval'].forEach(id => {
    const b = document.getElementById(id);
    if(b){ b.classList.add('active-naval'); const am = b.querySelector('.am'); if(am) am.textContent='Cancel Naval'; }
  });
  scheduleDraw(); popup('Naval mode — click reachable coastal territory');
}
function cancelNaval(){
  G.navalFrom = -1; G.navalMode = false;
  const mb = document.getElementById('move-banner');
  if(mb){ mb.style.display='none'; mb.className=''; }
  ['sp-btn-naval','mob-btn-naval'].forEach(id => {
    const b = document.getElementById(id);
    if(b){ b.classList.remove('active-naval'); const am = b.querySelector('.am'); if(am) am.textContent='Naval Transport'; }
  });
  scheduleDraw();
}
function openNavalDialog(from, to){
  cancelNaval();
  if(G.owner[to] >= 0 && G.owner[to] !== G.playerNation && !atWar(G.playerNation, G.owner[to])){
    popup('Cannot land without war!'); return;
  }
  const max   = G.army[from] - 100;
  const zones = getNavalZones(PROVINCES[from].id).map(z => z.replace(/_/g,' ')).join(', ');
  openMo('NAVAL TRANSPORT',
    `<p class="mx">⚓ <b>${PROVINCES[from].name}</b> → <b style="color:#60e8ff">${PROVINCES[to].name}</b></p>
     <p class="mx" style="color:#5090c0">Via: <b>${zones}</b> · Arrives next month</p>
     <p class="mx">Available: <b>${fa(max)}</b> soldiers</p>
     <div class="slider-w"><div class="slider-l"><span>Soldiers</span><span class="slider-v" id="nsv">${fa(max)}</span></div>
     <input type="range" id="nsl" min="100" max="${max}" value="${max}" oninput="updSl('nsl','nsv')"></div>`,
    [{lbl:'Cancel',cls:'dim'},{lbl:'⚓ Embark!',cls:'grn',cb:()=>confirmNaval(from,to)}]
  );
  setTimeout(() => document.getElementById('nsl')?.style.setProperty('--pct','100%'), 40);
}
function confirmNaval(from, to){
  const v = +(document.getElementById('nsl')?.value || G.army[from]-100);
  if(!v) return;
  G.army[from] -= v;
  G.fleet.push({at:to, size:v, nation:G.playerNation, arriveIn:1});
  addLog(`⚓ ${fa(v)} embarked ${PROVINCES[from].short}→${PROVINCES[to].short}.`, 'naval');
  popup(`⚓ Fleet en route — arrives next month!`);
  scheduleDraw(); updateHUD();
}
function resolveNavalArrivals(){
  G.fleet = G.fleet.filter(f => {
    f.arriveIn--;
    if(f.arriveIn <= 0 && f.nation === G.playerNation){
      G.army[f.at] += f.size;
      if(G.owner[f.at] < 0) G.owner[f.at] = G.playerNation;
      addLog(`⚓ ${fa(f.size)} troops landed at ${PROVINCES[f.at].short}.`, 'naval');
      return false;
    }
    return f.arriveIn > 0;
  });
}
