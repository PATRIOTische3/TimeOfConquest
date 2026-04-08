// ══════════════════════════════════════════════════════════
//  DIPLOMACY — NAP, Alliances, Ultimatums, Puppets, Reform
// ══════════════════════════════════════════════════════════

function openAllianceMenu(){
  const PN=G.playerNation,myAl=G.allianceOf[PN];
  const alive=aliveNations().slice(0,22);
  let html=`<p class="mx">Manage alliances, NAPs, and ultimatums.</p>`;
  if(myAl>=0)html+=`<p class="mx" style="color:#80c8ff">Your alliance: <b>${G.alliance[myAl].name}</b> (${G.alliance[myAl].members.map(m=>ownerName(m)).join(', ')})</p>`;

  html+=`<p class="mx" style="color:var(--gold)">Nations:</p><div class="tlist">${alive.map(ai=>{
    const ar=regsOf(ai),tot=ar.reduce((s,r)=>s+G.army[r],0);
    const st=atWar(PN,ai)?'⚔ War':G.pact[PN][ai]?`🤝 NAP(${G.pLeft[PN][ai]}mo)`:areAllies(PN,ai)?'🤝 Ally':'○ Neutral';
    return`<div class="ti"><span class="tn">${ownerName(ai)} (${ar.length}t)</span><span class="ta">⚔${fm(tot)}<br>${st}</span>
      <div style="display:flex;gap:3px;margin-top:3px">
        ${!G.pact[PN][ai]&&!atWar(PN,ai)?`<button class="btn" style="padding:2px 6px;font-size:8px" onclick="closeMo();offerNAP(${ai})">NAP</button>`:''}
        ${!areAllies(PN,ai)&&!atWar(PN,ai)?`<button class="btn" style="padding:2px 6px;font-size:8px" onclick="closeMo();proposeAlliance(${ai})">Alliance</button>`:''}
        ${!atWar(PN,ai)?`<button class="btn red" style="padding:2px 6px;font-size:8px" onclick="closeMo();openUltimatum(${ai})">Ultimatum</button>`:''}
      </div></div>`;
  }).join('')}</div>`;
  openMo('DIPLOMACY',html,[{lbl:'Close',cls:'dim'}]);
}

function offerNAP(ai){
  const PN=G.playerNation;
  if(atWar(PN,ai)){popup('Make peace first!');return;}
  if(G.pact[PN][ai]){popup(`Pact active: ${G.pLeft[PN][ai]} months`);return;}
  const io=ideol(),ch=.45*io.pactChance;
  setTimeout(()=>{
    if(Math.random()<ch){
      G.pact[PN][ai]=G.pact[ai][PN]=true;G.pLeft[PN][ai]=G.pLeft[ai][PN]=5;
      addLog(`🤝 NAP signed with ${ownerName(ai)}.`,'diplo');popup(`✓ NAP with ${ownerName(ai)}`);
    }else popup(`✗ ${ownerName(ai)} refused NAP`);
    scheduleDraw();
  },300);
}

function proposeAlliance(ai){
  const PN=G.playerNation;
  if(atWar(PN,ai)){popup('Cannot ally while at war!');return;}
  const io=ideol(),ch=.38*io.pactChance;
  const myAl=G.allianceOf[PN],theirAl=G.allianceOf[ai];
  setTimeout(()=>{
    if(Math.random()<ch){
      if(myAl>=0){
        // Add to existing alliance
        G.alliance[myAl].members.push(ai);G.allianceOf[ai]=myAl;
        addLog(`${ownerName(ai)} joined ${G.alliance[myAl].name}!`,'diplo');
      }else if(theirAl>=0){
        G.alliance[theirAl].members.push(PN);G.allianceOf[PN]=theirAl;
        addLog(`You joined ${G.alliance[theirAl].name}!`,'diplo');
      }else{
        // Form new alliance
        const newAl={name:`${ownerName(PN)}-${ownerName(ai)} Pact`,color:'#204080',members:[PN,ai]};
        G.alliance.push(newAl);const idx=G.alliance.length-1;
        G.allianceOf[PN]=idx;G.allianceOf[ai]=idx;
        addLog(`New alliance formed: ${ownerName(PN)} & ${ownerName(ai)}!`,'diplo');
      }
      popup(`✓ Alliance with ${ownerName(ai)}!`);
    }else popup(`✗ ${ownerName(ai)} refused alliance`);
    scheduleDraw();
  },300);
}

