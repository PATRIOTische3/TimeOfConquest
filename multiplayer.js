// ════════════════════════════════════════════════════════════
//  TIME OF CONQUEST — ONLINE MULTIPLAYER v3
//  Firebase Realtime Database relay
//
//  Architecture (fixed):
//  - HOST owns the canonical game state + runs AI for all nations
//  - After host's turn: host runs AI, sends full G to guest
//  - Guest acts on their own copy, sends ONLY their delta (gold spent,
//    armies moved, buildings built) back to host
//  - Host applies guest delta, runs one more AI pass, syncs state
//  - playerNation is NEVER overwritten during syncs
// ════════════════════════════════════════════════════════════

const MP = (() => {

  const FB_URL = (window.TOC_FIREBASE_URL ||
    'https://timeofconquest-default-rtdb.europe-west1.firebasedatabase.app')
    .replace(/\/$/, '');

  // ── Internal state ────────────────────────────────────────
  let role        = null;   // 'host' | 'guest' | null
  let roomId      = null;
  let hostNation  = -1;
  let guestNation = -1;
  let myTurn      = false;
  let connected   = false;
  let _pollTimer  = null;
  let _seenKeys   = new Set();
  let _origEndTurn = null;

  // ── AFK Detection ─────────────────────────────────────────
  const AFK_WARN_MS   = 90_000;  // 1.5 min → show "are you there?" dialog
  const AFK_KICK_MS   = 60_000;  // +1 min of no response → disconnect
  let _afkWarnTimer   = null;
  let _afkKickTimer   = null;
  let _afkDialogOpen  = false;
  let _lastOpponentAct = 0;      // timestamp of last opponent activity (host tracks guest, guest tracks host)

  // Host sends a heartbeat ping to guest every 30s while waiting
  let _hbTimer = null;

  function _resetAfkWatch() {
    // Called when we know opponent is active (received any message)
    _lastOpponentAct = Date.now();
    clearTimeout(_afkWarnTimer);
    clearTimeout(_afkKickTimer);
    _afkDialogOpen = false;
    // Close AFK dialog if it was open
    const afkEl = document.getElementById('mp-afk-dialog');
    if (afkEl) afkEl.remove();
  }

  function _startAfkWatch() {
    // Start watching the opponent — called when we enter "waiting" state
    _lastOpponentAct = Date.now();
    clearTimeout(_afkWarnTimer);
    clearTimeout(_afkKickTimer);

    _afkWarnTimer = setTimeout(() => {
      if (!connected || myTurn) return; // if it's our turn now, no need
      _showAfkWarning();
    }, AFK_WARN_MS);
  }

  function _showAfkWarning() {
    if (_afkDialogOpen) return;
    _afkDialogOpen = true;
    // Send PING silently — no UI shown, just wait for PONG
    send('PING', { ts: Date.now() });
    // Kick timer — if no PONG received within AFK_KICK_MS
    _afkKickTimer = setTimeout(() => {
      _kickAfkPlayer();
    }, AFK_KICK_MS);
  }

  function _showKickBanner(msg) {
    // Remove old if present
    const old = document.getElementById('mp-kick-banner');
    if (old) old.remove();

    const banner = document.createElement('div');
    banner.id = 'mp-kick-banner';
    banner.style.cssText = [
      'position:fixed',
      'top:0','left:0','right:0',
      'z-index:700',
      'height:28px',
      'background:linear-gradient(90deg,#1a0404,#3a0808,#1a0404)',
      'border-bottom:1px solid rgba(200,40,40,.5)',
      'overflow:hidden',
      'display:flex',
      'align-items:center',
    ].join(';');

    const ticker = document.createElement('div');
    ticker.style.cssText = [
      'white-space:nowrap',
      'font-family:Cinzel,serif',
      'font-size:11px',
      'color:#ff6060',
      'letter-spacing:2px',
      'padding-left:100%',
      'animation:mpTickerScroll 8s linear forwards',
    ].join(';');
    ticker.textContent = `⚡ ${msg}`;

    // Inject keyframe if needed
    if (!document.getElementById('mp-ticker-style')) {
      const st = document.createElement('style');
      st.id = 'mp-ticker-style';
      st.textContent = '@keyframes mpTickerScroll{from{transform:translateX(0)}to{transform:translateX(-200%)}}';
      document.head.appendChild(st);
    }

    banner.appendChild(ticker);
    document.body.appendChild(banner);

    // Push game HUD down slightly
    const hud = document.getElementById('hud');
    if (hud) { hud.style.transition='margin-top .3s ease'; hud.style.marginTop='28px'; }

    // Auto-remove after animation + restore HUD
    setTimeout(() => {
      banner.remove();
      if (hud) { hud.style.marginTop=''; }
    }, 8500);
  }

  function _kickAfkPlayer() {
    if (!connected) return;
    const oppName = role === 'host'
      ? (NATIONS[guestNation] && NATIONS[guestNation].name || 'Guest')
      : (NATIONS[hostNation] && NATIONS[hostNation].name || 'Host');
    const oppNation = role === 'host' ? guestNation : hostNation;
    const natName = (NATIONS[oppNation] && NATIONS[oppNation].name) || oppName;

    // Close any stale dialog
    const dlg = document.getElementById('mp-afk-dialog');
    if (dlg) dlg.remove();
    _afkDialogOpen = false;

    // Notify opponent
    send('KICKED', { reason: 'afk' });

    // Show scrolling ticker
    _showKickBanner(`${oppName} (${natName}) was removed for inactivity — AI takes over`);

    addLog(`⚠ ${oppName} disconnected (AFK). AI takes over.`, 'warn');
    mpLog(`🤖 ${oppName} AFK-kicked — AI takes over`, 'warn');

    _convertToSingleplayer();
  }

  function _convertToSingleplayer() {
    stopPolling();
    clearTimeout(_afkWarnTimer);
    clearTimeout(_afkKickTimer);
    clearTimeout(_hbTimer);
    if (roomId) fbDelete(`rooms/${roomId}`);

    const wasGuest = role === 'guest';
    const aiNation = wasGuest ? hostNation : guestNation;

    role = null; roomId = null; connected = false; myTurn = true;

    // Restore original endTurn
    if (_origEndTurn) { window.endTurn = _origEndTurn; _origEndTurn = null; }

    // Hide MP UI elements
    const igBar = document.getElementById('mp-ingame-bar');
    if (igBar) igBar.style.display = 'none';
    const ind = document.getElementById('mp-turn-indicator-wrap');
    if (ind) ind.style.display = 'none';

    // Re-enable UI
    const sp = document.getElementById('side-panel');
    if (sp) { sp.style.opacity='1'; sp.style.pointerEvents=''; }
    const bottom = document.getElementById('bottom');
    if (bottom) { bottom.style.opacity='1'; bottom.style.pointerEvents=''; }
    const endBtn = document.getElementById('end-btn');
    const endBtnMob = document.getElementById('end-btn-mob');
    if (endBtn) endBtn.disabled = false;
    if (endBtnMob) endBtnMob.disabled = false;

    // The AI nation (the kicked player's nation) will now be handled by the normal AI in doAI()
    // We just need to make sure G.playerNation is set correctly
    // (it already is — we never changed it)

    addLog('🤖 Game continues as single player. AI controls the opponent.', 'diplo');
    scheduleDraw(); updateHUD();
  }

  // Guest delta — actions taken this turn to send to host
  let _delta = {
    armyMoves: [],   // [{from,to,amount}]
    drafts:    [],   // [{prov,amount,goldCost}]
    builds:    [],   // [{prov,building,cost}]
    attacks:   [],   // [{from,to,force}]
    goldSpent: 0,
  };

  // ── Firebase helpers ──────────────────────────────────────
  async function fbSet(path, data) {
    try {
      const r = await fetch(`${FB_URL}/${path}.json`, {
        method: 'PUT', body: JSON.stringify(data)
      });
      return r.ok;
    } catch(e) { return false; }
  }

  async function fbPush(path, data) {
    try {
      const r = await fetch(`${FB_URL}/${path}.json`, {
        method: 'POST',
        body: JSON.stringify({ ...data, _ts: Date.now() })
      });
      return r.ok;
    } catch(e) { return false; }
  }

  async function fbGet(path) {
    try {
      const r = await fetch(`${FB_URL}/${path}.json`);
      if (!r.ok) return null;
      return await r.json();
    } catch(e) { return null; }
  }

  async function fbDelete(path) {
    try { await fetch(`${FB_URL}/${path}.json`, { method: 'DELETE' }); } catch(e) {}
  }

  // ── UI ────────────────────────────────────────────────────
  function mpLog(msg, type='info') {
    const el = document.getElementById('mp-log');
    if (!el) return;
    const colors = { info:'#8a7848', ok:'#40a830', warn:'#cc8030', err:'#cc3030', chat:'#c9a84c' };
    const div = document.createElement('div');
    div.style.cssText = `padding:3px 0;border-bottom:1px solid rgba(42,36,24,.15);font-size:10px;color:${colors[type]||colors.info}`;
    div.innerHTML = `<span style="color:var(--dim);font-size:8px">${new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}</span> ${msg}`;
    el.insertAdjacentElement('afterbegin', div);
    while (el.children.length > 40) el.removeChild(el.lastChild);
  }

  function setStatus(text, type='idle') {
    const colors = { idle:'#555', connecting:'#c9a84c', ok:'#40a830', err:'#cc3030', waiting:'#8060c0' };
    const dot = document.getElementById('mp-status-dot');
    const txt = document.getElementById('mp-status-text');
    if (dot) dot.style.background = colors[type] || colors.idle;
    if (txt) txt.textContent = text;
    const igDot = document.getElementById('mp-ig-dot');
    const igTxt = document.getElementById('mp-ig-txt');
    const igBar = document.getElementById('mp-ingame-bar');
    if (igBar) igBar.style.display = connected ? 'flex' : 'none';
    if (igDot) igDot.style.background = colors[type] || colors.idle;
    if (igTxt) igTxt.textContent = text;
  }

  // Dim/undim the UI panels (not the map) while waiting
  function setWaitingUI(waiting) {
    myTurn = !waiting;
    // Disable action buttons and advance button
    const endBtn = document.getElementById('end-btn');
    const endBtnMob = document.getElementById('end-btn-mob');
    if (endBtn) endBtn.disabled = waiting;
    if (endBtnMob) endBtnMob.disabled = waiting;

    // Dim side panel content (not map) 
    const sp = document.getElementById('side-panel');
    const bottom = document.getElementById('bottom');
    if (sp) sp.style.opacity = waiting ? '0.4' : '1';
    if (sp) sp.style.pointerEvents = waiting ? 'none' : '';
    if (bottom) bottom.style.opacity = waiting ? '0.4' : '1';
    if (bottom) bottom.style.pointerEvents = waiting ? 'none' : '';

    // Show/hide slim turn indicator on map
    const indWrap = document.getElementById('mp-turn-indicator-wrap');
    const indicator = document.getElementById('mp-turn-indicator');
    const oppName = role === 'host'
      ? (NATIONS[guestNation]?.name || 'Opponent')
      : (NATIONS[hostNation]?.name || 'Opponent');
    if (indWrap) indWrap.style.display = connected ? 'block' : 'none';
    if (indicator) {
      indicator.textContent = waiting ? `⏳ ${oppName}'s turn` : '⚔ Your turn';
      indicator.style.color = waiting ? '#8060c0' : '#40a830';
    }
    // Show MP bar in HUD
    const igBar = document.getElementById('mp-ingame-bar');
    if (igBar) igBar.style.display = connected ? 'flex' : 'none';

    if (!waiting) {
      popup('⚔ Your turn!', 2000);
      addLog('── Your turn ──', 'diplo');
      setStatus('Your turn', 'ok');
      // Cancel AFK watch — it's our turn now
      clearTimeout(_afkWarnTimer);
      clearTimeout(_afkKickTimer);
    } else {
      setStatus('Opponent\'s turn…', 'waiting');
      // Start watching for AFK
      _startAfkWatch();
    }
  }

  // ── Send ─────────────────────────────────────────────────
  async function send(type, payload = {}) {
    if (!roomId) return;
    const channel = role === 'host' ? 'host_to_guest' : 'guest_to_host';
    await fbPush(`rooms/${roomId}/${channel}`, { type, ...payload });
  }

  // ── Poll ─────────────────────────────────────────────────
  function startPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(async () => {
      if (!roomId) return;
      const channel = role === 'host' ? 'guest_to_host' : 'host_to_guest';
      const msgs = await fbGet(`rooms/${roomId}/${channel}`);
      if (!msgs || typeof msgs !== 'object') return;
      const entries = Object.entries(msgs).sort((a,b) => (a[1]._ts||0)-(b[1]._ts||0));
      for (const [key, msg] of entries) {
        if (_seenKeys.has(key)) continue;
        _seenKeys.add(key);
        try { handleMessage(msg); } catch(e) { console.error('MP msg error', e); }
      }
    }, 1500);
  }

  function stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ── Apply state safely (never overwrite playerNation) ─────
  function applySyncedState(state) {
    const myPN = G.playerNation; // save
    const myIdeology = G.ideology; // save player ideology
    Object.assign(G, state);
    G.playerNation = myPN;        // restore
    G.ideology = myIdeology;      // restore
  }

  // ── Message handler ───────────────────────────────────────
  function handleMessage(msg) {
    // Any incoming message = opponent is active — reset AFK watch
    _resetAfkWatch();

    switch (msg.type) {

      case 'GUEST_ARRIVED':
        mpLog('👤 Guest connected!', 'ok');
        setStatus('Guest joined — awaiting nation pick', 'ok');
        connected = true;
        send('HELLO', { hostNation, availableNations: getAvailableNations() });
        break;

      case 'HELLO':
        hostNation = msg.hostNation;
        mpLog(`🤝 Host plays <b>${NATIONS[hostNation]?.name}</b>`, 'ok');
        showGuestNationPick(msg.availableNations);
        break;

      case 'NATION_PICK':
        guestNation = msg.nation;
        mpLog(`👤 Guest picked <b>${NATIONS[guestNation]?.name}</b>`, 'ok');
        const gpEl = document.getElementById('mp-guest-nation');
        if (gpEl) gpEl.textContent = NATIONS[guestNation]?.name || '?';
        const gj = document.getElementById('mp-guest-joined');
        const wt = document.getElementById('mp-waiting-text');
        if (gj) gj.style.display = 'block';
        if (wt) wt.style.display = 'none';
        document.getElementById('mp-start-game-btn')?.removeAttribute('disabled');
        break;

      case 'GAME_START': {
        // Guest receives full initial game state
        guestNation = msg.guestNation;
        hostNation  = msg.hostNation;
        // Apply state but set our own playerNation
        Object.assign(G, msg.state);
        G.playerNation = guestNation;
        G.ideology = NATIONS[guestNation]?.ideology || 'democracy';
        connected = true;
        show('game');
        setTimeout(() => {
          computeHexRadius(); buildCanvas(); zoomReset();
          updateHUD(); updateIdeoHUD(); updateSeasonUI();
          addLog('🌐 Multiplayer game started!', 'diplo');
          addLog(`You control: ${NATIONS[guestNation]?.name}`, 'event');
          _delta = emptyDelta();
          setWaitingUI(false); // guest goes first simultaneously with host
        }, 80);
        mpLog('🎮 Game started!', 'ok');
        break;
      }

      case 'HOST_STATE': {
        // Host sent updated state after processing turn
        // Guest applies it WITHOUT overwriting own playerNation
        applySyncedState(msg.state);
        updateHUD(); updateIdeoHUD(); updateSeasonUI(); scheduleDraw();
        if (G.sel >= 0) updateSP(G.sel);
        _delta = emptyDelta(); // clear delta for new turn
        setWaitingUI(false);   // guest's turn now
        mpLog('🔄 New turn synced', 'info');
        break;
      }

      case 'GUEST_STATE': {
        // Guest sent their delta for this turn
        // Host applies guest's actions then runs AI + endTurn for everyone
        applyGuestDelta(msg.delta);
        // Now run the actual game turn (AI + time advance)
        _origEndTurn();
        // Sync canonical state back to guest
        const snap = JSON.parse(JSON.stringify(G));
        send('HOST_STATE', { state: snap });
        setWaitingUI(false); // host's turn again
        mpLog('✅ Turn processed — waiting for guest', 'info');
        break;
      }

      case 'CHAT': {
        const who = msg.from === 'host'
          ? (NATIONS[hostNation]?.name || 'Host')
          : (NATIONS[guestNation]?.name || 'Guest');
        addLog(`💬 ${who}: ${msg.text}`, 'diplo');
        mpLog(`💬 <b>${who}:</b> ${msg.text}`, 'chat');
        popup(`💬 ${who}: ${msg.text}`, 3500);
        break;
      }

      case 'PING':
        // Opponent checked if we're alive — respond immediately
        send('PONG', { ts: Date.now() });
        break;

      case 'PONG': {
        // Opponent is alive — cancel kick, close dialog
        _resetAfkWatch();
        clearTimeout(_afkKickTimer);
        const dlg2 = document.getElementById('mp-afk-dialog');
        if (dlg2) dlg2.remove();
        _afkDialogOpen = false;
        mpLog('✅ Opponent responded — still connected', 'ok');
        // Restart AFK watch for this waiting period
        if (!myTurn) _startAfkWatch();
        break;
      }

      case 'KICKED':
        // We were kicked for AFK — convert to singleplayer on our end too
        _showKickBanner('You were removed for inactivity — game continues as single player');
        addLog('⚠ You were removed from the game (AFK). Switching to single player.', 'warn');
        _convertToSingleplayer();
        break;
    }
  }

  // ── Guest delta helpers ───────────────────────────────────
  function emptyDelta() {
    return { armyMoves:[], drafts:[], builds:[], attacks:[], goldSpent:0 };
  }

  function applyGuestDelta(delta) {
    if (!delta) return;
    const gn = guestNation;
    // Apply moves
    (delta.armyMoves||[]).forEach(({from,to,amount}) => {
      G.army[from] = Math.max(0, (G.army[from]||0) - amount);
      G.army[to] = (G.army[to]||0) + amount;
      if (G.owner[to] < 0) G.owner[to] = gn;
    });
    // Apply drafts
    (delta.drafts||[]).forEach(({prov,amount,goldCost}) => {
      G.army[prov] = (G.army[prov]||0) + amount;
      G.pop[prov] = Math.max(1000, (G.pop[prov]||0) - amount*1000);
      G.gold[gn] = Math.max(0, (G.gold[gn]||0) - goldCost);
    });
    // Apply builds
    (delta.builds||[]).forEach(({prov,building,cost}) => {
      G.gold[gn] = Math.max(0, (G.gold[gn]||0) - cost);
      (G.buildings[prov] = G.buildings[prov]||[]).push(building);
    });
    // Apply attacks (simplified: just record, runBattle handles UI on guest side)
    (delta.attacks||[]).forEach(({from,to,force}) => {
      // Re-resolve combat on host side
      const aio = IDEOLOGIES[NATIONS[gn]?.ideology||'democracy'];
      const terrain = TERRAIN[PROVINCES[to]?.terrain||'plains'];
      const hasFort = (G.buildings[to]||[]).includes('fortress');
      const defM = terrain.defB*(hasFort?1.6:1);
      const effAtk = force*aio.atk*rf(.75,1.25);
      const effDef = (G.army[to]||0)*defM*rf(.75,1.25);
      const win = effAtk > effDef;
      const prev = G.owner[to];
      if (win) {
        const al = Math.floor(force*rf(.15,.3));
        G.army[from] = Math.max(0,(G.army[from]||0)-force);
        G.army[to] = Math.max(50, force-al);
        G.owner[to] = gn;
        G.instab[to] = ri(30,60); G.assim[to] = ri(5,20);
        if (prev>=0 && regsOf(prev).length===0) G.war[gn][prev]=G.war[prev][gn]=false;
        if (PROVINCES[to]?.isCapital && prev>=0) G.capitalPenalty[gn]=3;
        addLog(`⚔ ${NATIONS[gn]?.name} seized ${PROVINCES[to]?.name}!`, 'war');
      } else {
        G.army[from] = Math.max(0,(G.army[from]||0)-Math.floor(force*rf(.1,.3)));
        G.army[to] = Math.max(50,(G.army[to]||0)-Math.floor((G.army[to]||0)*rf(.08,.25)));
      }
    });
  }

  // ── Intercept guest actions ───────────────────────────────
  // We patch key game functions to record guest's actions into _delta
  function patchGuestActions() {
    // Patch confirmMove
    const origMove = window.confirmMove;
    window.confirmMove = function(from, to) {
      if (role === 'guest' && myTurn) {
        const v = +(document.getElementById('msl')?.value || G.army[from]);
        const s = season();
        const terrMod = s.winterTerrain?.includes(PROVINCES[to].terrain)?s.moveMod:1.0;
        const actual = Math.round(v*terrMod);
        _delta.armyMoves.push({from, to, amount: actual});
      }
      origMove(from, to);
    };

    // Patch confirmDraft
    const origDraft = window.confirmDraft;
    window.confirmDraft = function() {
      if (role === 'guest' && myTurn) {
        const r = window._dr;
        const v = +(document.getElementById('dsl')?.value||0);
        if (r>=0 && v>0) _delta.drafts.push({prov:r, amount:v, goldCost:v});
      }
      origDraft();
    };

    // Patch queueBuild / doB
    const origBuild = window.queueBuild;
    window.queueBuild = function(k, ri2) {
      if (role === 'guest' && myTurn) {
        const io = ideol();
        const cost = Math.round(BUILDINGS[k].cost*(io.buildCostMod||1));
        _delta.builds.push({prov:ri2, building:k, cost});
      }
      if(origBuild) origBuild(k, ri2);
    };

    // Patch launchAtk
    const origLaunch = window.launchAtk;
    window.launchAtk = function(breakDiplo) {
      if (role === 'guest' && myTurn) {
        const fr = window._af, to = window._at;
        const force = +(document.getElementById('asl')?.value||G.army[fr]);
        _delta.attacks.push({from:fr, to, force});
        if(breakDiplo && G.owner[to]>=0) G.war[guestNation][G.owner[to]]=G.war[G.owner[to]][guestNation]=true;
      }
      if(origLaunch) origLaunch(breakDiplo);
    };
  }

  // ── Patch endTurn ─────────────────────────────────────────
  function patchEndTurn() {
    if (_origEndTurn) return;
    _origEndTurn = window.endTurn;
    window.endTurn = function() {
      if (role === 'host') {
        // Host runs full endTurn (includes AI for all non-player nations)
        _origEndTurn();
        // Send updated state to guest, wait for their delta
        setWaitingUI(true);
        send('HOST_STATE', { state: JSON.parse(JSON.stringify(G)) });
        mpLog('⏳ Sent turn to guest…', 'info');
        return;
      }
      if (role === 'guest') {
        // Guest sends delta, waits for host to process
        setWaitingUI(true);
        send('GUEST_STATE', { delta: _delta });
        _delta = emptyDelta();
        mpLog('📤 Sent actions to host…', 'info');
        return;
      }
      _origEndTurn();
    };
  }

  // ── Nation helpers ────────────────────────────────────────
  function getAvailableNations() {
    return NATIONS.map((n,i) => ({ i, name: n.name, color: n.color, ideology: n.ideology }))
      .filter(n => n.i !== hostNation);
  }

  function showGuestNationPick(nations) {
    const panel = document.getElementById('mp-guest-pick-panel');
    if (!panel) return;
    panel.style.display = 'flex';
    const list = document.getElementById('mp-guest-nation-list');
    if (!list) return;
    list.innerHTML = nations.map(n => `
      <div class="mp-nat-row" onclick="MP.pickGuestNation(${n.i})"
        style="display:flex;align-items:center;gap:9px;padding:7px 10px;background:rgba(0,0,0,.2);border:1px solid var(--border);cursor:pointer;margin-bottom:3px;transition:all .12s">
        <div style="width:14px;height:14px;border-radius:2px;background:${n.color};flex-shrink:0"></div>
        <span style="font-family:Cinzel,serif;font-size:10px;flex:1">${n.name}</span>
        <span style="font-size:8px;color:var(--dim)">${n.ideology}</span>
      </div>`).join('');
  }

  // ── PUBLIC API ────────────────────────────────────────────
  return {
    get role()      { return role; },
    get connected() { return connected; },
    get myTurn()    { return myTurn; },
    get active()    { return role !== null; },
    canAct()        { return !role || myTurn; },

    createRoom(nation) {
      hostNation = nation;
      role = 'host';
      roomId = Math.floor(100000 + Math.random() * 900000).toString();
      mpLog(`✅ Room: <b>${roomId}</b>`, 'ok');
      setStatus('Waiting for guest…', 'connecting');

      const ridEl = document.getElementById('mp-room-id');
      if (ridEl) { ridEl.textContent = roomId; }
      const disp = document.getElementById('mp-room-display');
      if (disp) disp.style.display = 'flex';
      const wt = document.getElementById('mp-waiting-text');
      if (wt) wt.style.display = 'flex';

      fbSet(`rooms/${roomId}/info`, { host: nation, created: Date.now() });
      _seenKeys.clear();
      startPolling();
      patchEndTurn();
    },

    joinRoom(id, nation) {
      if (!id?.trim()) { mpLog('Enter a room code!', 'warn'); return; }
      guestNation = nation;
      role = 'guest';
      roomId = id.trim();
      mpLog(`⏳ Joining ${roomId}…`, 'info');
      setStatus('Connecting…', 'connecting');

      fbGet(`rooms/${roomId}/info`).then(info => {
        if (!info) {
          mpLog('❌ Room not found', 'err');
          setStatus('Room not found', 'err');
          role = null; roomId = null;
          return;
        }
        mpLog('✅ Room found!', 'ok');
        setStatus('Waiting for host…', 'waiting');
        _seenKeys.clear();
        startPolling();
        patchEndTurn();
        patchGuestActions();
        send('GUEST_ARRIVED', { ts: Date.now() });
      });
    },

    pickGuestNation(i) {
      guestNation = i;
      document.querySelectorAll('.mp-nat-row').forEach(r => r.style.borderColor='var(--border)');
      send('NATION_PICK', { nation: i });
      mpLog(`✓ Picked <b>${NATIONS[i]?.name}</b>`, 'ok');
      document.getElementById('mp-join-ready-btn')?.removeAttribute('disabled');
    },

    startMultiplayerGame() {
      if (guestNation < 0) { popup('Guest hasn\'t picked a nation!'); return; }
      // Set up the game as host
      SC = hostNation; SI = NATIONS[hostNation].ideology;
      startGame(); // initialises full G, shows game screen
      G.playerNation = hostNation;
      G.ideology = NATIONS[hostNation].ideology;

      setTimeout(() => {
        const snap = JSON.parse(JSON.stringify(G));
        send('GAME_START', { hostNation, guestNation, state: snap });
        connected = true;
        patchGuestActions(); // also patch on host (no-op since role check guards it)
        setWaitingUI(false); // host goes first
        mpLog('🎮 Started — your turn', 'ok');
      }, 250);
    },

    guestReady() {
      mpLog('✅ Ready!', 'ok');
      setStatus('Waiting for host…', 'waiting');
      const pp = document.getElementById('mp-guest-pick-panel');
      if (pp) pp.style.display = 'none';
      const gw = document.getElementById('mp-guest-waiting');
      if (gw) gw.style.display = 'flex';
    },

    sendChat(text) {
      if (!text?.trim()) return;
      addLog(`💬 You: ${text}`, 'diplo');
      send('CHAT', { from: role, text: text.trim() });
    },

    disconnect() {
      stopPolling();
      clearTimeout(_afkWarnTimer);
      clearTimeout(_afkKickTimer);
      clearTimeout(_hbTimer);
      if (roomId) fbDelete(`rooms/${roomId}`);
      role = null; roomId = null; connected = false; myTurn = false;
      if (_origEndTurn) { window.endTurn = _origEndTurn; _origEndTurn = null; }
      setStatus('Disconnected', 'idle');
      mpLog('Disconnected', 'warn');
      // Restore UI
      const sp = document.getElementById('side-panel');
      if (sp) { sp.style.opacity='1'; sp.style.pointerEvents=''; }
    }
  };
})();
