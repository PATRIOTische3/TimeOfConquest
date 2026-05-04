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
  // Разместить армии всех наций на гексах при старте
  hwSpawnAllArmies();
}

// Размещает G.army[r] каждой нации на лучшем гексе провинции.
// Вызывается один раз при hwInit (старт игры) и при hwOnLoad (загрузка).
// "Лучший" гекс = наибольший HEX_POP_WEIGHT (город > поля > горы).
function hwSpawnAllArmies() {
  if (!_hexCache) return;
  for (let pi = 0; pi < PROVINCES.length; pi++) {
    const owner = G.owner[pi];
    if (owner < 0) continue;           // повстанцы — пропускаем
    const amount = G.army[pi] || 0;
    if (amount <= 0) continue;
    const hexes = _hwPHexes(pi);
    // Пропускаем только если армия именно этой нации уже размещена
    const alreadyPlaced = hexes.some(hi => G.hexArmy[hi]?.nation === owner && G.hexArmy[hi].amount > 0);
    if (alreadyPlaced) continue;
    // Выбрать лучший гекс
    const best = hexes.slice().sort((a,b)=>
      (HEX_POP_WEIGHT[_hexCache[b].t]||1)-(HEX_POP_WEIGHT[_hexCache[a].t]||1)
    )[0];
    if (best === undefined) continue;
    G.hexArmy[best] = { nation: owner, amount, movePoints: 0 };
  }
}

