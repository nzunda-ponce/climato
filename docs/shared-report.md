# Informe compartido: web de consulta y proceso de datos

El informe público lee una publicación completa de Neon. No descarga meteorología, no entrena modelos y no inicializa ni migra la base al recibir visitas. Filtrar zonas y alternar días/semanas no inicia trabajo de datos.

**Estado al 20 de octubre de 2026:** web publicada en https://climato-eta.vercel.app/, Neon conectado y tarea de GitHub Actions configurada. La última publicación del modelo se completó correctamente. Para cambiar de computadora, seguir [esta guía](otra-pc.md); no repetir la activación inicial descrita abajo.

## Procesos independientes

- `npm run data:bootstrap`: completa sólo los años históricos pendientes de las ubicaciones activas, con los criterios actuales. Cada lote se confirma antes de avanzar. Una ejecución queda limitada inicialmente a 30 minutos y la siguiente retoma lo pendiente; completar una pasada no significa necesariamente haber terminado 45 años. Los años ya procesados no se vuelven a descargar en cada ejecución. Un año nuevo, una ubicación nueva o cambiar criterios sí puede requerir trabajo adicional.
- `npm run data:refresh`: actualiza pronósticos y verifica predicciones pasadas. Si esas descargas terminan sin errores, avanza hasta seis tareas históricas pendientes dentro de la misma ejecución, conservando el progreso. `CLIMATO_HISTORY_TASKS_PER_REFRESH=0` desactiva ese avance adicional. Los datos meteorológicos cambian: esta tarea es periódica, no se calcula una única vez para siempre.
- `npm run data:publish`: prepara el informe con los datos existentes, sin descargar meteorología. Sirve para publicar inmediatamente el avance ya guardado antes de terminar toda la carga inicial.

Los tres comandos usan la misma `DATABASE_URL` de Neon y rechazan una conexión vacía. El estado de cada proceso se guarda en la base. Los bloqueos renovables evitan ejecutar simultáneamente dos instancias de la misma tarea. Los registros confirmados sobreviven a la interrupción de un proceso.

Si Open-Meteo responde HTTP 429, se detiene la pasada y se guarda una pausa compartida de al menos una hora. Las otras tareas también respetan esa pausa, sin extenderla cada vez que consultan el estado. No se cambian IPs ni se crean datos para sortear el límite del proveedor. La próxima ejecución intentará únicamente los pendientes.

La publicación es atómica y usa los datos y la revisión de una misma lectura consistente. Las importaciones pueden seguir avanzando mientras se prepara el informe: eso se indica como cambios pendientes y no impide publicar el avance disponible. Un proceso lento no reemplaza una publicación que ya utiliza datos más recientes. Si un proceso falla, permanece la última publicación completa. Se muestra una advertencia cuando cambian los datos sin publicar, pasa el día, transcurren trece horas o vence una fuente meteorológica utilizada. Una publicación puede tener cobertura parcial: el informe muestra esa cobertura y no la convierte en una campaña completa.

## Activar la tarea programada en GitHub Actions

Se preparó `.github/workflows/data-worker.yml`:

- Pronóstico y verificación dos veces al día: 07:17 y 19:17 de Argentina (10:17 y 22:17 UTC). Cada pasada guarda los resultados en Neon y publica el informe. Son dos ejecuciones, no dos solicitudes HTTP: se consultan múltiples ubicaciones y fuentes, agrupadas en lotes.
- `bootstrap` permite avanzar manualmente la carga histórica; `refresh` también retoma lotes pequeños sin añadir ejecuciones programadas.
- Ejecución manual de `bootstrap`, `refresh` o `publish`.
- Una sola ejecución simultánea; no se cancela un lote anterior por abrir el informe.
- Usa un runner Linux estándar. No sube datos ni credenciales como archivos o artefactos públicos.

**Preparar el archivo no activa el servicio.** GitHub sólo programa workflows presentes en la rama predeterminada (`main` en este repositorio). Hay que incorporar este workflow a `main` y guardar `CLIMATO_DATABASE_URL` en *Settings → Secrets and variables → Actions*. Su valor es la conexión PostgreSQL completa con SSL, nunca un archivo público. Si se usa Open-Meteo comercial, agregar también `WEATHER_API_KEY`. El workflow consulta el código de `codex/automatic-data-import`, la rama que usa la instalación actual.

GitHub puede demorar ejecuciones programadas o desactivarlas por inactividad del repositorio. Los cron gratuitos y las fuentes meteorológicas gratuitas no ofrecen un SLA. Revisar ejecuciones fallidas en Actions y la antigüedad que muestra el informe. No considerar la preparación inicial completada mientras queden ubicaciones sin cobertura.

Para la primera publicación, ejecutar `data:publish` o iniciar manualmente `publish` en Actions. La base ya contiene los equipos e históricos migrados desde la PC; no hay que volver a importarlos.

## Alojar la web de consulta en Vercel

1. Conectar Vercel con el repositorio y desplegar la rama `codex/automatic-data-import`.
2. Usar Node 24. Build: `npm run db:generate && npm run build`. Instalación: `npm ci`.
3. Configurar `DATABASE_URL` con la misma base Neon y `CLIMATO_ROLE=web`. No compartir estos valores con el navegador ni usar variables `NEXT_PUBLIC_*` para credenciales.
4. Después de la primera publicación, comprobar `/api/planning` y los apartados del informe. Si aún no existe una publicación, se devuelve 503 con un mensaje explícito; no se inicia una carga a pedido.
5. El enlace no requiere contraseña. El modo web bloquea modificaciones, descargas manuales, APIs de cálculo anteriores y exportación del estado completo. Las selecciones de zonas sólo afectan al navegador de quien consulta. Se solicita no indexar el sitio en buscadores, lo cual no equivale a autenticación.

La conexión/plan de alojamiento y los secretos son configuración externa. Ninguna tarea queda activada sólo por instalar un plugin o subir este código. Elegir un plan acorde al uso, sin contratar servicios pagos automáticamente.

## Instalación local y transición

La instalación local existente sigue funcionando con `npm run dev` y conserva sus datos. Si usa `DATABASE_URL`, no inicia un coordinador adicional: consulta el estado compartido de GitHub Actions. Las instalaciones con SQLite conservan su coordinador local. Las importaciones manuales siguen disponibles donde corresponde, fuera del informe público.

Cuando la tarea remota esté comprobada, establecer `CLIMATO_ROLE=web` también en la PC y reiniciar una vez. Así tanto la PC como el enlace compartido consultan lo mismo y ninguna de las dos ejecuta las descargas. El cálculo y la carga inicial seguirán fuera de la web, aunque la PC se apague.
