// ══════════════════════════════════════════════════════════════════════════════
//  HEX WARFARE ENGINE  — engine/hex_warfare.js
//  Hex-level ownership, combat, buildings, partial occupation, economics.
//  Depends on: map.js (_hexCache, _hexByRC, HEX_GRID), state.js (G, PROVINCES,
//              NATIONS), utils.js (ri, fm, natColor, atWar, areAllies)
// ══════════════════════════════════════════════════════════════════════════════

// ── BUILDINGS CATALOGUE ──────────────────────────────────────────────────────
var BUILDINGS = {
  barracks: {
    name:'Barracks', icon:'⚔', cost:400,
    buildTurns:3,
    desc:'Enables conscription. Army gathers here.',
    coastal:false,
    maxPerProv: (hexCount) => hexCount > 20 ? 2 : 1,
  },
  port: {
    name:'Port', icon:'⚓', cost:500,
    buildTurns:4,
    desc:'Required for naval operations. Coastal hexes only.',
    coastal:true,
    maxPerProv: () => 2,
  },
  fort: {
    name:'Fortress', icon:'🏰', cost:600,
    buildTurns:5,
    desc:'Defense +60% on this hex. Slows enemy advance.',
    coastal:false,
    maxPerProv: () => 1,
  },
  mine: {
    name:'Mine', icon:'⛏', cost:300,
    buildTurns:3,
    desc:'+25% resource yield from this province.',
    coastal:false,
    maxPerProv: () => 3,
  },
  farm: {
    name:'Farm', icon:'🌾', cost:200,
    buildTurns:2,
    desc:'+15% population growth, +10% income.',
    coastal:false,
    maxPerProv: () => 4,
  },
  watchtower: {
    name:'Watchtower', icon:'🗼', cost:150,
    buildTurns:2,
    desc:'Reveals exact enemy army in adjacent provinces.',
    coastal:false,
    maxPerProv: () => 2,
  },
};

// ── TERRAIN CONSTANTS ────────────────────────────────────────────────────────
// Movement cost (points to enter this hex)
var HEX_MOVE_COST = {
  plains:1, farmland:1, steppe:1, savanna:1,
  forest:2, hills:2, highland:2, coast:1,
  mountain:3, swamp:3, marsh:3,
  urban:1, tundra:2, desert:2, jungle:3,
};
// Defense multiplier (defender advantage in this terrain)
var HEX_DEF_BONUS = {
  plains:1.0, farmland:1.0, steppe:1.0, savanna:1.0,
  forest:1.35, hills:1.30, highland:1.35, coast:1.0,
  mountain:1.70, swamp:1.45, marsh:1.40,
  urban:1.55,  tundra:1.20, desert:1.15, jungle:1.50,
};
// Population weight — how much of province pop lives in this terrain type
var HEX_POP_WEIGHT = {
  urban:4.0, farmland:1.5, plains:1.0, coast:0.8,
  forest:0.5, hills:0.7, highland:0.6, steppe:0.7,
  mountain:0.3, swamp:0.2, marsh:0.2,
  desert:0.1, tundra:0.1, jungle:0.3, savanna:0.6,
};
// Income weight per hex
var HEX_INCOME_WEIGHT = {
  urban:4.0, farmland:1.8, plains:1.0, coast:1.1,
  forest:0.6, hills:0.8, highland:0.7, steppe:0.8,
  mountain:0.4, swamp:0.2, marsh:0.2,
  desert:0.2, tundra:0.2, jungle:0.4, savanna:0.7,
};

// Movement points per turn for a hex army stack
var HEX_ARMY_MOVE_POINTS = 3;

// ── STATE INIT ───────────────────────────────────────────────────────────────
// Call this at game start (after buildHexCache()) and on load.
// Adds hex-warfare fields to G without breaking existing save keys.
function hwInit() {
  // hexOwner: { hexIdx -> nationIdx }  — only set when different from province owner
  if (!G.hexOwner) G.hexOwner = {};

  // hexArmy: { hexIdx -> { amount:int, nation:int, movePoints:int } }
  if (!G.hexArmy) G.hexArmy = {};

  // hexBuildings: { hexIdx -> { type:string, nation:int } }
  if (!G.hexBuildings) G.hexBuildings = {};

  // hexConstruction: { hexIdx -> { type, turnsLeft, totalTurns, nation } }
  if (!G.hexConstruction) G.hexConstruction = {};

  // provHexBuildings cache (derived, rebuilt on load):
  // { pi -> [ {hexIdx, type}, ... ] }
  _hwRebuildProvBuildCache();

  // Seed armies from legacy G.army into hexArmy (capital/barracks hex)
  _hwSeedArmies();
}

// Rebuild fast lookup: province → list of {hexIdx, type}
function _hwRebuildProvBuildCache() {
  window._provHexBuild = {};
  for (const [hStr, bld] of Object.entries(G.hexBuildings || {})) {
    const hi = +hStr;
    const h = _hexCache && _hexCache[hi];
    if (!h || h.p < 0) continue;
    if (!window._provHexBuild[h.p]) window._provHexBuild[h.p] = [];
    window._provHexBuild[h.p].push({ hexIdx: hi, type: bld.type });
  }
}

// Migrate legacy G.army[pi] values into G.hexArmy on the capital/barracks hex
function _hwSeedArmies() {
  if (!_hexCache) return;
  for (let pi = 0; pi < PROVINCES.length; pi++) {
    const amt = G.army[pi] || 0;
    if (amt <= 0) continue;
    // Already seeded?
    const hasHexArmy = Object.values(G.hexArmy).some(a =>
      a.nation === G.owner[pi] && _hexCache[+Object.keys(G.hexArmy).find(k => G.hexArmy[k] === a)]?.p === pi
    );
    if (hasHexArmy) continue;

    // Find barracks hex, or capital hex, or any hex of this province
    const bArr = (window._provHexBuild[pi] || []).find(b => b.type === 'barracks');
    let seedHex = bArr ? bArr.hexIdx : -1;
    if (seedHex < 0) {
      // Use centroid-nearest hex
      const provHexes = _hexCache.reduce((acc, h, idx) => {
        if (!h.sea && h.p === pi) acc.push(idx); return acc;
      }, []);
      if (provHexes.length > 0) {
        const cx = _provCentroid[pi]?.x || PROVINCES[pi].cx;
        const cy = _provCentroid[pi]?.y || PROVINCES[pi].cy;
        seedHex = provHexes.reduce((best, idx) => {
          const h = _hexCache[idx];
          const d = (h.x-cx)**2 + (h.y-cy)**2;
          const bd = best < 0 ? Infinity : ((h2=>((h2.x-cx)**2+(h2.y-cy)**2))(_hexCache[best]));
          return d < bd ? idx : best;
        }, provHexes[0]);
      }
    }
    if (seedHex >= 0) {
      G.hexArmy[seedHex] = {
        amount: amt,
        nation: G.owner[pi] >= 0 ? G.owner[pi] : -1,
        movePoints: HEX_ARMY_MOVE_POINTS,
      };
    }
  }
}

