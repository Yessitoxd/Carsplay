// admin.js - simple admin panel to create/list stations
(function(){
  const USER_KEY = 'carsplay_user';

  function getUser(){
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch(e){ return null; }
  }

  function requireAdmin(){
    const u = getUser();
    if (!u || (u.role || '').toLowerCase() !== 'admin') {
      // redirect to admin login
      window.location.href = (window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '') + '/admin_login.html';
      return false;
    }
    return true;
  }

  async function loadStations(){
    try {
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
      const res = await fetch((base || '') + '/api/stations');
      const list = document.getElementById('stationList');
      list.innerHTML = '';
      if (!res.ok) { list.textContent = 'No se pudieron cargar estaciones'; return; }
      const stations = await res.json();
      if (!Array.isArray(stations) || stations.length === 0){ list.textContent = 'No hay estaciones aún'; return; }
      stations.forEach(s => {
        const div = document.createElement('div');
        div.className = 'station-row';
        div.textContent = `${s.name} (#${s.number || '-'}) - C$ ${s.price || 0}`;
        list.appendChild(div);
      });
    } catch (e) { console.error(e); }
  }

  async function createStation(ev){
    ev.preventDefault();
    const name = document.getElementById('s-name').value.trim();
    const number = parseInt(document.getElementById('s-number').value,10) || undefined;
    const price = parseFloat(document.getElementById('s-price').value) || 0;
    if (!name) { alert('Nombre requerido'); return; }
    try {
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
      const res = await fetch((base || '') + '/api/stations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, number, price })
      });
      if (!res.ok) { const txt = await res.text(); alert('Error: ' + txt); return; }
      document.getElementById('s-name').value = '';
      document.getElementById('s-number').value = '';
      document.getElementById('s-price').value = '0';
      await loadStations();
    } catch (e){ console.error(e); alert('Error creando estación'); }
  }
  // Sidebar navigation and additional admin features
  function showSection(name){
    document.querySelectorAll('.admin-section').forEach(s => s.style.display = 'none');
    const el = document.getElementById('section-' + name);
    if (el) el.style.display = '';
  }

  async function downloadReport(){
    try {
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
      const res = await fetch((base || '') + '/api/time/logs');
      if (!res.ok) { alert('No se pudo obtener el reporte'); return; }
      const data = await res.json();
      // convert to CSV simple
      const csv = [];
      if (Array.isArray(data)){
        csv.push('username,stationId,start,end,duration_minutes');
        data.forEach(r => {
          csv.push(`${r.username || ''},${r.stationId || ''},${r.start || ''},${r.end || ''},${r.duration || ''}`);
        });
      }
      const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'report.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch (e){ console.error(e); alert('Error al descargar reporte'); }
  }

  async function populatePriceEditor(){
    try {
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
      const res = await fetch((base || '') + '/api/stations');
      const sel = document.getElementById('priceStation');
      sel.innerHTML = '';
      if (!res.ok) return;
      const stations = await res.json();
      stations.forEach(s => {
        const opt = document.createElement('option'); opt.value = s._id; opt.textContent = `${s.name} (#${s.number || '-'})`; sel.appendChild(opt);
      });
    } catch(e){ console.error(e); }
  }

  async function updatePrice(ev){
    ev.preventDefault();
    const stationId = document.getElementById('priceStation').value;
    const price = parseFloat(document.getElementById('priceValue').value) || 0;
    if (!stationId) { alert('Selecciona una estación'); return; }
    try {
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
      const res = await fetch((base || '') + '/api/stations/' + stationId, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price })
      });
      if (!res.ok) { alert('Error actualizando precio'); return; }
      alert('Precio actualizado');
      await loadStations();
      await populatePriceEditor();
    } catch(e){ console.error(e); alert('Error actualizando precio'); }
  }

  function setupSidebar(){
    document.querySelectorAll('.side-btn[data-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sec = btn.dataset.section;
        showSection(sec);
        if (sec === 'addCarritos') loadStations();
        if (sec === 'addPrices') populatePriceEditor();
      });
    });
    document.getElementById('sidebarLogout').addEventListener('click', () => {
      localStorage.removeItem(USER_KEY);
      window.location.href = (window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '') + '/admin_login.html';
    });
    const downloadBtn = document.getElementById('downloadReport');
    if (downloadBtn) downloadBtn.addEventListener('click', downloadReport);
    const updateBtn = document.getElementById('updatePrice');
    if (updateBtn) updateBtn.addEventListener('click', updatePrice);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!requireAdmin()) return;
    document.getElementById('createStation').addEventListener('submit', createStation);
    loadStations();
    setupSidebar();
    // show default section
    showSection('report');
  });

})();