function openUltimatum(ai){
  const PN=G.playerNation;
  const theirRegs=regsOf(ai);if(!theirRegs.length)return;
  const html=`<p class="mx">Issue ultimatum to <b style="color:#ff7070">${ownerName(ai)}</b>. They may comply or resist — risking war.</p>
  <p class="mx">Demand options:</p>
  <div class="tlist">
    <div class="ti ene" onclick="doUltimatum(${ai},'territory')"><span class="tn">⚔ Cede border territory</span><span class="ta">40% accept if weaker</span></div>
    <div class="ti ene" onclick="doUltimatum(${ai},'tribute')"><span class="tn">💰 Pay tribute (500 gold)</span><span class="ta">55% accept if weaker</span></div>
    <div class="ti ene" onclick="doUltimatum(${ai},'puppet')"><span class="tn">🎭 Become puppet state</span><span class="ta">25% accept if far weaker</span></div>
  </div>`;
  openMo('ULTIMATUM',html,[{lbl:'Cancel',cls:'dim'}]);
}
function doUltimatum(ai,type){
  closeMo();
  const PN=G.playerNation;
  const myPow=regsOf(PN).reduce((s,r)=>s+G.army[r],0);
  const theirPow=regsOf(ai).reduce((s,r)=>s+G.army[r],0);
  const stronger=myPow>theirPow*1.4;
  const baseChance=type==='tribute'?.55:type==='territory'?.40:.25;
  const ch=stronger?baseChance*1.5:baseChance*.5;
  setTimeout(()=>{
    if(Math.random()<ch){
      if(type==='tribute'){G.gold[PN]+=500;G.gold[ai]-=300;addLog(`💰 ${ownerName(ai)} paid tribute: +500 gold.`,'diplo');popup(`✓ Tribute received!`);}
      else if(type==='territory'){
        const border=regsOf(ai).find(r=>NB[r].some(nb=>G.owner[nb]===PN));
        if(border>=0){G.owner[border]=PN;G.instab[border]=60;addLog(`⚔ ${PROVINCES[border].name} ceded by ultimatum!`,'diplo');popup(`✓ ${PROVINCES[border].name} ceded!`);}
      }else if(type==='puppet'){
        G.puppet.push(ai);G.war[PN][ai]=G.war[ai][PN]=false;addLog(`🎭 ${ownerName(ai)} became puppet state!`,'diplo');popup(`✓ ${ownerName(ai)} is now your puppet!`);}
      scheduleDraw();updateHUD();
    }else{
      G.war[PN][ai]=G.war[ai][PN]=true;
      addLog(`⚔ ${ownerName(ai)} refused ultimatum — WAR!`,'war');popup(`✗ Ultimatum rejected — war declared!`);
    }
  },400);
}

function openPeace(){
  const PN=G.playerNation,ew=aliveNations().filter(ai=>atWar(PN,ai));
  if(!ew.length){popup('Not at war.');return;}
  const html=`<p class="mx">Seek ceasefire:</p><div class="tlist">${ew.map(ai=>{const tot=regsOf(ai).reduce((s,r)=>s+G.army[r],0);return`<div class="ti ene" onclick="offerPeace(${ai})"><span class="tn">⚔ ${ownerName(ai)}</span><span class="ta">⚔${fa(tot)}</span></div>`;}).join('')}</div>`;
  openMo('PEACE TALKS',html,[{lbl:'Close',cls:'dim'}]);
}
function offerPeace(ai){
  closeMo();const PN=G.playerNation;
  const ma=regsOf(PN).reduce((s,r)=>s+G.army[r],0),aa=regsOf(ai).reduce((s,r)=>s+G.army[r],0);
  let ch=.38;if(ma>aa*2)ch=.82;if(ma<aa*.5)ch=.18;
  setTimeout(()=>{
    if(Math.random()<ch){
      G.war[PN][ai]=G.war[ai][PN]=false;
      // Clear occupation records between these two nations
      if(G.occupied){
        for(const [k,occ] of Object.entries(G.occupied)){
          if(occ&&(occ.by===PN&&occ.originalOwner===ai)||(occ.by===ai&&occ.originalOwner===PN)){
            delete G.occupied[k];
          }
        }
      }
      addLog(`🕊 Peace with ${ownerName(ai)}.`,'peace');popup(`✓ Peace accepted`);
    }
    else popup(`✗ ${ownerName(ai)} rejected`);
    scheduleDraw();
  },300);
}

