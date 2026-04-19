// ══════════════════════════════════════════════════════════
//  GAME STATE
//  Central state object G and game initialisation.
// ══════════════════════════════════════════════════════════

// Popup timer declared early to avoid TDZ if popup() fires during init
var _popT;

let G = {
  month:0, week:0,
  year:1936, playerNation:0, leaderName:'The Leader', ideology:'fascism',
  owner:[], pop:[], army:[], income:[], gold:[], buildings:[], instab:[], assim:[],
  disease:[],          // legacy severity array (kept for map-render compat)
  satisfaction:[],
  construction:[],
  reforming:false, reformTarget:'', reformTurnsLeft:0, reformTotalTurns:0,
  resPool:{oil:0,coal:0,grain:0,steel:0},
  resBase:[],
  taxRate:25,
  taxMood:[],
  loans:[],
  totalDebt:0,
  pact:[], war:[], pLeft:[], capitalPenalty:[],
  alliance:[],
  puppet:[],
  resistance:[],
  resistSponsor:[],
  fleet:[],
  sel:-1, selStage:0, selHex:null, moveFrom:-1, moveMode:false, navalMode:false, navalFrom:-1,
  mapMode:'political',
  allianceOf:[],
  tick:0,
  // Queues
  battleQueue:[],
  _enemyAttackQueue:[],
  moveQueue:[],
  draftQueue:[],
  assimQueue:[],
  // Occupation
  occupied:{},
  // Disease
  epidemics:[],
  provDisease:[],
  _allyEpicNotified:null,
  // AI
  aiPersonality:{},
  ceasefire:{},
};

// ── SETUP UI GLOBALS ──────────────────────────────────────
// SC / SI managed by setup screen; declared here to avoid reference errors
let SC = -1, SI = 'fascism';

function chkSB(){
  const b = document.getElementById('startbtn');
  if(b) b.disabled = SC < 0 || !SI;
}

// ── DIPLOMACY INIT ────────────────────────────────────────
function initDiplo(){
  const N = NATIONS.length;
  G.pact        = Array.from({length:N}, () => new Array(N).fill(false));
  G.war         = Array.from({length:N}, () => new Array(N).fill(false));
  G.pLeft       = Array.from({length:N}, () => new Array(N).fill(0));
  G.capitalPenalty = new Array(N).fill(0);
  G.gold        = new Array(N).fill(0);
  G.allianceOf  = new Array(N).fill(-1);
  G.alliance    = [];
  G.puppet      = [];
  // Apply map-defined alliances
  INIT_ALLIANCES.forEach((al, ai) => {
    G.alliance.push({...al});
    al.members.forEach(m => { G.allianceOf[m] = ai; });
  });
}

