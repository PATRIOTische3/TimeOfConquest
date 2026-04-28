// ══════════════════════════════════════════════════════════════════════════════
//  HEX WARFARE ENGINE  — hex_warfare.js  v2 (clean rewrite)
//
//  What this file does:
//    1. Hex-level ownership (G.hexOwner) for partial province occupation
//    2. Renders occupation hatch overlay on captured hexes
//    3. Renders HEX building icons (barracks/port/fortress on specific hexes)
//    4. Renders army counter badges per hex (G.hexArmy)
//    5. Build-on-hex UI injected into province panel when selStage===2
//    6. Partial occupation status in province panel
//    7. Hex combat & movement
//
//  What this file does NOT do:
//    - Does NOT redefine BUILDINGS (province buildings stay in utils.js)
//    - Does NOT auto-create armies in every province (no _hwSeedArmies)
//    - Does NOT add armies to capitals on its own
//    - Does NOT spam G.army[] — legacy province army system untouched
// ══════════════════════════════════════════════════════════════════════════════

// ── HEX-LEVEL BUILDINGS (separate from province BUILDINGS in utils.js) ────────
var HEX_BUILDING_DEFS = {
  barracks: {
    name:'Barracks', icon:'🪖', cost:300, buildTurns:3,
    desc:'Enables conscription for this province.',
    coastal:false,
    maxPerProv: function(n){ return n > 20 ? 2 : 1; },
  },
  port: {
    name:'Port', icon:'⚓', cost:500, buildTurns:4,
    desc:'Naval transport. Coastal hexes only.',
    coastal:true,
    maxPerProv: function(){ return 2; },
  },
  fortress: {
    name:'Fortress', icon:'🏯', cost:450, buildTurns:5,
    desc:'Defense ×1.6 on this hex.',
    coastal:false,
    maxPerProv: function(){ return 1; },
  },
};

// ── TERRAIN TABLES ────────────────────────────────────────────────────────────
var HEX_MOVE_COST = {
  plains:1, farmland:1, steppe:1, savanna:1, coast:1, urban:1,
  forest:2, hills:2, highland:2, tundra:2, desert:2,
  mountain:3, swamp:3, marsh:3, jungle:3,
};
var HEX_DEF_BONUS = {
  plains:1.0, farmland:1.0, steppe:1.0, savanna:1.0, coast:1.0, urban:1.55,
  forest:1.35, hills:1.30, highland:1.35, tundra:1.20, desert:1.15,
  mountain:1.70, swamp:1.45, marsh:1.40, jungle:1.50,
};
var HEX_POP_WEIGHT = {
  urban:4.0, farmland:1.5, plains:1.0, coast:0.8, steppe:0.7,
  forest:0.5, hills:0.7, highland:0.6, desert:0.1, tundra:0.1,
  mountain:0.3, swamp:0.2, marsh:0.2, jungle:0.3, savanna:0.6,
};
var HEX_INCOME_WEIGHT = {
  urban:4.0, farmland:1.8, plains:1.0, coast:1.1, steppe:0.8,
  forest:0.6, hills:0.8, highland:0.7, desert:0.2, tundra:0.2,
  mountain:0.4, swamp:0.2, marsh:0.2, jungle:0.4, savanna:0.7,
};
var HEX_ARMY_MP = 3;

// ── INIT ──────────────────────────────────────────────────────────────────────
function hwInit() {
  if (!G.hexOwner)        G.hexOwner = {};
  if (!G.hexArmy)         G.hexArmy = {};
  if (!G.hexBuildings)    G.hexBuildings = {};
  if (!G.hexConstruction) G.hexConstruction = {};
  _hwBuildProvCache();
  _hwPHCTick = -1;
}

function hwOnLoad() {
  if (!G.hexOwner)        G.hexOwner = {};
  if (!G.hexArmy)         G.hexArmy = {};
  if (!G.hexBuildings)    G.hexBuildings = {};
  if (!G.hexConstruction) G.hexConstruction = {};
  _hwBuildProvCache();
  _hwPHCTick = -1;
}

