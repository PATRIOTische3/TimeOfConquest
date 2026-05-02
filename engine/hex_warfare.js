// ══════════════════════════════════════════════════════════════════════════════
//  HEX WARFARE ENGINE  — hex_warfare.js  v3
//  Полная интеграция: здания на гексах, призыв в казармы,
//  движение армий по гексам, частичная оккупация.
// ══════════════════════════════════════════════════════════════════════════════

// ── КАТАЛОГ ГЕКСОВЫХ ЗДАНИЙ ──────────────────────────────────────────────────
// Отдельный от провинциальных BUILDINGS (utils.js)
var HEX_BUILDING_DEFS = {
  barracks: {
    name:'Barracks', icon:'🪖', cost:300, buildTurns:3,
    desc:'Enables conscription. Troops rally here.',
    coastal:false,
    maxPerProv: function(n){ return n > 20 ? 2 : 1; },
  },
  port: {
    name:'Port', icon:'⚓', cost:500, buildTurns:4,
    desc:'Naval transport hub. Coastal hexes only.',
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

// ── TERRAIN ───────────────────────────────────────────────────────────────────
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
var HEX_INCOME_WEIGHT = {
  urban:4.0, farmland:1.8, plains:1.0, coast:1.1, steppe:0.8,
  forest:0.6, hills:0.8, highland:0.7, desert:0.2, tundra:0.2,
  mountain:0.4, swamp:0.2, marsh:0.2, jungle:0.4, savanna:0.7,
};
var HEX_ARMY_MP = 3; // очков движения за ход

// ── ИНИЦИАЛИЗАЦИЯ ─────────────────────────────────────────────────────────────
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

// Кэш: провинция → [{hexIdx, type}]
function _hwBuildProvCache() {
  window._provHexBuild = {};
  for (const [hs, bld] of Object.entries(G.hexBuildings || {})) {
    const hi = +hs, h = _hexCache && _hexCache[hi];
    if (!h || h.p < 0) continue;
    if (!window._provHexBuild[h.p]) window._provHexBuild[h.p] = [];
    window._provHexBuild[h.p].push({ hexIdx: hi, type: bld.type });
  }
}

// ── КЭШИРОВАННЫЙ СПИСОК ГЕКСОВ ПРОВИНЦИИ ─────────────────────────────────────
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

// ── НАЙТИ ИНДЕКС ГЕКСА ПО {r, c} ─────────────────────────────────────────────
function hwFindHexIdx(selHex) {
  if (!selHex || !_hexCache) return -1;
  for (let i = 0; i < _hexCache.length; i++) {
    const h = _hexCache[i];
    if (h && h.r === selHex.r && h.c === selHex.c) return i;
  }
  return -1;
}

// ── ВЛАДЕНИЕ ГЕКСАМИ ──────────────────────────────────────────────────────────
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

// ── ЭКОНОМИКА ─────────────────────────────────────────────────────────────────
function hwProvEffectiveIncome(pi, nation) {
  const base = G.income[pi] || 0;
  if (!_hexCache || !G.hexOwner || Object.keys(G.hexOwner).length === 0)
    return G.owner[pi] === nation ? base : 0;
  const hexes = _hwPHexes(pi);
  if (!hexes.length) return G.owner[pi] === nation ? base : 0;
  let myW = 0, totW = 0;
  for (const i of hexes) {
    const w = HEX_INCOME_WEIGHT[_hexCache[i].t] || 1;
    totW += w;
    if (hwHexOwner(i) === nation) myW += w;
  }
  const frac = totW > 0 ? myW/totW : 0;
  return Math.round(base * frac
    * (hwProvContested(pi) ? 0.5 : 1)
    * (frac > 0 && frac < 1 ? 0.65 : 1)
    * (G.owner[pi] !== nation ? 0.7 : 1));
}

// Максимальный призыв из провинции (требует казармы)
function hwProvMaxRecruit(pi, nation) {
  const frac = hwProvControlFraction(pi, nation);
  if (frac <= 0) return 0;
  const barracks = (window._provHexBuild[pi] || [])
    .filter(b => b.type === 'barracks' && hwHexOwner(b.hexIdx) === nation);
  if (!barracks.length) return 0;
  const base = Math.round((G.pop[pi] || 0) * 0.008);
  return Math.max(100, Math.round(base * frac
    * (G.owner[pi] === nation ? 1 : 0.25)
    * (frac < 1 ? 0.35 : 1)));
}

// ── СТРОИТЕЛЬСТВО НА ГЕКСЕ ───────────────────────────────────────────────────
function hwCanBuildAt(hexIdx, type, nation) {
  if (!_hexCache) return 'Map not ready';
  const h = _hexCache[hexIdx];
  if (!h || h.sea || h.p < 0) return 'Invalid hex';
  if (hwHexOwner(hexIdx) !== nation) return 'Not your hex';
  const def = HEX_BUILDING_DEFS[type];
  if (!def) return 'Unknown building';
  if (def.coastal && !(h.nbIdx||[]).some(ni => _hexCache[ni]?.sea))
    return 'Coastal hexes only';
  if (G.hexBuildings[hexIdx])    return 'Already has a building';
  if (G.hexConstruction[hexIdx]) return 'Already under construction';
  const existing = (window._provHexBuild[h.p]||[]).filter(b => b.type === type);
  if (existing.length >= def.maxPerProv(_hwPHexes(h.p).length))
    return 'Province limit reached';
  if ((G.gold[nation]||0) < def.cost) return `Need ${def.cost}g`;
  return true;
}

// Начать строительство — вызывается из кнопки в панели
function hwStartBuild(hexIdx, type) {
  const PN = G.playerNation;
  const check = hwCanBuildAt(hexIdx, type, PN);
  if (check !== true) { popup(check); return false; }
  const def = HEX_BUILDING_DEFS[type];
  G.gold[PN] -= def.cost;
  G.hexConstruction[hexIdx] = {
    type, nation: PN,
    turnsLeft: def.buildTurns,
    totalTurns: def.buildTurns,
  };
  _hwBuildProvCache();
  if(typeof closeModal==='function') closeModal();
  scheduleDraw(); updateHUD();
  if (G.sel >= 0) updateSP(G.sel);
  addLog(`🏗 ${def.name} construction started in ${PROVINCES[_hexCache[hexIdx].p]?.name}`, 'build');
  popup(`🏗 ${def.name} — ${def.buildTurns} weeks to complete`);
  return true;
}

// Отмена строительства на гексе (возврат 50% золота)
function hwCancelBuild(hexIdx) {
  const con = G.hexConstruction && G.hexConstruction[hexIdx];
  if (!con) return;
  const def = HEX_BUILDING_DEFS[con.type];
  const refund = Math.floor(def.cost * 0.5);
  G.gold[G.playerNation] += refund;
  delete G.hexConstruction[hexIdx];
  _hwBuildProvCache();
  if(typeof closeModal==='function') closeModal();
  scheduleDraw(); updateHUD();
  if (G.sel >= 0) updateSP(G.sel);
  popup(`Construction cancelled — ${refund}g refunded`);
}

// Прогресс строительства — каждый ход
function hwTickConstruction() {
  const done = [];
  for (const [hs, con] of Object.entries(G.hexConstruction || {})) {
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

// ── ПРИЗЫВ В КАЗАРМЫ ─────────────────────────────────────────────────────────
// Перехватывает processDraftQueue — войска идут на гекс казармы, не на провинцию
function hwProcessDraftArrival(entry) {
  const pi = entry.prov;
  // Ищем казармы на гексах провинции, принадлежащих игроку
  const barracks = (window._provHexBuild[pi] || [])
    .filter(b => b.type === 'barracks' && hwHexOwner(b.hexIdx) === entry.nation);

  if (!barracks.length) {
    // Нет казарм — войска как обычно на провинцию (совместимость)
    G.army[pi] = (G.army[pi] || 0) + entry.amount;
    return;
  }

  // Распределяем по казармам поровну
  const per = Math.floor(entry.amount / barracks.length);
  const rem = entry.amount - per * barracks.length;
  barracks.forEach((b, i) => {
    if (!G.hexArmy[b.hexIdx])
      G.hexArmy[b.hexIdx] = { amount: 0, nation: entry.nation, movePoints: HEX_ARMY_MP };
    G.hexArmy[b.hexIdx].amount += per + (i === 0 ? rem : 0);
  });
  // Синхронизируем G.army[pi] для HUD/AI
  hwSyncProvArmy(pi);
}

// Синхронизировать G.army[pi] из hexArmy (для HUD и AI)
function hwSyncProvArmy(pi) {
  if (!_hexCache) return;
  let total = 0;
  for (const [hs, a] of Object.entries(G.hexArmy || {})) {
    if (_hexCache[+hs]?.p === pi && a.nation === G.owner[pi]) total += a.amount;
  }
  G.army[pi] = total;
}

// ── ЗАХВАТ ГЕКСА ─────────────────────────────────────────────────────────────
function hwCaptureHex(hexIdx, byNation) {
  const h = _hexCache && _hexCache[hexIdx];
  if (!h || h.p < 0) return;
  const pi = h.p;
  // Здания на захваченном гексе
  const bld = G.hexBuildings[hexIdx];
  if (bld && bld.nation !== byNation) {
    if (bld.type === 'fortress' && Math.random() < 0.5) {
      delete G.hexBuildings[hexIdx];
      addLog('🏚 Fortress destroyed during capture', 'combat');
    } else {
      bld.nation = byNation;
    }
    _hwBuildProvCache();
  }
  // Обновить владельца гекса
  if (byNation === G.owner[pi]) delete G.hexOwner[hexIdx];
  else G.hexOwner[hexIdx] = byNation;

  // Проверить — вся провинция захвачена?
  const hexes = _hwPHexes(pi);
  if (hexes.length && hexes.every(i => hwHexOwner(i) === byNation)) {
    const prev = G.owner[pi];
    G.owner[pi] = byNation;
    hexes.forEach(i => delete G.hexOwner[i]);
    if (PROVINCES[pi].isCapital && G.capitalPenalty)
      G.capitalPenalty[prev] = (G.capitalPenalty[prev]||0) + 1;
    addLog(`🗺 ${NATIONS[byNation]?.short||'?'} captures ${PROVINCES[pi].name}!`, 'war');
    if (G.occupied) delete G.occupied[pi];
  } else {
    if (!G.occupied) G.occupied = {};
    G.occupied[pi] = { by: hwProvController(pi), originalOwner: G.owner[pi], partial: true };
  }
}

// ── БОЙ ───────────────────────────────────────────────────────────────────────
function hwAttackHex(fromIdx, toIdx) {
  const att = G.hexArmy[fromIdx];
  const toH = _hexCache && _hexCache[toIdx];
  if (!att || att.amount <= 0 || !toH) return null;

  const def = G.hexArmy[toIdx] || { amount: 0, nation: hwHexOwner(toIdx) };
  const defBonus = (HEX_DEF_BONUS[toH.t] || 1.0)
    * (G.hexBuildings[toIdx]?.type === 'fortress' ? 1.6 : 1.0);

  let al = Math.min(att.amount,
    Math.round(def.amount * 0.12 * defBonus * 0.8 + ri(0, Math.round(att.amount * 0.02))));
  let dl = Math.min(def.amount,
    Math.round(att.amount * 0.10 / defBonus + ri(0, Math.round(def.amount * 0.02))));

  const newAtt = att.amount - al;
  const newDef = def.amount - dl;
  const win = newDef <= 0;

  // Применить потери
  att.amount = Math.max(0, newAtt);
  att.movePoints = Math.max(0, (att.movePoints||0) - (HEX_MOVE_COST[toH.t]||1));
  if (att.amount <= 0) delete G.hexArmy[fromIdx];

  if (win) {
    delete G.hexArmy[toIdx];
    const capNation = att.amount > 0 ? att.nation : G.playerNation;
    if (newAtt > 0) {
      G.hexArmy[toIdx] = { amount: newAtt, nation: capNation, movePoints: 0 };
      if (att.amount <= 0) delete G.hexArmy[fromIdx];
    }
    hwCaptureHex(toIdx, capNation);
  } else {
    G.hexArmy[toIdx] = { amount: newDef, nation: def.nation, movePoints: def.movePoints||0 };
  }

  // Синхронизировать G.army
  if (_hexCache[fromIdx]) hwSyncProvArmy(_hexCache[fromIdx].p);
  if (_hexCache[toIdx])   hwSyncProvArmy(_hexCache[toIdx].p);

  const an = NATIONS[att.nation]?.short || '?';
  const dn = NATIONS[def.nation]?.short || '?';
  addLog(`⚔ ${an}→${dn} [${toH.t}]: -${fm(al)}/${fm(dl)} ${win ? '🏴 captured' : '🛡 held'}`, 'combat');
  scheduleDraw();
  return { win, attLoss: al, defLoss: dl };
}

// ── ДВИЖЕНИЕ АРМИИ ПО ГЕКСАМ ─────────────────────────────────────────────────
function hwMoveArmy(fromIdx, toIdx, amount) {
  if (!_hexCache) return false;
  const army = G.hexArmy[fromIdx];
  const toH = _hexCache[toIdx];
  if (!army || army.amount <= 0) { popup('No army here'); return false; }
  if (!toH || toH.sea) { popup('Cannot move there'); return false; }

  const cost = HEX_MOVE_COST[toH.t] || 1;
  if ((army.movePoints||0) < cost) {
    popup(`Need ${cost} MP (have ${army.movePoints||0})`); return false;
  }

  const toArmy = G.hexArmy[toIdx];
  if (toArmy && toArmy.amount > 0 && toArmy.nation !== army.nation) {
    if (!atWar(army.nation, toArmy.nation)) { popup('Not at war'); return false; }
    return hwAttackHex(fromIdx, toIdx);
  }

  const moved = Math.min(amount || army.amount, army.amount);
  army.amount -= moved;
  army.movePoints = Math.max(0, (army.movePoints||0) - cost);
  if (army.amount <= 0) delete G.hexArmy[fromIdx];

  if (!G.hexArmy[toIdx]) {
    G.hexArmy[toIdx] = { amount: 0, nation: army.nation, movePoints: Math.max(0, HEX_ARMY_MP - cost) };
  }
  G.hexArmy[toIdx].amount += moved;

  if (hwHexOwner(toIdx) !== army.nation) hwCaptureHex(toIdx, army.nation);

  hwSyncProvArmy(_hexCache[fromIdx].p);
  if (_hexCache[toIdx].p !== _hexCache[fromIdx].p) hwSyncProvArmy(_hexCache[toIdx].p);
  scheduleDraw();
  return true;
}

function hwResetMovePoints() {
  const PN = G.playerNation;
  for (const a of Object.values(G.hexArmy || {}))
    if (a.nation === PN) a.movePoints = HEX_ARMY_MP;
}

// ── ДИАЛОГ ДВИЖЕНИЯ ГЕКСОВОЙ АРМИИ ───────────────────────────────────────────
// Вызывается кнопкой sp-btn-hexmove из index.html
function hwOpenHexMoveDialog() {
  // Prefer explicit selHex; fall back to hexMoveSrc set by toggleMoveMode.
  let fromIdx = (G.selHex && G.selStage === 2) ? hwFindHexIdx(G.selHex) : -1;
  if (fromIdx < 0 && G.hexMoveSrc >= 0) fromIdx = G.hexMoveSrc;
  if (fromIdx < 0) { popup('Select a province with your army first'); return; }

  const army = G.hexArmy && G.hexArmy[fromIdx];
  if (!army || army.nation !== G.playerNation || army.amount <= 0) {
    popup('No your army on this hex'); return;
  }

  const h = _hexCache[fromIdx];
  const neighbours = (h.nbIdx || []).filter(ni => {
    const nh = _hexCache[ni];
    if (!nh || nh.sea) return false;
    return true;
  });

  if (!neighbours.length) { popup('No adjacent hexes'); return; }

  // Строим список соседних гексов
  const rows = neighbours.map(ni => {
    const nh = _hexCache[ni];
    const nOwner = hwHexOwner(ni);
    const nArmy  = G.hexArmy[ni];
    const cost   = HEX_MOVE_COST[nh.t] || 1;
    const canMove = (army.movePoints || 0) >= cost;
    const isEnemy = nOwner >= 0 && nOwner !== G.playerNation && atWar(G.playerNation, nOwner);
    const action  = nArmy && nArmy.amount > 0 && nArmy.nation !== G.playerNation ? '⚔ Attack' : '→ Move';
    const pname   = PROVINCES[nh.p]?.name || '?';
    const ownerStr = nOwner === G.playerNation ? '<span style="color:#80c080">Yours</span>'
      : nOwner < 0 ? 'Rebels'
      : `<span style="color:${isEnemy?'#ff8080':'#aaa'}">${NATIONS[nOwner]?.short||'?'}</span>`;

    return `<div class="ti${canMove?'':' ene'}" style="cursor:${canMove?'pointer':'not-allowed'}"
      onclick="${canMove ? `closeMo();hwMoveArmy(${fromIdx},${ni},${army.amount})` : ''}">
      <span class="tn">${action} → ${nh.t} <span style="color:#888;font-size:8px">(${pname})</span></span>
      <span class="ta" style="font-size:8px">${ownerStr}${nArmy&&nArmy.amount>0?` · ⚔${fm(nArmy.amount)}`:''}
        <br><span style="color:${canMove?'#c9a84c':'#555'}">${cost} MP</span></span>
    </div>`;
  }).join('');

  openMo(`⚔ HEX ARMY — ${fm(army.amount)} troops`,
    `<p class="mx">At: <b>${h.t}</b> · Move points: <b>${army.movePoints||0}/${HEX_ARMY_MP}</b></p>
     <p class="mx" style="font-size:9px;color:var(--dim)">Select adjacent hex to move or attack:</p>
     <div class="tlist">${rows}</div>`,
    [{lbl:'Cancel', cls:'dim'}]
  );
}

// ── КОНЕЦ ХОДА ────────────────────────────────────────────────────────────────
function hwEndTurn() {
  hwTickConstruction();
  hwResetMovePoints();
  _hwPHCTick = -1;
  _hatchCache = {};
}

// Перехватываем processDraftQueue чтобы войска шли в казармы
(function _patchDraftQueue() {
  function patch() {
    if (typeof window.processDraftQueue !== 'function' || window._hwDQPatched) return false;
    const orig = window.processDraftQueue;
    window.processDraftQueue = function() {
      if (!G.draftQueue || !G.draftQueue.length) return orig.apply(this, arguments);
      // Если есть hexBuildings — перехватываем
      if (!G.hexBuildings || Object.keys(G.hexBuildings).length === 0) {
        return orig.apply(this, arguments);
      }
      const done = [];
      G.draftQueue = G.draftQueue.filter(entry => {
        entry.weeksLeft--;
        if (entry.weeksLeft <= 0) {
          done.push(entry);
          return false;
        }
        return true;
      });
      for (const entry of done) {
        hwProcessDraftArrival(entry);
        if (entry.nation === G.playerNation) {
          addLog(`✅ ${PROVINCES[entry.prov].short}: ${fa(entry.amount)} soldiers ready!`, 'info');
          popup(`✅ ${fa(entry.amount)} troops ready in ${PROVINCES[entry.prov].short}!`, 2500);
        }
      }
    };
    window._hwDQPatched = true;
    return true;
  }
  if (!patch()) document.addEventListener('DOMContentLoaded', patch);
})();

// Подключаемся к endTurn
(function _hookEndTurn() {
  function tryHook() {
    if (typeof window.endTurn !== 'function' || window._hwETHooked) return false;
    const orig = window.endTurn;
    window.endTurn = function() { hwEndTurn(); return orig.apply(this, arguments); };
    window._hwETHooked = true;
    return true;
  }
  if (!tryHook()) document.addEventListener('DOMContentLoaded', tryHook);
})();

// ── РЕНДЕРИНГ ─────────────────────────────────────────────────────────────────
var _hatchCache = {};

function _hatchPat(ctx, color) {
  if (_hatchCache[color]) return _hatchCache[color];
  const sz=8, oc=document.createElement('canvas');
  oc.width=sz; oc.height=sz;
  const ox=oc.getContext('2d'); ox.strokeStyle=color; ox.lineWidth=1.8;
  ox.beginPath(); ox.moveTo(0,sz); ox.lineTo(sz,0); ox.stroke();
  ox.beginPath(); ox.moveTo(-sz/2,sz/2); ox.lineTo(sz/2,-sz/2); ox.stroke();
  ox.beginPath(); ox.moveTo(sz/2,sz*1.5); ox.lineTo(sz*1.5,sz/2); ox.stroke();
  const p = ctx.createPattern(oc,'repeat');
  _hatchCache[color] = p;
  return p;
}

// PASS 2C — штриховка захваченных гексов
function hwDrawHexOccupation(ctx, h, hexIdx, R) {
  if (!G.hexOwner || hwHexOwner(hexIdx) === G.owner[h.p]) return;
  const col = natColor(hwHexOwner(hexIdx));
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = col;
  hexPath(ctx, h.x, h.y, R); ctx.fill();
  ctx.globalAlpha = 0.50;
  const pat = _hatchPat(ctx, col);
  if (pat) { ctx.fillStyle = pat; hexPath(ctx, h.x, h.y, R); ctx.fill(); }
  ctx.globalAlpha = 1.0;
}

// PASS X — иконки зданий на гексах
function hwDrawBuildings(ctx, R, wx0, wy0, wx1, wy1) {
  if (!_hexCache) return;
  const sc = vp.scale; if (sc < 0.35) return;
  const al = Math.min(1, (sc-0.35)/0.25);
  const fs = Math.max(4, R*0.58);
  const PN = G.playerNation;

  function drawIcon(h, icon, own, isC, prog) {
    ctx.globalAlpha = (isC ? 0.55 : 0.85) * al;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath(); ctx.arc(h.x, h.y, R*0.42, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = isC ? 'rgba(160,140,60,0.6)'
      : own ? 'rgba(201,168,76,0.85)' : 'rgba(180,100,100,0.7)';
    ctx.lineWidth = (isC ? 0.8 : 1.0) / sc;
    if (isC) ctx.setLineDash([2/sc, 2/sc]);
    ctx.beginPath(); ctx.arc(h.x, h.y, R*0.42, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    if (isC && prog > 0) {
      ctx.strokeStyle = 'rgba(201,168,76,0.9)';
      ctx.lineWidth = 1.2 / sc;
      ctx.beginPath();
      ctx.arc(h.x, h.y, R*0.42, -Math.PI/2, -Math.PI/2 + prog*Math.PI*2);
      ctx.stroke();
    }
    ctx.globalAlpha = al * (isC ? 0.7 : 1);
    ctx.font = `${fs}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 3;
    ctx.fillText(icon, h.x, h.y);
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }

  for (const [hs, bld] of Object.entries(G.hexBuildings || {})) {
    const h = _hexCache[+hs];
    if (!h || h.sea || h.x<wx0-R*2 || h.x>wx1+R*2 || h.y<wy0-R*2 || h.y>wy1+R*2) continue;
    drawIcon(h, HEX_BUILDING_DEFS[bld.type]?.icon||'?', bld.nation===PN, false, 0);
  }
  for (const [hs, con] of Object.entries(G.hexConstruction || {})) {
    const h = _hexCache[+hs];
    if (!h || h.sea || h.x<wx0-R*2 || h.x>wx1+R*2 || h.y<wy0-R*2 || h.y>wy1+R*2) continue;
    drawIcon(h, '🏗', con.nation===PN, true, 1 - con.turnsLeft/con.totalTurns);
  }
}

// PASS Y — плашки армий на гексах
function hwDrawHexArmies(ctx, R, wx0, wy0, wx1, wy1) {
  if (!G.hexArmy || !_hexCache) return;
  const sc = vp.scale; if (sc < 0.30) return;
  const al = Math.min(1, (sc-0.30)/0.20);
  const fs = Math.max(4, R*0.50);
  const PN = G.playerNation;

  for (const [hs, army] of Object.entries(G.hexArmy)) {
    if (!army || army.amount <= 0) continue;
    const h = _hexCache[+hs];
    if (!h || h.sea || h.x<wx0-R*2 || h.x>wx1+R*2 || h.y<wy0-R*2 || h.y>wy1+R*2) continue;
    const isOwn  = army.nation === PN;
    const isAlly = areAllies(PN, army.nation);
    const isEnemy= atWar(PN, army.nation);
    const bx = h.x + R*0.50, by = h.y + R*0.55;
    const bw = R*0.95, bh = R*0.55;
    ctx.globalAlpha = 0.90 * al;
    ctx.fillStyle = 'rgba(4,4,10,0.85)';
    _hwRR(ctx, bx-bw/2, by-bh/2, bw, bh, 2/sc); ctx.fill();
    ctx.strokeStyle = isOwn ? 'rgba(201,168,76,0.9)'
      : isAlly  ? 'rgba(80,140,220,0.8)'
      : isEnemy ? 'rgba(220,60,50,0.85)'
      : 'rgba(120,120,120,0.6)';
    ctx.lineWidth = 0.8 / sc;
    _hwRR(ctx, bx-bw/2, by-bh/2, bw, bh, 2/sc); ctx.stroke();
    ctx.globalAlpha = al;
    ctx.font = `600 ${fs*0.78}px Cinzel,serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = isOwn ? '#f0d080' : isAlly ? '#a0c0ff' : isEnemy ? '#ff9090' : '#cccccc';
    ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 2;
    ctx.fillText(fm(army.amount), bx, by);
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
}

function _hwRR(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
}

// ── UI — СТАТУС ЧАСТИЧНОЙ ОККУПАЦИИ ─────────────────────────────────────────
function hwProvStatusHTML(pi) {
  if (pi < 0 || !_hexCache) return '';
  const frac = hwProvControlFraction(pi, G.owner[pi]);
  const partial = frac > 0 && frac < 1;
  const contested = hwProvContested(pi);
  if (!partial && !contested) return '';

  const ctrl = hwProvController(pi);
  const pct  = Math.round(frac * 100);
  const col  = contested ? '#ff6040' : '#e08830';
  const txt  = contested ? '⚔ CONTESTED' : '▨ PARTIALLY OCCUPIED';

  let html = `<div style="font-size:8px;color:${col};letter-spacing:1px;font-family:Cinzel,serif;margin:4px 0 3px">${txt}</div>`;
  html += `<div style="height:6px;background:rgba(0,0,0,.4);border-radius:2px;overflow:hidden;display:flex;margin-bottom:3px">
    <div style="width:${pct}%;background:${natColor(G.owner[pi])};opacity:.85"></div>
    <div style="flex:1;background:${natColor(ctrl)};opacity:.65"></div>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:8px;color:#aaa;margin-bottom:4px">
    <span>${NATIONS[G.owner[pi]]?.short||'?'} ${pct}%</span>
    <span>${NATIONS[ctrl]?.short||'?'} ${100-pct}%</span>
  </div>`;

  // Здания на гексах провинции
  const blds = window._provHexBuild[pi] || [];
  if (blds.length) {
    html += `<div style="font-size:8px;color:#555;letter-spacing:1px;margin-top:3px">HEX BUILDINGS</div>`;
    for (const b of blds) {
      const def = HEX_BUILDING_DEFS[b.type];
      const own = hwHexOwner(b.hexIdx) === G.playerNation;
      html += `<div style="display:flex;align-items:center;gap:4px;padding:1px 0;font-size:8px;opacity:${own?1:0.4}">
        <span>${def?.icon||'?'}</span>
        <span style="color:${own?'#e8d5a3':'#888'}">${def?.name||b.type}</span>
      </div>`;
    }
  }
  return html;
}

// ── UI — МЕНЮ СТРОИТЕЛЬСТВА НА ГЕКСЕ ─────────────────────────────────────────
function hwBuildMenuHTML(hexIdx) {
  if (hexIdx == null || !_hexCache) return '';
  const h = _hexCache[hexIdx];
  if (!h || h.sea || h.p < 0) return '';
  const PN = G.playerNation;
  if (hwHexOwner(hexIdx) !== PN) {
    return `<div style="font-size:8px;color:#555;padding:3px 0">This hex is not yours</div>`;
  }

  const coastal  = h.coastal;
  const hexArmy  = G.hexArmy && G.hexArmy[hexIdx];
  const con      = G.hexConstruction && G.hexConstruction[hexIdx];
  const existing = G.hexBuildings && G.hexBuildings[hexIdx];

  let html = '';

  // ── Status bar: construction in progress ────────────────────────────────
  if (con) {
    const cdef = HEX_BUILDING_DEFS[con.type];
    const pct  = Math.round((con.totalTurns - con.turnsLeft) / con.totalTurns * 100);
    html += `<div style="margin-bottom:8px;padding:6px;background:rgba(0,0,0,.3);border-radius:3px;border:1px solid rgba(201,168,76,.2)">
      <div style="display:flex;justify-content:space-between;font-size:9px;color:#c9a84c;margin-bottom:5px">
        <span>${cdef?.icon||'🏗'} <b>${cdef?.name||con.type}</b> under construction</span>
        <span style="color:#aaa">${con.turnsLeft}w left</span>
      </div>
      <div style="height:5px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden;margin-bottom:5px">
        <div style="height:100%;background:var(--gold);border-radius:2px;width:${pct}%"></div>
      </div>
      <button onclick="hwCancelBuild(${hexIdx})"
        style="width:100%;padding:3px;font-size:8px;background:rgba(80,20,20,.6);
          border:1px solid rgba(180,60,60,.4);color:#c06060;cursor:pointer;border-radius:2px">
        ✕ Cancel (50% refund)
      </button>
    </div>`;
  }

  // ── Existing building ────────────────────────────────────────────────────
  if (existing) {
    const edef = HEX_BUILDING_DEFS[existing.type];
    html += `<div style="margin-bottom:6px;font-size:9px;color:#80c080">
      ${edef?.icon||'?'} <b>${edef?.name||existing.type}</b> already built here
    </div>`;
  }

  // ── Build options ────────────────────────────────────────────────────────
  if (!con && !existing) {
    for (const [type, def] of Object.entries(HEX_BUILDING_DEFS)) {
      if (def.coastal && !coastal) continue;
      const chk = hwCanBuildAt(hexIdx, type, PN);
      const can = chk === true;
      html += `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid rgba(42,36,24,.2)">
        <span style="font-size:16px;flex-shrink:0">${def.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:9px;color:${can?'#e8d5a3':'#555'};font-family:Cinzel,serif">${def.name}
            <span style="color:#8090a0;font-size:7px;margin-left:4px">⏳ ${def.buildTurns}w</span>
          </div>
          <div style="font-size:7px;color:${can?'#666':'#444'};margin-top:1px">${can ? def.desc : chk}</div>
        </div>
        <button onclick="hwStartBuild(${hexIdx},'${type}')"
          style="padding:4px 10px;font-size:9px;font-family:Cinzel,serif;flex-shrink:0;
            background:${can?'rgba(20,14,4,.85)':'rgba(10,10,10,.4)'};
            border:1px solid ${can?'rgba(201,168,76,.6)':'rgba(50,50,50,.4)'};
            color:${can?'#c9a84c':'#3a3a3a'};cursor:${can?'pointer':'not-allowed'};border-radius:2px"
          ${can?'':'disabled'}>${def.cost}g</button>
      </div>`;
    }
  } else if (!con) {
    html += `<div style="font-size:8px;color:#555;text-align:center;padding:4px">One building per hex</div>`;
  }

  return html;
}