function openMarionette(){
  const PN=G.playerNation;
  // Can make puppet from nations you've beaten (at war, have all their territory)
  const beaten=aliveNations().filter(ai=>atWar(PN,ai)&&regsOf(PN).length>regsOf(ai).length*2);
  const current=G.puppet.filter(p=>regsOf(p).length>0);
  if(!beaten.length&&!current.length){popup('No suitable nations to puppet or view.');return;}
  const html=`<p class="mx">Puppet states pay you 30% of their income and follow your wars.</p>
  ${beaten.length?`<p class="mx" style="color:var(--gold)">Offer puppet status to:</p><div class="tlist">${beaten.map(ai=>`<div class="ti" onclick="makePuppet(${ai})"><span class="tn">🎭 ${ownerName(ai)}</span><span class="ta">${regsOf(ai).length} territories</span></div>`).join('')}</div>`:''}
  ${current.length?`<p class="mx" style="color:#c090f0">Current puppets:</p><div class="tlist">${current.map(ai=>`<div class="ti"><span class="tn">🎭 ${ownerName(ai)}</span><span class="ta">${regsOf(ai).length}t · 30% tribute</span></div>`).join('')}</div>`:''}`;
  openMo('PUPPET STATES',html,[{lbl:'Close',cls:'dim'}]);
}
function makePuppet(ai){
  closeMo();
  G.puppet.push(ai);G.war[G.playerNation][ai]=G.war[ai][G.playerNation]=false;
  addLog(`🎭 ${ownerName(ai)} became your puppet state.`,'diplo');
  popup(`✓ ${ownerName(ai)} is now a puppet!`);scheduleDraw();
}

// ── GOVERNMENT REFORM ─────────────────────────────────────
// Ideology "distance" matrix — how different two systems are
// Higher = more expensive + longer transition + bigger satisfaction hit
var IDEO_DISTANCE = {
  fascism:    {fascism:0,nazism:1,militarism:2,nationalism:2,monarchy:3,communism:5,stalinism:6,socialdem:5,democracy:5,liberalism:6},
  nazism:     {nazism:0,fascism:1,militarism:2,nationalism:2,monarchy:4,communism:6,stalinism:7,socialdem:6,democracy:6,liberalism:7},
  communism:  {communism:0,stalinism:1,socialdem:3,democracy:4,liberalism:5,nationalism:5,fascism:5,nazism:6,monarchy:5,militarism:4},
  stalinism:  {stalinism:0,communism:1,socialdem:4,democracy:5,liberalism:6,nationalism:5,fascism:6,nazism:7,monarchy:5,militarism:4},
  democracy:  {democracy:0,liberalism:1,socialdem:1,monarchy:2,communism:4,nationalism:3,fascism:5,nazism:6,stalinism:5,militarism:4},
  liberalism: {liberalism:0,democracy:1,socialdem:2,monarchy:3,communism:5,nationalism:4,fascism:6,nazism:7,stalinism:6,militarism:5},
  socialdem:  {socialdem:0,democracy:1,liberalism:2,communism:3,monarchy:3,nationalism:3,fascism:5,nazism:6,stalinism:4,militarism:4},
  monarchy:   {monarchy:0,nationalism:1,democracy:2,liberalism:3,fascism:3,militarism:2,socialdem:3,communism:5,stalinism:5,nazism:4},
  nationalism:{nationalism:0,monarchy:1,fascism:2,militarism:2,democracy:3,liberalism:4,socialdem:3,communism:5,stalinism:5,nazism:2},
  militarism: {militarism:0,fascism:2,nazism:2,nationalism:2,monarchy:2,communism:4,stalinism:4,democracy:4,liberalism:5,socialdem:4},
};

function ideoDist(a,b){
  return (IDEO_DISTANCE[a]||{})[b] ?? 4; // fallback 4
}