function _hwBuildProvCache() {
  window._provHexBuild = {};
  for (const [hStr, bld] of Object.entries(G.hexBuildings || {})) {
    const hi = +hStr, h = _hexCache && _hexCache[hi];
    if (!h || h.p < 0) continue;
    if (!window._provHexBuild[h.p]) window._provHexBuild[h.p] = [];
    window._provHexBuild[h.p].push({ hexIdx: hi, type: bld.type });
  }
}

// ── PROVINCE HEX LIST (cached per tick) ──────────────────────────────────────
var _hwPHC = null, _hwPHCTick = -1;
function _hwPHexes(pi) {
  if (_hwPHCTick !== G.tick || !_hwPHC) {
    _hwPHC = []; _hwPHCTick = G.tick;
    if (_hexCache) for (let i = 0; i < _hexCache.length; i++) {
      const h = _hexCache[i];
      if (!h.sea && h.p >= 0) { if (!_hwPHC[h.p]) _hwPHC[h.p] = []; _hwPHC[h.p].push(i); }
    }
  }
  return (_hwPHC && _hwPHC[pi]) || [];
}

// ── OWNERSHIP ─────────────────────────────────────────────────────────────────
function hwHexOwner(hexIdx) {
  if (G.hexOwner && G.hexOwner[hexIdx] !== undefined) return G.hexOwner[hexIdx];
  const h = _hexCache && _hexCache[hexIdx];
  return h && h.p >= 0 ? G.owner[h.p] : -1;
}

function hwProvControlFraction(pi, nation) {
  if (!_hexCache) return G.owner[pi] === nation ? 1 : 0;
  const hexes = _hwPHexes(pi);
  if (!hexes.length) return 0;
  return hexes.filter(i => hwHexOwner(i) === nation).length / hexes.length;
}

function hwProvController(pi) {
  const counts = {};
  for (const i of _hwPHexes(pi)) { const o = hwHexOwner(i); counts[o] = (counts[o]||0)+1; }
  const e = Object.entries(counts);
  return e.length ? +e.sort((a,b)=>b[1]-a[1])[0][0] : G.owner[pi];
}

function hwProvContested(pi) {
  if (!G.hexArmy || !_hexCache) return false;
  const ns = new Set();
  for (const [hs, a] of Object.entries(G.hexArmy))
    if (a.amount > 0 && _hexCache[+hs]?.p === pi) ns.add(a.nation);
  return ns.size > 1;
}

// ── ECONOMICS ─────────────────────────────────────────────────────────────────
function hwProvEffectiveIncome(pi, nation) {
  const base = G.income[pi] || 0;
  if (!_hexCache) return G.owner[pi] === nation ? base : 0;
  const hexes = _hwPHexes(pi);
  if (!hexes.length) return G.owner[pi] === nation ? base : 0;
  let myW = 0, totW = 0;
  for (const i of hexes) {
    const w = HEX_INCOME_WEIGHT[_hexCache[i].t] || 1;
    totW += w;
    if (hwHexOwner(i) === nation) myW += w;
  }
  const frac = totW > 0 ? myW/totW : 0;
  return Math.round(base * frac * (hwProvContested(pi)?0.5:1) * (frac<1&&frac>0?0.65:1) * (G.owner[pi]!==nation?0.7:1));
}

function hwProvMaxRecruit(pi, nation) {
  const frac = hwProvControlFraction(pi, nation);
  if (frac <= 0) return 0;
  const barracks = (window._provHexBuild[pi]||[]).filter(b => b.type==='barracks' && hwHexOwner(b.hexIdx)===nation);
  if (!barracks.length) return 0;
  const base = Math.round((G.pop[pi]||0) * 0.008);
  return Math.max(100, Math.round(base * frac * (G.owner[pi]===nation?1:0.25) * (frac<1?0.35:1)));
}

