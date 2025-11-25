// employee.js - per-station timers, progress bar, start/reset controls
(function(){
  const pad = (n) => String(n).padStart(2,'0');
  const fmt = (s) => {
    const hrs = Math.floor(s/3600); const mins = Math.floor((s%3600)/60); const secs = s%60;
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
  };

  // Track state per card id
  const state = {};

  function initCard(card){
    const id = card.dataset.id;
    state[id] = { timer: null, elapsed: 0, total: 0 };

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
        // calculate a simple earned amount: e.g., 1 currency unit per 15 minutes
        const earned = Math.round((s.total/60) * 1); // 1 per hour roughly
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
        // pause
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

    // initial UI
    updateUI();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.card[data-id]').forEach(initCard);
  });

})();