// ── OWNERSHIP HELPERS ────────────────────────────────────────────────────────

// Who owns a specific hex? (falls back to province owner)
function hwHexOwner(hexIdx) {
  if (G.hexOwner && G.hexOwner[hexIdx] !== undefined) return G.hexOwner[hexIdx];
  const h = _hexCache && _hexCache[hexIdx];
  if (!h || h.p < 0) return -1;
  return G.owner[h.p];
}

// Fraction of province hexes controlled by `nation` (0.0–1.0)
function hwProvControlFraction(pi, nation) {
  if (!_hexCache) return G.owner[pi] === nation ? 1.0 : 0.0;
  const hexes = _hwProvHexes(pi);
  if (!hexes.length) return 0;
  const mine = hexes.filter(idx => hwHexOwner(idx) === nation).length;
  return mine / hexes.length;
}

// Which nation controls the MOST hexes in this province?
function hwProvController(pi) {
  if (!_hexCache) return G.owner[pi];
  const hexes = _hwProvHexes(pi);
  const counts = {};
  for (const idx of hexes) {
    const o = hwHexOwner(idx);
    counts[o] = (counts[o] || 0) + 1;
  }
  const entries = Object.entries(counts);
  if (!entries.length) return G.owner[pi];
  return +entries.sort((a,b)=>b[1]-a[1])[0][0];
}

// Is this province fully controlled by its owner?
function hwProvFullyOwned(pi) {
  return hwProvControlFraction(pi, G.owner[pi]) >= 1.0;
}

// Is there active fighting in this province? (armies of 2+ nations present)
function hwProvContested(pi) {
  if (!_hexCache) return false;
  const nations = new Set();
  for (const [hStr, army] of Object.entries(G.hexArmy)) {
    if (_hexCache[+hStr]?.p === pi && army.amount > 0) nations.add(army.nation);
  }
  return nations.size > 1;
}

// All land hex indices of a province (cached per tick)
var _hwProvHexCache = null, _hwProvHexCacheTick = -1;
function _hwProvHexes(pi) {
  if (_hwProvHexCacheTick !== G.tick || !_hwProvHexCache) {
    _hwProvHexCache = [];
    _hwProvHexCacheTick = G.tick;
    if (_hexCache) {
      for (let idx = 0; idx < _hexCache.length; idx++) {
        const h = _hexCache[idx];
        if (!h.sea && h.p >= 0) {
          if (!_hwProvHexCache[h.p]) _hwProvHexCache[h.p] = [];
          _hwProvHexCache[h.p].push(idx);
        }
      }
    }
  }
  return (_hwProvHexCache && _hwProvHexCache[pi]) || [];
}

// Population of a specific hex based on terrain weight
function hwHexPop(hexIdx) {
  const h = _hexCache[hexIdx];
  if (!h || h.p < 0) return 0;
  const pi = h.p;
  const hexes = _hwProvHexes(pi);
  const totalWeight = hexes.reduce((s,i)=>{
    return s + (HEX_POP_WEIGHT[_hexCache[i].t] || 1.0);
  }, 0);
  const myWeight = HEX_POP_WEIGHT[h.t] || 1.0;
  return Math.round((G.pop[pi] || 0) * myWeight / (totalWeight || 1));
}

// ── ECONOMICS WITH PARTIAL OCCUPATION ───────────────────────────────────────

// Effective income for a nation from a province (accounts for hex ownership)
function hwProvEffectiveIncome(pi, nation) {
  const baseIncome = G.income[pi] || 0;
  if (!_hexCache) return G.owner[pi] === nation ? baseIncome : 0;

  // Calculate income-weighted fraction
  const hexes = _hwProvHexes(pi);
  if (!hexes.length) return G.owner[pi] === nation ? baseIncome : 0;

  let myWeight = 0, totalWeight = 0;
  for (const idx of hexes) {
    const w = HEX_INCOME_WEIGHT[_hexCache[idx].t] || 1.0;
    totalWeight += w;
    if (hwHexOwner(idx) === nation) myWeight += w;
  }
  const fraction = totalWeight > 0 ? myWeight / totalWeight : 0;

  // Contested province → extra penalty
  const contested = hwProvContested(pi) ? 0.5 : 1.0;
  // Partial occupation penalty
  const occPenalty = fraction < 1.0 && fraction > 0 ? 0.65 : 1.0;
  // Enemy occupying own territory: resistance income
  const isOwner = G.owner[pi] === nation;
  const ownerBonus = isOwner ? 1.0 : 0.7; // foreign territory yields 70%

  return Math.round(baseIncome * fraction * occPenalty * contested * ownerBonus);
}

// Max recruitable troops per turn from a province for a nation
function hwProvMaxRecruit(pi, nation) {
  const pop = G.pop[pi] || 0;
  const fraction = hwProvControlFraction(pi, nation);
  if (fraction <= 0) return 0;

  // Base: 0.8% of population per turn (monthly)
  const base = Math.round(pop * 0.008);

  // Must have barracks
  const barracks = (window._provHexBuild[pi] || []).filter(b => b.type === 'barracks' &&
    hwHexOwner(b.hexIdx) === nation);
  if (!barracks.length) return 0;

  const isOwner = G.owner[pi] === nation;
  const loyaltyMod = isOwner ? 1.0 : 0.25;    // foreign pop doesn't want to serve
  const partialMod = fraction < 1.0 ? 0.35 : 1.0; // partial control = limited draft

  return Math.max(100, Math.round(base * fraction * loyaltyMod * partialMod));
}

// ── BUILDING PLACEMENT ───────────────────────────────────────────────────────

