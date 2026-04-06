// ══════════════════════════════════════════════════════════
//  EVENTS — Epidemics, Resistance, Random Events, Revolt
// ══════════════════════════════════════════════════════════

// ── RESISTANCE SYSTEM ─────────────────────────────────────
function openSponsor(){
  // Sponsor resistance in enemy provinces, OR
  // show own occupied territories' resistance status
  const PN=G.playerNation;
  const enemyOccupied=PROVINCES.map((_,i)=>i).filter(i=>{
    return G.owner[i]!==PN&&G.owner[i]>=0&&
      NB[i].some(nb=>G.owner[nb]===PN); // adjacent to player
  });
  const playerOccupied=PROVINCES.map((_,i)=>i).filter(i=>G.owner[i]===PN&&G.resistance[i]>10);

  let html=`<p class="mx">Spend gold to fund partisans in enemy territory, raising their instability.</p>`;
  if(enemyOccupied.length){
    html+=`<p class="mx" style="color:var(--gold)">Sponsor in enemy territory (100g each):</p><div class="tlist">${enemyOccupied.slice(0,12).map(i=>`<div class="ti ene" onclick="doSponsor(${i})"><span class="tn">${PROVINCES[i].name}</span><span class="ta">⚡${Math.round(G.instab[i])}% instab<br>🔥${Math.round(G.resistance[i])}% resist</span></div>`).join('')}</div>`;
  }
  if(playerOccupied.length){
    html+=`<p class="mx" style="color:#ff8844">Active resistance in your territories:</p><div class="tlist">${playerOccupied.map(i=>`<div class="ti"><span class="tn">${PROVINCES[i].name}</span><span class="ta">🔥${Math.round(G.resistance[i])}% resist<br>Suppressing: 200g</span><button class="btn" style="padding:3px 7px;font-size:8px" onclick="suppressResist(${i})">Suppress</button></div>`).join('')}</div>`;
  }
  if(!enemyOccupied.length&&!playerOccupied.length)html+='<p class="mx" style="color:var(--dim)">No viable targets nearby.</p>';
  openMo('RESISTANCE OPERATIONS',html,[{lbl:'Close',cls:'dim'}]);
}
function doSponsor(i){
  closeMo();
  if(G.gold[G.playerNation]<100){popup('Need 100 gold!');return;}
  G.gold[G.playerNation]-=100;
  const boost=ri(15,35);
  G.resistance[i]=Math.min(100,G.resistance[i]+boost);
  G.instab[i]=Math.min(100,G.instab[i]+ri(10,25));
  G.resistSponsor[i]=G.playerNation;
  addLog(`🔥 Resistance sponsored in ${PROVINCES[i].name}: +${boost}%.`,'resist');
  popup(`🔥 Partisans active in ${PROVINCES[i].name}!`);
  scheduleDraw();updateHUD();
}
function suppressResist(i){
  closeMo();
  if(G.gold[G.playerNation]<200){popup('Need 200 gold!');return;}
  G.gold[G.playerNation]-=200;
  const red=ri(30,60);
  G.resistance[i]=Math.max(0,G.resistance[i]-red);
  G.instab[i]=Math.max(0,G.instab[i]-ri(10,20));
  addLog(`${PROVINCES[i].name}: resistance suppressed (-${red}%).`,'info');
  popup(`Resistance suppressed in ${PROVINCES[i].name}`);
  scheduleDraw();
}
function processResistance(){
  // Player-owned territories with resistance
  regsOf(G.playerNation).forEach(i=>{
    if(G.resistance[i]<=0)return;
    // Milder instab from resistance: /20 instead of /10
    G.instab[i]=Math.min(100,G.instab[i]+Math.floor(G.resistance[i]/20));
    G.resistance[i]=Math.max(0,G.resistance[i]-ri(3,7)); // slightly faster decay
    if(G.resistance[i]>80&&Math.random()<.10){ // higher threshold, lower chance
      G.army[i]=Math.max(0,G.army[i]-ri(100,400));
      addLog(`🔥 Partisan attack in ${PROVINCES[i].name}!`,'resist');
    }
  });
  // AI sponsors resistance — reduced frequency
  aliveNations().forEach(ai=>{
    const lost=PROVINCES.map((_,i)=>i).filter(i=>G.owner[i]===G.playerNation&&PROVINCES[i].nation===ai);
    lost.forEach(i=>{
      if(Math.random()<.04&&G.gold[ai]>=80){ // was 0.08
        G.gold[ai]-=80;
        G.resistance[i]=Math.min(100,G.resistance[i]+ri(3,12)); // was 5-20
      }
    });
  });
}


