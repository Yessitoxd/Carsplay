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

  document.addEventListener('DOMContentLoaded', () => {
    if (!requireAdmin()) return;
    document.getElementById('createStation').addEventListener('submit', createStation);
    loadStations();
  });

})();