// Returns true / error string
function hwCanBuildAt(hexIdx, type, nation) {
  if (!_hexCache) return 'Map not ready';
  const h = _hexCache[hexIdx];
  if (!h) return 'Invalid hex';
  if (h.sea) return 'Cannot build on sea';
  if (h.p < 0) return 'Unassigned hex';
  if (hwHexOwner(hexIdx) !== nation) return 'You do not control this hex';

  const bDef = BUILDINGS[type];
  if (!bDef) return 'Unknown building type';

  // Coastal restriction
  if (bDef.coastal) {
    const isCoastal = (h.nbIdx || []).some(ni => _hexCache[ni] && _hexCache[ni].sea);
    if (!isCoastal) return 'Must be on a coastal hex';
  }

  // Already occupied by a building?
  if (G.hexBuildings[hexIdx]) return 'Hex already has a building';
  if (G.hexConstruction[hexIdx]) return 'Construction already in progress';

  // Per-province limit
  const pi = h.p;
  const existing = (window._provHexBuild[pi] || []).filter(b => b.type === type);
  const hexCount = _hwProvHexes(pi).length;
  const limit = bDef.maxPerProv(hexCount);
  if (existing.length >= limit) return `Max ${limit} ${bDef.name} per province`;

  // Gold check
  if ((G.gold[nation] || 0) < bDef.cost) return `Need ${bDef.cost} gold`;

  return true;
}

// Start construction (player action)
function hwStartBuild(hexIdx, type) {
  const nation = G.playerNation;
  const check = hwCanBuildAt(hexIdx, type, nation);
  if (check !== true) { if (typeof popup === 'function') popup(check); return false; }

  const bDef = BUILDINGS[type];
  G.gold[nation] -= bDef.cost;
  G.hexConstruction[hexIdx] = {
    type, nation,
    turnsLeft: bDef.buildTurns,
    totalTurns: bDef.buildTurns,
  };
  if (typeof scheduleDraw === 'function') scheduleDraw();
  if (typeof updateHUD === 'function') updateHUD();
  if (typeof popup === 'function') popup(`🏗 ${bDef.name} construction begun (${bDef.buildTurns} turns)`);
  return true;
}

// Advance construction by one turn (called from endturn)
function hwTickConstruction() {
  const completed = [];
  for (const [hStr, con] of Object.entries(G.hexConstruction)) {
    con.turnsLeft--;
    if (con.turnsLeft <= 0) {
      const hi = +hStr;
      G.hexBuildings[hi] = { type: con.type, nation: con.nation };
      completed.push(hi);
    }
  }
  for (const hi of completed) {
    delete G.hexConstruction[hi];
  }
  _hwRebuildProvBuildCache();
  return completed;
}

// Destroy a building (siege / player action)
function hwDestroyBuilding(hexIdx) {
  delete G.hexBuildings[hexIdx];
  delete G.hexConstruction[hexIdx];
  _hwRebuildProvBuildCache();
}

// ── ARMY MANAGEMENT ─────────────────────────────────────────────────────────

// Conscript troops to barracks hex(es) in a province
function hwDraft(pi, amount) {
  const nation = G.playerNation;
  const maxRec = hwProvMaxRecruit(pi, nation);
  if (maxRec <= 0) {
    if (typeof popup === 'function') popup('⚠ No barracks or no draft capacity here');
    return 0;
  }
  const actual = Math.min(amount, maxRec);

  // Find barracks owned by player in this province
  const barracks = (window._provHexBuild[pi] || [])
    .filter(b => b.type === 'barracks' && hwHexOwner(b.hexIdx) === nation);
  if (!barracks.length) {
    if (typeof popup === 'function') popup('⚠ No barracks in this province');
    return 0;
  }

  // Distribute evenly across barracks
  const perBnow = Math.floor(actual / barracks.length);
  const remainder = actual - perBnow * barracks.length;
  barracks.forEach((b, i) => {
    const bonus = i === 0 ? remainder : 0;
    if (!G.hexArmy[b.hexIdx]) {
      G.hexArmy[b.hexIdx] = { amount: 0, nation, movePoints: HEX_ARMY_MOVE_POINTS };
    }
    G.hexArmy[b.hexIdx].amount += perBnow + bonus;
  });

  // Update legacy G.army for compatibility
  hwSyncProvArmy(pi);

  if (typeof addLog === 'function')
    addLog(`⚔ ${fm(actual)} drafted in ${PROVINCES[pi].name}`, 'event');
  return actual;
}

// Sync legacy G.army[pi] from hexArmy (for HUD / AI compatibility)
function hwSyncProvArmy(pi) {
  if (!_hexCache) return;
  const hexes = _hwProvHexes(pi);
  let total = 0;
  for (const idx of hexes) {
    const a = G.hexArmy[idx];
    if (a && a.nation === G.owner[pi]) total += a.amount;
  }
  G.army[pi] = total;
}

// Refresh all provinces' legacy G.army
function hwSyncAllArmies() {
  for (let pi = 0; pi < PROVINCES.length; pi++) hwSyncProvArmy(pi);
}

// ── HEX MOVEMENT ─────────────────────────────────────────────────────────────

// Can an army on fromHexIdx move to toHexIdx?
// Returns 'move', 'attack', or an error string
function hwCanMoveHexTo(fromHexIdx, toHexIdx, nation) {
  if (!_hexCache) return 'No map';
  const from = _hexCache[fromHexIdx];
  const to   = _hexCache[toHexIdx];
  if (!from || !to) return 'Invalid hex';
  if (to.sea) return 'Cannot move onto sea';

  // Must be neighbours
  const isNeighbour = (from.nbIdx || []).includes(toHexIdx);
  if (!isNeighbour) return 'Not adjacent';

  const army = G.hexArmy[fromHexIdx];
  if (!army || army.nation !== nation || army.amount <= 0) return 'No army here';

  const cost = HEX_MOVE_COST[to.t] || 1;
  if (army.movePoints < cost) return `Need ${cost} MP (have ${army.movePoints})`;

  const toOwner = hwHexOwner(toHexIdx);
  const toArmy  = G.hexArmy[toHexIdx];

  // Enemy army present → attack
  if (toOwner !== nation && toArmy && toArmy.amount > 0 && toArmy.nation !== nation) {
    if (typeof atWar === 'function' && !atWar(nation, toArmy.nation)) return 'Not at war';
    return 'attack';
  }

  // Friendly or unoccupied hex → move (capture if enemy territory)
  return 'move';
}

