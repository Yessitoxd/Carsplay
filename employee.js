// employee.js - per-station timers, progress bar, start/reset controls
(function(){
  const pad = (n) => String(n).padStart(2,'0');
  const fmt = (s) => {
    const hrs = Math.floor(s/3600); const mins = Math.floor((s%3600)/60); const secs = s%60;
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  };

  // Global alarm audio (place Alarm.wav at project root / served statically)
  const ALARM_SRC = (window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '') + '/Alarm.wav';
  let alarmAudio = null;
  try {
    alarmAudio = new Audio(ALARM_SRC);
    alarmAudio.loop = true;
  } catch (e) { alarmAudio = null; }

  // Persistent storage keys
  const USER_KEY = 'carsplay_user';
  const STATE_KEY = 'carsplay_timers_v1';

  // cached time rates from server
  let TIME_RATES = [];

  // Track runtime state per card id
  const state = {};

  function saveStateToStorage(){
    try {
      const simple = {};
      Object.keys(state).forEach(id => {
        const s = state[id];
        simple[id] = { running: !!s.running, startedAt: s.startedAt || null, accumulated: s.accumulated || 0, total: s.total || 0, amount: s.amount || 0 };
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
      <div class="times"><div class="elapsed">00:00:00</div><div class="remaining">00:00:00</div></div>
      <div class="bar"><div class="bar-fill" style="width:0%"></div></div>
      <div class="controls">${selectHtml}<div class="price">C$ <span class="amount">${station.price || 0}</span></div></div>
      <div class="buttons"><button class="start">Iniciar</button><button class="reset">Restablecer</button><button class="finish" style="display:none">Finalizar</button></div>
    `;

    return div;
  }

  function initCard(card, persisted){
    const id = card.dataset.id;
    // initialize state for this card
    if (!state[id]) state[id] = { running: false, startedAt: null, accumulated: 0, total: 0, amount: 0, timer: null };
    const s = state[id];
    if (persisted){
      s.running = !!persisted.running;
      s.startedAt = persisted.startedAt || null;
      s.accumulated = persisted.accumulated || 0;
      s.total = persisted.total || 0;
      s.amount = persisted.amount || 0;
    }

    const startBtn = card.querySelector('.start');
    const resetBtn = card.querySelector('.reset');
    const finishBtn = card.querySelector('.finish');
    const durationSel = card.querySelector('.duration');
    const elapsedEl = card.querySelector('.elapsed');
    const remainingEl = card.querySelector('.remaining');
    const fill = card.querySelector('.bar-fill');
    const amountEl = card.querySelector('.amount');

    function getElapsed(){
      if (s.running && s.startedAt) {
        return s.accumulated + Math.floor((Date.now() - s.startedAt) / 1000);
      }
      return s.accumulated;
    }

    function updateUI(){
      const elapsed = getElapsed();
      elapsedEl.textContent = fmt(Math.max(0, elapsed));
      const remaining = Math.max(0, s.total - elapsed);
      remainingEl.textContent = fmt(remaining);
      const pct = s.total > 0 ? Math.min(100, Math.round((elapsed / s.total) * 100)) : 0;
      fill.style.width = pct + '%';
      amountEl.textContent = s.amount || 0;
    }

    // initialize total/amount based on selected duration option
    function applySelectedDuration(){
      if (!durationSel) return;
      const mins = parseInt(durationSel.value,10) || 0;
      const opt = durationSel.selectedOptions && durationSel.selectedOptions[0];
      const amt = opt && opt.dataset && opt.dataset.amount !== undefined ? parseFloat(opt.dataset.amount) : null;
      s.total = mins * 60;
      if (amt !== null) s.amount = amt; // use rate amount when provided
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
      // compute final amount (simple formula: 1 per hour)
      s.amount = Math.round((s.total/60) * 1);
      s.running = false; s.startedAt = null; s.accumulated = s.total;
      if (s.timer){ clearInterval(s.timer); s.timer = null; }
      startBtn.textContent = 'Iniciar';
      // show finish button and start alarm loop
      try {
        if (alarmAudio) { alarmAudio.currentTime = 0; alarmAudio.play().catch(()=>{}); }
      } catch(e){}
      if (finishBtn) { finishBtn.style.display = ''; }
      // optionally disable start until finalized
      startBtn.disabled = true;
      saveStateToStorage();
      updateUI();
      updatePanelTotal();
    }

    function tick(){
      const elapsed = getElapsed();
      if (s.total > 0 && elapsed >= s.total){ finishTimer(); return; }
      updateUI();
    }

    // restore running timer
    if (s.running && s.startedAt){
      // ensure startedAt is not in the future
      if (Date.now() - s.startedAt < 0) s.startedAt = Date.now();
      // start interval
      if (!s.timer) s.timer = setInterval(tick, 1000);
      startBtn.textContent = 'Pausar';
    }

    // if timer already completed, ensure UI shows amount
    // apply duration default before rendering
    applySelectedDuration();
    updateUI();
    // if already completed (from persisted state), trigger completion UI/alarm
    if (s.total > 0 && getElapsed() >= s.total) {
      finishTimer();
    }

    startBtn.addEventListener('click', () => {
      if (!s.running){
        // start or resume
        const mins = parseInt(durationSel.value, 10) || 0;
        if (!s.total) s.total = mins * 60;
        s.startedAt = Date.now();
        s.running = true;
        if (!s.timer) s.timer = setInterval(tick, 1000);
        startBtn.textContent = 'Pausar';
        saveStateToStorage();
      } else {
        // pause
        if (s.startedAt) s.accumulated += Math.floor((Date.now() - s.startedAt) / 1000);
        s.startedAt = null; s.running = false;
        if (s.timer){ clearInterval(s.timer); s.timer = null; }
        startBtn.textContent = 'Reanudar';
        saveStateToStorage();
      }
      updatePanelTotal();
    });
    resetBtn.addEventListener('click', () => {
      // stop alarm if playing
      try { if (alarmAudio) { alarmAudio.pause(); alarmAudio.currentTime = 0; } } catch(e){}
      if (s.timer){ clearInterval(s.timer); s.timer = null; }
      s.running = false; s.startedAt = null; s.accumulated = 0; s.total = 0; s.amount = 0;
      if (finishBtn) finishBtn.style.display = 'none';
      startBtn.textContent = 'Iniciar'; startBtn.disabled = false;
      saveStateToStorage();
      updateUI();
      updatePanelTotal();
    });

    if (finishBtn){
      finishBtn.addEventListener('click', () => {
        // stop alarm loop and mark as finalized
        try { if (alarmAudio) { alarmAudio.pause(); alarmAudio.currentTime = 0; } } catch(e){}
        // keep timer at completed state but clear any running state
        if (s.timer){ clearInterval(s.timer); s.timer = null; }
        s.running = false; s.startedAt = null;
        startBtn.disabled = false; finishBtn.style.display = 'none';
        saveStateToStorage();
        updateUI();
        updatePanelTotal();
      });
    }
  }

  function updatePanelTotal(){
    const total = Object.values(state).reduce((sum, s) => sum + (s.amount || 0), 0);
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

    // Close panel when clicking outside of it for convenience
    document.addEventListener('click', (ev) => {
      const target = ev.target;
      if (!panel.contains(target) && !toggle.contains(target)) {
        setOpen(false);
      }
    });

    // Allow Escape key to close the panel
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') setOpen(false);
    });

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