// ── ATTACK / BATTLE ───────────────────────────────────────

function triggerRevolt(r,io){
  const ra=Math.floor(ri(200,800)*(io.revoltScale||1));
  G.owner[r]=-1;G.army[r]=ra;G.instab[r]=ri(20,45);G.assim[r]=ri(8,28);G.resistance[r]=0;
  addLog(`🔥 Rebellion — ${PROVINCES[r].name} rises against you!`,'revolt');
  popup(`🔥 Rebellion in ${PROVINCES[r].name}!`,3200);
}

function spreadDisease(){
  // Legacy stub — new system handles everything
  processEpidemics();
}

// ════════════════════════════════════════════════════════════
//  EPIDEMIC SYSTEM
// ════════════════════════════════════════════════════════════

// Disease names and their base properties
var DISEASE_TYPES=[
  {name:'Plague',       lethality:.10, spreadRate:.65, satHit:22, armyHit:.28, icon:'☠',  duration:[10,22], seasonal:'winter'},
  {name:'Influenza',    lethality:.03, spreadRate:.80, satHit:12, armyHit:.12, icon:'🤧', duration:[5,14],  seasonal:'winter'},
  {name:'Cholera',      lethality:.08, spreadRate:.60, satHit:18, armyHit:.22, icon:'💧', duration:[7,16],  seasonal:'summer'},
  {name:'Typhus',       lethality:.07, spreadRate:.55, satHit:20, armyHit:.25, icon:'🦟', duration:[6,15],  seasonal:null},
  {name:'Dysentery',    lethality:.04, spreadRate:.50, satHit:14, armyHit:.18, icon:'🌡', duration:[5,12],  seasonal:'summer'},
  {name:'Smallpox',     lethality:.14, spreadRate:.45, satHit:28, armyHit:.35, icon:'💉', duration:[12,24], seasonal:null},
  {name:'Tuberculosis', lethality:.05, spreadRate:.38, satHit:16, armyHit:.14, icon:'🫁', duration:[14,28], seasonal:'winter'},
  {name:'Malaria',      lethality:.04, spreadRate:.48, satHit:12, armyHit:.20, icon:'🦟', duration:[9,20],  seasonal:'summer'},
];

// Distinct epidemic colors for map rendering
var EPIDEMIC_COLORS=[
  '#c83030','#c07820','#9030a8','#2878c0','#30a850',
  '#c03070','#787020','#2090a0','#8050c0','#c05020',
];

var _epicIdCounter=0;

function newEpidemic(originProv, type){
  if(!type) type=DISEASE_TYPES[Math.floor(Math.random()*DISEASE_TYPES.length)];
  const dur=ri(type.duration[0],type.duration[1]);
  const id=++_epicIdCounter;
  const color=EPIDEMIC_COLORS[(id-1)%EPIDEMIC_COLORS.length];
  const ep={
    id,
    name:type.name,
    icon:type.icon,
    color,
    type,
    origin:originProv,
    turnsActive:0,
    totalDuration:dur,
    provinces:new Set([originProv]),
    dead:0,
    active:true,
  };
  G.epidemics.push(ep);
  G.provDisease[originProv]=id;
  G.disease[originProv]=60+ri(0,30); // legacy severity
  // Only log outbreak if it's in player's territory
  const originOwner=G.owner[originProv];
  if(originOwner===G.playerNation){
    addLog(`${type.icon} <b>${type.name}</b> outbreak in ${PROVINCES[originProv]?.name||'?'}!`,'revolt');
    popup(`${type.icon} ${type.name} outbreak in ${PROVINCES[originProv]?.name}!`,4000);
  }
  // Track for ally notification later (checked monthly in processEpidemics)
  return ep;
}