// ── BUILDING PLACEMENT ────────────────────────────────────────────────────────
function hwCanBuildAt(hexIdx, type, nation) {
  if (!_hexCache) return 'Map not ready';
  const h = _hexCache[hexIdx];
  if (!h || h.sea || h.p < 0) return 'Invalid hex';
  if (hwHexOwner(hexIdx) !== nation) return 'Not your hex';
  const def = HEX_BUILDING_DEFS[type];
  if (!def) return 'Unknown building';
  if (def.coastal && !(h.nbIdx||[]).some(ni => _hexCache[ni]?.sea)) return 'Coastal hexes only';
  if (G.hexBuildings[hexIdx])    return 'Already has a building';
  if (G.hexConstruction[hexIdx]) return 'Already under construction';
  const existing = (window._provHexBuild[h.p]||[]).filter(b => b.type===type);
  if (existing.length >= def.maxPerProv(_hwPHexes(h.p).length)) return `Max per province reached`;
  if ((G.gold[nation]||0) < def.cost) return `Need ${def.cost}g`;
  return true;
}

function hwStartBuild(hexIdx, type) {
  const PN = G.playerNation;
  const check = hwCanBuildAt(hexIdx, type, PN);
  if (check !== true) { popup(check); return false; }
  const def = HEX_BUILDING_DEFS[type];
  G.gold[PN] -= def.cost;
  G.hexConstruction[hexIdx] = { type, nation: PN, turnsLeft: def.buildTurns, totalTurns: def.buildTurns };
  _hwBuildProvCache();
  scheduleDraw(); updateHUD();
  popup(`🏗 ${def.name} — ${def.buildTurns} months`);
  return true;
}

function hwTickConstruction() {
  const done = [];
  for (const [hs, con] of Object.entries(G.hexConstruction||{})) {
    if (--con.turnsLeft <= 0) {
      const hi = +hs;
      G.hexBuildings[hi] = { type: con.type, nation: con.nation };
      done.push(hi);
      const pname = PROVINCES[_hexCache[hi]?.p]?.name || '?';
      const dname = HEX_BUILDING_DEFS[con.type]?.name || con.type;
      addLog(`✅ ${dname} completed in ${pname}!`, 'build');
      popup(`✅ ${dname} built in ${pname}!`, 3000);
    }
  }
  for (const hi of done) delete G.hexConstruction[hi];
  if (done.length) _hwBuildProvCache();
}

// ── HEX CAPTURE ──────────────────────────────────────────────────────────────
function hwCaptureHex(hexIdx, byNation) {
  const h = _hexCache && _hexCache[hexIdx];
  if (!h || h.p < 0) return;
  const pi = h.p;
  // Handle buildings on captured hex
  const bld = G.hexBuildings[hexIdx];
  if (bld && bld.nation !== byNation) {
    if (bld.type === 'fortress' && Math.random() < 0.5) {
      delete G.hexBuildings[hexIdx];
      addLog('🏚 Fortress destroyed', 'combat');
    } else { bld.nation = byNation; }
    _hwBuildProvCache();
  }
  // Update hex ownership
  if (byNation === G.owner[pi]) delete G.hexOwner[hexIdx];
  else G.hexOwner[hexIdx] = byNation;
  // Check full province capture
  const hexes = _hwPHexes(pi);
  if (hexes.length && hexes.every(i => hwHexOwner(i) === byNation)) {
    const prev = G.owner[pi];
    G.owner[pi] = byNation;
    hexes.forEach(i => delete G.hexOwner[i]);
    if (PROVINCES[pi].isCapital && G.capitalPenalty) G.capitalPenalty[prev] = (G.capitalPenalty[prev]||0)+1;
    addLog(`🗺 ${NATIONS[byNation]?.short||'?'} captures ${PROVINCES[pi].name}!`, 'war');
    if (G.occupied) delete G.occupied[pi];
  } else {
    if (!G.occupied) G.occupied = {};
    G.occupied[pi] = { by: hwProvController(pi), originalOwner: G.owner[pi], partial: true };
  }
}

