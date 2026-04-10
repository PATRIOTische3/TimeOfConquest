// ══════════════════════════════════════════════════════════
//  MAP RENDERER
//  HEX grid, canvas drawing, camera, province hit-testing.
// ══════════════════════════════════════════════════════════

// ── HEX RADIUS ───────────────────────────────────────────
let HEX_R = 4.75;

function computeHexRadius(){
  // In HEX_GRID mode the renderer uses HEX_GRID.hexR directly — HEX_R is only
  // used by the legacy centroid renderer.  Still compute it as a fallback, but
  // NEVER rebuild NB here: the map editor already exports the correct NB array.
  if(typeof HEX_GRID !== 'undefined' && HEX_GRID && HEX_GRID.hexes){
    HEX_R = HEX_GRID.hexR || 18;
    // Pad NB to match province count (safety only — editor export is authoritative)
    const N = PROVINCES.length;
    while(NB.length < N) NB.push([]);
    return;
  }

  if(PROVINCES.length < 2){ HEX_R = 4.75; return; }
  const N = PROVINCES.length;

  // NB already set by map file? Only rebuild if it looks empty.
  const nbAlreadySet = NB.length >= N && NB.some(a => a && a.length > 0);

  const dists = [];
  const sample = Math.min(N, 300);
  for(let i = 0; i < sample; i++){
    for(let j = i + 1; j < sample; j++){
      const dx = PROVINCES[i].cx - PROVINCES[j].cx;
      const dy = PROVINCES[i].cy - PROVINCES[j].cy;
      const d  = Math.sqrt(dx*dx + dy*dy);
      if(d > 2 && d < 80) dists.push(d);
    }
  }

  let neighborDist = 8;
  if(dists.length >= 3){
    dists.sort((a,b) => a-b);
    const range = dists[dists.length-1] - dists[0];
    const step  = range > 30 ? 1 : 0.5;
    const bins  = {};
    dists.forEach(d => { const b = Math.round(d/step)*step; bins[b] = (bins[b]||0)+1; });
    neighborDist = parseFloat(Object.entries(bins).sort((a,b) => b[1]-a[1])[0][0]);
  }
  HEX_R = (neighborDist / Math.sqrt(3)) * 0.995;

  if(!nbAlreadySet){
    const thresh  = neighborDist * 1.35;
    const thresh2 = thresh * thresh;
    for(let i = 0; i < N; i++) NB[i] = [];
    for(let i = 0; i < N; i++){
      for(let j = i+1; j < N; j++){
        const dx = PROVINCES[i].cx - PROVINCES[j].cx;
        const dy = PROVINCES[i].cy - PROVINCES[j].cy;
        if(dx*dx + dy*dy <= thresh2){ NB[i].push(j); NB[j].push(i); }
      }
    }
  }
}

// All hexes same size — no capital scaling (causes gap artifacts)
var scaledR = () => HEX_R;

// ── HEX_GRID CACHE ────────────────────────────────────────
var _hexCache        = null;
var _hexByRC         = null;
var _provBorderHexes = null;
var _provCentroid    = null;
var _seaZonePositions = null;
var _seaZoneBorderEdges = null;

function buildHexCache(){
  if(typeof HEX_GRID === 'undefined' || !HEX_GRID || !HEX_GRID.hexes){
    _hexCache = null; _hexByRC = null; _provBorderHexes = null; _provCentroid = null;
    return;
  }
  const {hexR, hexes, cols, rows} = HEX_GRID;
  const R = hexR || 18, W = Math.sqrt(3)*R, H = 2*R;

  _hexCache = hexes.map(h => ({...h, x: W*h.c + (h.r%2 ? W/2 : 0), y: H*.75*h.r, R}));

  _hexByRC = [];
  for(let r = 0; r < (rows||200); r++) _hexByRC[r] = [];
  _hexCache.forEach((h, idx) => { if(!_hexByRC[h.r]) _hexByRC[h.r] = []; _hexByRC[h.r][h.c] = idx; });

  function getNeighbours(r, c){
    const even = r%2 === 0;
    const offs  = even ? [[-1,0],[-1,1],[0,1],[1,1],[1,0],[0,-1]] : [[-1,-1],[-1,0],[0,1],[1,0],[1,-1],[0,-1]];
    const out = [];
    for(const [dr, dc] of offs){
      const nr = r+dr, nc = c+dc;
      if(nr >= 0 && nc >= 0 && _hexByRC[nr] && _hexByRC[nr][nc] !== undefined) out.push(_hexByRC[nr][nc]);
    }
    return out;
  }

  const N = PROVINCES.length;
  _provBorderHexes = Array.from({length:N}, () => []);
  _provCentroid    = Array.from({length:N}, () => ({x:0, y:0, n:0}));
  window._provBorderEdges = Array.from({length:N}, () => []);

  function hexEdgeSeg(cx, cy, r, side){
    const a0 = Math.PI/6 + Math.PI/3*side;
    const a1 = Math.PI/6 + Math.PI/3*((side+1)%6);
    return {x0: cx+Math.cos(a0)*r, y0: cy+Math.sin(a0)*r,
            x1: cx+Math.cos(a1)*r, y1: cy+Math.sin(a1)*r};
  }

  const EVEN_OFFS     = [[-1,0],[-1,1],[0,1],[1,1],[1,0],[0,-1]];
  const ODD_OFFS      = [[-1,-1],[-1,0],[0,1],[1,0],[1,-1],[0,-1]];
  // For pointy-top hex, vertex k is at angle PI/6 + k*PI/3.
  // Edge k connects vertex k → vertex (k+1)%6.
  // Direction mapping: offset index d → which side of THIS hex borders that neighbour
  // EVEN row offsets order: [NW, NE, E, SE, SW, W] → sides [5, 0, 1, 2, 3, 4]
  // ODD  row offsets order: [NW, NE, E, SE, SW, W] → sides [5, 0, 1, 2, 3, 4]
  const EVEN_DIR_SIDE = [5, 0, 1, 2, 3, 4];
  const ODD_DIR_SIDE  = [5, 0, 1, 2, 3, 4];

  _hexCache.forEach((h, idx) => {
    h.nbIdx = getNeighbours(h.r, h.c);
    if(h.sea || h.p < 0) return;
    const c = _provCentroid[h.p];
    if(c){ c.x += h.x; c.y += h.y; c.n++; }
    const offs    = h.r%2 === 0 ? EVEN_OFFS     : ODD_OFFS;
    const dirSide = h.r%2 === 0 ? EVEN_DIR_SIDE : ODD_DIR_SIDE;
    let isBorder = false;
    for(let d = 0; d < 6; d++){
      const [dr, dc] = offs[d];
      const nr = h.r+dr, nc = h.c+dc;
      const niIdx = (_hexByRC[nr] && _hexByRC[nr][nc] !== undefined) ? _hexByRC[nr][nc] : -1;
      const nb = niIdx >= 0 ? _hexCache[niIdx] : null;
      const isExternal = !nb || nb.sea || nb.p !== h.p;
      if(isExternal){
        isBorder = true;
        const side = dirSide[d];
        const isProvBorder = nb && !nb.sea && nb.p >= 0 && nb.p !== h.p;
        const seg = hexEdgeSeg(h.x, h.y, R, side);
        seg.isProvBorder = isProvBorder;
        // Store neighbour province index for nation-border detection at draw time
        seg.nbProv = (nb && !nb.sea && nb.p >= 0) ? nb.p : -1;
        if(window._provBorderEdges[h.p]) window._provBorderEdges[h.p].push(seg);
      }
    }
    h.isBorder = isBorder;
    if(isBorder && _provBorderHexes[h.p]) _provBorderHexes[h.p].push(idx);
  });

  _provCentroid = _provCentroid.map(c => c.n > 0 ? {x: c.x/c.n, y: c.y/c.n} : {x:0, y:0});

  // ── Sea zone membership + label positions ─────────────────
  // Primary: SEA_ZONES[zi].hexIds exported directly from editor (exact membership).
  // Fallback for old maps without hexIds: proximity assignment from cx/cy centroid.
  _seaZonePositions = null;
  _seaZoneBorderEdges = null;
  if(typeof SEA_ZONES !== 'undefined' && SEA_ZONES?.length){
    const zoneHexIds = SEA_ZONES.map(() => []);

    const hasExportedHexIds = SEA_ZONES.every(z => Array.isArray(z.hexIds) && z.hexIds.length > 0);

    if(hasExportedHexIds){
      // New format: hexIds in SEA_ZONES map directly to HEX_GRID.hexes indices
      // which equal _hexCache indices (same array order)
      SEA_ZONES.forEach((z, zi) => {
        z.hexIds.forEach(hi => {
          if(hi >= 0 && hi < _hexCache.length) zoneHexIds[zi].push(hi);
        });
      });
    } else {
      // Legacy fallback: assign each sea hex to nearest zone centroid.
      // Editor coords use hcx = R*√3*(c+r%2*0.5)+R (has +R origin offset).
      // Game coords have no offset, so: game_coord = editor_coord - R
      const seedX = SEA_ZONES.map(z => z.cx - R);
      const seedY = SEA_ZONES.map(z => z.cy - R);
      for(let hi = 0; hi < _hexCache.length; hi++){
        const h = _hexCache[hi];
        if(!h.sea) continue;
        let bestZ = 0, bestD = Infinity;
        for(let z = 0; z < SEA_ZONES.length; z++){
          const dx = h.x - seedX[z], dy = h.y - seedY[z];
          const d = dx*dx + dy*dy;
          if(d < bestD){ bestD = d; bestZ = z; }
        }
        zoneHexIds[bestZ].push(hi);
      }
    }

    // Precompute outer boundary edges per zone using _hexByRC (O(1) lookup, exact)
    // Neighbour offsets for pointy-top offset hex grid:
    const EVEN_NB_Z = [[-1,0],[-1,1],[0,1],[1,1],[1,0],[0,-1]];
    const ODD_NB_Z  = [[-1,-1],[-1,0],[0,1],[1,0],[1,-1],[0,-1]];

    _seaZoneBorderEdges = SEA_ZONES.map(() => []);
    zoneHexIds.forEach((ids, zi) => {
      const zSet = new Set(ids);
      for(const hi of ids){
        const h = _hexCache[hi];
        if(!h) continue;
        const nbs = h.r%2===0 ? EVEN_NB_Z : ODD_NB_Z;
        for(let d = 0; d < 6; d++){
          const [dr, dc] = nbs[d];
          const nr = h.r+dr, nc = h.c+dc;
          const niIdx = (_hexByRC[nr] && _hexByRC[nr][nc] !== undefined) ? _hexByRC[nr][nc] : -1;
          if(niIdx >= 0 && zSet.has(niIdx)) continue; // same zone — interior edge
          // Outer boundary: store as {x0,y0,x1,y1} object for viewport culling
          const a1 = Math.PI/6 + Math.PI/3*d;
          const a2 = Math.PI/6 + Math.PI/3*((d+1)%6);
          _seaZoneBorderEdges[zi].push({
            x0: h.x + Math.cos(a1)*R, y0: h.y + Math.sin(a1)*R,
            x1: h.x + Math.cos(a2)*R, y1: h.y + Math.sin(a2)*R,
          });
        }
      }
    });

    // Label position = true centroid of assigned hexes
    _seaZonePositions = SEA_ZONES.map((z, zi) => {
      const ids = zoneHexIds[zi];
      let cx, cy;
      if(ids.length){
        cx = ids.reduce((s,i) => s + _hexCache[i].x, 0) / ids.length;
        cy = ids.reduce((s,i) => s + _hexCache[i].y, 0) / ids.length;
      } else {
        // Fallback to editor centroid converted to game space
        cx = z.cx - R; cy = z.cy - R;
      }
      return {t:z.name, x:cx, y:cy, fs:z.fontSize||7, hexIds:ids};
    });
  }

  _computeMapBounds();
}

