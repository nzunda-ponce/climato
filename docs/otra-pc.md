# Retomar Climato desde otra PC

El código está en https://github.com/nzunda-ponce/climato, rama `main`.
El informe publicado está en https://climato-eta.vercel.app/ y la ciencia de datos en https://climato-eta.vercel.app/ciencia-de-datos. Para consultarlos no hace falta instalar nada ni mantener una PC encendida.

## Instalar para hacer cambios

Instalar Git y Node.js 24. En PowerShell, elegir una carpeta fuera de OneDrive, por ejemplo `C:\Proyectos`, y ejecutar:

```powershell
git clone https://github.com/nzunda-ponce/climato.git
cd climato
npm ci
npm run db:generate
Copy-Item .env.example .env.local
```

El último comando es para una instalación nueva: si `.env.local` ya existe, conservarlo.

Abrir `.env.local` en un editor. Copiar la conexión desde **Connect** en el [proyecto Neon existente](https://console.neon.tech/app/projects/misty-mountain-41853228), seleccionando rama `production`, base `climato`, rol `climato_owner`, **Pooling** y SSL. Configurar:

```dotenv
DATABASE_URL="PEGAR_AQUI_LA_CONEXION_POSTGRESQL_COMPLETA"
CLIMATO_ROLE=web
```

Guardar el archivo localmente. La conexión contiene una contraseña: no subirla a Git ni pegarla en el chat. `.env.local` está excluido de Git.

```powershell
npm run dev:manual
```

Abrir http://127.0.0.1:3000. Mantener esa terminal abierta mientras se desarrolla; `Ctrl+C` detiene el servidor. Los cambios de código se muestran automáticamente. `dev:manual` evita que el actualizador de Git interfiera mientras se edita.

## Datos y actualizaciones

La campaña, los históricos y los informes ya están en Neon. Esta instalación consulta la misma publicación que Vercel. No ejecutar `db:setup`, `db:migrate`, restauraciones ni una nueva importación para retomar el proyecto.

GitHub Actions actualiza los datos dos veces por día, a las 07:17 y 19:17 de Argentina, y publica el informe. Revisar su estado en [Actions](https://github.com/nzunda-ponce/climato/actions/workflows/data-worker.yml). El workflow ejecuta la revisión que lo dispara; las ejecuciones programadas usan `main`. Las credenciales de Actions y Vercel ya están configuradas y no se trasladan en archivos del repositorio.

Para continuar con un asistente, abrir esta carpeta y pedirle que lea este documento y [la descripción del modelo](science-model.md). Las zonas se obtienen de la segunda letra del nombre del equipo; por ejemplo, `BE1187` pertenece a la zona E.

Antes de editar una copia existente, comprobar `git status` y actualizar con `git pull --ff-only` cuando no haya cambios pendientes. Si Git avisa de cambios locales, conservarlos antes de actualizar.