function processEpidemics(fullMonth=false){
  const s=season();
  const isWinter=s.name==='Winter';
  const isAutumn=s.name==='Autumn';
  const isSummer=s.name==='Summer';
  // Very mild seasonal multiplier
  const seasonMult=isWinter?1.3:isAutumn?1.05:isSummer?1.05:1.0;

  // ── Random new outbreaks — very rare, monthly only ────────
  if(fullMonth){
    const atWar=G.war[G.playerNation]&&G.war[G.playerNation].some(w=>w);
    // ~70% per year in peace, ~150% in war — diseases are common
    const baseChance=(atWar?0.50:0.28)*seasonMult;
    if(Math.random()<baseChance){
      const candidates=PROVINCES.map((_,i)=>i).filter(i=>!PROVINCES[i].isSea);
      const origin=candidates[Math.floor(Math.random()*candidates.length)];
      if(!G.epidemics||!G.epidemics.find(ep=>ep.active&&ep.provinces.has(origin))){
        let pool=DISEASE_TYPES;
        if(isWinter) pool=DISEASE_TYPES.filter(d=>d.seasonal==='winter'||!d.seasonal);
        if(isSummer||isAutumn) pool=DISEASE_TYPES.filter(d=>d.seasonal==='summer'||!d.seasonal);
        const type=pool[Math.floor(Math.random()*pool.length)];
        newEpidemic(origin, type);
      }
    }
  }

  // ── Process each active epidemic ─────────────────────────
  for(const ep of G.epidemics){
    if(!ep.active) continue;
    if(fullMonth) ep.turnsActive++;

    const provList=[...ep.provinces];

    for(const prov of provList){
      // ── Fast elimination: 28-48% per week → clears in 2-4 weeks ──
      const hospBonus=(G.buildings[prov]||[]).includes('hospital')?0.20:0;
      const eliminateChance=Math.min(0.55, 0.28+hospBonus);
      if(Math.random()<eliminateChance){
        ep.provinces.delete(prov);
        G.provDisease[prov]=null;
        G.disease[prov]=0;
        continue;
      }

      // ── Mild effects ──────────────────────────────────
      const pop=G.pop[prov];
      if(pop>500){
        const dead=Math.floor(pop*ep.type.lethality*0.04*(Math.random()<0.1?4:1));
        if(dead>0){G.pop[prov]=Math.max(500,pop-dead);ep.dead+=dead;}
        G.disease[prov]=Math.min(100,15+Math.floor(ep.type.lethality*150));
      }
      if(G.satisfaction[prov]!==undefined){
        G.satisfaction[prov]=Math.max(5,(G.satisfaction[prov]||70)-ri(0,Math.ceil(ep.type.satHit/10)));
      }
      G.instab[prov]=Math.min(100,(G.instab[prov]||0)+ri(0,2));

      // ── Neighbor spread — very rare, one neighbor at a time ──
      const neighbors=(NB[prov]||[]).filter(nb=>!ep.provinces.has(nb)&&!PROVINCES[nb]?.isSea);
      if(neighbors.length>0&&Math.random()<0.12){ // 12% chance to even attempt spread this tick
        const nb=neighbors[Math.floor(Math.random()*neighbors.length)];
        const nbOwner=G.owner[nb];
        const sameNation=G.owner[prov]>=0&&nbOwner===G.owner[prov];
        const nbHosp=(G.buildings[nb]||[]).includes('hospital')?0.25:1.0;
        const baseSpread=ep.type.spreadRate*0.05*(sameNation?1.1:0.5)*nbHosp*seasonMult;
        if(Math.random()<baseSpread){
          ep.provinces.add(nb);
          G.provDisease[nb]=ep.id;
          G.disease[nb]=8+ri(0,12);
          if(nbOwner===G.playerNation){
            addLog(`${ep.icon} ${ep.name} spreads to ${PROVINCES[nb]&&PROVINCES[nb].name||'?'}!`,'revolt');
          }
        }
      }
      // No long-range jumps
    }

    // ── Natural end ───────────────────────────────────────
    if(fullMonth&&(ep.turnsActive>=ep.totalDuration||ep.provinces.size===0)){
      ep.active=false;
      for(const p of ep.provinces){G.provDisease[p]=null;G.disease[p]=0;}
      ep.provinces.clear();
      if(ep.dead>0){
        addLog(`${ep.icon} ${ep.name} epidemic ended. ☠ ${fm(ep.dead)} total deaths.`,'event');
      }
    }
  }

  if(G.epidemics.length>30) G.epidemics=G.epidemics.slice(-30);

  // ── Monthly: warn about large ally epidemics (>5 provinces) ──
  if(fullMonth){
    if(!G._allyEpicNotified) G._allyEpicNotified=new Set();
    for(const ep of G.epidemics){
      if(!ep.active||ep.provinces.size<=5) continue;
      if(G._allyEpicNotified.has(ep.id)) continue;
      let allyCount=0;
      for(const p of ep.provinces){
        const o=G.owner[p];
        if(o>=0&&o!==G.playerNation&&areAllies(G.playerNation,o)) allyCount++;
      }
      if(allyCount>=5){
        G._allyEpicNotified.add(ep.id);
        addLog(`${ep.icon} Major ${ep.name} outbreak among allies (${ep.provinces.size} provinces affected)!`,'revolt');
      }
    }
    for(const id of [...G._allyEpicNotified]){
      if(!G.epidemics.find(ep=>ep.active&&ep.id===id)) G._allyEpicNotified.delete(id);
    }
  }
}