// ── TERRAIN COLORS ────────────────────────────────────────
const TC = {
  plains:'#3a4828', forest:'#2a3a1c', mountain:'#4a3e30', swamp:'#405838',
  desert:'#4a3e28', urban:'#2a2420',  tundra:'#354040',
  hills:'#4a4030',  highland:'#3e3828', steppe:'#4a4020',
  farmland:'#384820', savanna:'#4a4020', jungle:'#2a4018', coast:'#1e3040',
};
const REBEL_COLOR = '#c86820';

// ── PROVINCE COLOR ────────────────────────────────────────
function provColor(i){
  const o = G.owner[i], m = G.mapMode;

  if(m === 'disease'){
    const epId = G.provDisease?.[i];
    if(epId){ const ep = G.epidemics?.find(e => e.id===epId && e.active); if(ep) return ep.color; return '#3a2020'; }
    return '#1e2020';
  }
  if(m === 'instab'){
    if(PROVINCES[i]?.isSea) return '#0a1828';
    if(o < 0) return '#c86820';
    if(o !== G.playerNation) return '#181a1a';
    const ins = G.instab[i] || 0;
    if(ins > 70) return '#8a0808'; if(ins > 50) return '#7a2808';
    if(ins > 30) return '#5a4008'; if(ins > 10) return '#3a4820';
    return '#1a4010';
  }
  if(m === 'buildings'){
    if(PROVINCES[i]?.isSea) return '#0a1828';
    if(o < 0) return '#1a1a1a';
    const hasBld  = (G.buildings[i]||[]).length > 0;
    const hasConst = !!G.construction[i];
    if(o === G.playerNation){ if(hasBld) return '#2a4020'; if(hasConst) return '#302010'; return '#161c10'; }
    return hasBld ? '#1e1e28' : '#0e0e12';
  }
  if(m === 'terrain') return TC[PROVINCES[i].terrain] || '#2a2a2a';
  if(m === 'resources'){
    const r = G.resBase[i] || {};
    const F = window.RES_FILTER || {coal:true, iron:true, oil:true};
    const active = [];
    if(F.coal && r.coal > 0) active.push([40,40,40]);
    if(F.iron && r.iron > 0) active.push([70,90,110]);
    if(F.oil  && r.oil  > 0) active.push([130,90,20]);
    if(!active.length) return '#181618';
    const blend = active.reduce((a, c) => [a[0]+c[0], a[1]+c[1], a[2]+c[2]], [0,0,0]);
    const n = active.length;
    return `rgb(${Math.round(blend[0]/n)},${Math.round(blend[1]/n)},${Math.round(blend[2]/n)})`;
  }
  // Political
  if(o < 0){ if(PROVINCES[i]?.isSea) return '#0a1828'; return REBEL_COLOR; }

  // Occupied province — show original owner's color (occupier shown via dashed overlay)
  if(G.occupied && G.occupied[i] && G.occupied[i].originalOwner >= 0){
    const origO = G.occupied[i].originalOwner;
    return natColor(origO);
  }

  if(o === G.playerNation) return '#288820';
  if(atWar(G.playerNation, o)) return '#801818';
  if(G.pact[G.playerNation][o]) return '#706010';
  if(areAllies(G.playerNation, o)) return '#183868';
  return natColor(o);
}

// ── SEA LABELS ────────────────────────────────────────────
function getSeaLabels(){
  if(_seaZonePositions) return _seaZonePositions;
  if(typeof SEA_ZONES !== 'undefined' && SEA_ZONES?.length)
    return SEA_ZONES.map(z => ({t:z.name, x:z.cx, y:z.cy, fs:z.fontSize||7}));
  return [
    {t:'ATLANTIC',  x:40,  y:300, fs:7}, {t:'NORTH SEA', x:182, y:224, fs:7},
    {t:'NORW. SEA', x:185, y:160, fs:7}, {t:'BALTIC',    x:303, y:226, fs:7},
    {t:'MED.',      x:155, y:462, fs:7}, {t:'MED.',      x:253, y:460, fs:7},
    {t:'MED. E',    x:372, y:458, fs:7}, {t:'ADRIATIC',  x:304, y:394, fs:7},
    {t:'AEGEAN',    x:394, y:430, fs:7}, {t:'BLACK SEA', x:440, y:376, fs:7},
    {t:'CASPIAN',   x:568, y:364, fs:7}, {t:'ARCTIC',    x:360, y:72,  fs:7},
    {t:'BARENTS',   x:508, y:96,  fs:7},
  ];
}

// ── CANVAS SETUP ─────────────────────────────────────────
var canvas = document.getElementById('map-canvas');
var ctx    = canvas.getContext('2d');
var CW = 0, CH = 0;
var vp     = {scale:1, tx:0, ty:0};
var _drawPending = false;

function buildCanvas(){
  const wrap = document.getElementById('map-wrap');
  CW = wrap.clientWidth  || window.innerWidth;
  CH = wrap.clientHeight || Math.floor(window.innerHeight * .55);
  if(CW < 10 || CH < 10){ setTimeout(buildCanvas, 60); return; }
  canvas.width = CW; canvas.height = CH;
  scheduleDraw();
}

window.addEventListener('resize', () => {
  if(!document.getElementById('s-game')?.classList.contains('on')) return;
  const wrap = document.getElementById('map-wrap'); if(!wrap) return;
  CW = wrap.clientWidth  || window.innerWidth;
  CH = wrap.clientHeight || Math.floor(window.innerHeight * .55);
  if(CW < 10 || CH < 10) return;
  canvas.width = CW; canvas.height = CH;
  scheduleDraw();
});

