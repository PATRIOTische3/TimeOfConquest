// ══════════════════════════════════════════════════════════
//  ASSIMILATION SYSTEM
// ══════════════════════════════════════════════════════════

// ── ASSIMILATION ──────────────────────────────────────────
// ── ASSIMILATION ──────────────────────────────────────────
// Rate: instab reduction per week
// Pop loss: total % of pop lost over full 48 weeks (random within range each week)
// Cost formula: paid upfront for chosen N weeks; early weeks more expensive
//   weekCost(w, N) = baseRate * (1 + (N - w) / N * 1.8)  — first weeks ~2.8x last
// Gentle: cheapest; Standard: most expensive total; Harsh ≈ Standard but brutal pop loss
var ASSIM_DEFS = {
  gentle:   {
    label:'🕊 Gentle', icon:'🕊',
    instabRate: 2,
    popLossMin: 0.0,
    popLossMax: 0.015,
    desc:'Slow & humane. Minimal population impact.'
  },
  standard: {
    label:'⚖ Standard', icon:'⚖',
    instabRate: 2.5,
    popLossMin: 0.01,
    popLossMax: 0.05,
    desc:'Balanced. Noticeable but manageable pop decline.'
  },
  harsh: {
    label:'☠ Harsh', icon:'☠',
    instabRate: null,
    popLossMin: 0.05,
    popLossMax: 0.30,
    desc:'Rapid but brutal. Heavy initial pop losses.'
  },
};

// Harsh instab rate per week (decelerating)
function harshRate(weekIdx){ // weekIdx 0-based
  if(weekIdx===0) return 10;
  if(weekIdx===1) return 9.5;
  if(weekIdx===2) return 8;
  if(weekIdx===3) return 6.5;
  return 5;
}

// Upfront cost for N weeks of type
// Weekly cost curve: starts at 5g, divides by 1.05 each week, floors at 2g then slides to 1.75g
// Type multipliers: gentle=1.0 (cheapest), standard=1.7 (most expensive), harsh=1.65
var ASSIM_COST_MULT={gentle:1.0,standard:1.7,harsh:1.65};

// Base curve: week 0 = 5, each week / 1.05, floors at 2.0 then slides to 1.75
// Sum of this curve over 48 weeks ≈ 86 (used as normalizer)
var _ASSIM_BASE_48=(()=>{
  let s=0;
  const startVal=5.0,divRate=1.05,floor=2.0,endVal=1.75,floorReached=Math.ceil(Math.log(startVal/floor)/Math.log(divRate));
  for(let w=0;w<48;w++){
    let v=startVal/Math.pow(divRate,w);
    if(v<=floor){const extra=w-floorReached;v=floor-(floor-endVal)*Math.min(1,extra/Math.max(1,48-floorReached));}
    s+=v;
  }
  return s; // ≈86
})();

function assimWeekCost(weekIdx){ // returns normalised 0..1 weight for this week
  const startVal=5.0,divRate=1.05,floor=2.0,endVal=1.75,floorWeeks=48;
  let val=startVal/Math.pow(divRate,weekIdx);
  if(val<=floor){
    const floorReached=Math.ceil(Math.log(startVal/floor)/Math.log(divRate));
    const extra=weekIdx-floorReached;
    const totalExtra=floorWeeks-floorReached;
    val=floor-(floor-endVal)*Math.min(1,extra/Math.max(1,totalExtra));
  }
  return val/_ASSIM_BASE_48; // normalised weight
}

// pop = province population; type multiplier for gentle/standard/harsh
function assimTotalCost(type, weeks, pop){
  const mult=ASSIM_COST_MULT[type]||1.0;
  const popBase=(pop||10000)/2; // base cost for 48 weeks = pop/2
  // Scale: 48 weeks costs popBase*mult; fewer weeks cost proportionally less (front-loaded)
  let weightSum=0;
  for(let w=0;w<weeks;w++) weightSum+=assimWeekCost(w);
  // Full 48-week weight sum = 1.0 by construction
  return Math.max(1, Math.round(popBase * mult * weightSum));
}

