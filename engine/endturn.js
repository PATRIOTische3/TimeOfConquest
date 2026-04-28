// ══════════════════════════════════════════════════════════
//  END TURN — main weekly/monthly game loop
// ══════════════════════════════════════════════════════════

function endTurn(){
  setEB(true);cancelMove();cancelNaval();
  try{
  // Advance one week; check if new month
  const newMonth = advanceWeek();

  // ── Weekly light processing (every tick) ──────────────
  const io=ideol(),PN=G.playerNation,s=season();

  // Epidemic runs every week (scaled down)
  processEpidemics(newMonth);

  // Fleet arrivals every week
  resolveNavalArrivals();
  // Execute queued moves (instant, no animation needed)
  executeMoveQueue();
  processDraftQueue(); // advance draft timers every week
  processAssimCosts(); // deduct assimilation gold cost weekly

  if(!newMonth){
    doAI(false); // weekly — attacks, retreats only
    scheduleDraw();updateHUD();updateSeasonUI();
    if(G.sel>=0)updateSP(G.sel);chkBtns();
  } else {
  // ════════════════════════════════════════════
  //  MONTHLY PROCESSING (only on new month)
  // ════════════════════════════════════════════

  // Resources
  gatherResources();

  // Process loans
  processLoans();

  // Process construction queue
  processConstruction();

  // ── Process reform transition ──────────────────────────
  if(G.reforming){
    G.reformTurnsLeft--;
    if(G.reformTurnsLeft<=0){
      G.ideology=G.reformTarget;
      G.reforming=false;G.reformTarget='';G.reformTurnsLeft=0;G.reformTotalTurns=0;
      const newIo=IDEOLOGIES[G.ideology];
      addLog(`⚖ Reform complete — now ${newIo.icon} ${newIo.name}!`,'ideo');
      popup(`⚖ Transition complete! New government: ${newIo.icon} ${newIo.name}`,4000);
      updateIdeoHUD();
    } else {
      addLog(`⚖ Reform: ${G.reformTurnsLeft} months remaining…`,'ideo');
    }
  }

  // ── Player income + growth ─────────────────────────────
  const taxRate=G.taxRate??25;
  const taxMod=taxRate/100; // 0 to 1
  // Tax income multiplier: 0% tax = 0 income from pop taxes, 100% = full
  // Base province income stays, pop-based tax bonus scales with taxRate
  regsOf(PN).forEach(r=>{
    const sat=G.satisfaction[r]??70;
    const satIncomeMod=sat<40?0.80:1.0;
    const reformMod=G.reforming?0.80:1.0;

    let inc = (typeof hwGetProvIncome === 'function')
      ? hwGetProvIncome(r, PN)
      : G.income[r];
    if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
    if((G.buildings[r]||[]).includes('palace'))inc=Math.floor(inc*1.15);
    // Tax rate scales income: 25% base = full income, lower = less, higher = more
    const taxIncomeFactor=0.4+taxMod*2.4; // 0% tax→0.4x income, 25%→1.0x, 50%→1.6x, 100%→2.8x
    inc=Math.floor(inc*io.income*satIncomeMod*reformMod*(1-Math.min(.5,G.instab[r]/100))*s.incomeMod*taxIncomeFactor);
    G.gold[PN]+=inc;

    // Population growth
    let pgr=G.pop[r]*.005*io.popGrowth*(sat<40?0.5:sat<60?0.8:1.0);
    if((G.buildings[r]||[]).includes('hospital'))pgr*=1.1;
    if((G.buildings[r]||[]).includes('granary'))pgr*=1.15;
    G.pop[r]+=Math.floor(pgr);

    // Assimilation passive (old assim field — kept for compat display)
    if(G.assim[r]<100)G.assim[r]=Math.min(100,G.assim[r]+ri(1,3)*(io.assimSpeed||1));

    // ── Instability decay (new system) ─────────────────────
    // Natural decay is very slow and stops at 25% floor (foreign province barrier)
    // Phase 1: 100→50: −0.25/week  Phase 2: 50→25: −0.5/week
    const instab=G.instab[r]||0;
    const isConquered = PROVINCES[r].nation !== G.playerNation; // foreign province
    const instabFloor = isConquered ? 25 : 0;
    let instabDec = 0;
    if(instab > 50) instabDec = 0.25;
    else if(instab > 25) instabDec = 0.5;
    else if(!isConquered) instabDec = ri(1,3)*(io.instabDecay||1); // own historical: normal decay below 25
    // Buildings still help on own provinces
    if(!isConquered){
      if((G.buildings[r]||[]).includes('fortress'))instabDec+=5;
      if((G.buildings[r]||[]).includes('palace'))instabDec+=6;
    }
    G.instab[r]=Math.max(instabFloor, instab - instabDec);

    // Active assimilation processing (weekly)
    const aq = G.assimQueue&&G.assimQueue[r];
    if(aq){
      const def=ASSIM_DEFS[aq.type];
      if(def){
        // Instab reduction this week
        let instabDrop;
        if(aq.type==='harsh'){
          instabDrop=harshRate(aq.weekIdx||0);
        } else {
          instabDrop=def.instabRate;
        }
        G.instab[r]=Math.max(0, G.instab[r]-instabDrop);

        // Pop loss this week — random within type's range, distributed over 48w
        const weeklyLossMin=def.popLossMin/48;
        const weeklyLossMax=def.popLossMax/48;
        const weeklyLoss=weeklyLossMin+(weeklyLossMax-weeklyLossMin)*Math.random();
        const popLoss=Math.floor(G.pop[r]*weeklyLoss);
        G.pop[r]=Math.max(aq.popFloor||Math.floor(G.pop[r]*0.28), G.pop[r]-popLoss);

        aq.weekIdx=(aq.weekIdx||0)+1;
        aq.weeksLeft--;

        // End conditions
        if(aq.weeksLeft<=0||G.instab[r]<=0||G.owner[r]!==G.playerNation){
          G.assimQueue[r]=null;
          if(G.owner[r]===G.playerNation){
            addLog(`✅ ${PROVINCES[r].short}: assimilation complete. Instab ${Math.round(G.instab[r])}%.`,'info');
          }
        }
      }
    }

    // Supply penalty — only if army is VERY oversized (3x pop/10), and milder
    if(G.army[r]>G.pop[r]/10*3) G.instab[r]=Math.min(100,G.instab[r]+1);

    // Disease effects now in processEpidemics

    // ── Satisfaction update ──────────────────────────────
    const taxBaseline = taxRate<=10?80:taxRate<=25?70:taxRate<=40?60:taxRate<=60?50:taxRate<=80?38:28;
    const natSat = Math.round((io.popGrowth>1?72:io.atk>1.2?55:65)*0.4 + taxBaseline*0.6);
    let satDelta=0;
    if(sat<natSat) satDelta+=ri(1,3);
    if(sat>natSat) satDelta-=ri(0,1); // reduced: was 0-2
    // instab affects sat only at very high levels, and more mildly
    if(G.instab[r]>70) satDelta-=1;
    if(G.instab[r]>90) satDelta-=1;
    const atWarWithAnyone=G.war[PN]?.some(w=>w);
    if(atWarWithAnyone) satDelta-=ri(0,1); // reduced: was 0-2
    if(G.reforming) satDelta-=ri(0,1);    // reduced: was 1-3
    if(G.provDisease?.[r]){
      const ep=G.epidemics?.find(e=>e.id===G.provDisease[r]&&e.active);
      if(ep) satDelta-=ri(1,Math.ceil(ep.type.satHit/6)); // milder: was /4
    }
    if((G.buildings[r]||[]).includes('palace')) satDelta+=ri(1,2);
    if((G.buildings[r]||[]).includes('hospital')) satDelta+=1;
    if(G.taxMood&&G.taxMood[r]){
      satDelta+=Math.sign(G.taxMood[r])*Math.min(4,Math.ceil(Math.abs(G.taxMood[r])/3));
      G.taxMood[r]=Math.abs(G.taxMood[r])<0.5?0:G.taxMood[r]*0.88;
    }
    // Hard floor: satisfaction cannot drop below 5 naturally (revolt is separate)
    G.satisfaction[r]=Math.max(5,Math.min(100,sat+satDelta));

    // Revolt check — only at near-zero satisfaction (extremely rare)
    const revoltChance=G.satisfaction[r]<5?0.04:0; // reduced threshold and chance
    if(Math.random()<revoltChance)triggerRevolt(r,io);
  });

  if(G.capitalPenalty[PN]>0)G.capitalPenalty[PN]--;

  // Puppet tribute — collected once per month (not per province)
  G.puppet.forEach(pp=>{
    regsOf(pp).forEach(pr=>{
      let pi = (typeof hwGetProvIncome === 'function')
        ? hwGetProvIncome(pr, pp)
        : G.income[pr];
      if((G.buildings[pr]||[]).includes('factory'))pi=Math.floor(pi*1.8);
      G.gold[PN]+=Math.floor(pi*.3);
    });
  });

  // NAP expiry
  for(let a=0;a<NATIONS.length;a++)for(let b=0;b<NATIONS.length;b++)if(G.pact[a][b]){G.pLeft[a][b]--;if(G.pLeft[a][b]<=0){G.pact[a][b]=false;G.pLeft[a][b]=0;}}

  // Resistance
  processResistance();

  // AI turns — full monthly processing (income, buildings, conscript)
  doAI(true);

  // Random event (monthly)
  if(Math.random()<.25)randEvent(io);

  // ── Autosave every new month (slot 0, overwrites) ──────────
  autoSave();

  scheduleDraw();updateHUD();updateSeasonUI();
  if(G.sel>=0)updateSP(G.sel);chkBtns();checkDefeat();
  } // end else (monthly)
  }catch(e){console.error('endTurn error:',e);}
  // Run queued player battles (async, battle animations), then re-enable button
  executeBattleQueue(()=>{
    scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);chkBtns();chkVic();checkDefeat();
    setEB(false);
  });
}

