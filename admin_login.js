// admin_login.js - submits admin credentials and redirects to admin panel
(function(){
  const form = document.querySelector('.admin-login');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('a-username').value.trim();
    const password = document.getElementById('a-password').value;
    const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
    try {
      const res = await fetch((base || '') + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      let data = null;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) { data = await res.json(); }

      if (res.ok && data && data.ok) {
        // require admin role
        const role = (data.role || '').toLowerCase();
        if (role !== 'admin') {
          alert('Acceso denegado: necesitas credenciales de administrador');
          return;
        }
        localStorage.setItem('carsplay_user', JSON.stringify({ username: data.username, role: data.role }));
        window.location.href = (base || '') + '/admin.html';
        return;
      }

      if (data && data.error) alert('Error: ' + data.error);
      else alert('Credenciales inválidas');
    } catch (err) {
      console.error(err); alert('Error de conexión');
    }
  });

})();