// ── COMBAT ────────────────────────────────────────────────────────────────────
function hwAttackHex(fromIdx, toIdx) {
  const att = G.hexArmy[fromIdx], toH = _hexCache[toIdx];
  if (!att || att.amount <= 0 || !toH) return null;
  const def = G.hexArmy[toIdx] || { amount: 0, nation: hwHexOwner(toIdx) };
  const defBonus = (HEX_DEF_BONUS[toH.t]||1) * (G.hexBuildings[toIdx]?.type==='fortress' ? 1.6 : 1);
  let al = Math.min(att.amount, Math.round(def.amount*0.12*defBonus*0.8 + ri(0, Math.round(att.amount*0.02))));
  let dl = Math.min(def.amount, Math.round(att.amount*0.10/defBonus      + ri(0, Math.round(def.amount*0.02))));
  const newAtt = att.amount - al, newDef = def.amount - dl, win = newDef <= 0;
  att.amount = Math.max(0, newAtt);
  att.movePoints = Math.max(0, (att.movePoints||0) - (HEX_MOVE_COST[toH.t]||1));
  if (att.amount <= 0) delete G.hexArmy[fromIdx];
  if (win) {
    delete G.hexArmy[toIdx];
    const capNation = att.amount > 0 ? att.nation : G.playerNation;
    if (newAtt > 0) G.hexArmy[toIdx] = { amount: newAtt, nation: capNation, movePoints: 0 };
    if (att.amount <= 0) delete G.hexArmy[fromIdx];
    hwCaptureHex(toIdx, capNation);
  } else {
    G.hexArmy[toIdx] = { amount: newDef, nation: def.nation, movePoints: def.movePoints||0 };
  }
  addLog(`⚔ ${NATIONS[att.nation]?.short||'?'}→${NATIONS[def.nation]?.short||'?'} [${toH.t}]: -${fm(al)}/${fm(dl)} ${win?'🏴 captured':'🛡 held'}`, 'combat');
  scheduleDraw();
  return { win, attLoss: al, defLoss: dl };
}

function hwMoveArmy(fromIdx, toIdx, amount) {
  if (!_hexCache) return false;
  const army = G.hexArmy[fromIdx], toH = _hexCache[toIdx];
  if (!army || army.amount <= 0) { popup('No army here'); return false; }
  if (!toH || toH.sea) { popup('Cannot move there'); return false; }
  const cost = HEX_MOVE_COST[toH.t]||1;
  if ((army.movePoints||0) < cost) { popup(`Need ${cost} MP`); return false; }
  const toArmy = G.hexArmy[toIdx];
  if (toArmy && toArmy.amount > 0 && toArmy.nation !== army.nation) {
    if (!atWar(army.nation, toArmy.nation)) { popup('Not at war'); return false; }
    return hwAttackHex(fromIdx, toIdx);
  }
  const moved = Math.min(amount || army.amount, army.amount);
  army.amount -= moved; army.movePoints = Math.max(0,(army.movePoints||0)-cost);
  if (army.amount <= 0) delete G.hexArmy[fromIdx];
  if (!G.hexArmy[toIdx]) G.hexArmy[toIdx] = { amount: 0, nation: army.nation, movePoints: Math.max(0,HEX_ARMY_MP-cost) };
  G.hexArmy[toIdx].amount += moved;
  if (hwHexOwner(toIdx) !== army.nation) hwCaptureHex(toIdx, army.nation);
  scheduleDraw(); return true;
}

function hwResetMovePoints() {
  const PN = G.playerNation;
  for (const a of Object.values(G.hexArmy||{})) if (a.nation===PN) a.movePoints = HEX_ARMY_MP;
}

// ── END TURN ──────────────────────────────────────────────────────────────────
function hwEndTurn() {
  hwTickConstruction();
  hwResetMovePoints();
  _hwPHCTick = -1;
  _hatchCache = {};
}

// Auto-hook endTurn()
(function() {
  function tryHook() {
    if (typeof window.endTurn !== 'function' || window._hwHooked) return false;
    const orig = window.endTurn;
    window.endTurn = function(){ hwEndTurn(); return orig.apply(this,arguments); };
    window._hwHooked = true; return true;
  }
  if (!tryHook()) document.addEventListener('DOMContentLoaded', tryHook);
})();

