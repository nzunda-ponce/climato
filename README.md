# Climato

Herramienta interna para evaluar la viabilidad climática de los trabajos de uniformidad de pivots hasta el 31/12/2026. Mapa meteorológico y oportunidades de trabajo por equipo. Fechas de Argentina.

## Ejecutar

Node.js 22 o superior:

```sh
npm install
npm run db:generate
npm run dev
```

### Actualizaciones automáticas del proyecto

`npm run dev` mantiene la aplicación local sincronizada con la rama de GitHub que estás usando. Revisa cada 15 segundos, descarga las nuevas versiones y reinicia el servidor y la página automáticamente. Si cambian dependencias o el esquema de Prisma, también prepara esos cambios. Dejá la terminal abierta; ya no hay que repetir `git pull` ni `npm run dev` por cada mejora.

En Windows también podés iniciar con doble clic en **Abrir Climato.cmd**. Para activar esta función en una instalación anterior hay que hacer una última actualización y reiniciar una vez con `npm run dev`.

Se conservan `data/`, `.env` y los cambios locales: si hay archivos modificados, commits locales que impiden avanzar o una colisión con archivos propios, la actualización se pausa y lo informa en la terminal. Si se corta la conexión, continúa sirviendo la versión instalada y vuelve a intentar. Al cerrar la ventana se detiene el servidor. Para desarrollar sin recibir cambios remotos, usá `npm run dev:manual`.

Abrir http://127.0.0.1:3000. La persistencia por defecto es local: `data/state.json`, `data/research/`, `data/long-range/` y `data/snapshots/`. Los datos privados y las cachés están excluidos de Git. No hay autenticación; el servidor se limita a loopback.

Al abrir la aplicación se inicia la carga automática. Si no hay equipos, importa el mapa de Google My Maps configurado; luego descarga el corto plazo, la malla de lluvia y viento, los históricos ERA5, NOAA y el pronóstico hasta fin de año. Una notificación muestra el progreso y los errores reales de cada fuente. No hace falta pulsar los botones de Fuentes. El servidor debe permanecer encendido; la descarga continúa al navegar o cerrar la pestaña. Al volver a abrir la app tras reiniciar, reutiliza los archivos ya guardados. Los errores se reintentan tras cinco minutos, y los datos vigentes se conservan. No modifica automáticamente equipos ya cargados.

La primera carga de 45 años de históricos y 527 puntos de malla puede tardar bastante y está sujeta a acceso y límites de los proveedores. Sin conexión o sin acceso al mapa de origen se muestra el motivo y se reintenta; no se generan datos ficticios. En Windows conviene ubicar el proyecto fuera de OneDrive (por ejemplo `C:\Proyectos\climato`); el guardado reintenta bloqueos temporales antes de informar un error.

## Informe de oportunidades

Desde «Informe de oportunidades» en la cabecera del mapa, o en `/informe`, se ve «Cuándo podemos trabajar»: fecha próxima para revisar, días estimados a 7 y 14 días y hasta el cierre, y cuántas otras oportunidades podrían quedar. Los porcentajes, cantidades de modelos y cálculos detallados se consultan en un apartado opcional. Se puede imprimir el informe de la zona seleccionada.

La actualización funciona con el servidor encendido, incluso con la pestaña cerrada. Al reiniciar, retoma las descargas necesarias. La carga inicial de históricos y malla no bloquea la actualización de los pronósticos. Los porcentajes y rangos no son garantías de acierto local; los datos faltantes no se reemplazan por días secos ni por históricos.

## Uso

- **Mapa:** capa conjunta de lluvia y viento. El color representa lluvia diaria para hoy y lluvia acumulada esperada al elegir una semana: gris en 0, luego azul, verde, amarillo y rojo, con escala no lineal ajustada al período: 0 a 50+ mm para un día y 0 a 350+ mm para siete días. El acumulado esperado no implica lluvia continua. Los trazos siguen la dirección media del viento; su longitud, grosor, visibilidad y velocidad aumentan con la intensidad. WebGL dibuja unas 550 líneas con varios trazos por línea, calculando la geometría al cambiar fecha o posición. Si no está disponible, usa una alternativa SVG menos densa. Puede pausarse y respeta movimiento reducido. La disponibilidad climática se consulta como otra capa. Búsqueda, centrado en equipos y resumen ocultable.
- **Línea de tiempo:** cada semana muestra una cantidad aproximada de días para trabajar, en lugar de un porcentaje diario. Al elegir una zona, el cálculo usa esa zona; sin selección, muestra el promedio entre zonas, sin multiplicarlo por equipos. La vista diaria usa indicaciones como «Posible ventana; confirmar horario», «Puede servir» o «Faltan datos». Los horarios se consultan en «Ver días y horarios»; los porcentajes quedan como detalle opcional.
- **Cómo calculamos los días aptos:** explicación con ejemplos de porcentajes, ventanas y fechas lejanas. El detalle técnico de la comprobación está desplegable en Fuentes.
- **Detalle de equipo:** nombre, campo, ventanas estimadas, probabilidad de la mejor ventana y las próximas tres oportunidades. Las referencias históricas y los datos técnicos quedan en Fuentes.
- **Datos y reglas → Fuentes:** cobertura de cada fuente y zona, actualización y limitaciones del modelo.
- **Datos y reglas → Reglas:** viento (16 km/h por defecto), lluvia durante el ensayo (0 mm), lluvia del día anterior (menos de 15 mm), duración, jornada y fecha de cierre. Guardar recalcula con los históricos y pronósticos en caché.
- **Datos y reglas → Equipos:** ubicaciones, estados, edición, importación CSV/KML/KMZ/GeoJSON y sincronización del mapa de Google My Maps. Las correcciones de coordenadas conservan identificadores, estado y comentarios, y eliminan el pronóstico puntual de la posición anterior.

## Pronóstico y estadística

La pantalla principal usa **pronóstico en todo el período**. Los primeros 14 días priorizan ensembles de corto plazo con las variables completas. Después usa los 51 miembros de ECMWF EC46 y SEAS5. Si falta un pronóstico vigente, se informa sin cobertura; no se reemplaza silenciosamente por una frecuencia histórica.

EC46 y SEAS5 tienen resolución temporal nativa de 6 horas; SEAS5 no publica ráfagas para todo el horizonte. Un modelo experimental de 60 análogos transforma el viento y la lluvia de cada miembro en probabilidades de ventanas horarias, usando **ERA5 de octubre–diciembre de 1981–2025**. Las etiquetas históricas usan viento, lluvia limitada a las horas del ensayo, lluvia del día anterior y duración continua. Las ráfagas no son una regla. La lluvia previa es una aproximación al acceso y no confirma el estado real del camino. Se mantiene el mismo peso por familia en el corto plazo. La suma de probabilidades da días aptos esperados, sin sumar días de distintas zonas como si fueran jornadas adicionales.

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

El mapa de lluvia respeta exactamente el día o período seleccionado. Muestra el acumulado, incluida la noche; los días aptos buscan horas secas durante el ensayo y pueden coexistir con lluvia fuera de ese horario. Sin seleccionar una zona, el calendario resume el promedio entre zonas.
