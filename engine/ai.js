// ══════════════════════════════════════════════════════════
//  AI ENGINE
//  BUG FIX: ~40 lines of AI income+conscript code previously
//  existed OUTSIDE the doAI function (after its closing brace
//  on the original line 3972). That code ran at script-load
//  time instead of each AI turn. It has been removed here
//  because doAI already contains equivalent logic in its
//  fullMonth income and conscript blocks above. The outer
//  orphan was a copy-paste duplicate — removing it is correct.
// ══════════════════════════════════════════════════════════

function doAI(fullMonth=true){
// fullMonth=true → income, buildings, conscript, upkeep
// fullMonth=false (weekly) → attacks, army movements only
  for(const ai of aliveNations()){
    const ar=regsOf(ai);if(!ar.length)continue;
    const aio=IDEOLOGIES[NATIONS[ai]&&NATIONS[ai].ideology||'nationalism'];
    const s=season();
    const isAtWar=G.war[ai]&&G.war[ai].some(w=>w);

    // Each AI nation has a persistent personality: aggressive or defensive
    // Stored in G.aiPersonality[ai] — set once, kept forever
    if(!G.aiPersonality)G.aiPersonality={};
    if(G.aiPersonality[ai]===undefined)G.aiPersonality[ai]=Math.random()<0.5?'aggressive':'defensive';
    const aggressive=G.aiPersonality[ai]==='aggressive';

    if(fullMonth){
      // ── Income ──────────────────────────────────────────
      for(const r of ar){
        let inc=G.income[r];
        if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
        if((G.buildings[r]||[]).includes('palace'))inc=Math.floor(inc*1.15);
        G.gold[ai]+=Math.floor(inc*aio.income*.78);
      }

      // ── Smart buildings ──────────────────────────────────
      // Aggressive: builds barracks+factory first; Defensive: fortress first
      const capIdx=ar.find(r=>PROVINCES[r]&&PROVINCES[r].isCapital);
      const borderProvs=ar.filter(r=>(NB[r]||[]).some(nb=>{const o=G.owner[nb];return o>=0&&o!==ai&&!areAllies(ai,o);}));
      const buildBudget=Math.floor(G.gold[ai]*(aggressive?0.25:0.2));
      let bSpent=0;

      // Priority list of (province, building, reason)
      const buildQueue=[];
      // Fortresses on borders
      for(const r of borderProvs){
        const blds=G.buildings[r]||[];
        if(!blds.includes('fortress')&&!(buildQueue.some(b=>b.r===r&&b.bld==='fortress')))
          buildQueue.push({r,bld:'fortress',priority:aggressive?2:4});
      }
      // Fortress on capital
      if(capIdx!==undefined){
        const blds=G.buildings[capIdx]||[];
        if(!blds.includes('fortress'))buildQueue.push({r:capIdx,bld:'fortress',priority:5});
        if(!blds.includes('palace'))buildQueue.push({r:capIdx,bld:'palace',priority:4});
        if(!blds.includes('barracks'))buildQueue.push({r:capIdx,bld:'barracks',priority:aggressive?5:3});
        if(!blds.includes('factory'))buildQueue.push({r:capIdx,bld:'factory',priority:3});
      }
      // Barracks on high-pop border provinces
      for(const r of borderProvs){
        if(G.pop[r]>20000&&!(G.buildings[r]||[]).includes('barracks'))
          buildQueue.push({r,bld:'barracks',priority:aggressive?3:2});
      }
      // Factories in interior high-income provinces
      const interior=ar.filter(r=>!borderProvs.includes(r));
      for(const r of interior.slice(0,3)){
        if(!(G.buildings[r]||[]).includes('factory'))
          buildQueue.push({r,bld:'factory',priority:2});
      }

      buildQueue.sort((a,b)=>b.priority-a.priority);
      for(const {r,bld} of buildQueue){
        if(bSpent>=buildBudget)break;
        const cost=BUILDINGS[bld]&&BUILDINGS[bld].cost||300;
        if(G.gold[ai]>=cost*0.9&&bSpent+cost<=buildBudget){
          const blds=G.buildings[r]||[];
          const maxSlots=PROVINCES[r]&&PROVINCES[r].isCapital?5:3;
          if(!blds.includes(bld)&&blds.length<maxSlots){
            G.gold[ai]-=cost; bSpent+=cost;
            G.buildings[r]=[...blds,bld];
          }
        }
      }

      // ── Conscript ────────────────────────────────────────
      // Aggressive: conscripts more; defensive: less but focuses borders
      const conscriptRate=aggressive?(isAtWar?0.22:0.12):(isAtWar?0.15:0.07);
      const conscriptBudget=Math.floor(G.gold[ai]*conscriptRate);
      let spent=0;
      const priorityProvs=[...new Set([
        ...(capIdx!==undefined?[capIdx]:[]),
        ...borderProvs
      ])];
      for(const r of priorityProvs){
        if(spent>=conscriptBudget)break;
        const popCap=Math.floor(G.pop[r]/10);
        const canRecruit=Math.max(0,Math.min(
          Math.floor(popCap*(aggressive?0.04:0.025)),
          conscriptBudget-spent, 100
        ));
        if(canRecruit>0&&G.army[r]<popCap){
          const actual=Math.min(canRecruit,popCap-G.army[r]);
          // Hex system: route through hwProcessDraftArrival so troops land on barracks hex.
          // Falls back to direct G.army increment if hex grid not ready.
          if(typeof _hexCache!=='undefined'&&_hexCache&&typeof hwProcessDraftArrival==='function'){
            hwProcessDraftArrival({prov:r, amount:actual, nation:ai});
          } else {
            G.army[r]+=actual;
          }
          G.pop[r]=Math.max(500,G.pop[r]-actual);
          G.gold[ai]-=actual; spent+=actual;
        }
      }

      // ── Upkeep ───────────────────────────────────────────
      for(const r of ar){
        G.pop[r]+=Math.floor(G.pop[r]*.004);
        G.instab[r]=Math.max(0,G.instab[r]-ri(1,4));
        if(G.assim[r]<100)G.assim[r]=Math.min(100,G.assim[r]+ri(1,3));
      }

      // ── Puppet tribute ────────────────────────────────────
      if(G.puppet.includes(ai)){
        G.gold[G.playerNation]+=Math.floor(ar.reduce((sum,r)=>{
          let inc=G.income[r];
          if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
          return sum+inc;
        },0)*.3);
      }
    // ── Income (AI 78% efficiency, second pass — removed duplicate; was orphaned code)
    } // end fullMonth

    // ── Attack (runs EVERY week) ─────────────────────────
    // Aggressive: 30% weekly chance; Defensive: 10% (both higher when at war)
    const atkChance=isAtWar?(aggressive?0.55:0.35):(aggressive?0.14:0.05);
    if(!inPeacePeriod()&&Math.random()<atkChance){
      const tgts=[];
      for(const r of ar){
        if(G.army[r]<200)continue;
        for(const nb of (NB[r]||[])){
          const nbo=G.owner[nb];
          if(nbo===ai||areAllies(ai,nbo))continue;
          if(nbo>=0&&G.pact[ai][nbo]){
            // Ceasefire break: only 4% weekly chance, only if aggressive personality
            const cfKey=`${Math.min(ai,nbo)}_${Math.max(ai,nbo)}`;
            const isCeasefire=G.ceasefire&&G.ceasefire[cfKey];
            const canBreak=isCeasefire&&aggressive&&Math.random()<0.04;
            if(!canBreak)continue;
            // Break the ceasefire
            G.pact[ai][nbo]=G.pact[nbo][ai]=false;
            G.pLeft[ai][nbo]=G.pLeft[nbo][ai]=0;
            if(G.ceasefire)delete G.ceasefire[cfKey];
            if(nbo===G.playerNation){
              addLog(`⚔ ${ownerName(ai)} broke the ceasefire!`,'war');
              popup(`⚠ ${ownerName(ai)} broke the ceasefire!`,3500);
            }
          }
          // Prefer capitals and provinces with buildings
          const hasCap=PROVINCES[nb]&&PROVINCES[nb].isCapital;
          const hasBld=(G.buildings[nb]||[]).length>0;
          const ratio=G.army[r]/Math.max(1,G.army[nb]);
          const minRatio=aggressive?1.2:1.8;
          if(ratio>=minRatio){
            const score=ratio*(hasCap?2.5:1)*(hasBld?1.5:1);
            tgts.push([r,nb,score]);
          }
        }
      }
      if(tgts.length){
        tgts.sort((a,b)=>b[2]-a[2]);
        const [fr2,to2]=tgts[0];
        const def=G.owner[to2];
        const sendFrac=aggressive?0.55:0.4;
        const send=Math.max(1,Math.floor(G.army[fr2]*sendFrac));
        if(def>=0&&def!==ai){G.war[ai][def]=true;G.war[def][ai]=true;}
        const frt=(G.buildings[to2]||[]).includes('fortress')?1.6:1;
        const terrMod=s.winterTerrain?.includes(PROVINCES[to2]?.terrain)?s.moveMod:1.0;
        const win=send*aio.atk*terrMod*rf(.75,1.25)>G.army[to2]*provTerrainDef(to2)*frt*rf(.75,1.25);
        if(win){
          const al=Math.floor(send*rf(.15,.3));
          G.army[fr2]-=send;G.army[to2]=Math.max(50,send-al);G.owner[to2]=ai;
          G.instab[to2]=ri(30,60);G.assim[to2]=ri(5,20);
          if((G.buildings[to2]||[]).includes('fortress'))
            G.buildings[to2]=(G.buildings[to2]||[]).filter(b=>b!=='fortress');
          if(def===G.playerNation){
            addLog(`⚔ ${ownerName(ai)} seized ${PROVINCES[to2].name}!`,'war');
            if(!G._enemyAttackQueue)G._enemyAttackQueue=[];
            G._enemyAttackQueue.push({fr:fr2,to:to2,atker:ai,send,win:true,al});
          }
          if(def>=0&&regsOf(def).length===0)G.war[ai][def]=G.war[def][ai]=false;
          if(PROVINCES[to2]&&PROVINCES[to2].isCapital&&def>=0)G.capitalPenalty[ai]=3;
        }else{
          G.army[fr2]=Math.max(0,G.army[fr2]-Math.floor(send*rf(.1,.28)));
          G.army[to2]=Math.max(50,G.army[to2]-Math.floor(G.army[to2]*rf(.08,.25)));
          if(def===G.playerNation&&Math.random()<0.35){
            if(!G._enemyAttackQueue)G._enemyAttackQueue=[];
            G._enemyAttackQueue.push({fr:fr2,to:to2,atker:ai,send,win:false,al:0});
          }
        }
      }
    }

    // ── Retreat from interior (weekly, 10% chance) ────────
    if(Math.random()<.1){
      for(const r of ar){
        const isBorder=(NB[r]||[]).some(nb=>G.owner[nb]!==ai);
        if(!isBorder&&G.army[r]>600){
          const dest=ar.find(d=>d!==r&&(NB[d]||[]).some(nb=>G.owner[nb]!==ai));
          if(dest){const mv=Math.floor(G.army[r]*.4);G.army[r]-=mv;G.army[dest]+=mv;}
        }
      }
    }
  }
}