// ── RANDOM EVENTS ─────────────────────────────────────────
function randEvent(io){
  const mr=regsOf(G.playerNation);if(!mr.length)return;
  const r=mr[Math.floor(Math.random()*mr.length)];
  const evs=[
    ()=>{const b=ri(80,500);G.gold[G.playerNation]+=b;return[`💰 War bonds in ${PROVINCES[r].short}: +${b}g.`,'event'];},
    ()=>{const l=Math.floor(G.pop[r]*.06);G.pop[r]=Math.max(500,G.pop[r]-l);G.instab[r]=Math.min(100,G.instab[r]+ri(10,20));return[`☠ Epidemic in ${PROVINCES[r].name}. -${fm(l)} pop.`,'revolt'];},
    ()=>{const b=ri(100,300);G.gold[G.playerNation]+=b;return[`🏛 Tax windfall in ${PROVINCES[r].short}: +${b}g.`,'event'];},
    ()=>{G.income[r]+=ri(15,35);return[`🏭 Industrial boom in ${PROVINCES[r].short}.`,'event'];},
    ()=>{const l=Math.min(G.army[r]-150,ri(100,800));if(l<=0)return null;G.army[r]-=l;return[`😤 Desertion: -${fa(l)} in ${PROVINCES[r].short}.`,'revolt'];},
    ()=>{G.instab[r]=Math.max(0,G.instab[r]-ri(15,30));return[`🎖 Morale boost in ${PROVINCES[r].short}.`,'event'];},
    ()=>{const b=ri(50,200);G.gold[G.playerNation]+=b;return[`⛏ Resources in ${PROVINCES[r].short}: +${b}g.`,'event'];},
    // Seasonal events
    ()=>{if(season().name!=='Winter')return null;G.army[r]=Math.max(0,G.army[r]-ri(100,500));return[`❄️ Frostbite casualties in ${PROVINCES[r].short}.`,'season'];},
    ()=>{if(season().name!=='Summer')return null;const b=ri(100,300);G.gold[G.playerNation]+=b;return[`☀️ Bumper harvest in ${PROVINCES[r].short}: +${b}g.`,'season'];},
  ];
  for(let i=0;i<5;i++){const fn=evs[Math.floor(Math.random()*evs.length)],res=fn();if(res){const[msg,type]=res;addLog(msg,type);popup('★ '+msg,2800);break;}}
}

// ── VICTORY / DEFEAT ──────────────────────────────────────
function chkVic(){if(regsOf(G.playerNation).length>=LAND.length){sEl('vic-txt',`${G.leaderName} under ${ideol().icon} ${ideol().name} conquered Europe by ${dateStr()}.`);show('victory');}}
function checkDefeat(){if(!regsOf(G.playerNation).length){sEl('def-txt',`The regime of ${G.leaderName} collapsed in ${dateStr()}.`);show('defeat');}}


