// login.js - simple client-side login for demo
// It posts { username, password } to the backend endpoint.
// If you deploy backend separately, set window.API_BASE to the backend origin,
// e.g. window.API_BASE = 'https://your-service.onrender.com';

(function(){
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
      const data = await res.json();
      if (res.ok && data.ok) {
        // Simple success action: redirect to dashboard
        window.location.href = (base || '') + '/dashboard.html';
      } else {
        alert('Credenciales inválidas');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al servidor');
    }
  });
})();
