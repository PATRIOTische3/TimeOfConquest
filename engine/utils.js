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
    factory:4, fortress:3, barracks:2, arsenal:3,
    port:3, railroad:4, palace:5, hospital:2,
    mine:2, oilwell:2, granary:1, watchtower:3,
  };
}
if(typeof BUILDINGS==='undefined'){
  window.BUILDINGS={
    // ── Economy ──────────────────────────────────────────
    factory:    {name:'Factory',     icon:'🏭', desc:'Province income ×1.8',                          cost:600,  slots:1},
    mine:       {name:'Mine',        icon:'⛏',  desc:'+2 coal & +1 steel per month',                  cost:350,  slots:1},
    oilwell:    {name:'Oil Well',    icon:'🛢',  desc:'+2 oil per month',                              cost:350,  slots:1},
    granary:    {name:'Granary',     icon:'🌽',  desc:'Population growth ×1.15',                      cost:250,  slots:1},
    // ── Military ─────────────────────────────────────────
    fortress:   {name:'Fortress',    icon:'🏯',  desc:'Defense bonus ×1.6; costs 1 building slot on capture', cost:450, slots:1},
    barracks:   {name:'Barracks',    icon:'🪖',  desc:'Conscription 25% faster & cheaper',            cost:300,  slots:1},
    arsenal:    {name:'Arsenal',     icon:'⚙️',  desc:'Army attack strength +20%',                    cost:500,  slots:1},
    watchtower: {name:'Watchtower',  icon:'🗼',  desc:'Exact enemy army count in all adjacent provinces', cost:280, slots:1},
    // ── Infrastructure ───────────────────────────────────
    port:       {name:'Port',        icon:'⚓',  desc:'Enables naval transport from this province',   cost:500,  slots:1, needsCoast:true},
    railroad:   {name:'Railroad',    icon:'🚂',  desc:'Army move speed ×1.5; income +10% in province', cost:450, slots:1},
    // ── Civil ────────────────────────────────────────────
    palace:     {name:'Palace',      icon:'🏛',  desc:'Satisfaction +1-2/mo; income ×1.15',           cost:600,  slots:1, capitalOnly:true},
    hospital:   {name:'Hospital',    icon:'🏥',  desc:'Pop growth ×1.1; disease spread -25%',         cost:350,  slots:1},
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