// ── RENDERING ─────────────────────────────────────────────────────────────────
var _hatchCache = {};

function _hatchPat(ctx, color) {
  if (_hatchCache[color]) return _hatchCache[color];
  const sz=8, oc=document.createElement('canvas'); oc.width=sz; oc.height=sz;
  const ox=oc.getContext('2d'); ox.strokeStyle=color; ox.lineWidth=1.8;
  ox.beginPath(); ox.moveTo(0,sz); ox.lineTo(sz,0); ox.stroke();
  ox.beginPath(); ox.moveTo(-sz/2,sz/2); ox.lineTo(sz/2,-sz/2); ox.stroke();
  ox.beginPath(); ox.moveTo(sz/2,sz*1.5); ox.lineTo(sz*1.5,sz/2); ox.stroke();
  const p=ctx.createPattern(oc,'repeat'); _hatchCache[color]=p; return p;
}

// Called per-hex in map.js PASS 2 — draws occupation hatch
function hwDrawHexOccupation(ctx, h, hexIdx, R) {
  if (!G.hexOwner || hwHexOwner(hexIdx) === G.owner[h.p]) return;
  const col = natColor(hwHexOwner(hexIdx));
  ctx.globalAlpha = 0.38; ctx.fillStyle = col;
  hexPath(ctx, h.x, h.y, R); ctx.fill();
  ctx.globalAlpha = 0.50;
  const pat = _hatchPat(ctx, col);
  if (pat) { ctx.fillStyle = pat; hexPath(ctx, h.x, h.y, R); ctx.fill(); }
  ctx.globalAlpha = 1.0;
}