// Move army (or split) from one hex to another
function hwMoveArmy(fromHexIdx, toHexIdx, amount) {
  const nation = G.playerNation;
  const action = hwCanMoveHexTo(fromHexIdx, toHexIdx, nation);
  if (action === 'attack') {
    return hwAttackHex(fromHexIdx, toHexIdx, amount);
  }
  if (action !== 'move') {
    if (typeof popup === 'function') popup(action);
    return false;
  }

  const army = G.hexArmy[fromHexIdx];
  const cost = HEX_MOVE_COST[_hexCache[toHexIdx].t] || 1;
  const moved = Math.min(amount, army.amount);

  army.amount -= moved;
  army.movePoints -= cost;
  if (army.amount <= 0) delete G.hexArmy[fromHexIdx];

  // Merge into destination
  if (!G.hexArmy[toHexIdx]) {
    G.hexArmy[toHexIdx] = { amount: 0, nation, movePoints: HEX_ARMY_MOVE_POINTS - cost };
  }
  G.hexArmy[toHexIdx].amount += moved;

  // Capture hex if it belonged to enemy
  const prevOwner = hwHexOwner(toHexIdx);
  if (prevOwner !== nation) {
    hwCaptureHex(toHexIdx, nation);
  }

  hwSyncProvArmy(_hexCache[toHexIdx].p);
  if (fromHexIdx !== toHexIdx) hwSyncProvArmy(_hexCache[fromHexIdx].p);
  if (typeof scheduleDraw === 'function') scheduleDraw();
  return true;
}

// ── COMBAT ───────────────────────────────────────────────────────────────────

// Fort defense bonus on a hex
function _hwFortBonus(hexIdx) {
  const bld = G.hexBuildings[hexIdx];
  return (bld && bld.type === 'fort') ? 1.60 : 1.0;
}

// Attack one hex from an adjacent hex
// Returns { win:bool, attLoss:int, defLoss:int }
function hwAttackHex(fromHexIdx, toHexIdx, attackerAmount) {
  if (!_hexCache) return null;
  const attArmy = G.hexArmy[fromHexIdx];
  const defArmy = G.hexArmy[toHexIdx] || { amount: 0, nation: hwHexOwner(toHexIdx) };
  const toHex   = _hexCache[toHexIdx];

  const attNation = attArmy ? attArmy.nation : G.playerNation;
  const defNation = defArmy.nation;

  // Effective forces in this engagement
  const attForce = Math.min(attackerAmount || (attArmy?.amount || 0), attArmy?.amount || 0);
  const defForce = defArmy.amount || 0;

  // Terrain + fort defence
  const terrainBonus = HEX_DEF_BONUS[toHex.t] || 1.0;
  const fortBonus    = _hwFortBonus(toHexIdx);
  const totalDefBonus = terrainBonus * fortBonus;

  // Attrition rates (per engagement)
  const ATT_RATE = 0.10;
  const DEF_RATE = 0.12;

  let attLoss = Math.round(defForce * DEF_RATE * totalDefBonus * 0.8 + ri(0, Math.round(attForce * 0.02)));
  let defLoss = Math.round(attForce * ATT_RATE / totalDefBonus      + ri(0, Math.round(defForce * 0.02)));

  attLoss = Math.min(attLoss, attForce);
  defLoss = Math.min(defLoss, defForce);

  const newAttForce = attForce - attLoss;
  const newDefForce = defForce - defLoss;

  // Apply losses
  if (attArmy) {
    attArmy.amount = Math.max(0, attArmy.amount - attLoss);
    const cost = HEX_MOVE_COST[toHex.t] || 1;
    attArmy.movePoints = Math.max(0, (attArmy.movePoints || 0) - cost);
    if (attArmy.amount <= 0) delete G.hexArmy[fromHexIdx];
  }

  const win = newDefForce <= 0;
  if (win) {
    // Attacker advances into captured hex
    delete G.hexArmy[toHexIdx];
    if (newAttForce > 0) {
      G.hexArmy[toHexIdx] = {
        amount: newAttForce,
        nation: attNation,
        movePoints: 0, // exhausted after assault
      };
      if (attArmy && fromHexIdx !== toHexIdx) {
        delete G.hexArmy[fromHexIdx];
      }
    }
    hwCaptureHex(toHexIdx, attNation);
  } else {
    // Defender holds
    G.hexArmy[toHexIdx] = { amount: newDefForce, nation: defNation, movePoints: defArmy.movePoints || 0 };
  }

  // Log
  if (typeof addLog === 'function') {
    const attName = NATIONS[attNation]?.short || '?';
    const defName = NATIONS[defNation]?.short || '?';
    const result  = win ? `🏴 ${attName} captures hex!` : `🛡 ${defName} holds!`;
    addLog(`⚔ ${attName} attacks ${defName} [${toHex.t}]: -${fm(attLoss)}/${fm(defLoss)} ${result}`, 'combat');
  }

  // Sync province armies
  hwSyncProvArmy(_hexCache[fromHexIdx].p);
  hwSyncProvArmy(_hexCache[toHexIdx].p);
  if (typeof scheduleDraw === 'function') scheduleDraw();

  return { win, attLoss, defLoss };
}

// ── HEX CAPTURE & PROVINCE STATUS ────────────────────────────────────────────

// Capture a single hex for `nation`
function hwCaptureHex(hexIdx, nation) {
  const h = _hexCache && _hexCache[hexIdx];
  if (!h || h.p < 0) return;
  const pi = h.p;
  const prevOwner = hwHexOwner(hexIdx);

  // Buildings change hands or get damaged
  const bld = G.hexBuildings[hexIdx];
  if (bld && bld.nation !== nation) {
    // Enemy fort: 50% chance of demolition
    if (bld.type === 'fort' && Math.random() < 0.5) {
      hwDestroyBuilding(hexIdx);
      if (typeof addLog === 'function')
        addLog(`🏚 Fort destroyed during capture`, 'combat');
    } else {
      // Transfer building ownership
      bld.nation = nation;
    }
  }

  // Mark ownership
  if (nation === G.owner[pi]) {
    // Liberating own hex — remove override
    delete G.hexOwner[hexIdx];
  } else {
    G.hexOwner[hexIdx] = nation;
  }

  _hwUpdateProvStatus(pi, nation);
}

// After a hex capture, check if the whole province flipped
function _hwUpdateProvStatus(pi, captorNation) {
  const hexes = _hwProvHexes(pi);
  if (!hexes.length) return;

  // Check if captor now owns ALL hexes
  const allCaptured = hexes.every(idx => hwHexOwner(idx) === captorNation);
  if (allCaptured) {
    // Full capture: update province owner, clear hex overrides
    const prevOwner = G.owner[pi];
    G.owner[pi] = captorNation;
    for (const idx of hexes) delete G.hexOwner[idx];

    // Capital captured? Apply capital penalty
    if (PROVINCES[pi].isCapital && typeof G.capitalPenalty !== 'undefined') {
      G.capitalPenalty[prevOwner] = (G.capitalPenalty[prevOwner] || 0) + 1;
    }

    if (typeof addLog === 'function') {
      const n = NATIONS[captorNation]?.short || '?';
      addLog(`🗺 ${n} captures ${PROVINCES[pi].name}!`, 'war');
    }
  }

  // Sync legacy occupied map for compatibility
  const ownerFrac = hwProvControlFraction(pi, G.owner[pi]);
  if (ownerFrac < 1.0 && ownerFrac > 0) {
    const ctrl = hwProvController(pi);
    if (!G.occupied) G.occupied = {};
    G.occupied[pi] = { by: ctrl, originalOwner: G.owner[pi], partial: true };
  } else {
    if (G.occupied) delete G.occupied[pi];
  }
}