function openAssim(i){
  if(i===undefined||i<0)i=G.sel;
  if(i<0||G.owner[i]!==G.playerNation){popup('Select your territory!');return;}
  const instabVal=Math.round(G.instab[i]||0);
  if(instabVal<=25){popup('Province already stable (instability ≤ 25%).');return;}
  if(G.assimQueue&&G.assimQueue[i]){
    const aq=G.assimQueue[i];
    const def=ASSIM_DEFS[aq.type];
    openMo('🏛 ASSIMILATION IN PROGRESS',
      `<p class="mx"><b>${PROVINCES[i].name}</b> · ${def?.label||''}</p>
       <p class="mx">Instability: <b style="color:#c9a84c">${instabVal}%</b> · Weeks remaining: <b>${aq.weeksLeft}</b></p>
       <p class="mx" style="color:#ff8844;font-size:9px">Cancel to stop (no refund).</p>`,
      [{lbl:'Keep running',cls:'grn'},{lbl:'Cancel assimilation',cls:'red',cb:()=>{G.assimQueue[i]=null;addLog(`🏛 ${PROVINCES[i].short}: assimilation cancelled.`,'info');scheduleDraw();}}]
    );
    return;
  }

  const p=PROVINCES[i];
  const isConquered=p.nation!==G.playerNation;
  const gold=G.gold[G.playerNation];
  const provPop=G.pop[i]||10000;
  const initWeeks=24;
  window._assimProv=i;

  // Three type cards — prices update via slider
  function typeCards(weeks){
    return Object.entries(ASSIM_DEFS).map(([key,def])=>{
      const cost=assimTotalCost(key,weeks,provPop);
      const canAfford=gold>=cost;
      const col=key==='harsh'?'#ff7060':key==='standard'?'#c9a84c':'#80c080';
      const estDrop=key==='harsh'
        ?[10,9.5,8,6.5,...Array(44).fill(5)].slice(0,weeks).reduce((a,b)=>a+b,0)
        :def.instabRate*weeks;
      const instabAfter=Math.max(0,instabVal-estDrop).toFixed(0);
      const popMin=Math.round(def.popLossMin*100);
      const popMax=Math.round(def.popLossMax*100);
      return`<div id="assim_card_${key}" style="flex:1;background:rgba(0,0,0,.3);border:1px solid ${canAfford?col:'#333'};padding:9px 8px;text-align:center;${canAfford?'cursor:pointer':'opacity:.45;cursor:not-allowed'}"
        ${canAfford?`onclick="startAssim(${i},'${key}',document.getElementById('assim-weeks-sl').value|0,${provPop})"`:''}>
        <div style="font-family:Cinzel,serif;font-size:11px;color:${col};margin-bottom:4px">${def.label}</div>
        <div style="font-size:8px;color:var(--dim);margin-bottom:6px;line-height:1.4">${def.desc}</div>
        <div style="font-size:8px;color:#c0c040;margin-bottom:2px">→ ${instabAfter}% instab</div>
        <div style="font-size:8px;color:#ff8844;margin-bottom:6px">pop −${popMin===0?'<1':'~'+popMin}–${popMax}%</div>
        <div style="font-family:Cinzel,serif;font-size:15px;color:${canAfford?col:'#ff4040'}" id="ac_${key}">${fa(cost)}g</div>
      </div>`;
    }).join('');
  }

  openMo('🏛 ASSIMILATION',
    `<p class="mx"><b>${p.name}${p.isCapital?' ★':''}</b>${isConquered?' · <span style="color:#ff8844">Foreign province</span>':''}</p>
     <p class="mx">Instability: <b style="color:${instabVal>60?'#ff6040':instabVal>40?'#e08030':'#c0c040'}">${instabVal}%</b> · Pop: <b>${fm(provPop)}</b> · Treasury: <b>${fa(gold)}g</b></p>
     <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:rgba(0,0,0,.25);border:1px solid var(--border2);margin-bottom:10px">
       <span style="font-size:9px;color:var(--dim);flex-shrink:0">Duration</span>
       <input type="range" id="assim-weeks-sl" min="1" max="48" value="${initWeeks}" style="flex:1"
         oninput="(function(w){
           document.getElementById('assim-weeks-val').textContent=w+'w';
           Object.keys(ASSIM_DEFS).forEach(function(k){
             var el=document.getElementById('ac_'+k);
             if(el)el.textContent=fa(assimTotalCost(k,w,${provPop}))+'g';
           });
         })(+this.value)">
       <span style="font-family:Cinzel,serif;font-size:14px;color:var(--gold);min-width:34px;text-align:right" id="assim-weeks-val">${initWeeks}w</span>
     </div>
     <p class="mx" style="font-size:9px;color:var(--dim);margin-bottom:8px">Cost paid upfront. Early weeks cost more. Click a method to confirm.</p>
     <div style="display:flex;gap:6px">${typeCards(initWeeks)}</div>`,
    [{lbl:'Cancel',cls:'dim'}]
  );
}

window.startAssim=function(i,type,weeks,pop){
  closeMo();
  if(!G.assimQueue)G.assimQueue=PROVINCES.map(()=>null);
  const def=ASSIM_DEFS[type];if(!def)return;
  weeks=Math.max(1,Math.min(48,weeks||24));
  const provPop=pop||G.pop[i]||10000;
  const cost=assimTotalCost(type,weeks,provPop);
  if(G.gold[G.playerNation]<cost){popup('Insufficient gold!');return;}
  G.gold[G.playerNation]-=cost;
  const popFloor=Math.floor(G.pop[i]*0.28);
  G.assimQueue[i]={type,weeksLeft:weeks,totalWeeks:weeks,popFloor,weekIdx:0};
  addLog(`🏛 ${PROVINCES[i].short}: ${def.label} assimilation (${weeks}w, ${fa(cost)}g).`,'info');
  popup(`🏛 Assimilation started — ${fa(cost)}g paid upfront`);
  scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);
};

// processAssimCosts is now a no-op (cost paid upfront)
function processAssimCosts(){ /* paid upfront */ }

