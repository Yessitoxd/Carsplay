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
        // thumbnail
        const img = document.createElement('img');
        img.alt = s.name || 'Carrito';
        if (s.image) img.src = s.image; else img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"></svg>';
        div.appendChild(img);
        // title
        const title = document.createElement('div'); title.style.flex = '1'; title.textContent = `${s.name || 'Carrito'} #${s.number || '-'}`;
        div.appendChild(title);
        // actions
        const editBtn = document.createElement('button'); editBtn.className = 'btn secondary'; editBtn.textContent = 'Editar';
        editBtn.addEventListener('click', () => openEditModal(s));
        const delBtn = document.createElement('button'); delBtn.className = 'btn danger'; delBtn.textContent = 'Eliminar';
        delBtn.addEventListener('click', () => deleteStation(s._id));
        const actions = document.createElement('div'); actions.appendChild(editBtn); actions.appendChild(delBtn);
        div.appendChild(actions);
        list.appendChild(div);
      });
    } catch (e) { console.error(e); }
  }

  // delete station
  async function deleteStation(id){
    if (!confirm('Eliminar esta estación? Esta acción no se puede deshacer.')) return;
    try {
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
      const token = localStorage.getItem('carsplay_token');
      const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
      const res = await fetch((base || '') + '/api/stations/' + id, { method: 'DELETE', headers });
      if (!res.ok) { const txt = await res.text(); alert('Error eliminando: ' + txt); return; }
      showToast('Estación eliminada', 3000, 'success');
      await loadStations();
    } catch (e) { console.error(e); alert('Error eliminando estación'); }
  }

  // Edit modal handling
  function openEditModal(station){
    const modal = document.getElementById('editModal');
    const wrap = document.getElementById('editImageWrap');
    wrap.innerHTML = '';
    const img = document.createElement('img'); img.src = station.image || ''; img.style.width = '100%'; img.style.borderRadius = '6px';
    wrap.appendChild(img);
    document.getElementById('editNumber').value = station.number || '';
    modal.style.display = '';
    // attach save handler
    const form = document.getElementById('editForm');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const newNumber = parseInt(document.getElementById('editNumber').value,10);
      if (isNaN(newNumber)) { alert('Número inválido'); return; }
      try {
        const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
        const token = localStorage.getItem('carsplay_token');
        const headers = Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {});
        const res = await fetch((base || '') + '/api/stations/' + station._id, {
          method: 'PUT', headers, body: JSON.stringify({ number: newNumber })
        });
        if (res.status === 409) { alert('Ese número ya está ocupado'); return; }
        if (!res.ok) { const txt = await res.text(); alert('Error: ' + txt); return; }
        showToast('Estación actualizada', 3000, 'success');
        modal.style.display = 'none';
        await loadStations();
      } catch (err) { console.error(err); alert('Error actualizando'); }
    };
    document.getElementById('cancelEdit').onclick = () => { modal.style.display = 'none'; };
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
    if (!number && number !== 0) missing.push({ el: numEl, label: 'Número' });
    // Accept either an actual selected file or a preparedBlob from the cropper
    if (!file && !preparedBlob) missing.push({ el: fileEl, label: 'Imagen' });
    if (missing.length) {
      missing.forEach(item => item.el.classList && item.el.classList.add('invalid'));
      try { missing[0].el.focus(); } catch (e) {}
      if (missing.length === 1) showToast('Completa el campo: ' + missing[0].label, 4000, 'warning');
      else showToast('Completa los campos marcados', 4000, 'warning');
      return;
    }
    try {
      // determine blob to send: prefer preparedBlob from manual cropper if present
      let blob = preparedBlob || null;
      if (!blob && file) {
        // fallback: auto center-crop and resize
        const canvasDataUrl = await fileToSquareDataUrl(file, 512);
        blob = dataURLToBlob(canvasDataUrl);
      }
      const form = new FormData();
      form.append('name', name);
      form.append('number', number);
      form.append('image', blob, `carrito-${Date.now()}.jpg`);
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : 'https://carsplay.onrender.com';
      const token = localStorage.getItem('carsplay_token');
      const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
      const res = await fetch((base || '') + '/api/stations', {
        method: 'POST', headers, body: form
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

  function dataURLToBlob(dataURL){
    const parts = dataURL.split(',');
    const m = parts[0].match(/:(.*?);/);
    const mime = m ? m[1] : 'image/jpeg';
    const bstr = atob(parts[1]);
    let n = bstr.length; const u8 = new Uint8Array(n);
    while(n--) u8[n] = bstr.charCodeAt(n);
    return new Blob([u8], { type: mime });
  }

  // prepared blob from cropper (if user confirms manual crop)
  let preparedBlob = null;

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

  // --- Time rate management ---
  async function loadTimeRates(){
    try {
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
      const res = await fetch((base || '') + '/api/time/rates');
      const list = document.getElementById('timeRateList');
      list.innerHTML = '';
      if (!res.ok) { list.textContent = 'No se pudieron cargar tarifas'; return; }
      const rates = await res.json();
      if (!Array.isArray(rates) || rates.length === 0){ list.textContent = 'No hay tarifas aún'; return; }
      rates.forEach(r => {
        const row = document.createElement('div'); row.className = 'station-row';
        const title = document.createElement('div'); title.style.flex = '1'; title.textContent = `${r.minutes} min = C$ ${r.amount}`;
        const editBtn = document.createElement('button'); editBtn.className = 'btn secondary'; editBtn.textContent = 'Editar';
        editBtn.addEventListener('click', () => editTimeRate(r));
        const delBtn = document.createElement('button'); delBtn.className = 'btn danger'; delBtn.textContent = 'Eliminar';
        delBtn.addEventListener('click', () => deleteTimeRate(r._id));
        const actions = document.createElement('div'); actions.appendChild(editBtn); actions.appendChild(delBtn);
        row.appendChild(title); row.appendChild(actions);
        list.appendChild(row);
      });
    } catch (e){ console.error(e); }
  }

  async function createTimeRate(ev){
    ev.preventDefault();
    const minsEl = document.getElementById('tr-minutes');
    const amtEl = document.getElementById('tr-amount');
    const minutes = parseInt(minsEl.value,10);
    const amount = parseFloat(amtEl.value) || 0;
    if (!minutes || minutes <= 0) { showToast('Minutos inválidos', 3000, 'warning'); return; }
    try {
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
      const token = localStorage.getItem('carsplay_token');
      const headers = Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {});
      const res = await fetch((base || '') + '/api/time/rates', { method: 'POST', headers, body: JSON.stringify({ minutes, amount }) });
      if (!res.ok) { const txt = await res.text(); showToast('Error: ' + txt, 4000, 'error'); return; }
      minsEl.value = ''; amtEl.value = '';
      showToast('Tarifa añadida', 3000, 'success');
      await loadTimeRates();
    } catch (e){ console.error(e); showToast('Error creando tarifa', 3000, 'error'); }
  }

  async function editTimeRate(rate){
    // open modal to edit rate
    openTimeRateModal(rate);
  }

  // Modal handling for time rate edit
  let currentEditingRate = null;
  function openTimeRateModal(rate){
    currentEditingRate = rate || null;
    const modal = document.getElementById('timeRateModal');
    const mins = document.getElementById('tr-edit-minutes');
    const amt = document.getElementById('tr-edit-amount');
    mins.value = rate ? String(rate.minutes) : '';
    amt.value = rate ? String(rate.amount) : '';
    modal.style.display = '';
  }

  async function saveTimeRateFromModal(ev){
    ev.preventDefault();
    if (!currentEditingRate) return;
    const mins = parseInt(document.getElementById('tr-edit-minutes').value,10);
    const amt = parseFloat(document.getElementById('tr-edit-amount').value);
    if (isNaN(mins) || mins <= 0) { showToast('Minutos inválidos', 3000, 'warning'); return; }
    if (isNaN(amt) || amt < 0) { showToast('Monto inválido', 3000, 'warning'); return; }
    try {
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
      const token = localStorage.getItem('carsplay_token');
      const headers = Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {});
      const res = await fetch((base || '') + '/api/time/rates/' + currentEditingRate._id, { method: 'PUT', headers, body: JSON.stringify({ minutes: mins, amount: amt }) });
      if (!res.ok) { const txt = await res.text(); showToast('Error: ' + txt, 4000, 'error'); return; }
      showToast('Tarifa actualizada', 3000, 'success');
      document.getElementById('timeRateModal').style.display = 'none';
      currentEditingRate = null;
      await loadTimeRates();
    } catch (e){ console.error(e); showToast('Error actualizando tarifa', 3000, 'error'); }
  }

  async function deleteTimeRate(id){
    if (!confirm('Eliminar esta tarifa?')) return;
    try {
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
      const token = localStorage.getItem('carsplay_token');
      const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
      const res = await fetch((base || '') + '/api/time/rates/' + id, { method: 'DELETE', headers });
      if (!res.ok) { const txt = await res.text(); showToast('Error: ' + txt, 4000, 'error'); return; }
      showToast('Tarifa eliminada', 3000, 'success');
      await loadTimeRates();
    } catch (e){ console.error(e); showToast('Error eliminando tarifa', 3000, 'error'); }
  }

  async function updatePrice(ev){
    ev.preventDefault();
    const stationId = document.getElementById('priceStation').value;
    const price = parseFloat(document.getElementById('priceValue').value) || 0;
    if (!stationId) { alert('Selecciona una estación'); return; }
    try {
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
      const token = localStorage.getItem('carsplay_token');
      const headers = Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {});
      const res = await fetch((base || '') + '/api/stations/' + stationId, {
        method: 'PUT', headers,
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
        if (sec === 'addPrices') { populatePriceEditor(); loadTimeRates(); }
      });
    });
    document.getElementById('sidebarLogout').addEventListener('click', () => {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem('carsplay_token');
      window.location.href = (window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '') + '/admin_login.html';
    });
    const downloadBtn = document.getElementById('downloadReport');
    if (downloadBtn) downloadBtn.addEventListener('click', downloadReport);
    const updateBtn = document.getElementById('updatePrice');
    if (updateBtn) updateBtn.addEventListener('click', updatePrice);
    const createTR = document.getElementById('createTimeRate');
    if (createTR) createTR.addEventListener('submit', createTimeRate);
    // wire modal save/cancel for time rate editing
    const timeRateForm = document.getElementById('timeRateForm');
    if (timeRateForm) timeRateForm.addEventListener('submit', saveTimeRateFromModal);
    const cancelTR = document.getElementById('cancelTimeRate');
    if (cancelTR) cancelTR.addEventListener('click', () => { document.getElementById('timeRateModal').style.display = 'none'; currentEditingRate = null; });
    // image input and dropzone behavior
    const imgInput = document.getElementById('s-image');
    const dropzone = document.getElementById('imageDropzone');
    const preview = document.getElementById('imagePreview');
    function showFilePreview(file){
      preview.innerHTML = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image(); img.src = reader.result;
        img.style.width = '120px'; img.style.height = '120px'; img.style.objectFit = 'cover'; img.style.borderRadius = '6px';
        img.onload = () => {
          if (img.naturalWidth !== img.naturalHeight){
            const note = document.createElement('div'); note.className = 'image-note'; note.textContent = 'La imagen será recortada/ajustada a 1:1';
            preview.appendChild(img); preview.appendChild(note);
          } else {
            preview.appendChild(img);
          }
        };
      };
      reader.readAsDataURL(file);
    }

    if (imgInput){
      imgInput.addEventListener('change', (e) => { const file = imgInput.files && imgInput.files[0]; handleFileSelected(file); });
    }
    if (dropzone){
      // Only open file selector when clicking the dropzone itself — ignore clicks inside cropPanel or preview
      dropzone.addEventListener('click', (e) => {
        const cropPanelLocal = document.getElementById('cropPanel');
        if (cropPanelLocal && cropPanelLocal.style && cropPanelLocal.style.display !== 'none' && cropPanelLocal.contains(e.target)) return;
        const previewLocal = document.getElementById('imagePreview');
        if (previewLocal && previewLocal.contains(e.target)) return;
        imgInput && imgInput.click();
      });
      dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dz-hover'); });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dz-hover'));
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault(); dropzone.classList.remove('dz-hover');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f && imgInput){
          // assign file to input
          const dt = new DataTransfer(); dt.items.add(f); imgInput.files = dt.files; handleFileSelected(f);
        }
      });
    }

    // --- Cropper UI logic ---
    const cropPanel = document.getElementById('cropPanel');
    const cropViewport = document.getElementById('cropViewport');
    const cropImage = document.getElementById('cropImage');
    const cropZoom = document.getElementById('cropZoom');
    const confirmCrop = document.getElementById('confirmCrop');
    const cancelCrop = document.getElementById('cancelCrop');

    let cx = 0, cy = 0, scale = 1, imgW = 0, imgH = 0, dragging = false, startX = 0, startY = 0, startCx = 0, startCy = 0;

    function handleFileSelected(file){
      if (!file) return;
      showFilePreview(file);
      const reader = new FileReader();
      reader.onload = () => {
        cropImage.src = reader.result;
        // When image loads, if it's already square (1:1) accept it immediately
        preparedBlob = null;
        cropImage.onload = () => {
          imgW = cropImage.naturalWidth; imgH = cropImage.naturalHeight;
          if (imgW === imgH) {
            // image is already 1:1 — accept original file as preparedBlob and skip crop panel
            preparedBlob = file;
            // show final thumbnail (use reader.result)
            const prev = document.getElementById('imagePreview'); prev.innerHTML = '';
            const thumb = new Image(); thumb.src = reader.result; thumb.style.width = '120px'; thumb.style.height = '120px'; thumb.style.objectFit = 'cover'; thumb.style.borderRadius = '6px'; prev.appendChild(thumb);
            cropPanel.style.display = 'none';
            return;
          }
          // initial scale so image covers viewport for non-square images
          cropPanel.style.display = '';
          const vp = cropViewport.getBoundingClientRect();
          const fit = Math.max(vp.width / imgW, vp.height / imgH);
          scale = Math.max(fit, 1);
          cropZoom.value = scale.toFixed(2);
          cx = 0; cy = 0; applyTransform();
        };
      };
      reader.readAsDataURL(file);
    }

    function applyTransform(){
      cropImage.style.transform = `translate(${cx}px, ${cy}px) scale(${scale})`;
    }

    // drag handlers
    cropImage.addEventListener('pointerdown', (e) => { e.preventDefault(); dragging = true; startX = e.clientX; startY = e.clientY; startCx = cx; startCy = cy; cropImage.setPointerCapture && cropImage.setPointerCapture(e.pointerId); cropImage.style.cursor = 'grabbing'; });
    cropImage.addEventListener('pointermove', (e) => { if (!dragging) return; const dx = e.clientX - startX; const dy = e.clientY - startY; cx = startCx + dx; cy = startCy + dy; applyTransform(); });
    cropImage.addEventListener('pointerup', (e) => { dragging = false; cropImage.releasePointerCapture && cropImage.releasePointerCapture(e.pointerId); cropImage.style.cursor = 'grab'; });
    cropImage.addEventListener('pointercancel', () => { dragging = false; });

    cropZoom.addEventListener('input', (e) => { scale = parseFloat(e.target.value) || 1; applyTransform(); });

    cancelCrop.addEventListener('click', (e) => { e.preventDefault(); cropPanel.style.display = 'none'; preparedBlob = null; document.getElementById('createStation').reset(); document.getElementById('imagePreview').innerHTML = ''; });

    confirmCrop.addEventListener('click', (e) => {
      e.preventDefault();
      const vp = cropViewport.getBoundingClientRect();
      const size = Math.min(512, Math.round(vp.width));
      const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const imgDisplayW = imgW * scale; const imgDisplayH = imgH * scale;
      const imgLeft = cx + (cropViewport.clientWidth - imgDisplayW) / 2;
      const imgTop = cy + (cropViewport.clientHeight - imgDisplayH) / 2;
      const sx = Math.max(0, (0 - imgLeft) / scale);
      const sy = Math.max(0, (0 - imgTop) / scale);
      const sSize = Math.min(imgW - sx, imgH - sy, vp.width / scale, vp.height / scale);
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,size,size);
      ctx.drawImage(cropImage, sx, sy, sSize, sSize, 0, 0, size, size);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      preparedBlob = dataURLToBlob(dataUrl);
      document.getElementById('imagePreview').innerHTML = '';
      const thumb = new Image(); thumb.src = dataUrl; thumb.style.width = '120px'; thumb.style.height = '120px'; thumb.style.objectFit = 'cover'; thumb.style.borderRadius = '6px';
      document.getElementById('imagePreview').appendChild(thumb);
      cropPanel.style.display = 'none';
    });
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