// ── AI HEX WARFARE ───────────────────────────────────────────────────────────
// Called each turn for AI nations. Simple: march toward enemy hexes.
function hwAiTick(nation) {
  if (!_hexCache) return;
  // Reset move points for this nation's armies
  for (const [hStr, army] of Object.entries(G.hexArmy)) {
    if (army.nation === nation) army.movePoints = HEX_ARMY_MOVE_POINTS;
  }

  // Collect all this nation's army hexes
  const myArmyHexes = Object.entries(G.hexArmy)
    .filter(([,a]) => a.nation === nation && a.amount > 0)
    .map(([h]) => +h);

  for (const fromIdx of myArmyHexes) {
    const army = G.hexArmy[fromIdx];
    if (!army || army.amount <= 0) continue;

    // Look for enemy hex in neighbours
    const from = _hexCache[fromIdx];
    const neighbours = from.nbIdx || [];

    for (const toIdx of neighbours) {
      const toHex = _hexCache[toIdx];
      if (!toHex || toHex.sea) continue;
      const toOwner = hwHexOwner(toIdx);
      if (toOwner === nation) continue;

      // At war with toOwner?
      if (toOwner >= 0 && typeof atWar === 'function' && !atWar(nation, toOwner)) continue;

      const cost = HEX_MOVE_COST[toHex.t] || 1;
      if ((army.movePoints || 0) < cost) continue;

      const defArmy = G.hexArmy[toIdx];
      if (defArmy && defArmy.amount > 0 && defArmy.nation !== nation) {
        // Attack if have 1.3× advantage
        if (army.amount > defArmy.amount * 1.3) {
          hwAttackHex(fromIdx, toIdx, army.amount);
          break;
        }
      } else {
        // Undefended enemy hex — march in
        hwMoveArmy(fromIdx, toIdx, army.amount);
        break;
      }
    }
  }
}

// Reset move points for player's armies at start of their turn
function hwResetPlayerMovePoints() {
  const nation = G.playerNation;
  for (const [,army] of Object.entries(G.hexArmy)) {
    if (army.nation === nation) army.movePoints = HEX_ARMY_MOVE_POINTS;
  }
}

// ── RENDERING HOOKS ──────────────────────────────────────────────────────────
// These are called FROM map.js drawMap() at the appropriate passes.
// map.js should call: hwDrawHexOccupation(ctx, h, idx, R, wx0, wy0, wx1, wy1)
//                     hwDrawBuildings(ctx, R, wx0, wy0, wx1, wy1)
//                     hwDrawHexArmies(ctx, R, wx0, wy0, wx1, wy1)

var _hatchPatternCache = {};

function _hwHatchPattern(ctx, color) {
  if (_hatchPatternCache[color]) return _hatchPatternCache[color];
  const sz = 8;
  const oc = document.createElement('canvas'); oc.width = sz; oc.height = sz;
  const ox = oc.getContext('2d');
  ox.strokeStyle = color; ox.lineWidth = 1.8;
  ox.beginPath(); ox.moveTo(0, sz); ox.lineTo(sz, 0); ox.stroke();
  ox.beginPath(); ox.moveTo(-sz/2, sz/2); ox.lineTo(sz/2, -sz/2); ox.stroke();
  ox.beginPath(); ox.moveTo(sz/2, sz*1.5); ox.lineTo(sz*1.5, sz/2); ox.stroke();
  const p = ctx.createPattern(oc, 'repeat');
  _hatchPatternCache[color] = p;
  return p;
}

// PASS 2C: Partial hex occupation overlay (hatch on captured hexes)
function hwDrawHexOccupation(ctx, h, hexIdx, R, wx0, wy0, wx1, wy1) {
  const hOwner = hwHexOwner(hexIdx);
  const provOwner = G.owner[h.p];
  if (hOwner === provOwner) return; // normal

  // Hex captured by someone other than province owner
  const occupierColor = (typeof natColor === 'function') ? natColor(hOwner) : '#ff0000';
  ctx.globalAlpha = 0.40;
  // Tinted fill (occupier color, dark)
  ctx.fillStyle = occupierColor;
  if (typeof hexPath === 'function') hexPath(ctx, h.x, h.y, R);
  ctx.fill();
  ctx.globalAlpha = 0.55;
  // Hatch overlay
  const pat = _hwHatchPattern(ctx, occupierColor);
  if (pat) { ctx.fillStyle = pat; hexPath(ctx, h.x, h.y, R); ctx.fill(); }
  ctx.globalAlpha = 1.0;
}

// PASS X: Building icons on hexes
function hwDrawBuildings(ctx, R, wx0, wy0, wx1, wy1) {
  if (!G.hexBuildings && !G.hexConstruction) return;
  if (!_hexCache) return;

  const scale = (typeof vp !== 'undefined') ? vp.scale : 1;
  if (scale < 0.35) return;

  const iconAlpha = Math.min(1, (scale - 0.35) / 0.25);
  const fs = Math.max(3.5, R * 0.58);

  // Completed buildings
  for (const [hStr, bld] of Object.entries(G.hexBuildings)) {
    const h = _hexCache[+hStr];
    if (!h || h.sea) continue;
    if (h.x < wx0 - R*2 || h.x > wx1 + R*2 || h.y < wy0 - R*2 || h.y > wy1 + R*2) continue;

    const isOwn = bld.nation === G.playerNation;
    ctx.globalAlpha = 0.82 * iconAlpha;

    // Background circle
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.beginPath(); ctx.arc(h.x, h.y, R * 0.42, 0, Math.PI * 2); ctx.fill();

    // Ring color
    ctx.strokeStyle = isOwn ? 'rgba(201,168,76,0.85)' : 'rgba(160,100,100,0.7)';
    ctx.lineWidth = 1.0 / scale;
    ctx.beginPath(); ctx.arc(h.x, h.y, R * 0.42, 0, Math.PI * 2); ctx.stroke();

    // Icon
    ctx.globalAlpha = iconAlpha;
    ctx.font = `${fs}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 3;
    ctx.fillText(BUILDINGS[bld.type]?.icon || '?', h.x, h.y);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1.0;
  }

  // Under construction
  for (const [hStr, con] of Object.entries(G.hexConstruction)) {
    const h = _hexCache[+hStr];
    if (!h || h.sea) continue;
    if (h.x < wx0 - R*2 || h.x > wx1 + R*2 || h.y < wy0 - R*2 || h.y > wy1 + R*2) continue;

    ctx.globalAlpha = 0.55 * iconAlpha;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath(); ctx.arc(h.x, h.y, R * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(160,140,60,0.6)';
    ctx.lineWidth = 0.8 / scale;
    ctx.setLineDash([2/scale, 2/scale]);
    ctx.beginPath(); ctx.arc(h.x, h.y, R * 0.42, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    // Progress arc
    const prog = 1 - (con.turnsLeft / con.totalTurns);
    ctx.strokeStyle = 'rgba(201,168,76,0.8)';
    ctx.lineWidth = 1.2 / scale;
    ctx.beginPath();
    ctx.arc(h.x, h.y, R * 0.42, -Math.PI/2, -Math.PI/2 + prog * Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.7 * iconAlpha;
    ctx.font = `${fs * 0.85}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🏗', h.x, h.y);
    ctx.globalAlpha = 1.0;
  }
}

