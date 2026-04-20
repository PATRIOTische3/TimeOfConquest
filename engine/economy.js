// ══════════════════════════════════════════════════════════
//  ECONOMY — Tax, Income, Loans, Resources, Construction, Reform
// ══════════════════════════════════════════════════════════

// ── ECONOMY ───────────────────────────────────────────────
// Max tax rate per ideology
var TAX_MAX={
  nazism:90, fascism:80, stalinism:85, communism:75,
  militarism:70, nationalism:65, monarchy:60,
  socialdem:55, democracy:50, liberalism:45,
};

function taxMax(){ return TAX_MAX[G.ideology]||60; }

function openEconomy(){ openTaxation(); }

function openTaxation(){
  const PN=G.playerNation;
  const io=ideol();
  const mr=regsOf(PN);
  const avgSat=mr.length?Math.round(mr.reduce((s,r)=>s+(G.satisfaction[r]??70),0)/mr.length):70;
  const curTax=G.taxRate??25;
  const maxTax=taxMax();
  const curInc=mr.reduce((s,r)=>{
    let inc=G.income[r];
    if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
    if((G.buildings[r]||[]).includes('palace'))inc=Math.floor(inc*1.15);
    const taxFactor=0.4+(curTax/100)*2.4;
    return s+Math.floor(inc*io.income*taxFactor);
  },0);

  // Tax mood description
  const taxLabel=curTax<=10?'🟢 Very Low':curTax<=25?'🟢 Low':curTax<=40?'🟡 Moderate':curTax<=60?'🟠 High':curTax<=80?'🔴 Very High':'💀 Extreme';
  const satEffect=curTax<=10?'+15% sat':curTax<=25?'+5% sat':curTax<=40?'neutral':curTax<=60?'−10% sat':curTax<=80?'−25% sat':'−40% sat';

  const html=`
    <p class="mx" style="margin-bottom:10px">Tax rates affect both income and popular opinion.</p>

    <div style="background:rgba(201,168,76,.05);border:1px solid var(--border2);padding:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-family:Cinzel,serif;font-size:11px;color:var(--gold)">TAX RATE</span>
        <span style="font-size:10px;color:var(--dim)">${io.icon} Max: <b style="color:var(--gold)">${maxTax}%</b></span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <input type="range" id="tax-sl" min="0" max="${maxTax}" value="${curTax}" oninput="updTaxPreview()" style="flex:1">
        <span style="font-family:Cinzel,serif;font-size:16px;color:var(--gold);min-width:42px;text-align:right" id="tax-val">${curTax}%</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--dim);margin-bottom:8px">
        <span>Current: <b style="color:var(--gold)">${taxLabel}</b></span>
        <span>Pop mood: <b id="tax-mood-lbl" style="color:var(--gold)">${satEffect}</b></span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--dim);margin-bottom:10px">
        <span>Est. monthly income: <b id="tax-inc-preview" style="color:var(--gold)">${fa(curInc)}g</b></span>
        <span>Avg. satisfaction: <b style="color:${avgSat<40?'#ff6040':avgSat<60?'#c08020':'#40c040'}">${avgSat}%</b></span>
      </div>
      <button class="btn grn" style="width:100%;padding:8px" onclick="applyTaxRate()">✓ Apply Tax Rate</button>
    </div>

  `;
  openMo('💰 ECONOMY & TAXATION', html, [{lbl:'Close',cls:'dim'}]);
  // store for preview
  window._econMr=mr;
  window._econIo=io;
}

function buildTurns(r, key){
  // Low satisfaction = longer construction
  // satisfaction >70: normal; 40-70: +50%; <40: doubled or worse
  const sat=G.satisfaction[r]??70;
  const base=BUILD_TURNS[key]||2;
  let mult=1;
  if(sat<40) mult=2.0+Math.floor((40-sat)/10)*0.5; // 2x at 40%, up to ~4x at 10%
  else if(sat<70) mult=1.0+(70-sat)/60;             // 1x→1.5x
  return Math.max(1,Math.round(base*mult));
}

