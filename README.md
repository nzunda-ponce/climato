# Climato

Informe de planificación de uniformidades en campo: zonas seleccionables, análisis meteorológico en las coordenadas de cada equipo, días aptos esperados, rachas continuas y verificación de pronósticos. Fechas y horarios de Argentina.

## Ejecutar

**Para retomar desde otra PC:** seguir [la guía de instalación y conexión a los datos existentes](docs/otra-pc.md). El informe ya está publicado en https://climato-eta.vercel.app/ y no requiere instalación para consultarlo.

Node.js 24 o superior:

```sh
npm install
npm run db:generate
npm run dev
```

Abrir <http://127.0.0.1:3000>. En Windows también se puede iniciar con doble clic en **Abrir Climato.cmd**. Conviene ubicar el proyecto fuera de OneDrive (por ejemplo `C:\Proyectos\climato`); la base local de transición queda fuera de OneDrive, en `%LOCALAPPDATA%\Climato`. Con PostgreSQL no se guarda el estado mediante renombrados de JSON.

`npm run dev` revisa cada 15 segundos la rama de GitHub configurada y actualiza código, dependencias y servidor. También recarga la página. Para activar esto en una instalación anterior hay que actualizar una vez y reiniciar con `npm run dev`. Con cambios locales o ramas divergentes, la actualización se pausa sin sobrescribirlos. `npm run dev:manual` permite desarrollar sin sincronización remota.

La instalación compartida ya usa Vercel para la web, Neon para los datos y GitHub Actions para las actualizaciones. No depende de que la PC esté encendida. Para consultar esos mismos datos localmente, configurar `DATABASE_URL` y `CLIMATO_ROLE=web` según la guía anterior.

## Dos vistas principales

La navegación global tiene dos entradas: **Resultados** (`/`), con el panel de planificación, y **Explicación de ML** (`/data-science`), con la explicación educativa y evaluación del modelo. Dentro de Resultados, el menú **Herramientas** conserva zonas/equipos, detalle, verificación, datos/criterios y análisis de campaña. Las rutas anteriores `/informe` y `/ciencia-de-datos` redirigen al panel y a su análisis de campaña, respectivamente.

## Panel de resultados

El inicio comparte la estética de la vista de ML y concentra cinco bloques: métrica general, **Estimación actual frente a todas las temporadas**, **Distribución geográfica**, **Disponibilidad por zona** y **Detalle por zona**. Los filtros de zona y equipo se comparten; seleccionar una semana en la matriz actualiza el mapa y el detalle desplegable de equipos.

Las curvas muestran las temporadas históricas disponibles con suavizado visual que conserva los puntos y no cruza huecos. El equipo TBD se conserva bajo **Sin zona asignada**; no genera una Zona B. El mapa permite alternar entre disponibilidad y las capas meteorológicas de Windy, que mantiene sus propios controles temporales.

Se conserva el promedio por coordenada, sin multiplicar por equipos ni extrapolar faltantes. Las referencias históricas no se presentan como pronósticos meteorológicos. Los apartados de equipos, detalle, validación y criterios conservan sus herramientas.

El informe incluye:

- **Zonas de trabajo:** seleccionar o deseleccionar regiones completas y ubicaciones individuales. Incluye búsqueda y acciones de seleccionar/quitar todas. La selección persiste en el navegador y limita tablas, resumen y matriz de confusión.
- **Windy:** mapa interactivo oficial insertado mediante [Windy Embed](https://embed.windy.com/config/map), con capas de viento y lluvia y enlace a la web completa. Se centra en la ubicación consultada. Su fecha y su modelo se controlan dentro de Windy; el contenido del iframe no alimenta los cálculos ni está sincronizado con la fecha de la tabla. Se conservan sus controles y atribución.
- **Análisis a 7 y 14 días:** probabilidad diaria de al menos un ensayo completo, días esperados y rango central del 80% de escenarios. También informa la racha más larga de días consecutivos y, al elegir una fecha, la continuidad posterior condicionada a que ese día resulte apto.
- **Detalle por ubicación:** miembros por familia, cobertura, fecha de descarga y mejor franja común respaldada por el ensemble. Una probabilidad diaria alta puede reunir horarios diferentes entre escenarios y no implica una franja común de esa misma probabilidad.
- **Clasificación explícita:** umbral seleccionable entre 50% y 95%, con 70% inicial. Se muestra la probabilidad numérica y si supera el umbral. Modificar el umbral no recalibra el pronóstico ni aumenta la certeza.
- **Criterios:** viento máximo, lluvia durante el ensayo, lluvia del día anterior, duración consecutiva, jornada y fin de campaña. Cambiarlos invalida los cálculos anteriores y dispara su actualización automática.
- **Imprimir informe:** conserva las tablas de las ubicaciones seleccionadas; omite controles y el iframe externo.

La antigua superficie de calor propia y su malla pública de 527 nodos ya no se descargan automáticamente ni aparecen en la página principal. Los endpoints y herramientas anteriores se conservan para compatibilidad. Los equipos terminados y las coordenadas que requieren revisión quedan fuera del análisis.

## Cálculo y evidencia

### Auditoría de machine learning

La subpágina `/data-science`, enlazada como **Explicación de ML**, muestra por defecto el total de ubicaciones del modelo meteorológico al umbral fijo del 70%: matriz de confusión, precisión, recall, F1 y calibración, con ayudas breves, explicación visual inicial, anillos de métricas, distribución interactiva de aciertos/errores, barras por probabilidad y gráfico de calibración. El detalle por ubicación se despliega bajo demanda. Los totales suman casos únicos ubicación-día y recalculan métricas; no promedian porcentajes por equipo. Una explicación breve muestra los datos, las particiones temporales y los conteos usados; la referencia comparable y las fórmulas se despliegan bajo demanda. Las matrices usan los árboles guardados y las mismas variables/cohortes del entrenamiento; se verifican huella, cantidad de casos y Brier. No se reentrena ni se modifica la base. Para ejecutar una vista de desarrollo simultánea sin compartir archivos generados, configurar `CLIMATO_DEV_DIST_DIR=.next-audit-dev`.

La clave de análisis usa coordenadas redondeadas a cinco decimales, en lugar de agrupar equipos por celdas de 0,25°. Los equipos en la misma coordenada comparten meteorología; equipos cercanos en coordenadas diferentes se consultan por separado. Consultar una coordenada no mejora la resolución nativa del modelo meteorológico.

En cada miembro se buscan bloques completos dentro de la jornada con viento permitido, lluvia acumulada del ensayo dentro del límite y lluvia del día anterior menor al máximo. La lluvia nocturna o fuera del ensayo no descarta automáticamente el día. Se exigen horas completas; datos ausentes no se convierten en condiciones secas.

Cada familia meteorológica tiene igual peso. Para publicar la probabilidad diaria se exigen al menos dos familias, diez miembros utilizables por familia y 80% de cobertura en cada una. La mejor franja requiere esos mismos mínimos en su propio horario. Los días y rachas se cuentan recorriendo trayectorias completas de los miembros, conservando la dependencia entre días; no se simulan días independientes.

El rango central del 80% es una distribución de escenarios, **no un intervalo de confianza de precisión validada**. Las probabilidades brutas del ensemble todavía no tienen calibración local acreditada. Los equipos no se multiplican para fabricar más días disponibles y el promedio entre ubicaciones no equivale a capacidad ejecutable de la flota. Acceso, suelo, personal, traslados y duración real del trabajo requieren evaluación aparte.

El corto plazo usa ensembles descargados hace menos de 12 horas. Más allá de 14 días se presenta una perspectiva experimental EC46/SEAS5 entrenada con 45 años de ERA5. No se recomiendan fechas operativas lejanas con la misma confianza que el corto plazo. La historia y el pronóstico se recalculan con los criterios actuales; no se sustituyen faltantes con una frecuencia histórica silenciosa.

## Matriz de confusión de los últimos 30 días

Se conserva la **primera captura** de cada ubicación, fecha objetivo, anticipación y versión de criterios. Las capturas sólo incluyen fechas futuras y fuentes vigentes con evidencia mínima. Guardar una actualización posterior no sobrescribe esa predicción.

Cuando [ERA5](https://open-meteo.com/en/docs/historical-weather-api) publica el clima horario retrospectivo, se aplican exactamente los criterios guardados y se registra si existió un ensayo completo. ERA5 es una reconstrucción meteorológica y tiene demora de publicación; no es una observación en campo. Las verificaciones incompletas permanecen pendientes.

La matriz usa los últimos 30 días completos, las ubicaciones seleccionadas y una anticipación fija de 1, 3, 7 o 14 días. Informa:

- Aciertos aptos y no aptos, falsas alarmas y días aptos no detectados.
- Acierto global, precisión de avisos aptos, detección de días aptos y error probabilístico Brier.
- Cobertura de pronósticos capturados y pares verificados, fechas y ubicaciones.
- Frecuencias observadas por intervalo de probabilidad para revisar calibración.

Cada ubicación y fecha cuentan una sola vez por anticipación. No se mezclan criterios anteriores ni horizontes diferentes. Sin casos o sin el denominador de una clase, la métrica se muestra sin valor. Los casos cercanos espacial y temporalmente no son independientes.

Las instalaciones anteriores no guardaban estos ensembles de manera inmutable con su versión de criterios. No se reconstruyen estimaciones pasadas usando modelos actuales. La matriz puede empezar vacía y se completa automáticamente con datos genuinos. Se retienen 60 días de objetivos para alimentar la ventana móvil.

La validación del **entrenamiento de análogos** se presenta aparte: entrenamiento hasta 2015, prueba temporal desde 2016 y Brier frente a una referencia mensual. Usa condiciones reconstruidas del propio día; no mide habilidad de anticipación meteorológica ni sustituye la matriz operativa. Faltan registros de campo e hindcasts estacionales para medir la habilidad final de largo plazo.

## Informe compartido sin depender de una PC

La web de consulta (`CLIMATO_ROLE=web`, automático en Vercel) lee resultados publicados en Neon y no inicia descargas ni cálculos de disponibilidad por visita. Los procesos independientes `data:bootstrap`, `data:refresh` y `data:publish` preparan los históricos, mantienen el pronóstico y publican el informe. Se conservan el avance y la última publicación completa; las fuentes vencidas se identifican explícitamente.

El workflow de GitHub Actions y sus secretos ya están configurados para este proyecto: actualiza los datos a las 07:17 y 19:17 de Argentina. Ver [operación del informe compartido](docs/shared-report.md).

## Datos y actualización

Si la instalación no tiene equipos, se importan de Google My Maps. Se actualizan automáticamente pronósticos puntuales, ensembles por coordenada, históricos ERA5, NOAA y perspectiva de campaña. La verificación tiene su propia cola y la carga larga no bloquea el corto plazo. Los errores se muestran y se reintentan; no se generan datos ficticios.

La persistencia principal admite PostgreSQL administrado en la nube. Equipos, criterios, históricos, pronósticos, cachés y validación se guardan en registros comprimidos independientes. Sin una conexión configurada se mantiene una base SQLite local de transición, identificada explícitamente en la página; esto no significa que la nube esté activada. Los datos y credenciales están excluidos de Git. No hay autenticación; el servidor se limita a loopback.

Endpoints principales: `/api/planning`, `/api/validation?lead=1&threshold=0.7&key=lat,lon`, `/api/auto-sync` y `/api/campaign` para criterios. La validación intersecta las claves solicitadas con las ubicaciones activas de los equipos.

## Verificar

```sh
npm test
npm run build
```

Las pruebas cubren ventanas horarias, lluvia nocturna y previa, datos faltantes, familias y cobertura, trayectorias y rachas, archivo inmutable, separación temporal de validación, matriz y Brier, ubicaciones próximas distintas, persistencia y actualización automática del código.

## Base gratuita en la nube: Neon PostgreSQL

El proyecto **Climato** ya está creado y contiene la campaña migrada. Ver [conexión del proyecto existente](docs/neon-setup.md); no hace falta crear otro proyecto ni volver a importar los equipos.

Se usa [Neon Free](https://neon.com/pricing), con cuotas de almacenamiento, cómputo y transferencia que se consultan en el panel del proveedor. La base centraliza los datos; las descargas las ejecuta GitHub Actions y la web está en Vercel.

El siguiente procedimiento es sólo para migrar una instalación independiente a una **base nueva y vacía**. No corresponde repetirlo al abrir la campaña existente desde otra PC:

1. Crear un proyecto vacío con el plan Free en Neon y copiar su cadena PostgreSQL con **Connection pooling** y `sslmode=require`.
2. En la carpeta del proyecto ejecutar `npm run db:generate` y `npm run db:setup`.
3. Pegar la cadena en la terminal. No se muestra ni se envía al navegador; se guarda en `.env.local`, excluido de Git. No compartirla por chat.
4. El comando verifica la conexión y migra automáticamente los datos. Reiniciar Climato una vez. La página debe indicar **Datos guardados en la nube**. `npm run db:status` permite comprobarlo desde la terminal.

La aplicación crea su tabla e índices automáticamente; no requiere PostGIS, Docker, `db:push` ni cargar equipos nuevamente. Si se prefiere configurar la conexión desde el entorno del servidor, establecer `DATABASE_URL` y ejecutar `npm run db:migrate`. Una conexión configurada que falla **produce un error**, sin cambiar silenciosamente a una base local vacía.

### Qué se migra y cómo se conserva

- Se importa el estado anterior `AppState`, si existe en PostgreSQL; en una base nueva se prioriza la base SQLite local más reciente y luego `data/state.json`.
- Se importan las cachés de `data/research/` y `data/long-range/`, y las capturas recientes. La migración se retoma tras una interrupción y no reimporta ni sobrescribe datos al reiniciar.
- Los archivos originales y las tablas anteriores se conservan. Después de verificar el informe y descargar un respaldo se pueden archivar aparte; no son la fuente de lectura habitual.
- El informe consulta resúmenes sin descargar las series horarias de 45 años. Se reutiliza en memoria hasta que cambian los datos; las escrituras guardan solo los registros modificados.
- Las transacciones evitan pérdidas entre procesos. Las descargas usan coordinación en la base, con vencimiento para recuperarse si un proceso se cierra. Las predicciones congeladas y sus resultados no se reemplazan con actualizaciones posteriores.
- La caché descargable tiene un presupuesto inicial de **128 MB** (`CLIMATO_CACHE_MAX_MB`). Al superar el límite se eliminan primero las entradas más antiguas de esa caché; se conservan equipos, históricos calculados, criterios y observaciones. Se retiene una captura por equipo y día durante 14 días y los objetivos de validación durante 61 días.
- El coordinador no consulta la base cada minuto mientras está en espera. Los errores repetidos aumentan la espera entre reintentos hasta seis horas, para evitar descargas y conexiones constantes. Una carga inicial extensa o dejar la página abierta sigue consumiendo cuota; el panel del proveedor es la referencia de uso total, incluyendo índices y tablas anteriores.

### Respaldos y recuperación

«Descargar respaldo» en el informe exporta todos los datos de campaña y validación en JSON. También se puede ejecutar:

```sh
npm run db:backup
```

Crea un archivo comprimido en `data/backups/`, excluido de Git. Incluye equipos, históricos calculados, criterios, pronósticos y validación; omite la caché descargable. Guardar una copia fuera de la PC y de la base.

Para recuperar en **una instalación y base vacías**, configurar la conexión y ejecutar:

```sh
npm run db:restore -- ruta/al/respaldo.json.gz
```

También acepta el JSON descargado desde la página. Valida los registros antes de escribir y rechaza una base que ya tenga datos; no sobrescribe una campaña existente. El respaldo no sustituye la supervisión de las cuotas ni garantiza por sí solo continuidad del servicio gratuito.

## Estimación integrada y cobertura

La pantalla publica una sola estimación combinada, un resumen global de las ubicaciones seleccionadas y el detalle por ubicación. Las probabilidades por familia están dentro de «Detalle técnico de las fuentes».

Una fuente que termina antes o tiene cobertura insuficiente no anula las fuentes que sí cubren esa fecha. Se siguen exigiendo al menos dos fuentes con diez miembros y 80% de cobertura cada una; se combinan sólo las que pasan ese mínimo. Los rangos de períodos completos usan las fuentes que cubren todo el período.

El resumen diario global es el promedio de probabilidades entre ubicaciones con información, con igual peso y denominador visible por fecha. No es la probabilidad de que cualquier zona resulte apta ni una predicción para ubicaciones ausentes. Si faltan fechas, se muestran los días previstos únicamente sobre las fechas analizadas y se informa su cobertura, sin extrapolar días ni rachas desconocidas.

La carga de corto plazo usa lotes de seis coordenadas, cuatro consultas de fuentes por lote y alternancia entre regiones. Se priorizan las ubicaciones aún sin registros y el cálculo integrado antes de las descargas determinísticas auxiliares. Los errores quedan guardados por ubicación y se distinguen de una descarga pendiente. Se solicitan 16 días horarios para el horizonte operativo, sin descargar los 35 días que antes se pedían para todas las fuentes.

## Referencia histórica para fechas sin pronóstico

El informe prioriza el ensemble de corto plazo con cobertura suficiente, luego una proyección estacional vigente y, para las fechas restantes, la frecuencia histórica de días aptos en las mismas fechas y coordenadas del equipo. La referencia histórica requiere al menos diez años con etiquetas calculadas bajo los criterios actuales; no usa el porcentaje fijo de disponibilidad configurado como sustituto de datos reales. Las celdas y semanas que usan esta base se identifican como «Base histórica» y no proponen horas de ensayo.

La perspectiva semanal recorre todo el período restante de campaña. Informa días esperados y, por ubicación, una referencia empírica del 80% central de años completos para esa semana. Se muestrean años enteros para conservar rachas; no se multiplica el número de muestras tratando días correlacionados como independientes. Agrupar por semana permite planificar sin una falsa precisión de fecha; no constituye por sí mismo una mejora de habilidad predictiva.

El total hasta el cierre suma las estimaciones de todas las fechas con cobertura, indicando cuántas provienen de historia. Si faltan fechas, conserva el subtotal y marca la cobertura parcial. El historial no se presenta como un pronóstico emitido en el pasado ni entra como tal en la matriz de confusión operativa.

La descarga histórica ahora avanza por años recientes y lotes de seis coordenadas: obtiene una temporada para todas las ubicaciones antes de pasar a la siguiente. Tras los primeros diez años se puede publicar la referencia, mientras continúa ampliándose hasta 45 años. Cada temporada y cada resumen parcial se guardan para retomar el avance. La descarga ERA5 no depende de NOAA ni de que se pueda obtener un pronóstico estacional. La verificación interna del entrenamiento se calcula cuando está completa la serie de 45 años.