function scheduleDraw(){
  if(_drawPending) return;
  _drawPending = true;
  requestAnimationFrame(() => {
    _drawPending = false;
    drawMap();
    if(G.sel >= 0 || G.moveMode || G.navalMode || _atkSelectMode) scheduleDraw();
    if(G.mapMode === 'instab' && window._instabAnimY){
      if(Object.values(window._instabAnimY).some(v => v !== undefined && Math.abs(v) < 5)) scheduleDraw();
    }
  });
}

// ── HEX MATH ─────────────────────────────────────────────
function toScreen(cx, cy){ return [cx*vp.scale + vp.tx, cy*vp.scale + vp.ty]; }
function toWorld(sx, sy){ return [(sx - vp.tx)/vp.scale, (sy - vp.ty)/vp.scale]; }

function hexPath(ctx2, cx, cy, r){
  ctx2.beginPath();
  for(let i = 0; i < 6; i++){
    const a = Math.PI/6 + Math.PI/3*i;
    const x = cx + Math.cos(a)*r, y = cy + Math.sin(a)*r;
    i === 0 ? ctx2.moveTo(x, y) : ctx2.lineTo(x, y);
  }
  ctx2.closePath();
}

// ── FOG OF WAR ────────────────────────────────────────────
function canSeeArmy(i){
  const o = G.owner[i];
  if(o === G.playerNation) return true;
  if(areAllies(G.playerNation, o)) return true;
  if(G.puppet.includes(o)) return true;
  const ownNbs = NB[i]?.filter(nb => G.owner[nb] === G.playerNation) || [];
  if(ownNbs.some(nb => (G.buildings[nb]||[]).includes('fortress'))) return true;
  return false;
}

// ── MAP BOUNDS ────────────────────────────────────────────
var _mapBounds = {minX:0, maxX:100, minY:0, maxY:100};

function _computeMapBounds(){
  if(_hexCache && _hexCache.length){
    const R = HEX_GRID.hexR;
    let mnX=Infinity, mxX=-Infinity, mnY=Infinity, mxY=-Infinity;
    for(const h of _hexCache){ mnX=Math.min(mnX,h.x); mxX=Math.max(mxX,h.x); mnY=Math.min(mnY,h.y); mxY=Math.max(mxY,h.y); }
    _mapBounds = {minX:mnX-R*2, maxX:mxX+R*2, minY:mnY-R*2, maxY:mxY+R*2};
    return;
  }
  if(!PROVINCES.length) return;
  let mnX=Infinity, mxX=-Infinity, mnY=Infinity, mxY=-Infinity;
  for(const p of PROVINCES){ mnX=Math.min(mnX,p.cx); mxX=Math.max(mxX,p.cx); mnY=Math.min(mnY,p.cy); mxY=Math.max(mxY,p.cy); }
  _mapBounds = {minX:mnX-30, maxX:mxX+30, minY:mnY-30, maxY:mxY+30};
}

function clampViewport(){
  const {minX, maxX, minY, maxY} = _mapBounds;
  const margin = Math.min(CW, CH) * 0.15;
  vp.tx = Math.max(CW-margin-maxX*vp.scale, Math.min(margin-minX*vp.scale, vp.tx));
  vp.ty = Math.max(CH-margin-maxY*vp.scale, Math.min(margin-minY*vp.scale, vp.ty));
}

function zoomBy(f, cx, cy){
  if(cx === undefined){ cx = CW/2; cy = CH/2; }
  const ns = Math.max(.18, Math.min(9, vp.scale*f)), r = ns/vp.scale;
  vp.tx = cx - (cx - vp.tx)*r; vp.ty = cy - (cy - vp.ty)*r; vp.scale = ns;
  clampViewport(); scheduleDraw();
}

function zoomReset(){
  if(_hexCache && _hexCache.length){
    const R = HEX_GRID.hexR;
    let mnX=Infinity, mxX=-Infinity, mnY=Infinity, mxY=-Infinity;
    for(const h of _hexCache){ mnX=Math.min(mnX,h.x); mxX=Math.max(mxX,h.x); mnY=Math.min(mnY,h.y); mxY=Math.max(mxY,h.y); }
    const minX=mnX-R*2, maxX=mxX+R*2, minY=mnY-R*2, maxY=mxY+R*2;
    const s = Math.min(CW/(maxX-minX), CH/(maxY-minY)) * 0.92;
    vp.scale = s; vp.tx = (CW-(maxX-minX)*s)/2 - minX*s; vp.ty = (CH-(maxY-minY)*s)/2 - minY*s;
    _computeMapBounds(); scheduleDraw(); return;
  }
  if(!PROVINCES.length){ vp.scale=1; vp.tx=0; vp.ty=0; scheduleDraw(); return; }
  let mnX=Infinity, mxX=-Infinity, mnY=Infinity, mxY=-Infinity;
  for(const p of PROVINCES){ mnX=Math.min(mnX,p.cx); mxX=Math.max(mxX,p.cx); mnY=Math.min(mnY,p.cy); mxY=Math.max(mxY,p.cy); }
  const minX=mnX-25, maxX=mxX+25, minY=mnY-25, maxY=mxY+25;
  const s = Math.min(CW/(maxX-minX), CH/(maxY-minY)) * 0.88;
  vp.scale = s; vp.tx = (CW-(maxX-minX)*s)/2 - minX*s; vp.ty = (CH-(maxY-minY)*s)/2 - minY*s;
  _computeMapBounds(); scheduleDraw();
}

// ── HIT TESTING ───────────────────────────────────────────
function hitProv(wx, wy){
  if(_hexCache && _hexCache.length){
    const R = HEX_GRID.hexR, W2 = Math.sqrt(3)*R, H2 = 2*R;
    const approxRow = Math.round(wy / (H2*.75));
    const startRow  = Math.max(0, approxRow-2);
    const endRow    = Math.min((_hexByRC?.length||0)-1, approxRow+2);
    let best = -1, bestD = Infinity;
    for(let r = startRow; r <= endRow; r++){
      if(!_hexByRC[r]) continue;
      const offset    = r%2 ? W2/2 : 0;
      const approxCol = Math.round((wx - offset) / W2);
      for(let c = Math.max(0, approxCol-2); c <= approxCol+2; c++){
        const idx = _hexByRC[r][c];
        if(idx === undefined) continue;
        const h = _hexCache[idx];
        if(h.sea || h.p < 0) continue;
        const dx = wx-h.x, dy = wy-h.y, d = dx*dx + dy*dy;
        if(d < R*R*1.8 && d < bestD){ bestD = d; best = h.p; }
      }
    }
    return best;
  }
  let best = -1, bestDist = Infinity;
  const threshold = HEX_R * HEX_R * 4;
  PROVINCES.forEach((p, i) => {
    const dx = wx-p.cx, dy = wy-p.cy, d = dx*dx + dy*dy;
    if(d < threshold && d < bestDist){ bestDist = d; best = i; }
  });
  return best;
}

function provScreenPos(i){
  if(_provCentroid && _provCentroid[i] && _provCentroid[i].x)
    return toScreen(_provCentroid[i].x, _provCentroid[i].y);
  return toScreen(PROVINCES[i].cx, PROVINCES[i].cy);
}

// ── SMOOTH PAN ────────────────────────────────────────────
var _panAnim = null;
function panToProvince(i){
  const p = PROVINCES[i]; if(!p) return;
  const wx = _provCentroid ? _provCentroid[i]?.x ?? p.cx : p.cx;
  const wy = _provCentroid ? _provCentroid[i]?.y ?? p.cy : p.cy;
  const [sx, sy] = toScreen(wx, wy);
  const padX = CW*.25, padY = CH*.25;
  if(sx >= padX && sx <= CW-padX && sy >= padY && sy <= CH-padY) return;
  const targetTx = CW/2 - wx*vp.scale;
  const targetTy = CH/2 - wy*vp.scale;
  const {minX, maxX, minY, maxY} = _mapBounds;
  const margin = Math.min(CW, CH) * .15;
  const clampedTx = Math.max(CW-margin-maxX*vp.scale, Math.min(margin-minX*vp.scale, targetTx));
  const clampedTy = Math.max(CH-margin-maxY*vp.scale, Math.min(margin-minY*vp.scale, targetTy));
  if(_panAnim) cancelAnimationFrame(_panAnim);
  const startTx = vp.tx, startTy = vp.ty;
  const dur = 320, start = performance.now();
  function step(now){
    const t    = Math.min(1, (now-start)/dur);
    const ease = 1 - Math.pow(1-t, 3);
    vp.tx = startTx + (clampedTx-startTx)*ease;
    vp.ty = startTy + (clampedTy-startTy)*ease;
    scheduleDraw();
    if(t < 1) _panAnim = requestAnimationFrame(step); else _panAnim = null;
  }
  _panAnim = requestAnimationFrame(step);
}

