// login.js - simple client-side login for demo
// It posts { username, password } to the backend endpoint.
// If you deploy backend separately, set window.API_BASE to the backend origin,
// e.g. window.API_BASE = 'https://your-service.onrender.com';

(function(){
  // Ensure API_BASE is defined so login requests from Netlify go to the correct backend
  if (!window.API_BASE) {
    window.API_BASE = 'https://carsplay.onrender.com';
    console.info('login.js: window.API_BASE not found — defaulting to', window.API_BASE);
  }
  const form = document.querySelector('.login');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const base = window.API_BASE ? window.API_BASE.replace(/\/$/, '') : '';
    const url = base + '/api/login';

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      // Handle non-JSON or empty responses safely
      let data = null;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try { data = await res.json(); } catch (e) { console.warn('Invalid JSON response', e); }
      } else {
        // If server returned text or empty body, read it for debugging
        try { const text = await res.text(); console.warn('Non-JSON response:', text); } catch (e) { /* ignore */ }
      }

      if (res.ok && data && data.ok) {
        // persist logged-in user details so employee page can read them
        try {
          localStorage.setItem('carsplay_user', JSON.stringify({ username: data.username, role: data.role }));
        } catch (e) { /* ignore */ }
        // Redirect based on role returned by server
        const role = (data.role || '').toLowerCase();
        if (role === 'employee' || role === 'empleado') {
          // Always navigate to the frontend's employee page (same origin)
          window.location.href = '/employee.html';
          return;
        }
        // default to admin dashboard (frontend)
        window.location.href = '/dashboard.html';
        return;
      }

      // Specific HTTP status handling
      if (res.status === 405) {
        alert('Método no permitido (405) — inténtalo de nuevo o revisa el servidor.');
        return;
      }

      if (data && data.error) {
        alert('Error: ' + data.error);
        return;
      }

      alert('Credenciales inválidas o respuesta inesperada del servidor');
    } catch (err) {
      console.error(err);
      alert('Error de conexión al servidor');
    }
  });
})();