function hwOnLoad() {
  if (!G.hexOwner)        G.hexOwner = {};
  if (!G.hexArmy)         G.hexArmy = {};
  if (!G.hexBuildings)    G.hexBuildings = {};
  if (!G.hexConstruction) G.hexConstruction = {};
  _hwBuildProvCache();
  _hwPHCTick = -1;
  hwSpawnAllArmies();
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
// Считаем ВСЕ дружественные армии на гексах провинции, не только владельца.
// Оккупационные войска (наша армия в чужой провинции) тоже отображаются.
function hwSyncProvArmy(pi) {
  if (!_hexCache) return;
  // Для отображения в HUD считаем армии владельца провинции
  // + армии игрока если он там оккупирует
  const owner = G.owner[pi];
  const PN = G.playerNation;
  let ownerTotal = 0, playerTotal = 0;
  for (const [hs, a] of Object.entries(G.hexArmy || {})) {
    const hi = +hs;
    if (_hexCache[hi]?.p !== pi) continue;
    if (a.nation === owner)  ownerTotal  += a.amount;
    if (a.nation === PN && PN !== owner) playerTotal += a.amount;
  }
  // G.army[pi] отражает армию владельца (для AI и провинциального HUD)
  G.army[pi] = ownerTotal;
  // Отдельно храним оккупационные войска игрока для корректного отображения
  if (!G.hexArmyPlayer) G.hexArmyPlayer = {};
  if (playerTotal > 0) G.hexArmyPlayer[pi] = playerTotal;
  else delete G.hexArmyPlayer[pi];
}

// Суммарная армия игрока (все гексы включая оккупированные)
function hwPlayerTotalArmy() {
  if (!G.hexArmy) return 0;
  let total = 0;
  const PN = G.playerNation;
  for (const a of Object.values(G.hexArmy)) {
    if (a && a.nation === PN) total += a.amount;
  }
  return total;
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

  const attNation = att.nation;
  const defNation = def.nation;
  const defSnap   = def.amount;

  if (win) {
    delete G.hexArmy[toIdx];
    const capNation = att.amount > 0 ? attNation : defNation;
    if (newAtt > 0) {
      G.hexArmy[toIdx] = { amount: newAtt, nation: capNation, movePoints: att.movePoints };
      if (att.amount <= 0) delete G.hexArmy[fromIdx];
    }
    hwCaptureHex(toIdx, capNation);

    // Анимация для игрока
    if (attNation === G.playerNation) {
      popup(`🏴 Captured [${toH.t}]! Lost ${fm(al)}, enemy lost ${fm(dl)}`);
    } else if (defNation === G.playerNation) {
      if (!G._enemyAttackQueue) G._enemyAttackQueue = [];
      G._enemyAttackQueue.push({ fr:fromIdx, to:toIdx, atker:attNation,
        send:newAtt+al, win:true, al, defArmy:defSnap, isHex:true });
    }
  } else {
    G.hexArmy[toIdx] = { amount: newDef, nation: defNation, movePoints: def.movePoints||0 };

    if (attNation === G.playerNation)
      popup(`🛡 Held [${toH.t}]! Lost ${fm(al)}, enemy lost ${fm(dl)}`);
    else if (defNation === G.playerNation)
      popup(`🛡 Repelled! Enemy lost ${fm(dl)}, we lost ${fm(al)}`);
  }

  // Синхронизировать G.army
  if (_hexCache[fromIdx]) hwSyncProvArmy(_hexCache[fromIdx].p);
  if (_hexCache[toIdx])   hwSyncProvArmy(_hexCache[toIdx].p);

  const an = NATIONS[attNation]?.short || '?';
  const dn = NATIONS[defNation]?.short  || '?';
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
  const toOwner = hwHexOwner(toIdx);

  // Автоматическое объявление войны при вторжении на чужой гекс
  const isEnemy = toOwner >= 0 && toOwner !== army.nation;
  const enemyArmy = toArmy && toArmy.amount > 0 && toArmy.nation !== army.nation;
  const enemyNation = enemyArmy ? toArmy.nation : (isEnemy ? toOwner : -1);

  if (enemyNation >= 0 && !atWar(army.nation, enemyNation) && !areAllies(army.nation, enemyNation)) {
    G.war[army.nation][enemyNation] = true;
    G.war[enemyNation][army.nation] = true;
    if (G.pact[army.nation]?.[enemyNation]) {
      G.pact[army.nation][enemyNation] = G.pact[enemyNation][army.nation] = false;
      G.pLeft[army.nation][enemyNation] = G.pLeft[enemyNation][army.nation] = 0;
    }
    if (army.nation === G.playerNation) {
      addLog(`⚔ War declared on ${NATIONS[enemyNation]?.name||'?'} by invasion!`, 'war');
      popup(`⚔ War declared on ${NATIONS[enemyNation]?.short||'?'}!`, 3000);
    } else if (enemyNation === G.playerNation) {
      addLog(`⚔ ${NATIONS[army.nation]?.name||'?'} invaded your territory!`, 'war');
      popup(`⚠ ${NATIONS[army.nation]?.short||'?'} invaded!`, 3500);
    }
  }

  if (enemyArmy) {
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
function hwOpenHexMoveDialog(fromIdxOverride) {
  // Accept direct fromIdx (from move mode interceptor) or find via selHex/hexMoveSrc
  let fromIdx = (fromIdxOverride !== undefined && fromIdxOverride >= 0) ? fromIdxOverride : -1;
  if (fromIdx < 0) fromIdx = (G.selHex && G.selStage === 2) ? hwFindHexIdx(G.selHex) : -1;
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

// ══════════════════════════════════════════════════════════════════════════════
//  СИСТЕМА СНАБЖЕНИЯ  (Шаги 1-3)
//  Шаг 1: BFS проверка — есть ли путь по своим гексам до тыла
//  Шаг 2: G.hexSupply{} — статусы, обновляются каждую неделю
//  Шаг 3: Визуализация — окружённые армии мигают ⚠
// ══════════════════════════════════════════════════════════════════════════════

// Константы снабжения
var HEX_SUPPLY = {
  FULL:     'full',      // открытый путь к тылу
  PARTIAL:  'partial',   // путь есть но через вражеские соседи (1 гекс зазора)
  CUT:      'cut',       // полное окружение
};

// Сколько недель без снабжения до эффекта и капитуляции
var HEX_SUPPLY_GRACE  = 2;  // недель до начала потерь
var HEX_SUPPLY_DECAY  = 0.06; // потери армии в неделю при CUT (6%)
var HEX_SUPPLY_SURRENDER = 8; // недель до капитуляции

// ── Шаг 1: BFS проверка снабжения одного гекса ───────────────────────────────
// Возвращает 'full' | 'partial' | 'cut'
// "Тыл" = любой гекс нации nation без вражеских армий в провинции с казармой
//         ИЛИ прибрежный гекс этой нации с портом (морское снабжение, Шаг 6)
function hwSupplyCheck(fromIdx, nation) {
  if (!_hexCache) return HEX_SUPPLY.FULL;
  const h0 = _hexCache[fromIdx];
  if (!h0 || h0.sea) return HEX_SUPPLY.FULL;

  // BFS по гексам нации — ищем путь до "тыла"
  // Тыл = гекс нации у которого есть хотя бы один своей нации сосед
  // на расстоянии > 3 гексов от fromIdx (т.е. не просто рядом)
  const visited = new Set([fromIdx]);
  const queue   = [fromIdx];
  let depth = 0;
  const MAX_DEPTH = 30; // ограничение BFS

  while (queue.length && depth < MAX_DEPTH) {
    const next = [];
    for (const cur of queue) {
      const hc = _hexCache[cur];
      if (!hc) continue;
      for (const ni of (hc.nbIdx || [])) {
        if (visited.has(ni)) continue;
        visited.add(ni);
        const nh = _hexCache[ni];
        if (!nh || nh.sea) continue;
        const nOwner = hwHexOwner(ni);
        if (nOwner !== nation) continue; // только свои гексы
        // Проверяем — это "тыловой" гекс?
        // Тыловой = нет вражеских армий рядом (хотя бы 2 своих соседа)
        const ownNeighbours = (nh.nbIdx || []).filter(x => {
          const xh = _hexCache[x]; if (!xh || xh.sea) return false;
          return hwHexOwner(x) === nation;
        }).length;
        if (ownNeighbours >= 2 && cur !== fromIdx) return HEX_SUPPLY.FULL;
        next.push(ni);
      }
    }
    queue.length = 0;
    queue.push(...next);
    depth++;
  }

  // Путь не найден — проверяем "partial" (есть свои соседи у fromIdx)
  const ownAdj = (h0.nbIdx || []).filter(ni => {
    const nh = _hexCache[ni];
    return nh && !nh.sea && hwHexOwner(ni) === nation;
  }).length;

  return ownAdj > 0 ? HEX_SUPPLY.PARTIAL : HEX_SUPPLY.CUT;
}

// ── Шаги 2, 4, 5, 6, 7: Обновление снабжения + эффекты ─────────────────────

// Шаг 6: морское снабжение — прибрежный гекс нации с портом считается тылом
function hwHasNavalSupply(fromIdx, nation) {
  if (!_hexCache || !G.hexBuildings) return false;
  // Ищем порт этой нации в радиусе BFS по морским гексам
  const h0 = _hexCache[fromIdx];
  if (!h0) return false;
  // Сначала — есть ли прибрежный гекс нации рядом с морем
  const visited = new Set([fromIdx]);
  const queue = [fromIdx];
  let depth = 0;
  while (queue.length && depth < 20) {
    const next = [];
    for (const cur of queue) {
      const hc = _hexCache[cur]; if (!hc) continue;
      for (const ni of (hc.nbIdx || [])) {
        if (visited.has(ni)) continue; visited.add(ni);
        const nh = _hexCache[ni]; if (!nh) continue;
        if (nh.sea) { next.push(ni); continue; } // плывём по морю
        if (hwHexOwner(ni) !== nation) continue;
        // Нашли свой прибрежный гекс — есть ли на нём порт?
        if (G.hexBuildings[ni]?.type === 'port') return true;
      }
    }
    queue.length = 0; queue.push(...next); depth++;
  }
  return false;
}

// Шаг 7: рельеф замедляет голодание — сколько бонусных недель даёт местность
function hwSupplyTerrainBonus(hexIdx) {
  const h = _hexCache && _hexCache[hexIdx]; if (!h) return 0;
  // Горы/джунгли/болота — легче укрыться и добывать пропитание
  const bonus = { mountain:3, jungle:2, forest:2, swamp:2, marsh:2, highland:1, hills:1, urban:4 };
  return bonus[h.t] || 0;
}

function hwUpdateSupply() {
  if (!_hexCache || !G.hexArmy) return;
  if (!G.hexSupply)      G.hexSupply = {};
  if (!G.hexSupplyWeeks) G.hexSupplyWeeks = {};

  const PN = G.playerNation;
  const toNotify    = []; // только что окружены
  const toSurrender = []; // капитулируют

  for (const [hs, army] of Object.entries(G.hexArmy)) {
    const hexIdx = +hs;
    if (!army || army.amount <= 0) {
      delete G.hexSupply[hexIdx]; delete G.hexSupplyWeeks[hexIdx]; continue;
    }

    const prev   = G.hexSupply[hexIdx] || HEX_SUPPLY.FULL;
    let   status = hwSupplyCheck(hexIdx, army.nation);

    // Шаг 6: морское снабжение снимает CUT если есть порт в досягаемости
    if (status === HEX_SUPPLY.CUT && hwHasNavalSupply(hexIdx, army.nation)) {
      status = HEX_SUPPLY.PARTIAL;
    }

    G.hexSupply[hexIdx] = status;

    if (status === HEX_SUPPLY.CUT) {
      G.hexSupplyWeeks[hexIdx] = (G.hexSupplyWeeks[hexIdx] || 0) + 1;
      if (prev !== HEX_SUPPLY.CUT && army.nation === PN) toNotify.push(hexIdx);

      const weeks      = G.hexSupplyWeeks[hexIdx];
      // Шаг 7: рельеф продлевает grace period
      const terrBonus  = hwSupplyTerrainBonus(hexIdx);
      const effectiveGrace = HEX_SUPPLY_GRACE + terrBonus;
      const effectiveSurrender = HEX_SUPPLY_SURRENDER + terrBonus;

      // Шаг 4: потери армии после grace period
      if (weeks > effectiveGrace) {
        const decayRate = HEX_SUPPLY_DECAY;
        const lost = Math.max(1, Math.floor(army.amount * decayRate));
        army.amount = Math.max(0, army.amount - lost);
        if (army.nation === PN) {
          const h = _hexCache[hexIdx];
          const pname = PROVINCES[h.p]?.name || '?';
          addLog(`☠ Surrounded army in ${pname} starving: −${fm(lost)} (${weeks}w)`, 'war');
        }
      }

      // Шаг 5: капитуляция
      if (weeks >= effectiveSurrender || army.amount <= 0) {
        toSurrender.push({ hexIdx, army: { ...army } });
        army.amount = 0;
      }

    } else {
      // Снабжение восстановлено — сбросить счётчик
      if ((G.hexSupplyWeeks[hexIdx] || 0) > 0) {
        if (army.nation === PN) {
          const h = _hexCache[hexIdx];
          addLog(`✅ Supply restored to army in ${PROVINCES[h.p]?.name || '?'}`, 'info');
        }
        G.hexSupplyWeeks[hexIdx] = 0;
      }
    }
  }

  // Шаг 5: обработка капитуляций
  for (const { hexIdx, army } of toSurrender) {
    const h = _hexCache[hexIdx];
    const pname = PROVINCES[h.p]?.name || '?';
    const captor = _findCaptor(hexIdx, army.nation);

    delete G.hexArmy[hexIdx];
    delete G.hexSupply[hexIdx];
    delete G.hexSupplyWeeks[hexIdx];

    if (captor >= 0) {
      // Захватчик получает 30% войск как пленных
      const prisoners = Math.floor(army.amount * 0.3);
      if (prisoners > 0) {
        const captorHex = _findNearestFriendlyHex(hexIdx, captor);
        if (captorHex >= 0) {
          const ca = G.hexArmy[captorHex];
          if (ca && ca.nation === captor) ca.amount += prisoners;
          else G.hexArmy[captorHex] = { nation: captor, amount: prisoners, movePoints: 0 };
        }
      }
      hwCaptureHex(hexIdx, captor);
      hwSyncProvArmy(h.p);
    }

    if (army.nation === PN) {
      addLog(`🏳 Army surrendered in ${pname} after ${G.hexSupplyWeeks[hexIdx]||0}+ weeks surrounded!`, 'war');
      popup(`🏳 Army in ${pname} has surrendered!`, 4000);
    } else if (captor === PN) {
      addLog(`🏳 Enemy army surrendered in ${pname}!`, 'info');
      popup(`🏳 Enemy surrendered in ${pname}! +${Math.floor(army.amount*0.3)} prisoners`, 3000);
    }
  }

  // ── Шаг 10: Нотификации ──────────────────────────────────────────────────────

  // Только что окружены (CUT)
  for (const hi of toNotify) {
    const h = _hexCache[hi];
    const terrBonus  = hwSupplyTerrainBonus(hi);
    const grace      = HEX_SUPPLY_GRACE + terrBonus;
    const surrender  = HEX_SUPPLY_SURRENDER + terrBonus;
    const pname      = PROVINCES[h.p]?.name || '?';
    const terrain    = h.t || '?';
    const bonusTxt   = terrBonus > 0 ? ` (${terrain} +${terrBonus}w)` : '';
    addLog(
      `⚠ Army in <b>${pname}</b> SURROUNDED${bonusTxt} — losses start w${grace+1}, surrenders w${surrender}`,
      'war'
    );
    popup(`⚠ Surrounded in ${pname}! ${grace}w before attrition, ${surrender}w to surrender`, 4500);
  }

  // Предупреждение о частичном снабжении (PARTIAL) — только первый раз
  if (!G._hwPartialNotified) G._hwPartialNotified = new Set();
  for (const [hs, status] of Object.entries(G.hexSupply)) {
    const hexIdx = +hs;
    const army = G.hexArmy[hexIdx];
    if (!army || army.nation !== PN) continue;
    if (status === HEX_SUPPLY.PARTIAL && !G._hwPartialNotified.has(hexIdx)) {
      G._hwPartialNotified.add(hexIdx);
      const h = _hexCache[hexIdx];
      const pname = PROVINCES[h.p]?.name || '?';
      addLog(`⚡ Army in ${pname} — supply line threatened! Enemy closing in.`, 'war');
    } else if (status !== HEX_SUPPLY.PARTIAL) {
      G._hwPartialNotified.delete(hexIdx); // сбросить если вышли из partial
    }
  }

  // Восстановление снабжения — уже в теле цикла выше (addLog там)
}

// Найти ближайшую нацию-захватчика (враг у которого больше всего гексов рядом)
function _findCaptor(hexIdx, excludeNation) {
  const h = _hexCache[hexIdx]; if (!h) return -1;
  const counts = {};
  for (const ni of (h.nbIdx || [])) {
    const o = hwHexOwner(ni);
    if (o >= 0 && o !== excludeNation) counts[o] = (counts[o]||0) + 1;
  }
  let best = -1, bestN = 0;
  for (const [n, cnt] of Object.entries(counts)) {
    if (cnt > bestN) { bestN = cnt; best = +n; }
  }
  return best;
}

// Найти ближайший гекс нации для размещения пленных
function _findNearestFriendlyHex(fromIdx, nation) {
  const h = _hexCache[fromIdx]; if (!h) return -1;
  for (const ni of (h.nbIdx || [])) {
    if (hwHexOwner(ni) === nation) return ni;
  }
  return -1;
}

// ── Шаг 3: Визуализация — ⚠ над окружёнными армиями ─────────────────────────
// Вызывается из hwDrawHexArmies после отрисовки счётчика армии
function hwDrawSupplyWarnings(ctx, R, wx0, wy0, wx1, wy1) {
  if (!G.hexSupply || !_hexCache) return;
  const sc = vp.scale; if (sc < 0.25) return;
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin(Date.now() / 600)); // пульсация

  for (const [hs, status] of Object.entries(G.hexSupply)) {
    if (status === HEX_SUPPLY.FULL) continue;
    const hexIdx = +hs;
    const army = G.hexArmy && G.hexArmy[hexIdx];
    if (!army || army.amount <= 0) continue;
    const h = _hexCache[hexIdx];
    if (!h || h.sea || h.x<wx0-R*2||h.x>wx1+R*2||h.y<wy0-R*2||h.y>wy1+R*2) continue;

    const weeks = G.hexSupplyWeeks[hexIdx] || 0;
    const isCut = status === HEX_SUPPLY.CUT;

    // Иконка ⚠ над бейджем армии
    const ix = h.x + R*0.50; // совпадает с бейджем
    const iy = h.y + R*0.00; // выше бейджа

    ctx.globalAlpha = (isCut ? pulse : 0.7) * Math.min(1,(sc-0.25)/0.15);
    ctx.font = `bold ${Math.max(5, R*0.42)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 3;

    if (isCut) {
      // Красный мигающий ⚠ + счётчик недель
      ctx.fillStyle = `rgb(255,${Math.round(80+60*pulse)},40)`;
      ctx.fillText('⚠', ix, iy);
      if (weeks > 0 && sc > 0.5) {
        ctx.font = `bold ${Math.max(4, R*0.28)}px Cinzel,serif`;
        ctx.fillStyle = 'rgba(255,150,80,0.9)';
        ctx.fillText(`${weeks}w`, ix, iy + R*0.35);
      }
    } else {
      // Жёлтый статичный ⚡ для partial
      ctx.fillStyle = 'rgba(255,220,60,0.8)';
      ctx.fillText('⚡', ix, iy);
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
}

function hwEndTurn() {
  hwTickConstruction();
  hwResetMovePoints();
  hwUpdateSupply();   // Шаг 2: обновить статусы снабжения
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
  // Шаг 3: поверх армий — иконки снабжения
  hwDrawSupplyWarnings(ctx, R, wx0, wy0, wx1, wy1);
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

// ══════════════════════════════════════════════════════════════════════════════
//  ШАГ 8: ТАКТИЧЕСКИЙ HEX-AI С УЧЁТОМ СНАБЖЕНИЯ
//  hwDoAI(nation) вызывается из doAI (ai.js) каждую неделю для наций в войне.
//
//  Три приоритета в порядке важности:
//  1. ЗАМКНУТЬ КОТЁЛ — если враг окружён (CUT) → добивать, не давать вырваться
//  2. АТАКА — двигаться к цели, атаковать слабые гексы, обходить сильные
//  3. ОБОРОНА — держать выгодный рельеф, отступать если плохо
// ══════════════════════════════════════════════════════════════════════════════

// Стратегическая ценность гекса для захвата
function _hwHexPriority(hexIdx) {
  const h = _hexCache[hexIdx]; if (!h) return 0;
  let s = HEX_POP_WEIGHT[h.t] || 1;
  if (G.hexBuildings[hexIdx]?.type === 'barracks') s += 6;  // лишить призыва
  if (G.hexBuildings[hexIdx]?.type === 'fortress') s += 3;  // укрепление
  if (G.hexBuildings[hexIdx]?.type === 'port')     s += 4;  // отрезать морское снабжение
  if (h.t === 'urban') s += 4;
  // Бонус если враг на этом гексе окружён — приоритет добивания
  const armyThere = G.hexArmy[hexIdx];
  if (armyThere && armyThere.amount > 0) {
    const supStatus = G.hexSupply && G.hexSupply[hexIdx];
    if (supStatus === 'cut')     s += 8;   // окружён — добить!
    if (supStatus === 'partial') s += 3;
  }
  return s;
}

// Оборонная ценность гекса (держать выгодно)
function _hwDefValue(hexIdx) {
  const h = _hexCache[hexIdx]; if (!h) return 1;
  return (HEX_DEF_BONUS[h.t] || 1.0)
    * (G.hexBuildings[hexIdx]?.type === 'fortress' ? 1.6 : 1.0);
}

// BFS: найти кратчайший путь от fromIdx к любому гексу из targetSet
// Возвращает первый шаг на пути, или -1 если пути нет
function _hwBFSStep(fromIdx, targetSet, nation) {
  if (targetSet.has(fromIdx)) return fromIdx;
  const visited = new Map([[fromIdx, -1]]); // idx → parent
  const queue = [fromIdx];
  while (queue.length) {
    const cur = queue.shift();
    const h = _hexCache[cur]; if (!h) continue;
    for (const ni of (h.nbIdx || [])) {
      if (visited.has(ni) || _hexCache[ni]?.sea) continue;
      const nOwner = hwHexOwner(ni);
      // Можем проходить через свои гексы и атаковать вражеские
      const passable = nOwner === nation || (nOwner >= 0 && atWar(nation, nOwner)) || nOwner < 0;
      if (!passable) continue;
      visited.set(ni, cur);
      if (targetSet.has(ni)) {
        // Восстанавливаем первый шаг
        let step = ni;
        while (visited.get(step) !== fromIdx) step = visited.get(step);
        return step;
      }
      queue.push(ni);
    }
  }
  return -1;
}

// Найти гексы провинции-цели (вражеские граничные гексы)
function _hwTargetHexes(targetProv, attackerNation) {
  const hexes = _hwPHexes(targetProv);
  return new Set(hexes.filter(hi => {
    const o = hwHexOwner(hi);
    return o !== attackerNation && (o < 0 || atWar(attackerNation, o));
  }));
}

function hwDoAI(nation) {
  if (!_hexCache || !G.hexArmy) return;
  const aggressive = G.aiPersonality && G.aiPersonality[nation] === 'aggressive';

  // Собираем все армии нации с MP > 0
  const myArmies = Object.entries(G.hexArmy)
    .filter(([, a]) => a && a.nation === nation && a.amount > 0 && (a.movePoints || 0) > 0)
    .map(([hs, a]) => ({ hexIdx: +hs, army: a }));

  if (!myArmies.length) return;

  // Определяем цель: провинция ближайшего врага с наивысшим приоритетом
  // Используем G.aiTarget[nation] если уже выбрана, иначе выбираем
  if (!G.aiTarget) G.aiTarget = {};
  if (G.aiTarget[nation] === undefined || Math.random() < 0.08) {
    // Пересмотр цели с 8% шансом каждую неделю
    let bestProv = -1, bestScore = -1;
    const myProvs = new Set(regsOf(nation));
    for (const { hexIdx } of myArmies) {
      const h = _hexCache[hexIdx];
      // Смотрим вражеские провинции в радиусе 3 BFS-шагов
      const visited = new Set([hexIdx]);
      const q = [hexIdx];
      for (let d = 0; d < 5 && q.length; d++) {
        const nq = [];
        for (const cur of q) {
          for (const ni of (_hexCache[cur]?.nbIdx || [])) {
            if (visited.has(ni) || _hexCache[ni]?.sea) continue;
            visited.add(ni); nq.push(ni);
            const np = _hexCache[ni]?.p;
            if (np == null || np < 0) continue;
            const nOwner = G.owner[np];
            if (nOwner === nation || areAllies(nation, nOwner)) continue;
            if (nOwner >= 0 && !atWar(nation, nOwner)) continue;
            // Считаем суммарный приоритет провинции
            const provHexes = _hwPHexes(np);
            let score = provHexes.reduce((s, hi) => s + _hwHexPriority(hi), 0);
            // Приоритет окружённых армий в провинции
            const hasEncircled = provHexes.some(hi => {
              const a = G.hexArmy[hi];
              return a && a.nation !== nation && G.hexSupply?.[hi] === 'cut';
            });
            if (hasEncircled) score += 15;
            if (score > bestScore) { bestScore = score; bestProv = np; }
          }
        }
        q.length = 0; q.push(...nq);
      }
    }
    G.aiTarget[nation] = bestProv;
  }

  const targetProv = G.aiTarget[nation];
  const targetHexes = targetProv >= 0 ? _hwTargetHexes(targetProv, nation) : new Set();

  for (const { hexIdx: fromIdx, army } of myArmies) {
    if ((army.movePoints || 0) <= 0) continue;
    const h = _hexCache[fromIdx];
    const neighbours = (h.nbIdx || []).filter(ni => !_hexCache[ni]?.sea);

    // ── ПРИОРИТЕТ 1: ЗАМКНУТЬ КОТЁЛ ────────────────────────────────────────
    // Если у соседнего вражеского гекса статус CUT — атаковать в первую очередь
    const encircledTargets = neighbours.filter(ni => {
      const cost = HEX_MOVE_COST[_hexCache[ni]?.t] || 1;
      if ((army.movePoints || 0) < cost) return false;
      const a = G.hexArmy[ni];
      if (!a || a.amount <= 0 || !atWar(nation, a.nation)) return false;
      return G.hexSupply?.[ni] === 'cut'; // окружён
    });

    if (encircledTargets.length) {
      // Атакуем слабейшего окружённого
      encircledTargets.sort((a, b) => (G.hexArmy[a]?.amount || 0) - (G.hexArmy[b]?.amount || 0));
      const tgt = encircledTargets[0];
      const defBonus = (HEX_DEF_BONUS[_hexCache[tgt].t] || 1.0)
        * (G.hexBuildings[tgt]?.type === 'fortress' ? 1.6 : 1.0);
      // Окружённые ослаблены — снижаем порог атаки
      const ratio = army.amount / Math.max(1, (G.hexArmy[tgt]?.amount || 1) * defBonus);
      if (ratio >= 0.8) { // атакуем даже с невыгодным соотношением
        hwMoveArmy(fromIdx, tgt, army.amount);
        hwSyncProvArmy(h.p);
        continue;
      }
    }

    // ── ПРИОРИТЕТ 2: АТАКА К ЦЕЛИ ──────────────────────────────────────────
    if (targetProv >= 0 && targetHexes.size > 0) {
      // Классифицируем соседей
      const attackable = [], movable = [];
      for (const ni of neighbours) {
        const nh = _hexCache[ni]; if (!nh) continue;
        const cost = HEX_MOVE_COST[nh.t] || 1;
        if ((army.movePoints || 0) < cost) continue;
        const nOwner = hwHexOwner(ni);
        const nArmy  = G.hexArmy[ni];
        const hasEnemyArmy = nArmy && nArmy.amount > 0 && atWar(nation, nArmy.nation);
        const isEnemyHex   = nOwner >= 0 && nOwner !== nation && atWar(nation, nOwner);

        if (hasEnemyArmy) {
          const defBonus = (HEX_DEF_BONUS[nh.t] || 1.0)
            * (G.hexBuildings[ni]?.type === 'fortress' ? 1.6 : 1.0);
          const ratio = army.amount / Math.max(1, nArmy.amount * defBonus);
          const minRatio = aggressive ? 1.2 : 1.8;
          if (ratio >= minRatio) attackable.push({ ni, ratio, priority: _hwHexPriority(ni) });
        } else if (isEnemyHex || nOwner < 0) {
          movable.push({ ni, priority: _hwHexPriority(ni), isTarget: targetHexes.has(ni) });
        }
      }

      // Сначала пробуем захватить пустой вражеский гекс цели
      const emptyTarget = movable.filter(x => x.isTarget).sort((a,b) => b.priority - a.priority)[0];
      if (emptyTarget) {
        hwMoveArmy(fromIdx, emptyTarget.ni, army.amount);
        hwSyncProvArmy(h.p);
        // Шаг 10: нотификация если игрок теряет гекс
        if (hwHexOwner(emptyTarget.ni) === G.playerNation) {
          // уже обработано в hwCaptureHex
        }
        continue;
      }

      // Потом атакуем вражескую армию (приоритет — окружённые и слабые)
      attackable.sort((a,b) => b.priority - a.priority);
      if (attackable.length) {
        const tgt = attackable[0];
        hwMoveArmy(fromIdx, tgt.ni, army.amount);
        hwSyncProvArmy(h.p);
        continue;
      }

      // Движение к цели через BFS если нет прямых ходов
      const nextStep = _hwBFSStep(fromIdx, targetHexes, nation);
      if (nextStep >= 0 && nextStep !== fromIdx) {
        const cost = HEX_MOVE_COST[_hexCache[nextStep]?.t] || 1;
        if ((army.movePoints || 0) >= cost) {
          hwMoveArmy(fromIdx, nextStep, army.amount);
          hwSyncProvArmy(h.p);
          continue;
        }
      }

      // Пустые вражеские не у цели тоже подходят
      const emptyAny = movable.sort((a,b) => b.priority - a.priority)[0];
      if (emptyAny) {
        hwMoveArmy(fromIdx, emptyAny.ni, army.amount);
        hwSyncProvArmy(h.p);
        continue;
      }
    }

    // ── ПРИОРИТЕТ 3: ОБОРОНА И ОТСТУПЛЕНИЕ ─────────────────────────────────
    if (!aggressive && _hwDefValue(fromIdx) < 1.3) {
      // Ищем лучший оборонительный гекс среди соседей
      const defTargets = neighbours
        .filter(ni => {
          const nh = _hexCache[ni]; if (!nh) return false;
          const cost = HEX_MOVE_COST[nh.t] || 1;
          if ((army.movePoints || 0) < cost) return false;
          return hwHexOwner(ni) === nation && !G.hexArmy[ni];
        })
        .sort((a,b) => _hwDefValue(b) - _hwDefValue(a));
      if (defTargets.length && _hwDefValue(defTargets[0]) > _hwDefValue(fromIdx) + 0.2) {
        hwMoveArmy(fromIdx, defTargets[0], army.amount);
        hwSyncProvArmy(h.p);
      }
    }
  }

  // Сбрасываем MP этой нации в 0 (ход завершён)
  for (const a of Object.values(G.hexArmy || {})) {
    if (a && a.nation === nation) a.movePoints = 0;
  }
}
