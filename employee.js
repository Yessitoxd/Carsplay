// employee.js - per-station timers, progress bar, start/reset controls
(function(){
  const pad = (n) => String(n).padStart(2,'0');
  const fmt = (s) => {
    const hrs = Math.floor(s/3600); const mins = Math.floor((s%3600)/60); const secs = s%60;
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  };

  // Global alarm audio (try several candidate paths; show friendly notice if missing)
  const ALARM_CANDIDATES = [];
  if (window.API_BASE) ALARM_CANDIDATES.push(window.API_BASE.replace(/\/$/, '') + '/Alarm.wav');
  ALARM_CANDIDATES.push('/Alarm.wav');
  ALARM_CANDIDATES.push('./Alarm.wav');
  ALARM_CANDIDATES.push('Alarm.wav');
  let alarmAudio = null;
  (function probeAlarm(){
    // try candidates sequentially; assign alarmAudio when one resolves
    const tryNext = (i) => {
        if (i >= ALARM_CANDIDATES.length) {
        console.warn('Alarm.wav not found at any candidate path');
        if (typeof showToast === 'function') showToast('Alarma no encontrada (Alarm.wav)', 4000, 'warning');
        alarmAudio = null;
        return;
      }
      const url = ALARM_CANDIDATES[i];
      fetch(url, { method: 'GET' }).then(res => {
        if (res.ok) {
          try {
            alarmAudio = new Audio(url);
            alarmAudio.loop = true;
            alarmAudio.load && alarmAudio.load();
            console.info('Alarm.wav loaded from', url);
          } catch (e) { alarmAudio = null; }
        } else {
          tryNext(i+1);
        }
        }).catch(() => { tryNext(i+1); });
    };
    tryNext(0);
  })();

  // Persistent storage keys
  const USER_KEY = 'carsplay_user';
  const STATE_KEY = 'carsplay_timers_v1';

  // cached time rates from server
  let TIME_RATES = [];

  // Map station number -> card id (populated on load)
  const STATION_BY_NUMBER = {};

  // Track runtime state per card id
  const state = {};

  function saveStateToStorage(){
    try {
      const simple = {};
      Object.keys(state).forEach(id => {
        const s = state[id];
        simple[id] = {
          running: !!s.running,
          startedAt: s.startedAt || null,
          accumulated: s.accumulated || 0,
          total: s.total || 0,
          plannedAmount: s.plannedAmount || 0,
          sessions: s.sessions || [],
          currentSession: s.currentSession !== undefined ? s.currentSession : null
        };
      });
      localStorage.setItem(STATE_KEY, JSON.stringify(simple));
    } catch (e) { console.warn('Could not save state', e); }
  }

  function loadStateFromStorage(){
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return {};
      return JSON.parse(raw);
    } catch (e){ return {}; }
  }

  function createCardElement(station, idx){
    const id = station._id || `s-${idx}`;
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.id = id;
    // Render thumbnail image if available, otherwise show placeholder text
    const thumbHtml = station.image
      ? `<div class="img"><img src="${station.image}" alt="${station.name || 'Carrito'}" style="width:100%;height:100%;object-fit:cover;border-radius:6px"/></div>`
      : `<div class="img">Imagen</div>`;

    // build duration select based on TIME_RATES (fallback to static options)
    let selectHtml = '';
    if (Array.isArray(TIME_RATES) && TIME_RATES.length > 0) {
      selectHtml = '<select class="duration">' + TIME_RATES.map(tr => `<option value="${tr.minutes}" data-amount="${tr.amount}">${tr.minutes} min</option>`).join('') + '</select>';
    } else {
      selectHtml = `
        <select class="duration">
          <option value="15">15 min</option>
          <option value="30" selected>30 min</option>
          <option value="45">45 min</option>
          <option value="60">60 min</option>
        </select>`;
    }

    div.innerHTML = `
      <div class="card-head">${thumbHtml}<h3>${station.name || 'Carrito'} #${station.number || (idx+1)}</h3></div>
      <div class="times"><div class="elapsed">00:00:00</div><div class="total">00:00:00</div></div>
      <div class="bar"><div class="bar-fill" style="width:0%"></div></div>
      <div class="controls">${selectHtml}<div class="price">C$ <span class="amount">${station.price || 0}</span></div></div>
      <div class="buttons"><button class="start">Iniciar</button><button class="pause-change" style="display:none">Detener</button><button class="change" style="display:none">Cambiar Carrito</button><button class="finish" style="display:none">Finalizar</button></div>
    `;

    return div;
  }

  function initCard(card, persisted){
    const id = card.dataset.id;
    // initialize state for this card
    if (!state[id]) state[id] = { running: false, startedAt: null, accumulated: 0, total: 0, amount: 0, timer: null, sessions: [], currentSession: null };
    const s = state[id];
    // element references inside this card
    const elapsedEl = card.querySelector('.elapsed');
    const totalEl = card.querySelector('.total');
    const fill = card.querySelector('.bar-fill');
    const durationSel = card.querySelector('.duration');
    const amountEl = card.querySelector('.amount');
    const startBtn = card.querySelector('.start');
    const stopBtn = card.querySelector('.pause-change');
    const changeBtn = card.querySelector('.change');
    const finishBtn = card.querySelector('.finish');

    // helper to compute elapsed seconds
    function getElapsed(){
      const base = s.accumulated || 0;
      if (s.running && s.startedAt){
        const delta = Math.floor((Date.now() - s.startedAt) / 1000);
        return base + delta;
      }
      return base;
    }

    // restore persisted state if present
    if (persisted){
      s.running = !!persisted.running;
      s.startedAt = persisted.startedAt || null;
      s.accumulated = persisted.accumulated || 0;
      s.total = persisted.total || 0;
      s.plannedAmount = persisted.plannedAmount || 0;
      s.sessions = persisted.sessions || [];
      s.currentSession = persisted.currentSession !== undefined ? persisted.currentSession : null;
      s.selectedMinutes = persisted.selectedMinutes || s.selectedMinutes || null;
      // if there is no active or unfinished session, clear elapsed/total so the card starts at 0
      const hasUnsettled = Array.isArray(s.sessions) && s.sessions.some(sess => sess && !sess.settled);
      const hasActive = s.running || (s.currentSession !== null) || hasUnsettled;
      if (!hasActive){
        s.accumulated = 0;
        s.total = 0;
        s.currentSession = null;
      }
    }

    // set duration select from persisted selectedMinutes (visual only)
    if (durationSel && s.selectedMinutes){
      try { durationSel.value = String(s.selectedMinutes); } catch(e){}
    }

    function updateUI(){
      const elapsed = getElapsed();
      elapsedEl.textContent = fmt(Math.max(0, elapsed));
      // show fixed total duration on the right (doesn't change while running)
      totalEl.textContent = fmt(s.total || 0);
      const pct = s.total > 0 ? Math.min(100, Math.round((elapsed / s.total) * 100)) : 0;
      fill.style.width = pct + '%';
      // show planned/current session amount (not included in panel total until settled)
      let displayAmt = 0;
      if (s.currentSession !== null && s.sessions && s.sessions[s.currentSession]) {
        displayAmt = s.sessions[s.currentSession].amount || s.plannedAmount || 0;
      } else {
        displayAmt = s.plannedAmount || 0;
      }
      amountEl.textContent = displayAmt;
    }

    // initialize total/amount based on selected duration option
    function applySelectedDuration(){
      if (!durationSel) return;
      const mins = parseInt(durationSel.value,10) || 0;
      const opt = durationSel.selectedOptions && durationSel.selectedOptions[0];
      const amt = opt && opt.dataset && opt.dataset.amount !== undefined ? parseFloat(opt.dataset.amount) : null;
      // DO NOT overwrite s.total here. Keep selectedMinutes as a template
      s.selectedMinutes = mins;
      // planned amount for display, but not settled until session finalizes
      if (amt !== null) s.plannedAmount = amt;
      else s.plannedAmount = 0;
    }

    // when user changes duration, update totals
    if (durationSel){
      durationSel.addEventListener('change', () => {
        applySelectedDuration();
        saveStateToStorage();
        updateUI();
        updatePanelTotal();
      });
    }

    function finishTimer(){
      // mark current session as ended
      if (s.currentSession !== null) {
        const sess = s.sessions[s.currentSession];
        sess.end = Date.now();
        sess.duration = s.total; // finished full time
        // amount: use planned amount or a computed fallback
        sess.amount = (sess.amount !== undefined) ? sess.amount : (s.plannedAmount || Math.round((s.total/60) * 1));
        sess.settled = false; // not yet paid until Finalizar or Detener
      }
      s.running = false; s.startedAt = null; s.accumulated = s.total;
      if (s.timer){ clearInterval(s.timer); s.timer = null; }
      startBtn.textContent = 'Iniciar';
      // show finish and another-round buttons and start alarm loop
      try {
        if (alarmAudio) {
          alarmAudio.currentTime = 0;
          alarmAudio.play().catch(err => {
            console.warn('Alarm playback blocked, will prompt user interaction', err);
            showToast && showToast('Toca la pantalla para activar el sonido', 4000, 'info');
            const onClickEnableSound = () => {
              try { alarmAudio.play().catch(()=>{}); } catch(e){}
              document.removeEventListener('click', onClickEnableSound);
            };
            document.addEventListener('click', onClickEnableSound);
          });
        }
      } catch(e){}
      if (finishBtn) { finishBtn.style.display = ''; }
      if (changeBtn) { changeBtn.style.display = ''; changeBtn.textContent = 'Otra ronda'; }
      // disable start until finalized or stopped
      startBtn.disabled = true;
      saveStateToStorage();
      updateUI();
      updatePanelTotal();
      refreshControls();
    }

    function tick(){
      const elapsed = getElapsed();
      if (s.total > 0 && elapsed >= s.total){ finishTimer(); return; }
      updateUI();
      refreshControls();
    }

    // restore running timer
    if (s.running && s.startedAt){
      // ensure startedAt is not in the future
      if (Date.now() - s.startedAt < 0) s.startedAt = Date.now();
      // start interval
      if (!s.timer) s.timer = setInterval(tick, 1000);
      startBtn.textContent = 'Pausar';
      if (stopBtn) stopBtn.style.display = '';
      if (changeBtn) changeBtn.style.display = '';
    }

    // if timer already completed, ensure UI shows amount
    // apply duration default before rendering
    applySelectedDuration();
    updateUI();
    // if already completed (from persisted state), trigger completion UI/alarm
      if (s.total > 0 && getElapsed() >= s.total) {
      finishTimer();
    }

    function refreshControls(){
      // decide visibility and labels according to state
      // completed state: elapsed >= total (show only Finalizar / Otra ronda)
      const elapsed = getElapsed();
      const completed = (s.total && elapsed >= s.total);
      if (completed){
        startBtn.textContent = 'Iniciar'; startBtn.disabled = true;
        if (stopBtn) stopBtn.style.display = 'none';
        if (changeBtn) { changeBtn.style.display = ''; changeBtn.textContent = 'Otra ronda'; }
        if (finishBtn) finishBtn.style.display = '';
        return;
      }

      if (!s.running && !s.currentSession){
        // idle
        startBtn.textContent = 'Iniciar'; startBtn.disabled = false;
        if (stopBtn) stopBtn.style.display = 'none';
        if (changeBtn) changeBtn.style.display = 'none';
        if (finishBtn) finishBtn.style.display = 'none';
      } else if (s.running){
        startBtn.textContent = 'Pausar'; startBtn.disabled = false;
        if (stopBtn) stopBtn.style.display = '';
        if (changeBtn) changeBtn.style.display = '';
        if (finishBtn) finishBtn.style.display = 'none';
      } else if (!s.running && s.currentSession !== null){
        // paused (but not completed)
        startBtn.textContent = 'Reanudar'; startBtn.disabled = false;
        if (stopBtn) stopBtn.style.display = '';
        if (changeBtn) changeBtn.style.display = '';
        if (finishBtn) finishBtn.style.display = 'none';
      }
    }

    startBtn.addEventListener('click', () => {
      if (!s.running){
        // start or resume
        const mins = parseInt(durationSel.value, 10) || (s.selectedMinutes || 0);
        if (!s.total) s.total = mins * 60;
        // start a new session record if none active
        if (s.currentSession === null) {
          const sess = { start: Date.now(), minutes: mins, amount: (durationSel.selectedOptions && durationSel.selectedOptions[0] && durationSel.selectedOptions[0].dataset.amount) ? parseFloat(durationSel.selectedOptions[0].dataset.amount) : null, settled: false };
          s.sessions.push(sess);
          s.currentSession = s.sessions.length - 1;
        }
        s.startedAt = Date.now();
        s.running = true;
        if (!s.timer) s.timer = setInterval(tick, 1000);
        startBtn.textContent = 'Pausar';
        // show stop/change buttons while running
        if (stopBtn) stopBtn.style.display = '';
        if (changeBtn) changeBtn.style.display = '';
        saveStateToStorage();
      } else {
        // pause
        if (s.startedAt) {
          const delta = Math.floor((Date.now() - s.startedAt) / 1000);
          s.accumulated += delta;
          // update current session accumulated time
          if (s.currentSession !== null) {
            const sess = s.sessions[s.currentSession];
            sess.accumulated = (sess.accumulated || 0) + delta;
          }
        }
        s.startedAt = null; s.running = false;
        if (s.timer){ clearInterval(s.timer); s.timer = null; }
        startBtn.textContent = 'Reanudar';
        // while paused, keep stop/change visible
        if (stopBtn) stopBtn.style.display = '';
        if (changeBtn) changeBtn.style.display = '';
        saveStateToStorage();
      }
      refreshControls();
      updatePanelTotal();
    });
    // stop (detener) - stop early but charge full amount
    if (stopBtn){
      stopBtn.addEventListener('click', () => {
        // stop alarm if playing
        try { if (alarmAudio) { alarmAudio.pause(); alarmAudio.currentTime = 0; } } catch(e){}
        if (s.timer){ clearInterval(s.timer); s.timer = null; }
        // compute elapsed so far and finalize current session
        if (s.startedAt) {
          const delta = Math.floor((Date.now() - s.startedAt) / 1000);
          s.accumulated += delta;
          if (s.currentSession !== null) {
            const sess = s.sessions[s.currentSession];
            sess.accumulated = (sess.accumulated || 0) + delta;
            sess.end = Date.now();
            sess.duration = sess.duration || (s.accumulated);
            // charge full originally selected total as requested
            sess.amount = sess.amount !== undefined && sess.amount !== null ? sess.amount : (s.plannedAmount || Math.round((s.total/60) * 1));
            sess.settled = true;
          }
        }
        s.startedAt = null; s.running = false;
        // hide change and stop buttons
        if (changeBtn) changeBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = 'none';
        // mark session settled already done above; reset UI counters
        s.currentSession = null;
        s.accumulated = 0; s.total = 0; s.plannedAmount = 0;
        // reset bar and timing display
        if (elapsedEl) elapsedEl.textContent = '00:00:00';
        if (totalEl) totalEl.textContent = fmt(0);
        if (fill) fill.style.width = '0%';
        // make Iniciar available again
        startBtn.textContent = 'Iniciar'; startBtn.disabled = false;
        saveStateToStorage();
        updateUI();
        updatePanelTotal();
        refreshControls();
      });
    }

    // change carrito - transfer session to another station (by number)
    if (changeBtn){
      changeBtn.addEventListener('click', async () => {
        // If this button is in 'Otra ronda' mode, start a new round flow
        if (changeBtn.textContent && changeBtn.textContent.toLowerCase().includes('otra')){
          // stop alarm and prepare for new round; do not settle previous session
          try { if (alarmAudio) { alarmAudio.pause(); alarmAudio.currentTime = 0; } } catch(e){}
          if (finishBtn) finishBtn.style.display = 'none';
          changeBtn.textContent = 'Cambiar Carrito';
          // allow starting a new session
          startBtn.disabled = false; startBtn.textContent = 'Iniciar';
          // reset currentSession so next start creates a new one
          s.currentSession = null;
          saveStateToStorage();
          updateUI();
          return;
        }
        // pause timer while entering destination
        if (s.running && s.startedAt) {
          const delta = Math.floor((Date.now() - s.startedAt) / 1000);
          s.accumulated += delta;
          if (s.currentSession !== null) {
            const sess = s.sessions[s.currentSession];
            sess.accumulated = (sess.accumulated || 0) + delta;
          }
          s.startedAt = null; s.running = false;
          if (s.timer){ clearInterval(s.timer); s.timer = null; }
          startBtn.textContent = 'Reanudar';
        }
        // prompt for destination station number
        const dest = window.prompt('Ingrese número de estación destino:');
        if (!dest) { saveStateToStorage(); return; }
        const destNum = parseInt(dest, 10);
        if (isNaN(destNum)) { showToast && showToast('Número inválido', 3000, 'warning'); saveStateToStorage(); return; }
        // find target card by number
        const allCards = Array.from(document.querySelectorAll('.card'));
        const targetCard = allCards.find(c => {
          const h = c.querySelector('h3');
          return h && h.textContent && h.textContent.indexOf('#' + destNum) !== -1;
        });
        if (!targetCard) { showToast && showToast('Estación destino no encontrada', 3000, 'warning'); saveStateToStorage(); return; }
        const sourceId = id;
        const targetId = targetCard.dataset.id;
        if (targetId === sourceId) { showToast && showToast('Ya estás en esa estación', 3000, 'info'); saveStateToStorage(); return; }
        // if target has active session, confirm overwrite
        const targetState = state[targetId];
        if (targetState && (targetState.running || (Array.isArray(targetState.sessions) && targetState.sessions.length>0))) {
          if (!confirm('La estación destino ya tiene una sesión. Sobrescribirla?')) { saveStateToStorage(); return; }
        }
        // transfer session data: move sessions array and running state
        state[targetId] = state[targetId] || { running:false, startedAt:null, accumulated:0, total:0, amount:0, timer:null, sessions:[], currentSession:null };
        // move current sessions to target
        state[targetId].sessions = (state[targetId].sessions || []).concat(s.sessions || []);
        state[targetId].accumulated = s.accumulated;
        state[targetId].total = s.total;
        state[targetId].plannedAmount = s.plannedAmount;
        // clear source
        delete state[sourceId];
        saveStateToStorage();
        // reload stations UI to reflect changes
        await loadStations();
      });
    }

    if (finishBtn){
      finishBtn.addEventListener('click', () => {
        // stop alarm loop and mark as finalized
        try { if (alarmAudio) { alarmAudio.pause(); alarmAudio.currentTime = 0; } } catch(e){}
        // keep timer at completed state but clear any running state
        if (s.timer){ clearInterval(s.timer); s.timer = null; }
        s.running = false; s.startedAt = null;
        // mark any completed (ended) sessions as settled (final payment)
        if (Array.isArray(s.sessions)){
          s.sessions.forEach(sess => {
            if (sess && sess.end && !sess.settled){
              sess.settled = true;
              sess.amount = sess.amount !== undefined && sess.amount !== null ? sess.amount : (sess.amount = (s.plannedAmount || Math.round((s.total/60) * 1)) );
            }
          });
        }
        startBtn.disabled = false; finishBtn.style.display = 'none';
        if (changeBtn) changeBtn.style.display = 'none';
        s.currentSession = null;
        // reset UI counters after finalizing
        s.accumulated = 0; s.total = 0; s.plannedAmount = 0;
        if (elapsedEl) elapsedEl.textContent = '00:00:00';
        if (totalEl) totalEl.textContent = fmt(0);
        if (fill) fill.style.width = '0%';
        saveStateToStorage();
        updateUI();
        updatePanelTotal();
        refreshControls();
      });
    }
  }

  function updatePanelTotal(){
    // Sum only settled (finalized/stopped) session amounts
    const total = Object.values(state).reduce((sum, s) => {
      if (!s || !Array.isArray(s.sessions)) return sum;
      const settled = s.sessions.reduce((ss, sess) => ss + ((sess && sess.settled && sess.amount) ? Number(sess.amount) : 0), 0);
      return sum + settled;
    }, 0);
    const el = document.getElementById('panelTotal');
    if (el) el.textContent = `C$ ${total}`;
  }

  async function loadStations(){
    let stations = null;
    try {
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
      // fetch time rates first (optional)
      try {
        const tr = await fetch((base || '') + '/api/time/rates');
        if (tr.ok) TIME_RATES = await tr.json();
      } catch(e) { TIME_RATES = []; }
      const res = await fetch((base || '') + '/api/stations');
      if (res.ok){ stations = await res.json(); }
    } catch (e){ /* ignore */ }

    const container = document.getElementById('stations');
    container.innerHTML = '';

    if (!stations || !Array.isArray(stations) || stations.length === 0){
      const msg = document.createElement('div');
      msg.className = 'no-stations';
      msg.textContent = 'No hay estaciones disponibles. Contacta al administrador.';
      container.appendChild(msg);
      return;
    }

    const persisted = loadStateFromStorage();
    stations.forEach((s, i)=>{
      const el = createCardElement(s, i);
      container.appendChild(el);
      initCard(el, persisted[el.dataset.id]);
    });

    updatePanelTotal();
  }

  function setupPanelAndUser(){
    // show user name from login
    const raw = localStorage.getItem(USER_KEY);
    let user = null;
    try { user = raw ? JSON.parse(raw) : null; } catch(e){}
    const name = (user && user.username) ? user.username : 'Empleado';
    const nameEls = document.querySelectorAll('#employeeName, #panelUser');
    nameEls.forEach(n => { if (n) n.textContent = name; });

    const toggle = document.getElementById('employeeToggle');
    const panel = document.getElementById('employeePanel');
    const logoutBtn = document.getElementById('logoutBtn');

    function setOpen(open){
      document.body.classList.toggle('panel-open', open);
      if (open) panel.classList.add('open'); else panel.classList.remove('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    }

    // Toggle via the button (or click on the name which is inside the button)
    toggle.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const isOpen = document.body.classList.contains('panel-open');
      setOpen(!isOpen);
    });

    // NOTE: panel only opens/closes via the user name toggle.
    // Do not close on outside clicks or Escape to preserve user preference.

    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem(USER_KEY);
      // keep timer state persisted, but navigate to login
      window.location.href = (window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '') + '/index.html';
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupPanelAndUser();
    loadStations();
  });

})();
