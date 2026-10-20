# Climato

Herramienta interna para evaluar la viabilidad climática de los trabajos de uniformidad de pivots hasta el 31/12/2026. Mapa meteorológico y oportunidades de trabajo por equipo. Fechas de Argentina.

## Ejecutar

Node.js 22 o superior:

```sh
npm install
npm run db:generate
npm run dev
```

Abrir http://127.0.0.1:3000. La persistencia por defecto es local: `data/state.json`, `data/research/`, `data/long-range/` y `data/snapshots/`. Los datos privados y las cachés están excluidos de Git. No hay autenticación; el servidor se limita a loopback.

Al abrir la aplicación se inicia la carga automática. Si no hay equipos, importa el mapa de Google My Maps configurado; luego descarga el corto plazo, la malla de lluvia y viento, los históricos ERA5, NOAA y el pronóstico hasta fin de año. Una notificación muestra el progreso y los errores reales de cada fuente. No hace falta pulsar los botones de Fuentes. El servidor debe permanecer encendido; la descarga continúa al navegar o cerrar la pestaña. Al volver a abrir la app tras reiniciar, reutiliza los archivos ya guardados. Los errores se reintentan tras cinco minutos, y los datos vigentes se conservan. No modifica automáticamente equipos ya cargados.

La primera carga de 45 años de históricos y 527 puntos de malla puede tardar bastante y está sujeta a acceso y límites de los proveedores. Sin conexión o sin acceso al mapa de origen se muestra el motivo y se reintenta; no se generan datos ficticios. En Windows conviene ubicar el proyecto fuera de OneDrive (por ejemplo `C:\Proyectos\climato`); el guardado reintenta bloqueos temporales antes de informar un error.

## Uso

- **Mapa:** capa conjunta de lluvia y viento. El color representa lluvia diaria para hoy y lluvia acumulada esperada al elegir una semana: gris en 0, luego azul, verde, amarillo y rojo, con escala no lineal ajustada al período: 0 a 50+ mm para un día y 0 a 350+ mm para siete días. El acumulado esperado no implica lluvia continua. Los trazos siguen la dirección media del viento; su longitud, grosor, visibilidad y velocidad aumentan con la intensidad. WebGL dibuja unas 550 líneas con varios trazos por línea, calculando la geometría al cambiar fecha o posición. Si no está disponible, usa una alternativa SVG menos densa. Puede pausarse y respeta movimiento reducido. La disponibilidad climática se consulta como otra capa. Búsqueda, centrado en equipos y resumen ocultable.
- **Línea de tiempo:** campaña completa, semanas o días hasta diciembre. La vista diaria permite saltar a una fecha. El resumen muestra la media de ventanas esperadas por equipo, conservando la probabilidad de los escenarios, y la probabilidad media diaria. La lista de equipos con fechas candidatas no representa trabajos confirmados. No se divide la expectativa por su probabilidad ni se presenta la suma de todos los equipos como horarios disponibles. Se muestran todas las ventanas posibles, incluidas las de baja probabilidad. Ya no se ocultan las que no superan el 50%. Las barras muestran la probabilidad media diaria de ventana, tanto por día como por semana, y el conteo de equipos con alguna posibilidad aparece separado. El mapa de calor abre con el tiempo de hoy y se mantiene así al navegar dentro de esta semana; cambia al seleccionar otra semana. Las ventanas esperadas se promedian por equipo; varios equipos cercanos pueden compartir el mismo horario. Los decimales indican una expectativa, no fracciones de horarios confirmados. «Ver ventanas posibles» abre un listado filtrable por equipo y fecha, con probabilidad y consulta de franjas horarias. Los horarios solo se muestran si los respaldan datos horarios vigentes; las fechas lejanas se marcan como tentativas. El detalle muestra las ventanas del equipo y la mejor probabilidad del período.
- **Cómo calculamos los días aptos:** explicación con ejemplos de porcentajes, ventanas y fechas lejanas. El detalle técnico de la comprobación está desplegable en Fuentes.
- **Detalle de equipo:** nombre, campo, ventanas estimadas, probabilidad de la mejor ventana y las próximas tres oportunidades. Las referencias históricas y los datos técnicos quedan en Fuentes.
- **Datos y reglas → Fuentes:** cobertura de cada fuente y zona, actualización y limitaciones del modelo.
- **Datos y reglas → Reglas:** viento (16 km/h por defecto), lluvia acumulada del día (0 mm), lluvia del día anterior (menos de 15 mm), duración, jornada y fecha de cierre. Guardar recalcula con los históricos y pronósticos en caché.
- **Datos y reglas → Equipos:** ubicaciones, estados, edición, importación CSV/KML/KMZ/GeoJSON y sincronización del mapa de Google My Maps. Las correcciones de coordenadas conservan identificadores, estado y comentarios, y eliminan el pronóstico puntual de la posición anterior.

