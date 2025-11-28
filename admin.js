// admin.js - simple admin panel to create/list stations
(function(){
  const USER_KEY = 'carsplay_user';

  // Ensure a sensible API base in case the HTML did not inject `window.API_BASE` (e.g. stale deploy)
  if (!window.API_BASE) {
    window.API_BASE = 'https://carsplay.onrender.com';
    console.info('admin.js: window.API_BASE not found — defaulting to', window.API_BASE);
  }

  function getUser(){
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch(e){ return null; }
  }

  function requireAdmin(){
    const u = getUser();
    if (!u || (u.role || '').toLowerCase() !== 'admin') {
      // redirect to admin login (frontend)
      window.location.href = '/admin_login.html';
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
        // resolve image URL so that root-relative paths (/api/...) are requested from the API host
        let imgSrc = s.image || '';
        try { if (imgSrc && imgSrc.startsWith('/') && window.API_BASE) imgSrc = window.API_BASE.replace(/\/$/, '') + imgSrc; } catch(e){}
        if (imgSrc) img.src = imgSrc; else img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"></svg>';
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
      if (!res.ok) { await handleFetchError(res); return; }
      showToast('Estación eliminada', 3000, 'success');
      await loadStations();
    } catch (e) { console.error(e); alert('Error eliminando estación'); }
  }

  // Edit modal handling
  function openEditModal(station){
    const modal = document.getElementById('editModal');
    const wrap = document.getElementById('editImageWrap');
    wrap.innerHTML = '';
    const img = document.createElement('img');
    let editImgSrc = station.image || '';
    try { if (editImgSrc && editImgSrc.startsWith('/') && window.API_BASE) editImgSrc = window.API_BASE.replace(/\/$/, '') + editImgSrc; } catch(e){}
    img.src = editImgSrc || '';
    img.style.width = '100%'; img.style.borderRadius = '6px';
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
        if (!res.ok) { await handleFetchError(res, { number: newNumber }); return; }
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
      if (!res.ok) { await handleFetchError(res, { number }); return; }
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

  // Handle non-OK fetch responses and show friendly toasts for known error codes
  async function handleFetchError(res, context = {}){
    try {
      if (res.status === 409) {
        // try parse JSON error body
        let body = null;
        try { body = await res.json(); } catch(e) { body = null; }
        const code = body && body.error ? body.error : null;
        if (code === 'number_taken') {
          showToast('Ese número ya está ocupado', 4000, 'error');
          return true;
        }
        if (code === 'minutes_taken') {
          const mins = context && context.minutes ? context.minutes : null;
          if (mins) showToast(`Ya existe una tarifa para ${mins} minutos`, 4000, 'error');
          else showToast('Ya existe una tarifa para esos minutos', 4000, 'error');
          return true;
        }
        // fallback for other 409 payloads: prefer a human message if provided
        const txt = body && body.message ? body.message : (body ? JSON.stringify(body) : (await res.text().catch(()=>'')).toString());
        showToast('Conflicto: ' + (txt || 'request conflict'), 4000, 'error');
        return true;
      }
      // non-409 errors: try to read text or json
      let text = null;
      try { const j = await res.json(); text = j && (j.message || j.error) ? (j.message || j.error) : JSON.stringify(j); } catch(e){ text = await res.text().catch(()=>null); }
      showToast('Error: ' + (text || 'Error en la solicitud'), 4000, 'error');
      return true;
    } catch (e){
      console.error('handleFetchError', e);
      showToast('Error en la solicitud', 4000, 'error');
      return true;
    }
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
      // prefer dedicated download inputs if present, otherwise fallback to report inputs
      const startInput = document.getElementById('downloadStart') || document.getElementById('reportStart');
      const endInput = document.getElementById('downloadEnd') || document.getElementById('reportEnd');
      const stationSelect = document.getElementById('downloadStation');
      const start = startInput ? startInput.value : null;
      const end = endInput ? endInput.value : null;
      const q = [];
      if (start) {
        const sLocal = new Date(start + 'T00:00:00');
        q.push('start=' + encodeURIComponent(new Date(sLocal.getTime()).toISOString()));
        // include a human-friendly label for the server to use in filenames/titles
        const ds = `${String(sLocal.getDate()).padStart(2,'0')}-${String(sLocal.getMonth()+1).padStart(2,'0')}-${sLocal.getFullYear()}`;
        q.push('labelStart=' + encodeURIComponent(ds));
      }
      if (end) {
        const eLocal = new Date(end + 'T23:59:59');
        q.push('end=' + encodeURIComponent(new Date(eLocal.getTime()).toISOString()));
        const de = `${String(eLocal.getDate()).padStart(2,'0')}-${String(eLocal.getMonth()+1).padStart(2,'0')}-${eLocal.getFullYear()}`;
        q.push('labelEnd=' + encodeURIComponent(de));
      }
      // include timezone offset (minutes) so server can format times to user's local time
      try {
        const tz = new Date().getTimezoneOffset();
        q.push('tzOffset=' + encodeURIComponent(String(tz)));
      } catch(e) {}
      if (stationSelect && stationSelect.value) {
        // stationSelect stores stationId in option value when available, otherwise empty
        q.push('stationId=' + encodeURIComponent(stationSelect.value));
      }
      const url = (base || '') + '/api/time/report.xlsx' + (q.length ? ('?' + q.join('&')) : '');

      // Use fetch so we can show friendly errors and support auth headers in future
      const headers = {};
      const token = localStorage.getItem('carsplay_token');
      if (token) headers['Authorization'] = 'Bearer ' + token;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        let body = null;
        try { body = await res.json(); } catch(e) { body = await res.text().catch(()=>null); }
        console.error('Report download failed', res.status, body);
        showToast('No se pudo generar el XLSX (' + res.status + ')', 4000, 'error');
        // If server doesn't provide XLSX endpoint (404), attempt fallback: fetch logs and generate CSV locally
        if (res.status === 404) {
          try {
            showToast('Intentando descarga fallback (CSV)...', 3000, 'warning');
            const logsUrl = (base || '') + '/api/time/logs' + (q.length ? ('?' + q.join('&')) : '');
            const logsRes = await fetch(logsUrl, { headers });
            if (!logsRes.ok) { showToast('Fallback también falló: ' + logsRes.status, 4000, 'error'); return; }
            const data = await logsRes.json();
            // build CSV
            const csv = [];
            csv.push('Fecha,Empleado,Estación,Dinero,Tiempo(min),Inicio,Fin,Comentario');
            if (Array.isArray(data)){
              data.forEach(r => {
                const s = new Date(r.start || '');
                const dateStr = isNaN(s) ? '' : `${String(s.getDate()).padStart(2,'0')}-${String(s.getMonth()+1).padStart(2,'0')}-${s.getFullYear()}`;
                const startTime = r.start ? new Date(r.start).toLocaleTimeString() : '';
                const endTime = r.end ? new Date(r.end).toLocaleTimeString() : '';
                const durationMins = r.duration ? Math.floor(Number(r.duration)/60) : '';
                const est = r.stationName ? (r.stationName + (r.stationNumber ? ' #' + r.stationNumber : '')) : (r.stationNumber ? ('#'+r.stationNumber) : '');
                const row = [dateStr, (r.username||''), est, (Number(r.amount)||0), durationMins, startTime, endTime, (r.comment||'')];
                // escape commas
                csv.push(row.map(c=>('"'+String(c).replace(/"/g,'""')+'"')).join(','));
              });
            }
            const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
            const urlBlob = URL.createObjectURL(blob);
            const a2 = document.createElement('a'); a2.href = urlBlob; a2.download = 'reporte_fallback.csv'; document.body.appendChild(a2); a2.click(); a2.remove(); URL.revokeObjectURL(urlBlob);
            showToast('Descarga fallback (CSV) completada', 3000, 'success');
          } catch (e2) {
            console.error('Fallback CSV generation failed', e2);
            showToast('No se pudo generar reporte (fallback falló)', 4000, 'error');
          }
        }
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      const blobUrl = URL.createObjectURL(blob);
      // try to read suggested filename from Content-Disposition
      let filename = 'reporte.xlsx';
      const cd = res.headers.get('Content-Disposition') || res.headers.get('content-disposition');
      if (cd) {
        const m = cd.match(/filename\*=UTF-8''([^;\n\r]+)/i) || cd.match(/filename="?([^";]+)"?/i);
        if (m && m[1]) filename = decodeURIComponent(m[1].replace(/"/g,''));
      }
      a.href = blobUrl; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(blobUrl);
    } catch (e){ console.error(e); showToast && showToast('Error al descargar reporte', 3000, 'error'); }
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

  // --- Reporting UI and data ---
  function renderReportUI(){
    const container = document.getElementById('reportContent');
    container.innerHTML = '';
    // top: horizontal station scroller
    const stationsWrap = document.createElement('div'); stationsWrap.id = 'stationsScroll'; stationsWrap.style.display = 'flex'; stationsWrap.style.gap = '12px'; stationsWrap.style.overflowX = 'auto'; stationsWrap.style.padding = '8px 4px'; stationsWrap.style.marginBottom = '12px';
    container.appendChild(stationsWrap);

    // date range controls
    const titleDiv = document.createElement('div'); titleDiv.id = 'reportTitle'; titleDiv.style.fontWeight = '700'; titleDiv.style.marginBottom = '8px'; titleDiv.textContent = 'Reporte General';
    container.appendChild(titleDiv);
    const controls = document.createElement('div'); controls.className = 'report-controls'; controls.style.display = 'flex'; controls.style.gap = '12px'; controls.style.alignItems = 'center'; controls.style.marginBottom = '12px';
    const startLabel = document.createElement('label'); startLabel.textContent = 'Fecha inicio:'; const startInput = document.createElement('input'); startInput.type = 'date'; startInput.id = 'reportStart';
    const endLabel = document.createElement('label'); endLabel.textContent = 'Fecha fin:'; const endInput = document.createElement('input'); endInput.type = 'date'; endInput.id = 'reportEnd';
    const btn = document.createElement('button'); btn.className = 'btn primary'; btn.textContent = 'Buscar'; btn.id = 'reportSearchBtn';
    controls.appendChild(startLabel); controls.appendChild(startInput); controls.appendChild(endLabel); controls.appendChild(endInput); controls.appendChild(btn);
    // debug: raw fetch button to inspect backend contents without date/station filtering
    const rawBtn = document.createElement('button'); rawBtn.className = 'btn secondary'; rawBtn.textContent = 'Ver raw'; rawBtn.id = 'reportRawBtn'; rawBtn.style.marginLeft = '8px';
    controls.appendChild(rawBtn);
    container.appendChild(controls);

    // table placeholder
    const tableWrap = document.createElement('div'); tableWrap.id = 'reportTableWrap'; tableWrap.style.marginTop = '8px'; container.appendChild(tableWrap);

    // set defaults to today
    const now = new Date();
    const pad = (n) => String(n).padStart(2,'0');
    const iso = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
    startInput.value = iso; endInput.value = iso;

    btn.addEventListener('click', () => {
      // If a station is currently selected, keep it as the filter; otherwise show general report
      const prev = document.querySelector('.station-card.small.selected');
      let stationFilter = null;
      if (prev) {
        stationFilter = prev.dataset.stationId || prev.dataset.stationNumber || null;
      }
      const titleEl = document.getElementById('reportTitle');
      if (stationFilter) {
        const num = prev && prev.dataset ? (prev.dataset.stationNumber || '') : '';
        titleEl.textContent = num ? `Reporte estación #${num}` : `Reporte estación`;
      } else {
        titleEl.textContent = 'Reporte General';
      }
      loadReport(startInput.value, endInput.value, stationFilter);
    });

    // Raw debug fetch — returns the full logs JSON and prints a small summary
    rawBtn.addEventListener('click', async () => {
      try {
        const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
        const res = await fetch((base || '') + '/api/time/logs');
        const wrap = document.getElementById('reportTableWrap');
        if (!res.ok) { wrap.textContent = 'No se pudo obtener logs (raw)'; return; }
        const data = await res.json();
        const dbg = document.getElementById('reportDebug') || document.createElement('pre');
        dbg.id = 'reportDebug'; dbg.style.maxHeight = '320px'; dbg.style.overflow = 'auto'; dbg.style.background = 'rgba(0,0,0,0.04)'; dbg.style.padding = '8px'; dbg.style.borderRadius = '6px'; dbg.style.marginTop = '8px';
        try { dbg.textContent = `Count: ${Array.isArray(data) ? data.length : 1}\n` + JSON.stringify(data, null, 2); } catch(e){ dbg.textContent = String(data); }
        wrap.parentNode.insertBefore(dbg, wrap.nextSibling);
      } catch (e) { console.error('raw fetch failed', e); showToast && showToast('Error fetch raw logs', 3000, 'error'); }
    });

    // load stations in scroller
    (async function(){
      try {
        const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
        const res = await fetch((base || '') + '/api/stations');
        if (!res.ok) return;
        const stations = await res.json();
        const swrap = document.getElementById('stationsScroll'); swrap.innerHTML = '';
        // allow selecting one station to filter report; clicking again clears selection
        stations.forEach(s => {
          const c = document.createElement('div'); c.className = 'station-card small'; c.style.minWidth = '200px'; c.style.padding = '12px'; c.style.borderRadius = '12px'; c.style.textAlign = 'center'; c.style.cursor='pointer';
          c.dataset.stationId = s._id || '';
          c.dataset.stationNumber = s.number !== undefined ? String(s.number) : '';
          const img = document.createElement('img'); let imgSrc = s.image || ''; try{ if (imgSrc && imgSrc.startsWith('/') && window.API_BASE) imgSrc = window.API_BASE.replace(/\/$/, '') + imgSrc; }catch(e){}
          img.src = imgSrc || '';
          img.style.width = '80px'; img.style.height = '80px'; img.style.objectFit = 'contain'; img.style.display = 'block'; img.style.margin = '0 auto 8px';
          const title = document.createElement('div'); title.textContent = `${s.name || 'Carrito'} #${s.number || '-'}`; title.style.fontWeight = '600';
          c.appendChild(img); c.appendChild(title); swrap.appendChild(c);
          c.addEventListener('click', () => {
            // toggle selection
            const prev = document.querySelector('.station-card.small.selected');
            if (prev && prev !== c) prev.classList.remove('selected');
            const isSelected = c.classList.toggle('selected');
            const stationFilter = isSelected ? (c.dataset.stationId || c.dataset.stationNumber) : null;
            // update title to show station number when selected
            const titleEl = document.getElementById('reportTitle');
            if (isSelected) {
              const num = c.dataset.stationNumber || '';
              titleEl.textContent = num ? `Reporte estación #${num}` : `Reporte estación`;
            } else {
              titleEl.textContent = 'Reporte General';
            }
            // load report for current date inputs and station filter
            const sVal = document.getElementById('reportStart').value;
            const eVal = document.getElementById('reportEnd').value;
            loadReport(sVal, eVal, stationFilter);
          });
        });
        // Also populate download selector if present
        try {
          const dsel = document.getElementById('downloadStation');
          if (dsel) {
            // clear but keep default
            const cur = dsel.value || '';
            dsel.innerHTML = '<option value="">Todas</option>';
            stations.forEach(s => {
              const opt = document.createElement('option'); opt.value = s._id || ''; opt.textContent = `${s.name || 'Carrito'} (#${s.number || '-'})`; dsel.appendChild(opt);
            });
            try { dsel.value = cur; } catch(e){}
          }
        } catch(e) { console.warn('download selector populate failed', e); }
      } catch(e){ console.warn('stations scroller failed', e); }
    })();

    // initial load
    loadReport(iso, iso);
  }

  async function loadReport(start, end, stationFilter){
    try {
      const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
      const q = [];
      // Build UTC range from the local date selected by the user.
      // Interpret the `start`/`end` strings as local dates (YYYY-MM-DD), then convert
      // to UTC instants so server filters by UTC time correctly while matching the
      // user's local-day selection.
      if (start) {
        const sLocal = new Date(start + 'T00:00:00');
        q.push('start=' + encodeURIComponent(new Date(sLocal.getTime()).toISOString()));
      }
      if (end) {
        // set to end of day local time
        const eLocal = new Date(end + 'T23:59:59');
        q.push('end=' + encodeURIComponent(new Date(eLocal.getTime()).toISOString()));
      }
      const url = (base || '') + '/api/time/logs' + (q.length ? ('?' + q.join('&')) : '');
      const res = await fetch(url);
      const wrap = document.getElementById('reportTableWrap'); wrap.innerHTML = '';
      if (!res.ok) { wrap.textContent = 'No se pudo cargar el reporte'; return; }
      const data = await res.json();
      // if stationFilter present, filter client-side by stationId or stationNumber
      let filtered = data;
      if (stationFilter) {
        filtered = data.filter(r => (r.stationId && r.stationId === stationFilter) || (r.stationNumber && String(r.stationNumber) === String(stationFilter)) );
      }
      // Build table
      const table = document.createElement('table'); table.className = 'report-table'; table.style.width = '100%'; table.style.borderCollapse = 'collapse';
      const thead = document.createElement('thead'); const hrow = document.createElement('tr'); ['Fecha','Empleado','Estación','Dinero generado','Tiempo','Inicio','Fin','Comentario'].forEach(h => { const th = document.createElement('th'); th.textContent = h; th.style.textAlign='left'; th.style.padding='8px'; th.style.borderBottom='1px solid rgba(255,255,255,0.06)'; hrow.appendChild(th); }); thead.appendChild(hrow); table.appendChild(thead);
      const tbody = document.createElement('tbody');
      let totalsCount = 0; let totalsAmount = 0; let totalsSeconds = 0;
      filtered.forEach(r => {
        const tr = document.createElement('tr');
        const d = new Date(r.start);
        const dateStr = d.toLocaleDateString();
        const startTime = new Date(r.start).toLocaleTimeString();
        const endTime = new Date(r.end).toLocaleTimeString();
        const duration = r.duration || Math.max(0, Math.floor((new Date(r.end).getTime() - new Date(r.start).getTime())/1000));
        const hrs = Math.floor(duration/3600); const mins = Math.floor((duration%3600)/60);
        const timeStr = hrs ? `${hrs} h ${mins} m` : `${mins} m`;
        const cells = [dateStr, (r.username||''), (r.stationName ? (r.stationName + (r.stationNumber ? ' #' + r.stationNumber : '')) : (r.stationNumber ? ('#'+r.stationNumber) : '')), ('C$ ' + (Number(r.amount)||0)), timeStr, startTime, endTime, (r.comment||'')];
        cells.forEach(c => { const td = document.createElement('td'); td.textContent = c; td.style.padding='8px'; td.style.borderBottom='1px solid rgba(255,255,255,0.03)'; tr.appendChild(td); });
        tbody.appendChild(tr);
        totalsCount += 1; totalsAmount += Number(r.amount)||0; totalsSeconds += duration;
      });
      // add tbody and table
      table.appendChild(tbody);
      // add tfoot with aligned totals under Estación / Dinero generado / Tiempo
      const tfoot = document.createElement('tfoot');
      const frow = document.createElement('tr');
      // Fecha, Empleado -> empty
      for (let i=0;i<2;i++){ const td = document.createElement('td'); td.textContent = ''; td.style.padding='8px'; frow.appendChild(td); }
      // Estación -> total count
      const tdCount = document.createElement('td'); tdCount.textContent = `${totalsCount} vueltas`; tdCount.style.padding='8px'; tdCount.style.fontWeight='600'; frow.appendChild(tdCount);
      // Dinero generado -> total amount
      const tdAmount = document.createElement('td'); tdAmount.textContent = `C$ ${totalsAmount}`; tdAmount.style.padding='8px'; tdAmount.style.fontWeight='600'; frow.appendChild(tdAmount);
      // Tiempo -> formatted total time per rule
      const tdTime = document.createElement('td'); tdTime.style.padding='8px'; tdTime.style.fontWeight='600';
      // format total seconds into minutes or "X h Y m"
      const totalMins = Math.floor(totalsSeconds/60);
      let timeLabel = '';
      if (totalMins < 60) {
        timeLabel = `${totalMins} m`;
      } else {
        const h = Math.floor(totalMins/60); const m = totalMins % 60;
        timeLabel = `${h} h` + (m ? ` ${m} m` : '');
      }
      tdTime.textContent = timeLabel; frow.appendChild(tdTime);
      // Inicio, Fin, Comentario -> empty cells
      for (let i=0;i<3;i++){ const td = document.createElement('td'); td.textContent = ''; td.style.padding='8px'; frow.appendChild(td); }
      tfoot.appendChild(frow);
      table.appendChild(tfoot);
      wrap.appendChild(table);
    } catch(e){ console.error('loadReport failed', e); const wrap = document.getElementById('reportTableWrap'); if (wrap) wrap.textContent = 'Error cargando reporte'; }
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
      if (!res.ok) { await handleFetchError(res, { minutes }); return; }
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
      if (!res.ok) { await handleFetchError(res, { minutes: mins }); return; }
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
      if (!res.ok) { await handleFetchError(res); return; }
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
        if (sec === 'addPrices') { loadTimeRates(); }
      });
    });
    document.getElementById('sidebarLogout').addEventListener('click', () => {
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem('carsplay_token');
      // navigate back to admin login on the frontend (same origin)
      window.location.href = '/admin_login.html';
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
    // render report UI and load today's report
    try { renderReportUI(); } catch(e){ console.warn('renderReportUI failed', e); }
  });

})();

