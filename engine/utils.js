// ══════════════════════════════════════════════════════════
//  SHARED UTILITIES & TERRAIN HELPERS
// ══════════════════════════════════════════════════════════

var ri  = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
var rf  = (a,b) => Math.random()*(b-a)+a;
var fm  = n => n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(0)+'k':''+Math.round(n);
var fa  = n => Math.round(n).toLocaleString('en');
var ideol   = () => IDEOLOGIES[G.ideology];
// regsOf: all provinces where this nation is the current controller (owner)
var regsOf  = n => PROVINCES.map((_,i)=>i).filter(i=>G.owner[i]===n);
// coreOf: provinces this nation controls and has NOT been occupied by an enemy
var coreOf  = n => PROVINCES.map((_,i)=>i).filter(i=>G.owner[i]===n&&!(G.occupied&&G.occupied[i]));
var ownerName = n => n<0?'Rebels':NATIONS[n]?.short||`#${n}`;
var natColor  = n => NATIONS[n]?.color||'#181620';

function aliveNations(){
  const s=new Set();
  PROVINCES.forEach((_,i)=>{ const o=G.owner[i]; if(o>=0&&o!==G.playerNation) s.add(o); });
  return [...s];
}
function areAllies(a,b){ return G.allianceOf[a]>=0 && G.allianceOf[a]===G.allianceOf[b]; }
function atWar(a,b){ return !!(G.war[a]&&G.war[a][b]); }

// ── TERRAIN HELPERS ───────────────────────────────────────
if(typeof TERRAIN==='undefined'){
  window.TERRAIN={
    plains:  {name:'Plains',   defB:1.0, incM:1.10},
    forest:  {name:'Forest',   defB:1.20,incM:.90},
    mountain:{name:'Mountain', defB:1.50,incM:.70},
    swamp:   {name:'Swamp',    defB:1.15,incM:.80},
    desert:  {name:'Desert',   defB:.90, incM:.75},
    urban:   {name:'Urban',    defB:1.30,incM:1.40},
    tundra:  {name:'Tundra',   defB:1.10,incM:.60},
    hills:   {name:'Hills',    defB:1.30,incM:.85},
    highland:{name:'Highland', defB:1.40,incM:.75},
    steppe:  {name:'Steppe',   defB:.95, incM:.90},
    farmland:{name:'Farmland', defB:1.0, incM:1.20},
    savanna: {name:'Savanna',  defB:.85, incM:.85},
    jungle:  {name:'Jungle',   defB:1.25,incM:.80},
    coast:   {name:'Coast',    defB:.95, incM:1.05},
  };
}
if(typeof MAX_BLD_CAP==='undefined') window.MAX_BLD_CAP=4;
if(typeof MAX_BLD_NORM==='undefined') window.MAX_BLD_NORM=2;
if(typeof BUILD_TURNS==='undefined'){
  window.BUILD_TURNS={
    fort:8, factory:12, farm:6, mine:6,
    barracks:6, railroad:10, hospital:8, arsenal:10,
    fortification:8, airfield:10,
  };
}
if(typeof BUILDINGS==='undefined'){
  window.BUILDINGS={
    factory:       {name:'Factory',       icon:'🏭',desc:'Increases province income ×1.8',             cost:600},
    mine:          {name:'Mine',          icon:'⛏', desc:'Boosts coal/iron/oil resource output',       cost:350},
    barracks:      {name:'Barracks',      icon:'🪖',desc:'Conscription 25% faster & cheaper',          cost:300},
    hospital:      {name:'Hospital',      icon:'🏥',desc:'Reduces disease severity in province',        cost:350},
    arsenal:       {name:'Arsenal',       icon:'⚙️', desc:'Increases army attack strength',             cost:500},
    palace:        {name:'Palace',        icon:'🏛',desc:'Boosts satisfaction & income',               cost:600, capitalOnly:true},
    granary:       {name:'Granary',       icon:'🌽',desc:'Increases grain output & pop growth',        cost:250},
    oilwell:       {name:'Oil Well',      icon:'🛢',desc:'Produces oil resources',                     cost:350},
    fortress:      {name:'Fortress',      icon:'🏯',desc:'Heavy defense bonus ×1.6',                  cost:450},
    watchtower:    {name:'Watchtower',    icon:'🗼',desc:'Reveals exact army counts in adjacent provinces', cost:350},
  };
}

function provTerrainDef(i){
  const p=PROVINCES[i]; if(!p) return 1;
  const tm=p.terrainMap;
  if(tm){ let w=0,n=0; for(const[t,c] of Object.entries(tm)){ const d=TERRAIN[t]; if(d){w+=d.defB*c;n+=c;} } if(n) return w/n; }
  return TERRAIN[p.terrain||'plains']?.defB||1;
}
function provTerrainInc(i){
  const p=PROVINCES[i]; if(!p) return 1;
  const tm=p.terrainMap;
  if(tm){ let w=0,n=0; for(const[t,c] of Object.entries(tm)){ const d=TERRAIN[t]; if(d){w+=d.incM*c;n+=c;} } if(n) return w/n; }
  return TERRAIN[p.terrain||'plains']?.incM||1;
}
function provSize(i){ return PROVINCES[i]?.hexCount||1; }

// Resource filter overlay state
window.RES_FILTER = {coal:true, iron:true, oil:true};