// PASS Y: Hex army counters (small unit icons on hexes)
function hwDrawHexArmies(ctx, R, wx0, wy0, wx1, wy1) {
  if (!G.hexArmy || !_hexCache) return;
  const scale = (typeof vp !== 'undefined') ? vp.scale : 1;
  if (scale < 0.30) return;

  const alpha = Math.min(1, (scale - 0.30) / 0.20);
  const fs = Math.max(4, R * 0.50);
  const PN = G.playerNation;

  for (const [hStr, army] of Object.entries(G.hexArmy)) {
    if (!army || army.amount <= 0) continue;
    const h = _hexCache[+hStr];
    if (!h || h.sea) continue;
    if (h.x < wx0 - R*2 || h.x > wx1 + R*2 || h.y < wy0 - R*2 || h.y > wy1 + R*2) continue;

    const isOwn = army.nation === PN;
    const isAlly = typeof areAllies === 'function' && areAllies(PN, army.nation);
    const isEnemy = typeof atWar === 'function' && atWar(PN, army.nation);

    const natCol = (typeof natColor === 'function') ? natColor(army.nation) : '#888';

    // Position: bottom-right of hex
    const ox = h.x + R * 0.50;
    const oy = h.y + R * 0.55;
    const bw = R * 0.95, bh = R * 0.55;

    ctx.globalAlpha = 0.92 * alpha;

    // Background plaque
    ctx.fillStyle = 'rgba(4,4,10,0.82)';
    _roundRect(ctx, ox - bw/2, oy - bh/2, bw, bh, 2/scale);
    ctx.fill();

    // Border color by relation
    ctx.strokeStyle = isOwn ? 'rgba(201,168,76,0.9)' :
                      isAlly ? 'rgba(80,140,220,0.8)' :
                      isEnemy ? 'rgba(220,60,50,0.85)' : 'rgba(120,120,120,0.6)';
    ctx.lineWidth = 0.8 / scale;
    _roundRect(ctx, ox - bw/2, oy - bh/2, bw, bh, 2/scale);
    ctx.stroke();

    // Army count text
    ctx.globalAlpha = alpha;
    ctx.font = `600 ${fs * 0.78}px Cinzel,serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = isOwn ? '#f0d080' : isAlly ? '#a0c0ff' : isEnemy ? '#ff9090' : '#cccccc';
    ctx.shadowColor = 'rgba(0,0,0,0.95)'; ctx.shadowBlur = 2;
    ctx.fillText(fm(army.amount), ox, oy);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1.0;
  }
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── UI HELPERS ───────────────────────────────────────────────────────────────

// Returns HTML string for a province's hex-warfare status panel
function hwProvStatusHTML(pi) {
  const nation = G.playerNation;
  const fraction = hwProvControlFraction(pi, nation);
  const ownerFrac = hwProvControlFraction(pi, G.owner[pi]);
  const maxRec = hwProvMaxRecruit(pi, nation);
  const income = hwProvEffectiveIncome(pi, nation);
  const baseIncome = G.income[pi] || 0;
  const contested = hwProvContested(pi);
  const partial = ownerFrac < 1.0 && ownerFrac > 0;
  const buildings = (window._provHexBuild[pi] || []);

  const pct = Math.round(fraction * 100);
  const pctBar = Math.round(ownerFrac * 100);

  let html = '';

  // Partial occupation warning
  if (partial || contested) {
    const statusColor = contested ? '#ff6040' : '#e08830';
    const statusText  = contested ? '⚔ CONTESTED' : '▨ PARTIAL OCCUPATION';
    html += `<div style="font-size:8px;color:${statusColor};letter-spacing:1px;font-family:Cinzel,serif;margin-bottom:4px">${statusText}</div>`;

    // Control bar
    const owner = G.owner[pi];
    const ctrl  = hwProvController(pi);
    const ownerCol = typeof natColor === 'function' ? natColor(owner) : '#888';
    const ctrlCol  = typeof natColor === 'function' ? natColor(ctrl)  : '#f00';
    html += `<div style="margin:3px 0 5px;height:6px;background:rgba(0,0,0,.4);border-radius:2px;overflow:hidden;display:flex">
      <div style="width:${pctBar}%;background:${ownerCol};opacity:.85"></div>
      <div style="flex:1;background:${ctrlCol};opacity:.65"></div>
    </div>`;
    html += `<div style="display:flex;justify-content:space-between;font-size:8px;color:#aaa;margin-bottom:4px">
      <span>${NATIONS[owner]?.short||'?'} ${pctBar}%</span>
      <span>${NATIONS[ctrl]?.short||'?'} ${100-pctBar}%</span>
    </div>`;
  }

  // Income row
  const incomeColor = income < baseIncome ? '#e08830' : '#9aba50';
  html += `<div style="display:flex;justify-content:space-between;font-size:9px;padding:2px 0">
    <span style="color:#aaa">Income</span>
    <span style="color:${incomeColor}">${income}${income < baseIncome ? ` <span style="color:#666">(base ${baseIncome})</span>` : ''}</span>
  </div>`;

  // Recruit row
  if (maxRec > 0) {
    html += `<div style="display:flex;justify-content:space-between;font-size:9px;padding:2px 0">
      <span style="color:#aaa">Max draft/turn</span>
      <span style="color:#c9a84c">${fm(maxRec)}</span>
    </div>`;
  }

  // Buildings in this province
  if (buildings.length) {
    html += `<div style="margin-top:5px;font-size:8px;color:#666;letter-spacing:1px">BUILDINGS</div>`;
    for (const b of buildings) {
      const bDef = BUILDINGS[b.type];
      const hex  = _hexCache && _hexCache[b.hexIdx];
      const own  = hwHexOwner(b.hexIdx) === nation;
      html += `<div style="display:flex;align-items:center;gap:5px;padding:2px 0;font-size:8px;opacity:${own?1:0.5}">
        <span>${bDef?.icon||'?'}</span>
        <span style="color:${own?'#e8d5a3':'#888'}">${bDef?.name||b.type}</span>
        <span style="color:#555;margin-left:auto">${hex?hex.t:''}</span>
      </div>`;
    }
  }

  // Under construction
  const underCon = Object.entries(G.hexConstruction || {})
    .filter(([hStr]) => _hexCache && _hexCache[+hStr]?.p === pi);
  for (const [,con] of underCon) {
    const bDef = BUILDINGS[con.type];
    html += `<div style="display:flex;align-items:center;gap:5px;padding:2px 0;font-size:8px;color:#c9a84c">
      <span>🏗</span>
      <span>${bDef?.name||con.type}</span>
      <span style="margin-left:auto">${con.turnsLeft}T left</span>
    </div>`;
  }

  return html;
}

// Build menu HTML for a selected hex (selStage===2)
function hwBuildMenuHTML(hexIdx) {
  if (hexIdx === null || hexIdx === undefined || !_hexCache) return '';
  const h = _hexCache[hexIdx];
  if (!h || h.sea || h.p < 0) return '';
  const nation = G.playerNation;
  const isOwn = hwHexOwner(hexIdx) === nation;
  const isCoastal = (h.nbIdx || []).some(ni => _hexCache[ni]?.sea);
  const existingBld = G.hexBuildings[hexIdx];
  const underCon = G.hexConstruction[hexIdx];
  const pi = h.p;

  let html = `<div style="font-size:8px;color:#c9a84c;letter-spacing:1px;margin-bottom:4px;font-family:Cinzel,serif">HEX [${h.t.toUpperCase()}${isCoastal ? ' \u2693' : ''}]</div>`;

  if (existingBld) {
    const bDef = BUILDINGS[existingBld.type];
    const isMyBld = existingBld.nation === nation;
    html += `<div style="display:flex;align-items:center;gap:6px;padding:4px 6px;background:rgba(0,0,0,.3);border:1px solid rgba(201,168,76,.25);margin-bottom:4px">
      <span style="font-size:14px">${bDef?.icon || '?'}</span>
      <div style="flex:1">
        <div style="font-size:9px;color:#e8d5a3;font-family:Cinzel,serif">${bDef?.name || existingBld.type}</div>
        <div style="font-size:7px;color:#888">${isMyBld ? 'Your building' : 'Enemy building'}</div>
      </div>
      ${existingBld.type === 'barracks' && isMyBld ? `<button onclick="hwDraftToBarracks(${pi})" style="padding:3px 7px;font-size:8px;font-family:Cinzel,serif;background:rgba(20,14,4,.8);border:1px solid rgba(201,168,76,.6);color:#c9a84c;cursor:pointer">Draft</button>` : ''}
    </div>`;
    return html;
  }

  if (underCon) {
    const bDef = BUILDINGS[underCon.type];
    html += `<div style="padding:4px 6px;background:rgba(0,0,0,.3);border:1px solid rgba(160,140,60,.3);font-size:8px;color:#c9a84c">
      \uD83C\uDFD7 ${bDef?.name || underCon.type} — ${underCon.turnsLeft} turns left
    </div>`;
    return html;
  }

  if (!isOwn) {
    html += `<div style="font-size:8px;color:#666">You don\'t control this hex</div>`;
    return html;
  }

  html += `<div style="font-size:8px;color:#666;margin-bottom:4px">Build on this hex:</div>`;

  for (const [type, bDef] of Object.entries(BUILDINGS)) {
    if (bDef.coastal && !isCoastal) continue;
    const check = hwCanBuildAt(hexIdx, type, nation);
    const canBuild = check === true;
    const disabled = !canBuild;
    const reason = disabled ? (typeof check === 'string' ? check : '') : '';
    html += `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid rgba(42,36,24,.25)">
      <span style="font-size:11px">${bDef.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:9px;color:${disabled ? '#555' : '#e8d5a3'};font-family:Cinzel,serif">${bDef.name}</div>
        <div style="font-size:7px;color:#666">${reason || bDef.desc}</div>
      </div>
      <button onclick="hwStartBuild(${hexIdx},'${type}')"
        style="padding:3px 7px;font-size:8px;font-family:Cinzel,serif;
               background:${canBuild ? 'rgba(20,14,4,.8)' : 'rgba(10,10,10,.5)'};
               border:1px solid ${canBuild ? 'rgba(201,168,76,.6)' : 'rgba(60,60,60,.4)'};
               color:${canBuild ? '#c9a84c' : '#444'};cursor:${canBuild ? 'pointer' : 'not-allowed'}"
        ${disabled ? 'disabled' : ''}>
        ${bDef.cost}g
      </button>
    </div>`;
  }
  return html;
}

