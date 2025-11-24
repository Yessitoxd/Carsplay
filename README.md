# Login blanco - CarsPlay

Archivos añadidos: `index.html`, `styles.css`.

Previsualizar localmente (PowerShell):

```powershell
cd "C:/Users/larry/Downloads/Carsplay";
python -m http.server 8000
```

Luego abre en tu navegador: `http://localhost:8000/index.html`

¿Deseas que añada validación JavaScript, integración con backend, o variaciones de color (por ejemplo fondo blanco puro vs. tarjeta blanca)?

---

**Backend (Node) y despliegue en Render — instrucciones rápidas**

1) Requisitos locales:
	- Instala Git: https://git-scm.com/downloads
	- Instala Node.js (LTS): https://nodejs.org/ (incluye `npm`)

2) Crear el repo, instalar dependencias y generar usuarios (hash):

```powershell
cd "C:/Users/larry/Downloads/Carsplay";
git init;
npm install;
npm run seed    # lee employees.json y escribe users.json con contraseñas hasheadas
npm start       # inicia el servidor en http://localhost:3000
```

3) Probar login (ejemplo usando `curl`):

```powershell
curl -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{"username":"CarsPlay","password":"246810"}'
```

4) Despliegue en Render:
	- Crea un repositorio remoto (GitHub/GitLab) y sube tu proyecto.
	- En Render: New -> Web Service; conecta el repo; Build Command: `npm install`; Start Command: `node server.js`.
	- Render usará la variable `PORT` automáticamente. Asegúrate de añadir secretos/env vars en Render si fuese necesario.

Seguridad (importante):
	- `create_users.js` hashea contraseñas usando `bcryptjs` y luego crea `users.json`.
	- No subas `users.json` con contraseñas reales a repositorios públicos.