// ── POINTER EVENTS ────────────────────────────────────────
var _pan      = {active:false, lx:0, ly:0};
var _pinch    = {active:false, dist:0};
var _tapStart = {x:0, y:0, t:0};
var _moved    = false;
var _touches  = {};
var wrap      = document.getElementById('map-wrap');

canvas.addEventListener('mousedown', e => {
  if(e.button === 1 || (e.button === 0 && e.ctrlKey)) e.preventDefault();
  _pan.active = true; _pan.lx = e.clientX; _pan.ly = e.clientY; _moved = false;
  _tapStart = {x:e.clientX, y:e.clientY, t:Date.now()};
  wrap.style.cursor = 'grabbing';
  hideProvPopup();
});
window.addEventListener('mousemove', e => {
  if(_pan.active){
    const dx = e.clientX - _pan.lx, dy = e.clientY - _pan.ly;
    if(Math.abs(dx) > 3 || Math.abs(dy) > 3){ _moved = true; hideProvPopup(); }
    vp.tx += dx; vp.ty += dy; _pan.lx = e.clientX; _pan.ly = e.clientY;
    clampViewport(); scheduleDraw(); return;
  }
  if(G.mapMode === 'resources' && window._resOverlayHitRects && e.target === canvas){
    const r = canvas.getBoundingClientRect();
    const hit = window._resOverlayHitRects.find(h => e.clientX-r.left >= h.x && e.clientX-r.left <= h.x+h.w && e.clientY-r.top >= h.y && e.clientY-r.top <= h.y+h.h);
    canvas.style.cursor = hit ? 'pointer' : '';
  } else { canvas.style.cursor = ''; }
});
window.addEventListener('mouseup', e => {
  if(!_pan.active) return;
  _pan.active = false; wrap.style.cursor = '';
  if(!_moved && Date.now()-_tapStart.t < 400 && e.target === canvas){
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX-r.left, sy = e.clientY-r.top;
    if(G.mapMode === 'resources' && window._resOverlayHitRects){
      const hit = window._resOverlayHitRects.find(h => sx>=h.x && sx<=h.x+h.w && sy>=h.y && sy<=h.y+h.h);
      if(hit){ window.RES_FILTER[hit.k] = !window.RES_FILTER[hit.k]; scheduleDraw(); return; }
    }
    const [wx, wy] = toWorld(sx, sy);
    onCanvasClick(wx, wy);
  }
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  zoomBy(e.deltaY < 0 ? 1.12 : 1/1.12, e.clientX-r.left, e.clientY-r.top);
}, {passive:false});

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  for(const t of e.changedTouches) _touches[t.identifier] = {x:t.clientX, y:t.clientY};
  if(e.touches.length === 1){
    _pan.active = true; _pan.lx = e.touches[0].clientX; _pan.ly = e.touches[0].clientY;
    _moved = false; _tapStart = {x:_pan.lx, y:_pan.ly, t:Date.now()};
  }
  if(e.touches.length === 2){
    _pan.active = false;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    _pinch = {active:true, dist:Math.hypot(dx, dy)};
  }
}, {passive:false});
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if(e.touches.length === 1 && _pan.active){
    const t = e.touches[0];
    const dx = t.clientX-_pan.lx, dy = t.clientY-_pan.ly;
    if(Math.abs(dx) > 2 || Math.abs(dy) > 2){ _moved = true; hideProvPopup(); }
    vp.tx += dx; vp.ty += dy; _pan.lx = t.clientX; _pan.ly = t.clientY;
    clampViewport(); scheduleDraw();
  } else if(e.touches.length === 2 && _pinch.active){
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const nd = Math.hypot(dx, dy);
    const r  = canvas.getBoundingClientRect();
    const cx = (e.touches[0].clientX+e.touches[1].clientX)/2 - r.left;
    const cy = (e.touches[0].clientY+e.touches[1].clientY)/2 - r.top;
    if(_pinch.dist > 0) zoomBy(nd/_pinch.dist, cx, cy);
    _pinch.dist = nd;
  }
}, {passive:false});
canvas.addEventListener('touchend', e => {
  e.preventDefault();
  for(const t of e.changedTouches) delete _touches[t.identifier];
  if(e.touches.length === 0){
    _pinch.active = false;
    if(!_moved && _pan.active && Date.now()-_tapStart.t < 400){
      const r  = canvas.getBoundingClientRect();
      const sx = _tapStart.x - r.left, sy = _tapStart.y - r.top;
      if(G.mapMode === 'resources' && window._resOverlayHitRects){
        const hit = window._resOverlayHitRects.find(h => sx>=h.x && sx<=h.x+h.w && sy>=h.y && sy<=h.y+h.h);
        if(hit){ window.RES_FILTER[hit.k] = !window.RES_FILTER[hit.k]; _pan.active=false; scheduleDraw(); return; }
      }
      const [wx, wy] = toWorld(sx, sy);
      onCanvasClick(wx, wy);
    }
    _pan.active = false;
  }
  if(e.touches.length === 1){ _pan.active=true; _pan.lx=e.touches[0].clientX; _pan.ly=e.touches[0].clientY; }
}, {passive:false});