function openReform(){
  if(G.reforming){
    const tgt=IDEOLOGIES[G.reformTarget];
    openModal('Reform in Progress',
      `<p class="mx warn">⚠ Currently transitioning to <b style="color:${tgt?.color}">${tgt?.icon} ${tgt?.name}</b></p>
       <p class="mx">Transition completes in <b>${G.reformTurnsLeft}</b> turns (${G.reformTurnsLeft} of ${G.reformTotalTurns} remaining).</p>
       <p class="mx" style="font-size:9px;color:var(--dim)">During transition: −20% income, −20% conscription efficiency, satisfaction declining.</p>`,
      '<button class="btn dim" onclick="closeModal()">Close</button>'
    );
    return;
  }

  const cur=G.ideology;
  const io=ideol();
  const gold=G.gold[G.playerNation];
  const avgSat=Math.round(regsOf(G.playerNation).reduce((s,r)=>s+G.satisfaction[r],0)/Math.max(1,regsOf(G.playerNation).length));

  const rows=Object.entries(IDEOLOGIES).filter(([k])=>k!==cur).map(([key,id])=>{
    const dist=ideoDist(cur,key);
    // Cost: 200 base × dist² — more different = much more expensive
    const cost=200+dist*dist*80;
    // Transition turns: 3 + dist*2 months
    const turns=3+dist*2;
    // Satisfaction hit: dist*8 points
    const satHit=dist*8;
    const canAfford=gold>=cost;
    const distLabel=['Identical','Very Close','Close','Moderate','Different','Very Different','Extreme'][Math.min(dist,6)];
    const distColor=['#8a8a8a','#50b050','#80c050','#c0c050','#c08030','#c04030','#900010'][Math.min(dist,6)];
    return`<div class="ideo-mo-card${canAfford?'':' ideo-mo-disabled'}" onclick="${canAfford?`doReform('${key}')`:''}" style="border-color:${id.border};${canAfford?'':'opacity:.45;cursor:not-allowed'}">
      <span style="font-size:20px;flex-shrink:0">${id.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-family:Cinzel,serif;font-size:11px;color:${id.color};margin-bottom:3px">${id.name}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span style="font-size:8px;color:${canAfford?'#c8a030':'#666'}">💰 ${fa(cost)}g</span>
          <span style="font-size:8px;color:#8090a0">⏳ ${turns} months</span>
          <span style="font-size:8px;color:#c06050">😞 −${satHit}% satisfaction</span>
          <span style="font-size:8px;color:${distColor}">${distLabel}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  openModal('⚖ Reform Government',
    `<p class="mx">Current: <b style="color:${io.color}">${io.icon} ${io.name}</b> · Treasury: <b>${fa(gold)}g</b> · Avg. Satisfaction: <b>${avgSat}%</b></p>
     <p class="mx" style="font-size:9px;color:var(--dim)">During transition your state is weakened. More different ideologies cost more and take longer.</p>
     <div class="ideo-mo-list" style="margin-top:8px">${rows}</div>`,
    '<button class="btn dim" onclick="closeModal()">Cancel</button>'
  );
}

function doReform(key){
  const dist=ideoDist(G.ideology,key);
  const cost=200+dist*dist*80;
  const turns=3+dist*2;
  const satHit=dist*8;
  const PN=G.playerNation;
  if(G.gold[PN]<cost){popup('Not enough gold!');return;}
  G.gold[PN]-=cost;
  G.reforming=true;
  G.reformTarget=key;
  G.reformTurnsLeft=turns;
  G.reformTotalTurns=turns;
  // Immediate satisfaction hit across all provinces
  regsOf(PN).forEach(r=>{
    G.satisfaction[r]=Math.max(5,G.satisfaction[r]-satHit);
    G.instab[r]=Math.min(100,G.instab[r]+dist*5);
  });
  closeModal();
  updateHUD();updateIdeoHUD();scheduleDraw();
  const tgt=IDEOLOGIES[key];
  addLog(`⚖ Reform: transitioning to ${tgt.icon} ${tgt.name} (${turns} months)…`,'ideo');
  popup(`⚖ Reform begins — ${turns} months to completion`);
}

