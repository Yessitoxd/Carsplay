# Login blanco - CarsPlay

Archivos añadidos: `index.html`, `styles.css`.

Previsualizar localmente (PowerShell):

```powershell
cd "C:/Users/larry/Downloads/Carsplay";
python -m http.server 8000
```

Luego abre en tu navegador: `http://localhost:8000/index.html`

¿Deseas que añada validación JavaScript, integración con backend, o variaciones de color (por ejemplo fondo blanco puro vs. tarjeta blanca)?


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

---

MongoDB (migración rápida)

He añadido soporte a MongoDB usando `mongoose` y agregué un script para crear los usuarios que solicitaste.

Archivos nuevos/importantes:
- `models/user.js` — modelo Mongoose para usuarios.
- `db.js` — helper para conectar con `MONGODB_URI`.
- `seed-db.js` — script que inserta los dos usuarios iniciales (empleado y admin).

Cómo seedear la base de datos (local o en Render)
1) Asegúrate de tener `MONGODB_URI` (por ejemplo un cluster en MongoDB Atlas).
2) Ejecuta localmente:

```powershell
cd "C:/Users/larry/Downloads/Carsplay"
SET MONGODB_URI="<tu_mongodb_uri>"
node seed-db.js
```

3) En Render, añade la variable de entorno `MONGODB_URI` con tu conexión y en la sección Build Command usa `npm install && npm run seed` (si no quieres que el seed corra automáticamente en cada deploy, define `SKIP_SEED=true` y el seed será omitido).

Notas de seguridad:
- No subas credenciales reales al repo.
- Protege la URI con las Environment Variables de Render.

3) Probar login (ejemplo usando `curl`):

```powershell
curl -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{"username":"CarsPlay","password":"246810"}'
```

4) Despliegue en Render:
	- Crea un repositorio remoto (GitHub/GitLab) y sube tu proyecto.
	- En Render: New -> Web Service; conecta el repo; Build Command: `npm install`; Start Command: `node server.js`.
	- Render usará la variable `PORT` automáticamente. Asegúrate de añadir secretos/env vars en Render si fuese necesario.

---

Controlar si se ejecuta el seed en el build (Render)

Por defecto el `seed` corre durante el build para generar `users.json` a partir de `employees.json`.
Si prefieres evitar que el seed se ejecute en un deploy (por ejemplo en producción), Render permite definir variables de entorno.

Para saltar el seed en un deploy, añade la variable de entorno `SKIP_SEED=true` en la sección Environment de tu servicio en Render. El script de build debe continuar usando:

```bash
npm install && npm run seed
```

El script `seed` ahora ejecuta `seed-if-needed.js` que lee `SKIP_SEED`. Si `SKIP_SEED` está establecido a `true`, el seed se omite.

Ejemplo (local) para omitir seed al correr el build:

```powershell
SET SKIP_SEED=true; npm install; npm run seed
```

En Linux/macOS la sintaxis sería:

```bash
SKIP_SEED=true npm install && npm run seed
```


Seguridad (importante):
	- `create_users.js` hashea contraseñas usando `bcryptjs` y luego crea `users.json`.
	- No subas `users.json` con contraseñas reales a repositorios públicos.

