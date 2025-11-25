// employee.js - per-station timers, progress bar, start/reset controls
(function(){
  const pad = (n) => String(n).padStart(2,'0');
  const fmt = (s) => {
    const hrs = Math.floor(s/3600); const mins = Math.floor((s%3600)/60); const secs = s%60;
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  };

  // Track state per card id
  const state = {};

  function createCardElement(station, idx){
    const id = station._id || `s-${idx}`;
    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.id = id;

    div.innerHTML = `
      <div class="card-head"><div class="img">Imagen</div><h3>${station.name || 'Carrito #' + (idx+1)}</h3></div>
      <div class="times"><div class="elapsed">00:00:00</div><div class="remaining">00:00:00</div></div>
      <div class="bar"><div class="bar-fill" style="width:0%"></div></div>
      <div class="controls"><select class="duration">
          <option value="15">15 min</option>
          <option value="30" selected>30 min</option>
          <option value="45">45 min</option>
          <option value="60">60 min</option>
        </select><div class="price">C$ <span class="amount">${station.price || 0}</span></div></div>
      <div class="buttons"><button class="start">Iniciar</button><button class="reset">Restablecer</button></div>
    `;

    return div;
  }

  function initCard(card){
    const id = card.dataset.id;
    if (!state[id]) state[id] = { timer: null, elapsed: 0, total: 0 };

    const startBtn = card.querySelector('.start');
    const resetBtn = card.querySelector('.reset');
    const durationSel = card.querySelector('.duration');
    const elapsedEl = card.querySelector('.elapsed');
    const remainingEl = card.querySelector('.remaining');
    const fill = card.querySelector('.bar-fill');
    const amountEl = card.querySelector('.amount');

    function updateUI(){
      const s = state[id];
      elapsedEl.textContent = fmt(s.elapsed);
      const remaining = Math.max(0, s.total - s.elapsed);
      remainingEl.textContent = fmt(remaining);
      const pct = s.total > 0 ? Math.min(100, Math.round((s.elapsed / s.total) * 100)) : 0;
      fill.style.width = pct + '%';
    }

    function tick(){
      const s = state[id];
      s.elapsed += 1;
      updateUI();
      if (s.total > 0 && s.elapsed >= s.total){
        clearInterval(s.timer);
        s.timer = null;
        startBtn.textContent = 'Iniciar';
        const earned = Math.round((s.total/60) * 1);
        amountEl.textContent = earned;
      }
    }

    startBtn.addEventListener('click', () => {
      const s = state[id];
      if (!s.timer){
        const mins = parseInt(durationSel.value, 10) || 0;
        s.total = mins * 60;
        s.elapsed = 0;
        updateUI();
        s.timer = setInterval(tick, 1000);
        startBtn.textContent = 'Pausar';
      } else {
        clearInterval(s.timer);
        s.timer = null;
        startBtn.textContent = 'Reanudar';
      }
    });

    resetBtn.addEventListener('click', () => {
      const s = state[id];
      if (s.timer){ clearInterval(s.timer); s.timer = null; }
      s.elapsed = 0; s.total = 0;
      amountEl.textContent = '0';
      startBtn.textContent = 'Iniciar';
      updateUI();
    });

    updateUI();
  }

  async function loadStations(){
    let stations = null;
    try {
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
      const res = await fetch((base || '') + '/api/stations');
      if (res.ok){ stations = await res.json(); }
    } catch (e){ /* ignore */ }

    const container = document.getElementById('stations');
    container.innerHTML = '';

    if (!stations || !Array.isArray(stations) || stations.length === 0){
      // fallback: create 6 default stations
      stations = Array.from({length:6}).map((_,i)=>({ name: `Carrito #${i+1}`, price: 0 }));
    }

    stations.forEach((s, i)=>{
      const el = createCardElement(s, i);
      container.appendChild(el);
      initCard(el);
    });
  }

  document.addEventListener('DOMContentLoaded', loadStations);

})();