// Called after hex passes in map.js — building icons
function hwDrawBuildings(ctx, R, wx0, wy0, wx1, wy1) {
  if (!_hexCache) return;
  const sc = vp.scale; if (sc < 0.35) return;
  const al = Math.min(1,(sc-0.35)/0.25), fs = Math.max(4,R*0.58), PN = G.playerNation;

  function draw(h, icon, own, isC, prog) {
    ctx.globalAlpha = (isC?0.55:0.85)*al;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath(); ctx.arc(h.x,h.y,R*0.42,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = isC ? 'rgba(160,140,60,0.6)' : own ? 'rgba(201,168,76,0.85)' : 'rgba(180,100,100,0.7)';
    ctx.lineWidth = (isC?0.8:1.0)/sc;
    if (isC) ctx.setLineDash([2/sc,2/sc]);
    ctx.beginPath(); ctx.arc(h.x,h.y,R*0.42,0,Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    if (isC && prog>0) {
      ctx.strokeStyle='rgba(201,168,76,0.9)'; ctx.lineWidth=1.2/sc;
      ctx.beginPath(); ctx.arc(h.x,h.y,R*0.42,-Math.PI/2,-Math.PI/2+prog*Math.PI*2); ctx.stroke();
    }
    ctx.globalAlpha=al*(isC?0.7:1); ctx.font=`${fs}px serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.shadowColor='rgba(0,0,0,0.95)'; ctx.shadowBlur=3;
    ctx.fillText(icon,h.x,h.y); ctx.shadowBlur=0; ctx.globalAlpha=1;
  }

  for (const [hs,bld] of Object.entries(G.hexBuildings||{})) {
    const h=_hexCache[+hs]; if(!h||h.sea||h.x<wx0-R*2||h.x>wx1+R*2||h.y<wy0-R*2||h.y>wy1+R*2) continue;
    draw(h, HEX_BUILDING_DEFS[bld.type]?.icon||'?', bld.nation===PN, false, 0);
  }
  for (const [hs,con] of Object.entries(G.hexConstruction||{})) {
    const h=_hexCache[+hs]; if(!h||h.sea||h.x<wx0-R*2||h.x>wx1+R*2||h.y<wy0-R*2||h.y>wy1+R*2) continue;
    draw(h, '🏗', con.nation===PN, true, 1-con.turnsLeft/con.totalTurns);
  }
}

// Called after hex passes in map.js — army badges
function hwDrawHexArmies(ctx, R, wx0, wy0, wx1, wy1) {
  if (!G.hexArmy||!_hexCache) return;
  const sc=vp.scale; if(sc<0.30) return;
  const al=Math.min(1,(sc-0.30)/0.20), fs=Math.max(4,R*0.50), PN=G.playerNation;
  for (const [hs,army] of Object.entries(G.hexArmy)) {
    if (!army||army.amount<=0) continue;
    const h=_hexCache[+hs]; if(!h||h.sea||h.x<wx0-R*2||h.x>wx1+R*2||h.y<wy0-R*2||h.y>wy1+R*2) continue;
    const isOwn=army.nation===PN, isAlly=areAllies(PN,army.nation), isEnemy=atWar(PN,army.nation);
    const bx=h.x+R*0.50, by=h.y+R*0.55, bw=R*0.95, bh=R*0.55;
    ctx.globalAlpha=0.90*al; ctx.fillStyle='rgba(4,4,10,0.85)';
    _hwRR(ctx,bx-bw/2,by-bh/2,bw,bh,2/sc); ctx.fill();
    ctx.strokeStyle=isOwn?'rgba(201,168,76,0.9)':isAlly?'rgba(80,140,220,0.8)':isEnemy?'rgba(220,60,50,0.85)':'rgba(120,120,120,0.6)';
    ctx.lineWidth=0.8/sc; _hwRR(ctx,bx-bw/2,by-bh/2,bw,bh,2/sc); ctx.stroke();
    ctx.globalAlpha=al; ctx.font=`600 ${fs*0.78}px Cinzel,serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillStyle=isOwn?'#f0d080':isAlly?'#a0c0ff':isEnemy?'#ff9090':'#cccccc';
    ctx.shadowColor='rgba(0,0,0,0.95)'; ctx.shadowBlur=2;
    ctx.fillText(fm(army.amount),bx,by); ctx.shadowBlur=0; ctx.globalAlpha=1;
  }
}

function _hwRR(ctx,x,y,w,h,r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
}

// ── UI HELPERS ────────────────────────────────────────────────────────────────
function hwProvStatusHTML(pi) {
  if (pi<0||!_hexCache) return '';
  const frac=hwProvControlFraction(pi,G.owner[pi]);
  const partial=frac>0&&frac<1, contested=hwProvContested(pi);
  if (!partial&&!contested) return '';
  const ctrl=hwProvController(pi), pct=Math.round(frac*100);
  const col=contested?'#ff6040':'#e08830', txt=contested?'⚔ CONTESTED':'▨ PARTIALLY OCCUPIED';
  let h=`<div style="font-size:8px;color:${col};letter-spacing:1px;font-family:Cinzel,serif;margin:4px 0 3px">${txt}</div>`;
  h+=`<div style="height:6px;background:rgba(0,0,0,.4);border-radius:2px;overflow:hidden;display:flex;margin-bottom:3px">
    <div style="width:${pct}%;background:${natColor(G.owner[pi])};opacity:.85"></div>
    <div style="flex:1;background:${natColor(ctrl)};opacity:.65"></div>
  </div><div style="display:flex;justify-content:space-between;font-size:8px;color:#aaa;margin-bottom:4px">
    <span>${NATIONS[G.owner[pi]]?.short||'?'} ${pct}%</span>
    <span>${NATIONS[ctrl]?.short||'?'} ${100-pct}%</span>
  </div>`;
  const blds=window._provHexBuild[pi]||[];
  if (blds.length) {
    h+=`<div style="font-size:8px;color:#555;letter-spacing:1px;margin-top:3px">HEX BUILDINGS</div>`;
    for (const b of blds) {
      const def=HEX_BUILDING_DEFS[b.type], own=hwHexOwner(b.hexIdx)===G.playerNation;
      h+=`<div style="display:flex;align-items:center;gap:4px;padding:1px 0;font-size:8px;opacity:${own?1:0.4}">
        <span>${def?.icon||'?'}</span><span style="color:${own?'#e8d5a3':'#888'}">${def?.name||b.type}</span>
      </div>`;
    }
  }
  return h;
}

function hwBuildMenuHTML(hexIdx) {
  if (hexIdx==null||!_hexCache) return '';
  const h=_hexCache[hexIdx]; if(!h||h.sea||h.p<0) return '';
  const PN=G.playerNation; if(hwHexOwner(hexIdx)!==PN) return '';
  const coastal=(h.nbIdx||[]).some(ni=>_hexCache[ni]?.sea);
  let html=`<div style="font-size:8px;color:#555;letter-spacing:1px;margin:5px 0 3px">BUILD ON HEX · ${h.t.toUpperCase()}${coastal?' · COASTAL':''}</div>`;
  for (const [type,def] of Object.entries(HEX_BUILDING_DEFS)) {
    if (def.coastal&&!coastal) continue;
    const chk=hwCanBuildAt(hexIdx,type,PN), can=chk===true;
    html+=`<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid rgba(42,36,24,.2)">
      <span style="font-size:13px">${def.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:9px;color:${can?'#e8d5a3':'#555'};font-family:Cinzel,serif">${def.name}</div>
        <div style="font-size:7px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${can?def.desc:chk}</div>
      </div>
      <button onclick="hwStartBuild(${hexIdx},'${type}')"
        style="padding:3px 8px;font-size:8px;font-family:Cinzel,serif;
          background:${can?'rgba(20,14,4,.85)':'rgba(10,10,10,.4)'};
          border:1px solid ${can?'rgba(201,168,76,.6)':'rgba(50,50,50,.4)'};
          color:${can?'#c9a84c':'#3a3a3a'};cursor:${can?'pointer':'not-allowed'}"
        ${can?'':'disabled'}>${def.cost}g</button>
    </div>`;
  }
  return html;
}

// ── PANEL INJECTION ───────────────────────────────────────────────────────────
function _hwInjectPanel(pi) {
  if (typeof pi!=='number'||pi<0) return;
  let st=document.getElementById('hw-status');
  if (!st) {
    const par=document.getElementById('sp-actions')||document.getElementById('sp-body');
    if (!par) return;
    st=document.createElement('div'); st.id='hw-status';
    st.style.cssText='padding:3px 0;border-top:1px solid rgba(42,36,24,.35);margin-top:3px';
    par.appendChild(st);
  }
  st.innerHTML=hwProvStatusHTML(pi);

  let bm=document.getElementById('hw-build-menu');
  if (!bm) {
    const par2=document.getElementById('sp-actions')||document.getElementById('sp-body');
    if (!par2) return;
    bm=document.createElement('div'); bm.id='hw-build-menu';
    bm.style.cssText='padding:3px 0;border-top:1px solid rgba(42,36,24,.35);margin-top:3px';
    par2.appendChild(bm);
  }
  // selHex can be either an object {idx,r,c,...} or just a number — handle both
  const hexIdx = G.selStage===2 && G.selHex!=null
    ? (typeof G.selHex==='object' ? G.selHex.idx ?? G.selHex : G.selHex)
    : null;
  bm.innerHTML = hexIdx!=null ? hwBuildMenuHTML(hexIdx) : '';
}

(function _patchSP() {
  function patch() {
    if (typeof window.updateSP!=='function'||window._hwSPP) return false;
    const orig=window.updateSP;
    window.updateSP=function(pi){ orig.apply(this,arguments); _hwInjectPanel(typeof pi==='number'?pi:G.sel); };
    window._hwSPP=true; return true;
  }
  if (!patch()) document.addEventListener('DOMContentLoaded', patch);
})();

(function _patchSD() {
  function patch() {
    if (typeof window.scheduleDraw!=='function'||window._hwSDP) return false;
    const orig=window.scheduleDraw;
    window.scheduleDraw=function(){ if(G.sel>=0) _hwInjectPanel(G.sel); return orig.apply(this,arguments); };
    window._hwSDP=true; return true;
  }
  if (!patch()) document.addEventListener('DOMContentLoaded', patch);
})();