// ── DRAW MAP (main) ───────────────────────────────────────
// (Full drawMap function preserved from game.js — no logic changes)
// ── MAIN DRAW ─────────────────────────────────────────────
function drawMap(){
  if(!ctx||!CW)return;

  // ── Global optimisation: skip redundant redraws ────────
  // Build a cheap state key; if it matches last frame, bail out
  // (only works when nothing animates — pulse/instab animation always differs)
  const _isAnimating = G.sel>=0||G.moveMode||G.navalMode||_atkSelectMode
    ||(G.mapMode==='instab'&&window._instabAnimY&&Object.keys(window._instabAnimY).length);
  if(!_isAnimating){
    const _dk=`${vp.scale.toFixed(4)},${vp.tx.toFixed(1)},${vp.ty.toFixed(1)},${G.mapMode},${G.tick},${G.sel}`;
    if(_dk===window._lastDrawKey){ return; }
    window._lastDrawKey=_dk;
  } else {
    window._lastDrawKey=null;
  }

  ctx.clearRect(0,0,CW,CH);

  // Ocean background
  const grad=ctx.createLinearGradient(0,0,0,CH);
  grad.addColorStop(0,'#08162a');grad.addColorStop(1,'#0c1e38');
  ctx.fillStyle=grad;ctx.fillRect(0,0,CW,CH);

  // Grid overlay (subtle)
  ctx.strokeStyle='rgba(50,110,190,.045)';ctx.lineWidth=.5;
  const gs=40*vp.scale;
  const ox=((vp.tx%gs)+gs)%gs,oy=((vp.ty%gs)+gs)%gs;
  for(let x=ox;x<CW;x+=gs){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,CH);ctx.stroke();}
  for(let y=oy;y<CH;y+=gs){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(CW,y);ctx.stroke();}

  // Clip to visible bounds for performance
  const [wx0,wy0]=toWorld(0,0),[wx1,wy1]=toWorld(CW,CH);

  ctx.save();
  ctx.translate(vp.tx,vp.ty);ctx.scale(vp.scale,vp.scale);

  // ── Sea zone borders + labels ────────────────────────────
  // Labels fade out when zoomed out (< 0.35 scale = too small to read)
  // Borders fade out below 0.25 scale
  const seaLabelAlpha = Math.min(1, Math.max(0, (vp.scale - 0.20) / 0.15));
  const seaBorderAlpha = Math.min(1, Math.max(0, (vp.scale - 0.15) / 0.10));

  if(_hexCache&&_hexCache.length&&_seaZonePositions&&seaBorderAlpha>0){
    _seaZonePositions.forEach((z,zi)=>{
      const edges = _seaZoneBorderEdges&&_seaZoneBorderEdges[zi];
      if(edges&&edges.length){
        // Check if this zone contains the selected province (for gold highlight)
        const isSelected = G.sel>=0 && z.hexIds && z.hexIds.length>0 &&
          _hexCache[z.hexIds[0]]?.p === G.sel;
        // Regular border: blue-ish; selected: gold
        const borderColor = isSelected
          ? `rgba(201,168,76,${(0.90*seaBorderAlpha).toFixed(2)})`
          : `rgba(60,140,220,${(0.55*seaBorderAlpha).toFixed(2)})`;
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = isSelected ? 2.2/vp.scale : 1.4/vp.scale;
        ctx.lineJoin='round'; ctx.lineCap='round';
        ctx.beginPath();
        for(const e of edges){
          if(e.x0<wx0-50&&e.x1<wx0-50) continue;
          if(e.x0>wx1+50&&e.x1>wx1+50) continue;
          ctx.moveTo(e.x0,e.y0); ctx.lineTo(e.x1,e.y1);
        }
        ctx.stroke();
      }

      // Label — spaced italic, fades at low zoom
      if(seaLabelAlpha<=0) return;
      if(z.x<wx0-80||z.x>wx1+80||z.y<wy0-40||z.y>wy1+40) return;
      const fs=Math.max(5,Math.min(z.fs||7,28));
      ctx.font=`italic ${fs}px Cinzel,serif`;
      ctx.fillStyle=`rgba(65,135,200,${(0.55*seaLabelAlpha).toFixed(2)})`;
      ctx.shadowColor='rgba(0,0,0,.85)'; ctx.shadowBlur=4/vp.scale;
      ctx.textAlign='left'; ctx.textBaseline='middle';
      const name=z.t||'';
      const spacing=fs*0.28;
      const widths=name.split('').map(ch=>ctx.measureText(ch).width+spacing);
      const totalW=widths.reduce((s,w)=>s+w,0)-spacing;
      let lx=z.x-totalW/2;
      for(let li=0;li<name.length;li++){
        ctx.fillText(name[li],lx,z.y); lx+=widths[li];
      }
      ctx.shadowBlur=0;
    });
  } else if(!_seaZonePositions){
    // Fallback: no HEX_GRID
    ctx.textAlign='center'; ctx.textBaseline='middle';
    getSeaLabels().forEach(sl=>{
      if(sl.x<wx0-40||sl.x>wx1+40||sl.y<wy0-20||sl.y>wy1+20) return;
      ctx.font=`italic ${Math.max(5,Math.min(sl.fs||7,24))}px Cinzel,serif`;
      ctx.fillStyle='rgba(100,170,230,.65)';
      ctx.fillText(sl.t,sl.x,sl.y);
    });
  }

  // ── HEX_GRID mode ─────────────────────────────────────────
  if(_hexCache&&_hexCache.length){
    const R=HEX_GRID.hexR,pad=R*3;

    // LOD: at very low zoom, hexes are < 2px — skip individual fills,
    // just paint solid nation-color rectangles (massive perf gain on mobile)
    const hexScreenR = R * vp.scale;
    const useLOD = hexScreenR < 2.5; // each hex < 2.5px on screen

    if(useLOD){
      // Low zoom: draw one solid rect per province using bounding box
      // No borders, no terrain — just nation color blobs
      for(let pi = 0; pi < PROVINCES.length; pi++){
        const c = _provCentroid[pi];
        if(!c || !c.x) continue;
        if(c.x < wx0-pad*2||c.x > wx1+pad*2) continue;
        const col = provColor(pi);
        const approxR = PROVINCES[pi].hexCount ? Math.sqrt(PROVINCES[pi].hexCount) * R * 1.1 : R*2;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(c.x, c.y, approxR, 0, Math.PI*2);
        ctx.fill();
      }
    } else {

    // PASS 1: Unowned land (sea=0, p=-1) — terrain color at 50% opacity
    ctx.globalAlpha=0.5;
    for(const h of _hexCache){
      if(h.sea||h.p>=0)continue;
      if(h.x<wx0-pad||h.x>wx1+pad||h.y<wy0-pad||h.y>wy1+pad)continue;
      hexPath(ctx,h.x,h.y,R+0.3/vp.scale);
      ctx.fillStyle=TC[h.t]||'#3a3828';
      ctx.fill();
    }
    ctx.globalAlpha=1.0;

    // PASS 2: Province hexes — base color
    for(const h of _hexCache){
      if(h.sea||h.p<0)continue;
      if(h.x<wx0-pad||h.x>wx1+pad||h.y<wy0-pad||h.y>wy1+pad)continue;
      hexPath(ctx,h.x,h.y,R+0.3/vp.scale);
      ctx.fillStyle=provColor(h.p);
      ctx.fill();
    }

    // PASS 2B: Occupation overlay — dashed border of occupier color on occupied provinces
    if(G.occupied && Object.keys(G.occupied).length > 0 && !useLOD){
      const occAlpha = Math.min(1, Math.max(0, (vp.scale - 0.18) / 0.12));
      if(occAlpha > 0){
        for(const [pidxStr, occ] of Object.entries(G.occupied)){
          const pi = +pidxStr;
          if(!occ || occ.by < 0) continue;
          const occupierColor = natColor(occ.by);
          // Draw dashed outline on all hexes of this province
          ctx.save();
          ctx.strokeStyle = occupierColor;
          ctx.lineWidth = 1.6/vp.scale;
          ctx.setLineDash([3/vp.scale, 2/vp.scale]);
          ctx.globalAlpha = 0.75 * occAlpha;
          ctx.lineJoin = 'round';
          const edges = window._provBorderEdges && window._provBorderEdges[pi];
          if(edges && edges.length){
            ctx.beginPath();
            for(const e of edges){
              if(e.x0<wx0-pad&&e.x1<wx0-pad)continue;
              if(e.x0>wx1+pad&&e.x1>wx1+pad)continue;
              ctx.moveTo(e.x0,e.y0); ctx.lineTo(e.x1,e.y1);
            }
            ctx.stroke();
          } else {
            // Fallback — outline each hex individually
            for(const h of _hexCache){
              if(h.sea||h.p!==pi)continue;
              if(h.x<wx0-pad||h.x>wx1+pad||h.y<wy0-pad||h.y>wy1+pad)continue;
              hexPath(ctx,h.x,h.y,R*0.9);
              ctx.stroke();
            }
          }
          ctx.restore();
        }
      }
    }

    // PASS 3: Subtle terrain tint on political map
    if(G.mapMode==='political' && hexScreenR > 4){
      const TC2={plains:'#7a8c5a',forest:'#3a6040',mountain:'#8a7a6a',hills:'#7a6a50',
        desert:'#c8a860',jungle:'#2a7040',steppe:'#9aaa60',farmland:'#9aaa50',
        highland:'#8a7060',tundra:'#8aA0a8',swamp:'#4a7050',savanna:'#b0963c',
        marsh:'#5a7855',urban:'#8a8070',coast:'#5a7890'};
      ctx.globalAlpha=0.12;
      for(const h of _hexCache){
        if(h.sea||h.p<0)continue;
        if(h.x<wx0-pad||h.x>wx1+pad||h.y<wy0-pad||h.y>wy1+pad)continue;
        hexPath(ctx,h.x,h.y,R+0.3/vp.scale);
        ctx.fillStyle=TC2[h.t]||'#7a8a60';
        ctx.fill();
      }
      ctx.globalAlpha=1.0;
    }

    } // end normal zoom branch

    // Province borders fade at low zoom for performance + readability
    const provBorderAlpha = useLOD ? 0 : Math.min(1, Math.max(0, (vp.scale - 0.18) / 0.12));

    if(provBorderAlpha > 0){
      // PASS 4A: Province inner borders — thin black line between different provinces
      ctx.strokeStyle = `rgba(0,0,0,${(0.65*provBorderAlpha).toFixed(2)})`;
      ctx.lineWidth = 1.0/vp.scale;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      for(let pi=0; pi<PROVINCES.length; pi++){
        const edges = window._provBorderEdges && window._provBorderEdges[pi];
        if(!edges) continue;
        for(const e of edges){
          if(!e.isProvBorder) continue;
          if(e.x0<wx0-pad&&e.x1<wx0-pad) continue;
          if(e.x0>wx1+pad&&e.x1>wx1+pad) continue;
          ctx.moveTo(e.x0,e.y0); ctx.lineTo(e.x1,e.y1);
        }
      }
      ctx.stroke();

      // PASS 4B: Nation borders — slightly thicker/brighter on political map
      if(G.mapMode==='political'){
        ctx.strokeStyle = `rgba(0,0,0,${(0.88*provBorderAlpha).toFixed(2)})`;
        ctx.lineWidth = 1.8/vp.scale;
        ctx.beginPath();
        for(let pi=0; pi<PROVINCES.length; pi++){
          const oA = G.owner[pi];
          const edges = window._provBorderEdges && window._provBorderEdges[pi];
          if(!edges) continue;
          for(const e of edges){
            if(!e.isProvBorder) continue;
            const oB = e.nbProv>=0 ? G.owner[e.nbProv] : -1;
            if(oB<0 || oA===oB) continue;
            if(e.x0<wx0-pad&&e.x1<wx0-pad) continue;
            if(e.x0>wx1+pad&&e.x1>wx1+pad) continue;
            ctx.moveTo(e.x0,e.y0); ctx.lineTo(e.x1,e.y1);
          }
        }
        ctx.stroke();
      }
    }

    // PASS 5: Selected province — pulsing white fill + gold border outline
    if(G.sel>=0){
      const pulse=0.18+0.12*Math.sin(Date.now()/220);
      const pulseBorder=0.7+0.3*Math.sin(Date.now()/220);
      // White fill pulse
      for(const h of _hexCache){
        if(h.sea||h.p!==G.sel)continue;
        if(h.x<wx0-pad||h.x>wx1+pad||h.y<wy0-pad||h.y>wy1+pad)continue;
        hexPath(ctx,h.x,h.y,R+0.3/vp.scale);
        ctx.fillStyle=`rgba(255,255,255,${pulse})`;
        ctx.fill();
      }
      // Gold border on outer edges of selected province
      const selEdges = window._provBorderEdges && window._provBorderEdges[G.sel];
      if(selEdges){
        ctx.strokeStyle=`rgba(201,168,76,${pulseBorder.toFixed(2)})`;
        ctx.lineWidth=2.0/vp.scale;
        ctx.lineJoin='round'; ctx.lineCap='round';
        ctx.beginPath();
        for(const e of selEdges){
          if(e.x0<wx0-pad&&e.x1<wx0-pad)continue;
          if(e.x0>wx1+pad&&e.x1>wx1+pad)continue;
          ctx.moveTo(e.x0,e.y0); ctx.lineTo(e.x1,e.y1);
        }
        ctx.stroke();
      }
    }

    // PASS 6: Move/attack/naval targets — colored pulse overlay
    const isMov=G.moveMode&&G.moveFrom>=0;
    const isNav=G.navalMode&&G.navalFrom>=0;
    if(isMov||isNav||_atkSelectMode){
      const pulse2=0.15+0.1*Math.sin(Date.now()/180);
      for(let pi=0;pi<PROVINCES.length;pi++){
        let col=null;
        if(isMov&&isMoveTgt(pi)) col=`rgba(80,255,80,${pulse2})`;
        else if(_atkSelectMode&&isAtkSrc(pi)) col=`rgba(255,80,80,${pulse2})`;
        else if(isNav&&navalDests(G.navalFrom).includes(pi)) col=`rgba(80,200,255,${pulse2})`;
        if(!col)continue;
        for(const h of _hexCache){
          if(h.sea||h.p!==pi)continue;
          if(h.x<wx0-pad||h.x>wx1+pad||h.y<wy0-pad||h.y>wy1+pad)continue;
          hexPath(ctx,h.x,h.y,R+0.3/vp.scale);
          ctx.fillStyle=col;
          ctx.fill();
        }
      }
    }

  }else{
  // ── Centroid mode (old map, no HEX_GRID) ─────────────────
  PROVINCES.forEach((p,i)=>{
    if(p.cx<wx0-30||p.cx>wx1+30||p.cy<wy0-30||p.cy>wy1+30)return;
    const r=scaledR(i);
    hexPath(ctx,p.cx,p.cy,r+0.4/vp.scale);
    ctx.fillStyle=provColor(i);ctx.fill();
  });
  // Borders between different owners only
  PROVINCES.forEach((p,i)=>{
    if(p.cx<wx0-30||p.cx>wx1+30||p.cy<wy0-30||p.cy>wy1+30)return;
    const r=scaledR(i);
    const o=G.owner[i];
    const hasBorder=(NB[i]||[]).some(nb=>G.owner[nb]!==o);
    if(hasBorder){hexPath(ctx,p.cx,p.cy,r);ctx.strokeStyle='rgba(0,0,0,.5)';ctx.lineWidth=.6/vp.scale;ctx.stroke();}
    // Selection pulse
    if(i===G.sel){
      const pulse=0.18+0.12*Math.sin(Date.now()/220);
      hexPath(ctx,p.cx,p.cy,r);ctx.fillStyle=`rgba(255,255,255,${pulse})`;ctx.fill();
    }
  });
  } // end centroid mode

  // ── Labels (both modes) — fade in above 0.45 scale ─────────
  const labelAlpha=Math.min(1,Math.max(0,(vp.scale-0.35)/0.15));
  if(labelAlpha>0){
    PROVINCES.forEach((p,i)=>{
      // Use precomputed hex centroid for HEX_GRID mode
      const hpos=_provCentroid&&_provCentroid[i]&&_provCentroid[i].x?_provCentroid[i]:null;
      const px=hpos?hpos.x:p.cx, py=hpos?hpos.y:p.cy;
      if(px<wx0-25||px>wx1+25||py<wy0-25||py>wy1+25)return;
      const labelR=_hexCache?HEX_GRID.hexR:scaledR(i);
      const fs=Math.max(3,Math.min(7,labelR*.42));

      // ── Unified label layout ──────────────────────────────
      // name (shifted up when army present) → army (below name) → draft (slides right from army)
      const hasName = p.isCapital || (i===G.sel && vp.scale>0.7);
      const hasArmy = G.army[i]>0 && vp.scale>1.0 && canSeeArmy(i) &&
                      G.mapMode!=='instab' && G.mapMode!=='disease' && G.mapMode!=='buildings';
      const _draftEntry = (G.draftQueue||[]).find(d=>d.prov===i&&d.nation===G.playerNation);
      const hasDraft = !!_draftEntry && G.mapMode==='political' && vp.scale>1.0;

      // Name: shift up if army will be shown below it
      const nameUpOff = (hasArmy && hasName) ? fs*0.9 : 0;
      // Army: centered, or below name
      const armyOffY  = hasName ? fs*1.0 : 0;

      // Province name
      if(p.isCapital){
        ctx.font=`700 ${fs+1}px Cinzel,serif`;
        ctx.fillStyle='#f0d080';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.shadowColor='rgba(0,0,0,.95)';ctx.shadowBlur=4;
        ctx.fillText(p.short.length>10?p.short.slice(0,10):p.short, px, py-nameUpOff);
        ctx.shadowBlur=0;
      } else if(i===G.sel&&vp.scale>0.7){
        const nameStr=(p.name||p.short||'').slice(0,14);
        ctx.font=`600 ${fs+0.5}px Cinzel,serif`;
        ctx.fillStyle='rgba(240,210,120,.95)';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.shadowColor='rgba(0,0,0,.98)';ctx.shadowBlur=5;
        ctx.fillText(nameStr, px, py-nameUpOff);
        ctx.shadowBlur=0;
      }

      if(G.owner[i]<0&&!PROVINCES[i]?.isSea&&vp.scale>0.8&&G.mapMode==='political'){
        ctx.font=`bold ${Math.max(4,fs)}px Cinzel,serif`;ctx.fillStyle='rgba(220,130,50,.95)';
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='rgba(0,0,0,.95)';ctx.shadowBlur=3;
        ctx.fillText('REBELS',px,py);ctx.shadowBlur=0;
      }

      if(G.mapMode==='instab'&&G.owner[i]===G.playerNation&&vp.scale>0.9){
        const sat=Math.round(G.satisfaction[i]||70),ins=G.instab[i]||0;
        ctx.font=`bold ${Math.max(4,fs)}px Cinzel,serif`;
        ctx.fillStyle=ins>70?'#ff8060':ins>40?'#ffcc60':ins>15?'#c0e860':'#80ff80';
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='rgba(0,0,0,.95)';ctx.shadowBlur=3;
        const targetOffY=hasName?fs*1.55:0;
        if(!window._instabAnimY) window._instabAnimY={};
        if(window._instabAnimY[i]===undefined) window._instabAnimY[i]=0;
        const cur=window._instabAnimY[i];
        window._instabAnimY[i]=cur+(targetOffY-cur)*0.2;
        ctx.fillText(sat+'%',px,py+window._instabAnimY[i]);ctx.shadowBlur=0;
      }

      // Army count — below name if name shown
      if(hasArmy){
        ctx.font=`${Math.max(3.5,fs-1.5)}px Cinzel,serif`;
        ctx.fillStyle='rgba(232,205,145,.85)';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=2;
        ctx.fillText(fm(G.army[i]), px, py+armyOffY);
        ctx.shadowBlur=0;
      }

      // Draft label — slides RIGHT from army position with fog-of-war gradient
      if(hasDraft){
        if(!window._draftAnimX) window._draftAnimX={};
        if(window._draftAnimX[i]===undefined) window._draftAnimX[i]=0;
        const targetDX = fs*2.6;
        window._draftAnimX[i] = window._draftAnimX[i]*0.70 + targetDX*0.30;
        const draftX = px + window._draftAnimX[i];
        const draftY = py + armyOffY;
        const draftStr = '+'+fm(_draftEntry.amount);
        ctx.font=`${Math.max(3.5,fs-1.5)}px Cinzel,serif`;
        ctx.textAlign='center';ctx.textBaseline='middle';
        // Fog gradient: transparent near army, solid green at destination
        const measW = ctx.measureText(draftStr).width;
        const g=ctx.createLinearGradient(px+fs*0.5, 0, draftX+measW*0.5, 0);
        g.addColorStop(0,'rgba(114,243,114,0)');
        g.addColorStop(0.5,'rgba(114,243,114,0.6)');
        g.addColorStop(1,'rgba(114,243,114,1)');
        ctx.fillStyle=g;
        ctx.shadowColor='rgba(0,0,0,.95)';ctx.shadowBlur=2;
        ctx.fillText(draftStr, draftX, draftY);
        ctx.shadowBlur=0;
        scheduleDraw();
      } else if(window._draftAnimX && window._draftAnimX[i]!==undefined){
        delete window._draftAnimX[i];
      }

      if(p.isCapital){
        ctx.font=`${fs+3}px serif`;ctx.fillStyle='#f0d080';ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=2;
        ctx.fillText('★',px+labelR*.62,py-labelR*.55);ctx.shadowBlur=0;
      }

      if(G.mapMode==='buildings'&&G.buildings[i]?.length){
        const bldR=labelR*0.82,total=G.buildings[i].length;
        G.buildings[i].forEach((k,bi)=>{
          const bDef=BUILDINGS[k];if(!bDef)return;
          const bx=px-(total-1)*fs*0.65+bi*fs*1.3,by=py+bldR*0.55;
          ctx.fillStyle='rgba(0,0,0,0.7)';ctx.beginPath();ctx.arc(bx,by,fs*0.72,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle='rgba(201,168,76,0.5)';ctx.lineWidth=0.8/vp.scale;ctx.stroke();
          ctx.font=`${Math.max(fs*1.1,5)}px serif`;ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillText(bDef.icon||'?',bx,by);
        });
      }
      if(G.mapMode==='buildings'&&G.construction[i]){
        const c=G.construction[i],prog=Math.round((c.totalTurns-c.turnsLeft)/c.totalTurns*100);
        ctx.font=`${Math.max(4,fs-1)}px Cinzel,serif`;ctx.fillStyle='rgba(201,168,76,0.9)';
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.shadowColor='rgba(0,0,0,.95)';ctx.shadowBlur=2;
        ctx.fillText('🏗'+prog+'%',px,py);ctx.shadowBlur=0;
      }
      if(G.mapMode==='political'&&G.resistance[i]>30){
        ctx.font=`${fs+1}px serif`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText('🔥',px+labelR*.55,py+labelR*.55);
      }

    });
  }

  // Fleet icons
  G.fleet&&G.fleet.filter(f=>f.nation===G.playerNation).forEach(f=>{
    const p=PROVINCES[f.at];if(!p)return;
    if(p.cx<wx0-20||p.cx>wx1+20)return;
    ctx.font=`${12/vp.scale*Math.min(vp.scale,1.2)}px serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('🚢',p.cx,p.cy-scaledR(f.at)-4/vp.scale);
  });

  ctx.restore();

  // ── Draw queued order arrows (screen space) ──────────────
  function drawOrderArrow(fsx, fsy, tsx, tsy, color, dashColor, label){
    ctx.save();
    ctx.strokeStyle=color;
    ctx.lineWidth=2.5;
    ctx.setLineDash([8,4]);
    ctx.beginPath();ctx.moveTo(fsx,fsy);ctx.lineTo(tsx,tsy);ctx.stroke();
    ctx.setLineDash([]);
    // Arrowhead
    const angle=Math.atan2(tsy-fsy,tsx-fsx);
    const al=13;
    ctx.fillStyle=color;
    ctx.beginPath();
    ctx.moveTo(tsx,tsy);
    ctx.lineTo(tsx-al*Math.cos(angle-0.4),tsy-al*Math.sin(angle-0.4));
    ctx.lineTo(tsx-al*Math.cos(angle+0.4),tsy-al*Math.sin(angle+0.4));
    ctx.closePath();ctx.fill();
    // Troop count label above midpoint
    if(label){
      const mx=(fsx+tsx)/2, my=(fsy+tsy)/2-10;
      ctx.font='bold 11px Cinzel,serif';
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillStyle='rgba(6,8,14,.75)';
      const tw=ctx.measureText(label).width;
      ctx.fillRect(mx-tw/2-3,my-7,tw+6,14);
      ctx.fillStyle=dashColor;
      ctx.fillText(label,mx,my);
    }
    ctx.restore();
  }

  // Attack arrows — red dashed (only player's queued attacks)
  if(G.battleQueue&&G.battleQueue.length){
    G.battleQueue.filter(b=>b.isPlayer!==false).forEach(({fr,to,force})=>{
      const fp=PROVINCES[fr],tp=PROVINCES[to];
      if(!fp||!tp)return;
      const [fsx,fsy]=toScreen(fp.cx,fp.cy);
      const [tsx,tsy]=toScreen(tp.cx,tp.cy);
      drawOrderArrow(fsx,fsy,tsx,tsy,'rgba(255,80,80,.85)','#ff9090',fm(force));
    });
  }
  // Move arrows — green dashed (only player's queued moves)
  if(G.moveQueue&&G.moveQueue.length){
    G.moveQueue.forEach(({from,to,amount})=>{
      const fp=PROVINCES[from],tp=PROVINCES[to];
      if(!fp||!tp)return;
      const [fsx,fsy]=toScreen(fp.cx,fp.cy);
      const [tsx,tsy]=toScreen(tp.cx,tp.cy);
      drawOrderArrow(fsx,fsy,tsx,tsy,'rgba(80,220,80,.85)','#a0ffb0',fm(amount));
    });
  }
  // ── UNIFIED MAP MODE OVERLAY PANELS ──────────────────────
  drawMapOverlay();
}

function drawMapOverlay(){
  // Shared panel style helpers
  const PAD=10, LH=17, SW=172, CORNER_X=CW-SW-8, CORNER_Y=8;
  const GOLD='#c9a84c', DIM='#7a6a40', TEXT='#ddd0b0', BG='rgba(5,7,12,.92)';
  const ACCENT_LINE='rgba(201,168,76,.18)';

  function panelBg(x,y,w,h,accentColor){
    ctx.save();
    ctx.fillStyle=BG;
    ctx.strokeStyle=accentColor||'rgba(201,168,76,.22)';
    ctx.lineWidth=1;
    ctx.beginPath();ctx.rect(x,y,w,h);ctx.fill();ctx.stroke();
    // Thin top accent line
    ctx.strokeStyle=accentColor&&accentColor!=='rgba(201,168,76,.22)'?accentColor:GOLD;
    ctx.globalAlpha=0.4;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(x+1,y+1);ctx.lineTo(x+w-1,y+1);ctx.stroke();
    ctx.restore();
  }
  function panelTitle(x,y,label){
    ctx.save();
    ctx.font='bold 8px Cinzel,serif';ctx.fillStyle=GOLD;
    ctx.textAlign='left';ctx.textBaseline='top';
    ctx.letterSpacing='1px';
    ctx.fillText(label,x,y);
    ctx.restore();
  }
  function panelRow(x,y,label,value,valColor){
    ctx.save();
    ctx.textAlign='left';ctx.textBaseline='middle';
    ctx.font='8px Cinzel,serif';ctx.fillStyle=TEXT;
    ctx.fillText(label,x,y);
    ctx.textAlign='right';
    ctx.fillStyle=valColor||GOLD;
    ctx.fillText(value,x+SW-PAD*2,y);
    ctx.restore();
  }
  function divider(x,y,w){
    ctx.save();ctx.strokeStyle=ACCENT_LINE;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+w,y);ctx.stroke();
    ctx.restore();
  }

  const PN=G.playerNation;
  const myProvs=PROVINCES.map((_,i)=>i).filter(i=>G.owner[i]===PN);

  if(G.mapMode==='disease'){
    const active=G.epidemics?.filter(ep=>ep.active)||[];
    const rows=active.length||1;
    const sh=PAD*2+14+rows*LH+4;
    panelBg(CORNER_X,CORNER_Y,SW,sh,'rgba(180,60,30,.35)');
    panelTitle(CORNER_X+PAD,CORNER_Y+PAD,'☣  EPIDEMICS');
    if(active.length===0){
      ctx.save();ctx.font='8px Cinzel,serif';ctx.fillStyle=DIM;
      ctx.textAlign='left';ctx.textBaseline='top';
      ctx.fillText('No active epidemics',CORNER_X+PAD,CORNER_Y+PAD+14);
      ctx.restore();
    } else {
      active.forEach((ep,idx)=>{
        const ey=CORNER_Y+PAD+14+idx*LH;
        ctx.save();
        ctx.fillStyle=ep.color;
        ctx.beginPath();ctx.arc(CORNER_X+PAD+4,ey+LH/2,3.5,0,Math.PI*2);ctx.fill();
        ctx.font='8px Cinzel,serif';ctx.fillStyle=TEXT;
        ctx.textAlign='left';ctx.textBaseline='middle';
        ctx.fillText(`${ep.icon} ${ep.name}`,CORNER_X+PAD+13,ey+LH/2-3);
        ctx.fillStyle=DIM;ctx.font='7px serif';
        ctx.fillText(`${ep.provinces.size} prov · ☠${fm(ep.dead)}`,CORNER_X+PAD+13,ey+LH/2+5);
        ctx.restore();
      });
    }
  }

  if(G.mapMode==='buildings'){
    const bldCounts={};
    myProvs.forEach(i=>{
      (G.buildings[i]||[]).forEach(k=>{bldCounts[k]=(bldCounts[k]||0)+1;});
      if(G.construction[i])bldCounts['_const']=(bldCounts['_const']||0)+1;
    });
    const entries=Object.entries(bldCounts).filter(([k])=>k!=='_const').sort((a,b)=>b[1]-a[1]);
    const constCount=bldCounts['_const']||0;
    const rows=entries.length+(constCount?1:0)||(1);
    const sh=PAD*2+14+rows*LH+4;
    panelBg(CORNER_X,CORNER_Y,SW,sh,'rgba(40,80,60,.4)');
    panelTitle(CORNER_X+PAD,CORNER_Y+PAD,'🏛  BUILDINGS');
    if(!entries.length&&!constCount){
      ctx.save();ctx.font='8px Cinzel,serif';ctx.fillStyle=DIM;
      ctx.textAlign='left';ctx.textBaseline='top';
      ctx.fillText('No buildings constructed',CORNER_X+PAD,CORNER_Y+PAD+14);
      ctx.restore();
    } else {
      entries.forEach(([k,cnt],idx)=>{
        const b=BUILDINGS[k];if(!b)return;
        const ey=CORNER_Y+PAD+14+idx*LH+LH/2;
        ctx.save();
        ctx.font='10px serif';ctx.fillStyle=TEXT;
        ctx.textAlign='left';ctx.textBaseline='middle';
        ctx.fillText(b.icon||'?',CORNER_X+PAD,ey);
        ctx.font='8px Cinzel,serif';
        ctx.fillText(b.name,CORNER_X+PAD+16,ey);
        ctx.fillStyle=GOLD;ctx.textAlign='right';
        ctx.fillText('×'+cnt,CORNER_X+SW-PAD,ey);
        ctx.restore();
      });
      if(constCount){
        const ey=CORNER_Y+PAD+14+entries.length*LH+LH/2;
        ctx.save();ctx.font='8px Cinzel,serif';ctx.fillStyle=DIM;
        ctx.textAlign='left';ctx.textBaseline='middle';
        ctx.fillText('🏗 Under construction',CORNER_X+PAD,ey);
        ctx.fillStyle=GOLD;ctx.textAlign='right';
        ctx.fillText('×'+constCount,CORNER_X+SW-PAD,ey);
        ctx.restore();
      }
    }
  }

  if(G.mapMode==='instab'){
    const satVals=myProvs.map(i=>G.satisfaction[i]??70);
    const avgSat=satVals.length?Math.round(satVals.reduce((a,b)=>a+b,0)/satVals.length):70;
    const satColor=avgSat>=70?'#9aba50':avgSat>=50?'#e08830':'#ff6040';
    // Panel height: title + gap + value row + bar + bottom pad
    const BAR_H=7, BAR_W=SW-PAD*2, TITLE_H=22, VAL_H=18;
    const sh=TITLE_H+VAL_H+BAR_H+PAD+8;
    panelBg(CORNER_X,CORNER_Y,SW,sh,'rgba(180,120,20,.3)');
    // Title
    panelTitle(CORNER_X+PAD,CORNER_Y+7,'⚡  UNREST');
    // Value row
    const vy=CORNER_Y+TITLE_H+VAL_H/2+2;
    ctx.save();
    ctx.font='8px Cinzel,serif';ctx.fillStyle=TEXT;
    ctx.textAlign='left';ctx.textBaseline='middle';
    ctx.fillText('Avg. satisfaction',CORNER_X+PAD,vy);
    ctx.font='bold 9px Cinzel,serif';ctx.fillStyle=satColor;
    ctx.textAlign='right';
    ctx.fillText(avgSat+'%',CORNER_X+SW-PAD,vy);
    ctx.restore();
    // Gradient bar
    const bx=CORNER_X+PAD, by=CORNER_Y+TITLE_H+VAL_H+4;
    const grad=ctx.createLinearGradient(bx,0,bx+BAR_W,0);
    grad.addColorStop(0,'#c03020');grad.addColorStop(0.4,'#c08020');
    grad.addColorStop(0.65,'#a0b030');grad.addColorStop(1,'#50c040');
    ctx.save();
    ctx.fillStyle='rgba(0,0,0,.4)';
    ctx.beginPath();ctx.rect(bx,by,BAR_W,BAR_H);ctx.fill();
    ctx.fillStyle=grad;
    const filled=Math.round(BAR_W*(avgSat/100));
    ctx.beginPath();ctx.rect(bx,by,filled,BAR_H);ctx.fill();
    // Tick marker
    ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.globalAlpha=0.9;
    ctx.beginPath();ctx.moveTo(bx+filled,by-1);ctx.lineTo(bx+filled,by+BAR_H+1);ctx.stroke();
    ctx.restore();
  }

  if(G.mapMode==='terrain'){
    // Count terrain types across player provinces
    const terrCount={};
    myProvs.forEach(i=>{
      const t=PROVINCES[i].terrain||'plains';
      terrCount[t]=(terrCount[t]||0)+1;
    });
    const sorted=Object.entries(terrCount).sort((a,b)=>b[1]-a[1]);
    const rows=Math.max(1,sorted.length);
    const sh=PAD*2+14+rows*LH+4;
    panelBg(CORNER_X,CORNER_Y,SW,sh,'rgba(50,80,50,.35)');
    panelTitle(CORNER_X+PAD,CORNER_Y+PAD,'🏔  TERRAIN');
    sorted.forEach(([t,cnt],idx)=>{
      const tInfo=TERRAIN[t];
      const label=tInfo?.name||t;
      const ey=CORNER_Y+PAD+14+idx*LH+LH/2;
      ctx.save();
      // Small terrain color swatch
      ctx.fillStyle=TC[t]||'#444';
      ctx.beginPath();ctx.rect(CORNER_X+PAD,ey-4,8,8);ctx.fill();
      ctx.font='8px Cinzel,serif';ctx.fillStyle=TEXT;
      ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillText(label,CORNER_X+PAD+12,ey);
      ctx.fillStyle=DIM;ctx.textAlign='right';
      ctx.fillText(cnt+' prov',CORNER_X+SW-PAD,ey);
      ctx.restore();
    });
    if(!sorted.length){
      ctx.save();ctx.font='8px Cinzel,serif';ctx.fillStyle=DIM;
      ctx.textAlign='left';ctx.textBaseline='top';
      ctx.fillText('No territories',CORNER_X+PAD,CORNER_Y+PAD+14);
      ctx.restore();
    }
  }

  if(G.mapMode==='resources'){
    const F=window.RES_FILTER||{coal:true,iron:true,oil:true};
    const resDefs=[
      {k:'coal',label:'Coal',dot:[80,80,80]},
      {k:'iron',label:'Iron',dot:[100,140,180]},
      {k:'oil', label:'Oil', dot:[180,130,40]},
    ];
    const counts={coal:0,iron:0,oil:0};
    PROVINCES.forEach((_,i)=>{
      if(PROVINCES[i]?.isSea)return;
      const r=G.resBase[i]||{};
      if(r.coal>0)counts.coal++;
      if(r.iron>0)counts.iron++;
      if(r.oil>0)counts.oil++;
    });
    const rows=3;
    const sh=PAD*2+14+rows*LH+4;
    panelBg(CORNER_X,CORNER_Y,SW,sh,'rgba(80,70,20,.35)');
    panelTitle(CORNER_X+PAD,CORNER_Y+PAD,'⛏  RESOURCES');
    window._resOverlayHitRects=[];
    resDefs.forEach(({k,label,dot},idx)=>{
      const rowY=CORNER_Y+PAD+14+idx*LH;
      const ey=rowY+LH/2;
      const active=F[k];
      window._resOverlayHitRects.push({k,x:CORNER_X,y:rowY,w:SW,h:LH});
      ctx.save();
      ctx.globalAlpha=active?1:0.35;
      ctx.fillStyle=`rgb(${dot[0]},${dot[1]},${dot[2]})`;
      ctx.beginPath();ctx.arc(CORNER_X+PAD+4,ey,4,0,Math.PI*2);ctx.fill();
      ctx.font='8px Cinzel,serif';
      ctx.fillStyle=active?TEXT:'rgba(180,160,120,.5)';
      ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillText(label,CORNER_X+PAD+13,ey);
      ctx.fillStyle=active?GOLD:'rgba(120,100,60,.5)';ctx.textAlign='right';
      ctx.fillText(counts[k]+' prov',CORNER_X+SW-PAD,ey);
      ctx.restore();
    });
  } else {
    window._resOverlayHitRects=[];
  }
}