// ── GAME START ────────────────────────────────────────────
function startGame(){
  if(SC < 0) return;
  G.leaderName   = document.getElementById('rname').value.trim() || 'The Leader';
  G.ideology     = SI || 'fascism';
  G.playerNation = SC;

  // ── Deduplicate campaign title before starting ──────────
  (function(){
    const disp = document.getElementById('camp-title-display');
    if(!disp) return;
    const raw = disp.textContent.trim() || 'NEW CAMPAIGN';
    if(typeof uniqueCampaignLabel === 'function'){
      const unique = uniqueCampaignLabel(raw);
      if(unique !== raw) disp.textContent = unique.toUpperCase();
    }
  })();
  G.month = 0; G.week = 0; G.year = 1936;

  initDiplo();

  G.owner = PROVINCES.map(p => typeof p.nation === 'number' ? p.nation : -1);

  // Population: use editor-defined pop when available
  G.pop = PROVINCES.map((p, i) => {
    if(p.pop && p.pop > 0) return p.pop;
    const hc = Math.max(1, provSize(i));
    const base = p.isCapital ? ri(800000,2000000) : ri(100000,500000);
    return Math.round(base * (Math.min(hc, 30) / 10));
  });

  G.army = PROVINCES.map(() => 0);

  G.income = PROVINCES.map((p, i) => {
    const hc = Math.max(1, provSize(i));
    const base = p.isCapital ? ri(300,600) : ri(80,200);
    return Math.round(base * (Math.min(hc, 20) / 8) * provTerrainInc(i));
  });

  G.instab        = PROVINCES.map(() => 0);
  G.assim         = PROVINCES.map(() => 100);
  G.disease       = PROVINCES.map(() => 0);
  G.buildings     = PROVINCES.map(() => []);
  G.satisfaction  = PROVINCES.map(() => ri(65, 80));
  G.construction  = PROVINCES.map(() => null);

  G.reforming = false; G.reformTarget = ''; G.reformTurnsLeft = 0; G.reformTotalTurns = 0;

  G.epidemics     = [];
  G.provDisease   = PROVINCES.map(() => null);
  G.resistance    = PROVINCES.map(() => 0);
  G.resistSponsor = PROVINCES.map(() => -1);

  G._allyEpicNotified = new Set();

  G.taxRate    = 25;
  G.taxMood    = PROVINCES.map(() => 0);
  G.battleQueue       = [];
  G._enemyAttackQueue = [];
  G.moveQueue  = [];
  G.draftQueue = [];
  G.assimQueue = PROVINCES.map(() => null);
  G.occupied   = {};

  G.resBase = PROVINCES.map(p => ({...((p.res) || {})}));
  G.resPool = {oil:0, coal:0, grain:0, steel:0};

  G.loans = []; G.totalDebt = 0;
  G.fleet = [];

  G.moveFrom = -1; G.moveMode = false;
  G.navalMode = false; G.navalFrom = -1; G.sel = -1; G.selStage = 0; G.selHex = null;

  G.aiPersonality = {};
  G.ceasefire = {};

  G.gold[SC] = 1200;
  NATIONS.forEach((_, i) => { if(i !== SC) G.gold[i] = ri(300, 700); });

  // Player army in capital only
  const capIdx = PROVINCES.findIndex(p => p.nation === SC && p.isCapital);
  if(capIdx >= 0) G.army[capIdx] = ri(6000, 10000);

  // AI: army in capital + small border garrisons
  NATIONS.forEach((_, ni) => {
    if(ni === SC) return;
    const ci = PROVINCES.findIndex(p => p.nation === ni && p.isCapital);
    if(ci >= 0) G.army[ci] = ri(2000, 5000);
    const natProvs   = PROVINCES.map((_,idx) => idx).filter(idx => PROVINCES[idx].nation === ni && !PROVINCES[idx].isCapital);
    const borderProvs = natProvs.filter(idx => (NB[idx]||[]).some(nb => PROVINCES[nb].nation !== ni && PROVINCES[nb].nation >= 0));
    borderProvs.slice(0, ri(1, 3)).forEach(idx => { G.army[idx] = ri(200, 800); });
  });

  show('game');
  setTimeout(() => {
    buildHexCache();
    computeHexRadius();
    buildCanvas();
    zoomReset();
    updateHUD(); updateIdeoHUD(); updateSeasonUI(); updateResCountsInPanel();
    addLog(`${dateStr()}: ${G.leaderName} rises to power.`, 'event');
    G.alliance.forEach(al => {
      addLog(`🤝 ${al.name} alliance active: ${al.members.map(m => NATIONS[m]?.short).join(', ')}`, 'diplo');
    });
  }, 80);
}

// ── SAVE / LOAD ───────────────────────────────────────────
function autoSave(){
  try {
    const saves = getAllSaves();
    const nat   = NATIONS[G.playerNation];
    const mo    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const stateCopy = JSON.parse(JSON.stringify(G, (key, val) => {
      if(val instanceof Set) return [...val];
      return val;
    }));
    const entry = {
      slot:       0,
      label:      (document.getElementById('camp-title-display')?.textContent?.trim()||G.leaderName||'Campaign'),
      nation:     nat?.name || '?',
      natColor:   nat?.color || '#888',
      ideology:   G.ideology,
      leaderName: G.leaderName,
      gameDate:   `${mo[G.month]} ${G.year}`,
      regions:    G.owner.filter(o => o === G.playerNation).length,
      gold:       Math.round(G.gold[G.playerNation] || 0),
      saved:      new Date().toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}),
      state:      stateCopy,
    };
    const idx = saves.findIndex(s => s.slot === 0);
    if(idx >= 0) saves[idx] = entry; else saves.unshift(entry);
    setSaves(saves);
    // Live session snapshot for crash recovery
    try { localStorage.setItem('toc_live', JSON.stringify(stateCopy)); } catch(e){}
  } catch(e){ console.warn('Autosave failed', e); }
}

function saveAndExit(){
  autoSave();
  try { localStorage.removeItem('toc_live'); } catch(e){}
  setTimeout(() => { show('worlds'); refreshWorldsList(); }, 80);
}

// ── SCREEN MANAGEMENT ─────────────────────────────────────
function show(id){
  document.querySelectorAll('.scr').forEach(e => e.classList.remove('on'));
  document.getElementById('s-' + id).classList.add('on');
}
function switchTab(id){
  document.querySelectorAll('.tab,.tpane').forEach(e => e.classList.remove('on'));
  document.getElementById('tab-' + id).classList.add('on');
  document.getElementById('pane-' + id).classList.add('on');
  hideProvPopup();
}
function setMapMode(mode){
  if(mode === 'instab') window._instabAnimY = {};
  G.mapMode = mode;
  document.querySelectorAll('.mmbtn').forEach(b => b.classList.remove('on'));
  document.getElementById('mm-' + mode).classList.add('on');
  updateResFilterPanel();
  scheduleDraw();
}
function updateResFilterPanel(){}   // canvas-only overlay
function updateResCountsInPanel(){} // no-op
