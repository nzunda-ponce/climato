# Climato

Informe de planificación de uniformidades en campo: zonas seleccionables, análisis meteorológico en las coordenadas de cada equipo, días aptos esperados, rachas continuas y verificación de pronósticos. Fechas y horarios de Argentina.

## Ejecutar

Node.js 22 o superior:

```sh
npm install
npm run db:generate
npm run dev
```

Abrir <http://127.0.0.1:3000>. En Windows también se puede iniciar con doble clic en **Abrir Climato.cmd**. Conviene ubicar el proyecto fuera de OneDrive (por ejemplo `C:\Proyectos\climato`); el guardado reintenta los bloqueos temporales de archivos.

`npm run dev` revisa cada 15 segundos la rama de GitHub configurada y actualiza código, dependencias y servidor. También recarga la página. Para activar esto en una instalación anterior hay que actualizar una vez y reiniciar con `npm run dev`. Con cambios locales o ramas divergentes, la actualización se pausa sin sobrescribirlos. `npm run dev:manual` permite desarrollar sin sincronización remota.

El servidor debe seguir encendido para descargar datos y archivar estimaciones, aunque nadie esté mirando la página. Si se apaga, no se inventan pronósticos para las fechas perdidas. La herramienta se puede consultar ocasionalmente; una instalación local apagada no puede construir una validación diaria continua.

## Nueva pantalla de planificación

La página principal y `/informe` ofrecen el mismo informe:

- **Zonas de trabajo:** seleccionar o deseleccionar regiones completas y ubicaciones individuales. Incluye búsqueda y acciones de seleccionar/quitar todas. La selección persiste en el navegador y limita tablas, resumen y matriz de confusión.
- **Windy:** mapa interactivo oficial insertado mediante [Windy Embed](https://embed.windy.com/config/map), con capas de viento y lluvia y enlace a la web completa. Se centra en la ubicación consultada. Su fecha y su modelo se controlan dentro de Windy; el contenido del iframe no alimenta los cálculos ni está sincronizado con la fecha de la tabla. Se conservan sus controles y atribución.
- **Análisis a 7 y 14 días:** probabilidad diaria de al menos un ensayo completo, días esperados y rango central del 80% de escenarios. También informa la racha más larga de días consecutivos y, al elegir una fecha, la continuidad posterior condicionada a que ese día resulte apto.
- **Detalle por ubicación:** miembros por familia, cobertura, fecha de descarga y mejor franja común respaldada por el ensemble. Una probabilidad diaria alta puede reunir horarios diferentes entre escenarios y no implica una franja común de esa misma probabilidad.
- **Clasificación explícita:** umbral seleccionable entre 50% y 95%, con 70% inicial. Se muestra la probabilidad numérica y si supera el umbral. Modificar el umbral no recalibra el pronóstico ni aumenta la certeza.
- **Criterios:** viento máximo, lluvia durante el ensayo, lluvia del día anterior, duración consecutiva, jornada y fin de campaña. Cambiarlos invalida los cálculos anteriores y dispara su actualización automática.
- **Imprimir informe:** conserva las tablas de las ubicaciones seleccionadas; omite controles y el iframe externo.

La antigua superficie de calor propia y su malla pública de 527 nodos ya no se descargan automáticamente ni aparecen en la página principal. Los endpoints y herramientas anteriores se conservan para compatibilidad. Los equipos terminados y las coordenadas que requieren revisión quedan fuera del análisis.

## Cálculo y evidencia

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

## Datos y actualización

Si la instalación no tiene equipos, se importan de Google My Maps. Se actualizan automáticamente pronósticos puntuales, ensembles por coordenada, históricos ERA5, NOAA y perspectiva de campaña. La verificación tiene su propia cola y la carga larga no bloquea el corto plazo. Los errores se muestran y se reintentan; no se generan datos ficticios.

La persistencia por defecto usa `data/state.json`, `data/research/`, `data/long-range/` y `data/snapshots/`. Los datos privados y cachés están excluidos de Git. La validación se guarda en el estado, incluyendo la primera predicción y los criterios de ese momento. No hay autenticación; el servidor se limita a loopback.

Endpoints principales: `/api/planning`, `/api/validation?lead=1&threshold=0.7&key=lat,lon`, `/api/auto-sync` y `/api/campaign` para criterios. La validación intersecta las claves solicitadas con las ubicaciones activas de los equipos.

## Verificar

```sh
npm test
npm run build
```

Las pruebas cubren ventanas horarias, lluvia nocturna y previa, datos faltantes, familias y cobertura, trayectorias y rachas, archivo inmutable, separación temporal de validación, matriz y Brier, ubicaciones próximas distintas, persistencia y actualización automática del código.

## PostgreSQL + PostGIS opcional

```sh
docker compose up -d
npm run db:push
```

Configurar `DATABASE_URL` en `.env` y aplicar `prisma/postgis.sql`. El estado y la validación se guardan como `AppState`; la caché meteorológica permanece local. No hay migración automática de datos locales existentes: exportar un respaldo antes de cambiar de modo.

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