## Pronóstico y estadística

La pantalla principal usa **pronóstico en todo el período**. Los primeros 14 días priorizan ensembles de corto plazo con las variables completas. Después usa los 51 miembros de ECMWF EC46 y SEAS5. Si falta un pronóstico vigente, se informa sin cobertura; no se reemplaza silenciosamente por una frecuencia histórica.

EC46 y SEAS5 tienen resolución temporal nativa de 6 horas; SEAS5 no publica ráfagas para todo el horizonte. Un modelo experimental de 60 análogos transforma el viento y la lluvia de cada miembro en probabilidades de ventanas horarias, usando **ERA5 de octubre–diciembre de 1981–2025**. Las etiquetas históricas usan viento, día completo sin lluvia, lluvia del día anterior y duración continua. Las ráfagas no son una regla. La lluvia previa es una aproximación al acceso y no confirma el estado real del camino. Se mantiene el mismo peso por familia en el corto plazo. La suma de probabilidades da días aptos esperados, sin sumar días de distintas zonas como si fueran jornadas adicionales.

La serie oficial **RONI de NOAA** clasifica los episodios históricos después de al menos cinco trimestres consecutivos con umbral ±0,5 °C. El último índice se informa como señal, con su período. Los años Niño/Niña/neutrales son una comparación separada: SEAS5 ya modela la evolución del océano y no se agrega un multiplicador ENSO arbitrario.

El Brier mostrado es una validación temporal **interna del modelo estadístico contra ERA5**: entrenamiento hasta 2015 y evaluación desde 2016, muestreando cada quinto día. No mide el acierto del pronóstico estacional. Faltan hindcasts SEAS5/EC46 y resultados de campo para medir y calibrar la habilidad final. No se promete precisión diaria a meses de distancia.

## Mapa continuo

El viento y la lluvia proceden de una malla geográfica pública fija, independiente de las ubicaciones privadas: 1° en la región central y 2° para el contexto regional de Sudamérica, con 527 nodos y muestras existentes compartidas. Combina pronóstico de corto plazo y media ensemble EC46/SEAS5. La interpolación bilineal exige cuatro esquinas con datos reales y no extrapola fuera de la malla. La resolución de la muestra no es la resolución nativa del modelo ni detalle dentro del campo.

La disponibilidad se calcula para las zonas relevadas y solo se interpola cerca de ellas. No se pinta el resto del territorio con condiciones de trabajo inventadas.

## Actualizar por consola

```sh
npx tsx scripts/sync-source-map.ts
npx tsx scripts/refresh-research.ts ensemble
npx tsx scripts/refresh-long-range.ts
npx tsx scripts/refresh-public-grid.ts
```

La primera carga de 45 años requiere muchas consultas; los archivos anuales comprimidos permiten reanudarla y recalcular reglas sin descargarla otra vez. La malla pública se reanuda por nodos. Se respetan errores y límites del proveedor; una consulta fallida no genera datos ficticios. Los botones de Fuentes permiten las mismas actualizaciones.

## Verificación

```sh
npm test
npm run build
```

Las pruebas cubren ventanas continuas, datos faltantes, acuerdo de familias, pronóstico estacional separado de climatología, RONI, análogos, interpolación acotada y sincronización de posiciones sin duplicar equipos ni perder estados.

## PostgreSQL + PostGIS opcional

```sh
docker compose up -d
npm run db:push
```

Configurar `DATABASE_URL` en `.env` y aplicar `prisma/postgis.sql`. El agregado operativo se almacena como `AppState`; la caché meteorológica permanece local. No hay migración automática de los datos locales existentes: exportar un respaldo antes de cambiar de modo.

Ver [fuentes y previsibilidad](docs/predictability.md) para las limitaciones técnicas y los datos pendientes de calibración.