function openBuild(){
  const si=G.sel;
  if(si<0||G.owner[si]!==G.playerNation){popup('Select your territory!');return;}
  // Check if construction already queued here
  if(G.construction[si]){
    const c=G.construction[si];
    const b=BUILDINGS[c.building];
    openModal('Construction in Progress',
      `<p class="mx">Building <b>${b?.icon} ${b?.name}</b> in <b>${PROVINCES[si].name}</b></p>
       <div style="margin:10px 0">
         <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--dim);margin-bottom:4px"><span>Progress</span><span>${c.totalTurns-c.turnsLeft}/${c.totalTurns} months</span></div>
         <div style="height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden"><div style="height:100%;background:var(--gold);border-radius:3px;width:${Math.round((c.totalTurns-c.turnsLeft)/c.totalTurns*100)}%;transition:width .3s"></div></div>
       </div>
       <p class="mx" style="font-size:9px;color:var(--dim)">Completes in <b>${c.turnsLeft}</b> more month${c.turnsLeft!==1?'s':''}.</p>`,
      `<button class="btn red" onclick="cancelConstruction(${si})">✕ Cancel (lose 50% gold)</button>
       <button class="btn dim" onclick="closeModal()">Close</button>`
    );
    return;
  }
  const p=PROVINCES[si],io=ideol(),cm=io.buildCostMod||1;
  const maxBld=p.isCapital?MAX_BLD_CAP:MAX_BLD_NORM,ex=G.buildings[si]||[];
  if(ex.length>=maxBld){popup(`Building limit (${maxBld}) reached!`);return;}
  const sat=G.satisfaction[si]??70;
  const satNote=sat<40
    ?`<p class="mx warn">⚠ Low satisfaction (${Math.round(sat)}%) — construction takes <b>longer</b> and costs more.</p>`
    :sat<70
    ?`<p class="mx" style="font-size:9px;color:#c08030">⚠ Satisfaction ${Math.round(sat)}% — mild construction delays.</p>`:'';
  const opts=Object.entries(BUILDINGS).filter(([k,b])=>!ex.includes(k)&&(!b.capitalOnly||p.isCapital)&&(!b.needsCoast||p.isCoastal)&&(!b.needsRes||(G.resBase[si][b.needsRes]||0)>0));
  const html=`<p class="mx">Build in <b>${p.name}</b>${p.isCapital?' ★':''} · Slots: <b>${ex.length}/${maxBld}</b> · Gold: <b>${fa(G.gold[G.playerNation])}</b></p>
  ${satNote}
  <div class="tlist">${opts.map(([k,b])=>{
    const cost=Math.round(b.cost*cm*(sat<40?1+(40-sat)/50:1)); // cost penalty when unhappy
    const turns=buildTurns(si,k);
    const ok=G.gold[G.playerNation]>=cost;
    return`<div class="ti${ok?'':' ene'}" onclick="${ok?`queueBuild('${k}',${si})`:''}" ${ok?'':'style="cursor:not-allowed"'}>
      <span class="tn">${b.name}</span>
      <span class="ta">${b.desc}<br>
        <span style="color:${ok?'#c8a030':'#555'}">${fa(cost)}g</span>
        <span style="color:#8090a0;margin-left:4px">⏳${turns}mo</span>
      </span>
    </div>`;
  }).join('')}</div>`;
  openModal('CONSTRUCTION',html,'<button class="btn dim" onclick="closeModal()">Cancel</button>');
}

window.queueBuild=function(k,ri2){
  closeModal();
  const io=ideol();
  const sat=G.satisfaction[ri2]??70;
  const cm=io.buildCostMod||1;
  const cost=Math.round(BUILDINGS[k].cost*cm*(sat<40?1+(40-sat)/50:1));
  if(G.gold[G.playerNation]<cost){popup('Insufficient gold!');return;}
  G.gold[G.playerNation]-=cost;
  const turns=buildTurns(ri2,k);
  G.construction[ri2]={building:k,turnsLeft:turns,totalTurns:turns,cost};
  scheduleDraw();updateHUD();if(G.sel===ri2)updateSP(ri2);
  addLog(`🏗 ${PROVINCES[ri2].short}: ${BUILDINGS[k].name} construction started (${turns}mo).`,'build');
  popup(`✓ Building ${BUILDINGS[k].name} — completes in ${turns} months`);
};

// Keep old doB as alias for compatibility
function doB(k,ri2){window.queueBuild(k,ri2);}

window.cancelConstruction=function(ri2){
  const c=G.construction[ri2];if(!c)return;
  const refund=Math.floor(c.cost*.5);
  G.gold[G.playerNation]+=refund;
  G.construction[ri2]=null;
  closeModal();
  scheduleDraw();updateHUD();if(G.sel===ri2)updateSP(ri2);
  addLog(`🏗 ${PROVINCES[ri2].short}: construction cancelled (+${refund}g refund).`,'build');
  popup(`Construction cancelled — ${fa(refund)}g refunded`);
};

function processConstruction(){
  const PN=G.playerNation;
  regsOf(PN).forEach(r=>{
    const c=G.construction[r];if(!c)return;
    c.turnsLeft--;
    if(c.turnsLeft<=0){
      (G.buildings[r]=G.buildings[r]||[]).push(c.building);
      G.construction[r]=null;
      addLog(`✅ ${PROVINCES[r].short}: ${BUILDINGS[c.building]?.name} completed!`,'build');
      popup(`✅ ${BUILDINGS[c.building]?.name} built in ${PROVINCES[r].short}!`,3000);
      if(G.sel===r)updateSP(r);
    }
  });
}


