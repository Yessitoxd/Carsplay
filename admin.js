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
        // display as Carrito #N for clarity
        div.textContent = `${s.name || 'Carrito'} #${s.number || '-'} `;
        list.appendChild(div);
      });
    } catch (e) { console.error(e); }
  }

  async function createStation(ev){
    ev.preventDefault();
    // gather fields and validate
    const numEl = document.getElementById('s-number');
    const fileEl = document.getElementById('s-image');
    // name is assigned by us (server/client) as 'Carrito'
    const name = 'Carrito';
    const number = numEl.value ? parseInt(numEl.value,10) : undefined;
    const file = fileEl.files && fileEl.files[0];

    // clear previous invalid state
    [numEl, fileEl].forEach(el => el.classList && el.classList.remove('invalid'));

    const missing = [];
    if (!number && number !== 0) missing.push(numEl);
    if (!file) missing.push(fileEl);
    if (missing.length) {
      missing.forEach(el => el.classList && el.classList.add('invalid'));
      missing[0].focus();
      showToast('Completa los campos marcados', 4000, 'warning');
      return;
    }
    try {
      // read image file, crop/resize to square on client side, then send base64 image
      const imgData = await fileToSquareDataUrl(file, 512);
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : 'https://carsplay.onrender.com';
      const res = await fetch((base || '') + '/api/stations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, number, image: imgData })
      });
      if (!res.ok) { const txt = await res.text(); showToast('Error: ' + txt, 4000, 'error'); return; }
      // success
      document.getElementById('createStation').reset();
      document.getElementById('imagePreview').innerHTML = '';
      await loadStations();
      showToast('Estación añadida correctamente', 5000, 'success');
    } catch (e){ console.error(e); showToast('Error creando estación', 4000, 'error'); }
  }

  // Convert file to square dataURL by center-cropping and resizing to `size` px
  function fileToSquareDataUrl(file, size){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('File read error'));
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          // compute square crop
          const s = Math.min(img.width, img.height);
          const sx = (img.width - s) / 2;
          const sy = (img.height - s) / 2;
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => reject(new Error('Image load error'));
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // small toast utility (type: success|error|warning)
  function showToast(text, ms = 4000, type = 'info'){
    const id = 'carsplay-toast';
    let t = document.getElementById(id);
    if (!t){
      t = document.createElement('div'); t.id = id; t.className = 'carsplay-toast'; document.body.appendChild(t);
    }
    t.textContent = text;
    t.className = 'carsplay-toast ' + type;
    t.style.opacity = '1';
    setTimeout(() => {
      t.style.opacity = '0';
    }, ms);
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
    // preview image when selected
    const imgInput = document.getElementById('s-image');
    if (imgInput){
      imgInput.addEventListener('change', (e) => {
        const file = imgInput.files && imgInput.files[0];
        const preview = document.getElementById('imagePreview');
        preview.innerHTML = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image(); img.src = reader.result;
          img.style.maxWidth = '120px'; img.style.maxHeight = '120px'; img.style.objectFit = 'cover'; img.style.borderRadius = '6px';
          // show dimension hint and validation
          img.onload = () => {
            // if not square, show a small note that it will be auto-cropped
            if (img.naturalWidth !== img.naturalHeight){
              const note = document.createElement('div'); note.className = 'image-note'; note.textContent = 'La imagen será recortada/ajustada a 1:1';
              preview.appendChild(img); preview.appendChild(note);
            } else {
              preview.appendChild(img);
            }
          };
        };
        reader.readAsDataURL(file);
      });
    }
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