// ── SERIALIZATION HELPERS ────────────────────────────────────────────────────

// Call after loadFromSlot to restore derived caches
function hwOnLoad() {
  if (!G.hexOwner)      G.hexOwner = {};
  if (!G.hexArmy)       G.hexArmy = {};
  if (!G.hexBuildings)  G.hexBuildings = {};
  if (!G.hexConstruction) G.hexConstruction = {};
  _hwRebuildProvBuildCache();
  hwSyncAllArmies();
  _hwProvHexCacheTick = -1; // invalidate cache
}

// ── ENDTURN INTEGRATION ──────────────────────────────────────────────────────
// Call hwEndTurn() from your existing endturn.js before or after AI processing.
function hwEndTurn() {
  // 1. Tick construction
  const built = hwTickConstruction();
  for (const hi of built) {
    const bld = G.hexBuildings[hi];
    const bDef = BUILDINGS[bld?.type];
    if (typeof addLog === 'function' && bDef)
      addLog(`🏛 ${bDef.name} completed in ${PROVINCES[_hexCache[hi]?.p]?.name || '?'}`, 'event');
  }

  // 2. AI hex warfare for all nations at war with player
  const PN = G.playerNation;
  for (let ni = 0; ni < NATIONS.length; ni++) {
    if (ni === PN) continue;
    if (typeof atWar === 'function' && atWar(PN, ni)) {
      hwAiTick(ni);
    }
  }

  // 3. Reset player move points for new turn
  hwResetPlayerMovePoints();

  // 4. Sync legacy army values
  hwSyncAllArmies();

  // 5. Invalidate caches
  _hwProvHexCacheTick = -1;
  _hatchPatternCache = {};
}