// ── LOANS ─────────────────────────────────────────────────
function openLoan(){
  const existing=G.loans.length;
  const debt=G.loans.reduce((s,l)=>s+l.amount,0);
  const opts=[
    {amt:500, monthly:30, months:18},
    {amt:1000,monthly:55, months:20},
    {amt:2000,monthly:100,months:22},
  ];
  const html=`<p class="mx">Borrow from the <b>World Bank</b>. Monthly repayment deducted automatically.</p>
  <p class="mx">Current debt: <b style="color:${debt>0?'#ff8844':'#60cc50'}">${fa(debt)} gold</b> · Active loans: <b>${existing}</b></p>
  <div class="tlist">${opts.map(o=>`<div class="ti grn" onclick="takeLoan(${o.amt},${o.monthly},${o.months})"><span class="tn">🏦 ${fa(o.amt)} gold</span><span class="ta">${fa(o.monthly)}/mo × ${o.months}mo<br>Total: ${fa(o.monthly*o.months)}</span></div>`).join('')}</div>
  <p class="mx" style="font-size:9px;color:var(--dim)">Failure to pay → instability rises in all territories.</p>`;
  openMo('WORLD BANK — LOAN',html,[{lbl:'Close',cls:'dim'}]);
}
function takeLoan(amount,monthly,months){
  closeMo();
  G.gold[G.playerNation]+=amount;
  G.loans.push({amount,monthly,monthsLeft:months,origMonths:months});
  addLog(`🏦 Loan: +${fa(amount)} gold. Repay ${fa(monthly)}/mo × ${months}mo.`,'loan');
  popup(`✓ ${fa(amount)} gold received. Monthly: ${fa(monthly)}/mo`);
  updateHUD();
}
function processLoans(){
  let paid=0;
  G.loans=G.loans.filter(loan=>{
    const pay=Math.min(loan.monthly,G.gold[G.playerNation]);
    G.gold[G.playerNation]-=pay;loan.amount-=pay;loan.monthsLeft--;paid+=pay;
    if(pay<loan.monthly){
      // Can't pay — instability
      regsOf(G.playerNation).forEach(r=>G.instab[r]=Math.min(100,G.instab[r]+ri(2,6)));
      addLog(`🏦 Loan default! +instability.`,'revolt');
    }
    return loan.amount>0&&loan.monthsLeft>0;
  });
}

// ── RESOURCES ─────────────────────────────────────────────
function gatherResources(){
  // Reset pool
  G.resPool={oil:0,coal:0,grain:0,steel:0};
  regsOf(G.playerNation).forEach(i=>{
    const base=G.resBase[i]||{};
    const blds=G.buildings[i]||[];
    let mult=1;
    if(blds.includes('oilwell'))base.oil=(base.oil||0)+2;
    if(blds.includes('mine')){base.coal=(base.coal||0)+2;base.steel=(base.steel||0)+1;}
    if(blds.includes('granary')){base.grain=(base.grain||0)+2;}
    Object.keys(base).forEach(k=>{if(G.resPool[k]!==undefined)G.resPool[k]+=base[k]*mult;});
  });
  // Resource effects — silent (no log spam)
  const PN=G.playerNation;
  if(G.resPool.coal<5){
    G.gold[PN]=Math.max(0,G.gold[PN]-ri(20,50));
  }
  if(G.resPool.grain<8){
    regsOf(PN).forEach(r=>G.instab[r]=Math.min(100,G.instab[r]+ri(0,2)));
  }
  if(G.resPool.grain>20){
    regsOf(PN).forEach(r=>G.pop[r]+=Math.floor(G.pop[r]*.002));
  }
}


// NOTE: openSponsor() and processResistance() live in events.js — not duplicated here.

// ── TAX PREVIEW (called by slider in openTaxation modal) ──
function updTaxPreview(){
  const sl=document.getElementById('tax-sl');if(!sl)return;
  const newRate=+sl.value;
  const valEl=document.getElementById('tax-val');
  if(valEl)valEl.textContent=newRate+'%';
  const io=window._econIo||ideol();
  const mr=window._econMr||regsOf(G.playerNation);
  const taxMod=newRate/100;
  const taxFactor=0.4+taxMod*2.4;
  const newInc=mr.reduce((s,r)=>{
    let inc=G.income[r];
    if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
    if((G.buildings[r]||[]).includes('palace'))inc=Math.floor(inc*1.15);
    return s+Math.floor(inc*io.income*taxFactor);
  },0);
  const incPrev=document.getElementById('tax-inc-preview');
  if(incPrev)incPrev.textContent=fa(newInc)+'g';
  const moodEl=document.getElementById('tax-mood-lbl');
  if(moodEl){
    const mood=newRate<=10?'+15% sat':newRate<=25?'+5% sat':newRate<=40?'neutral':newRate<=60?'−10% sat':newRate<=80?'−25% sat':'−40% sat';
    moodEl.textContent=mood;
  }
}