// ── AUTO-HOOK INTO ENDTURN ────────────────────────────────────────────────────
// If endTurn() exists globally, wrap it to call hwEndTurn() automatically.
// This avoids needing to edit endturn.js manually.
(function(){
  function _installHook(){
    if(typeof window.endTurn !== 'function') return false;
    if(window._hwEndTurnHooked) return true;
    const _orig = window.endTurn;
    window.endTurn = function(){
      if(typeof hwEndTurn === 'function') hwEndTurn();
      return _orig.apply(this, arguments);
    };
    window._hwEndTurnHooked = true;
    return true;
  }
  // Try immediately, then retry after DOM ready (endturn.js loads after us)
  if(!_installHook()){
    document.addEventListener('DOMContentLoaded', function _hwHookRetry(){
      if(!_installHook()){
        // Last resort: poll for up to 5s
        let _tries = 0;
        const _iv = setInterval(()=>{
          if(_installHook() || ++_tries > 50) clearInterval(_iv);
        }, 100);
      }
      document.removeEventListener('DOMContentLoaded', _hwHookRetry);
    });
  }
})();


// ── HEX MOVE / ATTACK DIALOG ─────────────────────────────────────────────────

function hwOpenHexMoveDialog() {
  if (!_hexCache) return;
  const selHex = G.selHex;
  if (!selHex) { if(typeof popup==='function')popup('Click a province, then click a hex inside it'); return; }

  let hexIdx = -1;
  for (let i = 0; i < _hexCache.length; i++) {
    if (_hexCache[i].r === selHex.r && _hexCache[i].c === selHex.c) { hexIdx = i; break; }
  }
  if (hexIdx < 0) { if(typeof popup==='function')popup('No hex selected'); return; }

  const army = G.hexArmy[hexIdx];
  if (!army || army.nation !== G.playerNation || army.amount <= 0) {
    if(typeof popup==='function')popup('No your army on this hex. Select a hex with your troops.');
    return;
  }

  const h = _hexCache[hexIdx];
  const moves = [];
  for (const ni of (h.nbIdx || [])) {
    const nh = _hexCache[ni];
    if (!nh || nh.sea) continue;
    const action = hwCanMoveHexTo(hexIdx, ni, G.playerNation);
    if (action === 'move' || action === 'attack') {
      const cost = HEX_MOVE_COST[nh.t] || 1;
      const defArmy = G.hexArmy[ni];
      moves.push({ idx: ni, action, cost, nh, defArmy });
    }
  }

  if (!moves.length) {
    if(typeof popup==='function')popup('No valid moves — no movement points or all hexes blocked');
    return;
  }

  const max = army.amount;
  let html = `<p class="mx">⚔ Hex army: <b>${fm(army.amount)}</b> · MP: <b>${army.movePoints}/${HEX_ARMY_MOVE_POINTS}</b></p>
    <p class="mx" style="color:var(--dim);font-size:8px">Terrain: <b>${h.t}</b>. Click target hex below:</p>
    <div class="tlist">`;

  for (const m of moves) {
    const icon = m.action === 'attack' ? '⚔' : '→';
    const defStr = m.defArmy && m.defArmy.amount > 0 ? ` · def ${fm(m.defArmy.amount)}` : '';
    html += `<div class="ti${m.action==='attack'?' ene':''}" onclick="hwDoHexMove(${hexIdx},${m.idx},document.getElementById('hw-mv-sl').value|0);closeMo()">
      <span class="tn">${icon} [${m.nh.t}]${defStr}</span>
      <span class="ta">${m.cost} MP</span>
    </div>`;
  }

  html += `</div>
    <div class="slider-w"><div class="slider-l"><span>Troops</span><span class="slider-v" id="hw-mv-sv">${fm(max)}</span></div>
    <input type="range" id="hw-mv-sl" min="100" max="${max}" value="${max}"
      oninput="document.getElementById('hw-mv-sv').textContent=fa(+this.value);this.style.setProperty('--pct',(+this.value/+this.max*100)+'%')"></div>`;

  if (typeof openMo === 'function') openMo('⚔ HEX MOVEMENT', html, [{lbl:'Cancel',cls:'dim'}]);
  setTimeout(() => {
    const sl = document.getElementById('hw-mv-sl');
    if (sl) sl.style.setProperty('--pct', '100%');
  }, 40);
}

function hwDoHexMove(fromIdx, toIdx, amount) {
  if (!amount || amount < 1) amount = G.hexArmy[fromIdx]?.amount || 0;
  const action = hwCanMoveHexTo(fromIdx, toIdx, G.playerNation);
  if (action === 'attack') {
    const result = hwAttackHex(fromIdx, toIdx, amount);
    if (result) {
      const msg = result.win
        ? `⚔ Victory! Losses: ${fm(result.attLoss)} vs ${fm(result.defLoss)}`
        : `🛡 Repelled! Losses: ${fm(result.attLoss)} vs ${fm(result.defLoss)}`;
      if (typeof popup === 'function') popup(msg);
    }
  } else if (action === 'move') {
    hwMoveArmy(fromIdx, toIdx, amount);
    if (typeof popup === 'function') popup(`Moved ${fm(amount)} troops`);
  } else {
    if (typeof popup === 'function') popup(action);
  }
  if (typeof updateSP === 'function') updateSP(G.sel);
  if (typeof chkBtns === 'function') chkBtns();
}

function hwDraftToBarracks(pi) {
  const maxRec = hwProvMaxRecruit(pi, G.playerNation);
  if (maxRec <= 0) { if(typeof popup==='function')popup('No barracks or no draft capacity'); return; }
  const pop = G.pop[pi] || 0;
  const popCap = Math.floor(pop / 10);
  const canDraft = Math.max(0, popCap - (G.army[pi]||0));
  if (canDraft <= 0) { if(typeof popup==='function')popup('Province at army capacity'); return; }
  const actual = Math.min(maxRec, canDraft);
  const cost = actual;
  if ((G.gold[G.playerNation] || 0) < cost) { if(typeof popup==='function')popup(`Need ${fa(cost)} gold`); return; }
  G.gold[G.playerNation] -= cost;
  G.pop[pi] = Math.max(500, pop - actual);
  hwDraft(pi, actual);
  if (typeof updateHUD === 'function') updateHUD();
  if (typeof updateSP === 'function') updateSP(pi);
}