// ── APPLY TAX RATE ────────────────────────────────────────
function applyTaxRate(){
  const sl=document.getElementById('tax-sl');if(!sl)return;
  const newRate=+sl.value;
  const old=G.taxRate??25;
  G.taxRate=newRate;
  // Tax mood delta — tracks sentiment change from tax shift
  const delta=newRate-old;
  if(Math.abs(delta)>0){
    regsOf(G.playerNation).forEach(r=>{
      G.taxMood[r]=(G.taxMood[r]||0)-delta*0.4; // negative = higher tax = bad mood
    });
  }
  closeMo();
  addLog(`💰 Tax rate set to ${newRate}%.`,'event');
  popup(`✓ Tax rate: ${newRate}%`);
  updateHUD();scheduleDraw();
}

function openAppease(){
  var PN=G.playerNation;
  var mr=regsOf(PN);
  var avgSat=mr.length?Math.round(mr.reduce(function(s,r){return s+(G.satisfaction[r]||70);},0)/mr.length):70;
  var cost1=Math.max(25,mr.length*10);
  var cost2=Math.max(50,mr.length*20);
  var cost3=Math.max(100,mr.length*40);
  var satCol=avgSat<40?'#ff6040':avgSat<60?'#c08020':'#40c040';
  var g=G.gold[PN];
  var h='<p class="mx" style="margin-bottom:8px">Raise satisfaction across all provinces.</p>';
  h+='<p class="mx" style="margin-bottom:12px">Avg sat: <b style="color:'+satCol+'">'+avgSat+'%</b> &middot; Gold: <b>'+fa(g)+'g</b></p>';
  h+='<div style="display:flex;gap:6px">';
  h+='<button class="btn" style="flex:1;padding:10px 4px;border-color:rgba(100,50,200,.5);color:#b090ff;text-align:center;opacity:'+(g>=cost1?1:0.4)+'" onclick="appeasePop(100,\'small\')">&#x1F35E;<br><b>Small</b><br><span style="font-size:8px;color:var(--dim)">'+fa(cost1)+'g +4-8%</span></button>';
  h+='<button class="btn" style="flex:1;padding:10px 4px;border-color:rgba(100,50,200,.5);color:#b090ff;text-align:center;opacity:'+(g>=cost2?1:0.4)+'" onclick="appeasePop(100,\'medium\')">&#x1F3AA;<br><b>Festival</b><br><span style="font-size:8px;color:var(--dim)">'+fa(cost2)+'g +8-15%</span></button>';
  h+='<button class="btn" style="flex:1;padding:10px 4px;border-color:rgba(100,50,200,.5);color:#b090ff;text-align:center;opacity:'+(g>=cost3?1:0.4)+'" onclick="appeasePop(100,\'grand\')">&#x1F451;<br><b>Grand</b><br><span style="font-size:8px;color:var(--dim)">'+fa(cost3)+'g +14-22%</span></button>';
  h+='</div>';
  openMo('APPEASE POPULATION', h, [{lbl:'Close',cls:'dim'}]);
}

// ── APPEASE POPULATION ────────────────────────────────────
function appeasePop(dummy, size){
  const PN=G.playerNation;
  const mr=regsOf(PN);
  const cost1=Math.max(25,mr.length*10);
  const cost2=Math.max(50,mr.length*20);
  const cost3=Math.max(100,mr.length*40);
  let cost,minGain,maxGain;
  if(size==='small'){       cost=cost1; minGain=4;  maxGain=8;  }
  else if(size==='medium'){ cost=cost2; minGain=8;  maxGain=15; }
  else {                    cost=cost3; minGain=14; maxGain=22; }
  if(G.gold[PN]<cost){closeMo();popup('Insufficient gold!');return;}
  G.gold[PN]-=cost;
  mr.forEach(r=>{
    const gain=ri(minGain,maxGain);
    G.satisfaction[r]=Math.min(100,(G.satisfaction[r]||70)+gain);
    G.instab[r]=Math.max(0,(G.instab[r]||0)-Math.floor(gain/2));
  });
  closeMo();
  const labels={small:'Bread distribution',medium:'Grand festival'};
  addLog(`🎉 ${labels[size]||'Royal celebration'}: +${minGain}–${maxGain}% satisfaction nationwide.`,'event');
  popup(`🎉 People appeased! +${minGain}–${maxGain}% satisfaction`);
  updateHUD();scheduleDraw();
}
