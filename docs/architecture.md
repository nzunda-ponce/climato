# Climato — arquitectura del MVP

La herramienta principal evalúa la viabilidad climática de los trabajos hasta fin de año y permite aprovechar las jornadas disponibles. El mapa muestra pronóstico meteorológico continuo y disponibilidad por zona. Acceso, asignación de cuadrillas y ejecución se mantienen separados del potencial climático.

## Estructura

```
src/app/                 Next.js App Router, UI y endpoints del servidor
src/components/          ClimateWorkspace, ClimateDataRules y mapa Leaflet
src/domain/types.ts      Contratos, reglas y fechas de Argentina
src/domain/windows.ts    Ventanas horarias y score independiente de acceso
src/domain/planning.ts   Clusters, prioridades y escenarios de campaña
src/domain/import.ts     CSV, GeoJSON, KML y KMZ
src/domain/climatic.ts   Días y ventanas esperados, sin logística
src/domain/seasonal.ts   Análogos, validación temporal y clasificación RONI
src/domain/weather-grid.ts Interpolación bilineal de mallas públicas
src/domain/sync-pivots.ts Sincronización de coordenadas conservando estados
src/providers/weather.ts Pronóstico determinístico de corto plazo
src/providers/long-range.ts ERA5 45 años, EC46/SEAS5, NOAA y malla regional
src/persistence/store.ts Estado durable y snapshots inmutables
prisma/                  Esquema objetivo normalizado y PostGIS
tests/                   Casos de dominio e importación
data/                    Estado y snapshots locales, excluidos de Git
```

## Datos reales y trazabilidad

La descarga KML de My Maps se realiza en servidor, restringida al endpoint de Google. La sincronización compara identificador y nombre único para actualizar posiciones sin duplicar equipos ni borrar estados/comentarios. La posición anterior pierde su pronóstico determinístico. No se interpretan polígonos como pivots ni se infieren estados de ejecución a partir del estilo del mapa.

El proveedor de corto plazo consulta ECMWF IFS, GFS, ICON y GEM. `providers/research.ts` conserva ensembles por celda y el importador histórico anterior. La pantalla actual usa `providers/long-range.ts`: 45 años de ERA5, índice RONI oficial y 51 miembros EC46/SEAS5 hasta diciembre. El pronóstico largo se transforma en probabilidad de ventanas mediante análogos horarios. Los datos faltantes no se rellenan como clima favorable. Lluvia y ráfagas se alinean al intervalo que representan. Ver [fuentes y previsibilidad](predictability.md) para el algoritmo y los límites de validación.

El riesgo de acceso usa lluvia 24/48/72 h, lluvia prevista y humedad superficial cuando está disponible. La falta de historia completa produce DESCONOCIDO. La lluvia previa obtenida por `past_days` es salida modelada, no observación validada. La validación manual tiene fecha y comentario. No se modifica el criterio meteorológico cuando alguien informa acceso APTO.

## Persistencia

Sin `DATABASE_URL`: JSON local, escritura atómica y cola de mutaciones dentro de un proceso. Con `DATABASE_URL`: Prisma/PostgreSQL, estado MVP en `AppState` y snapshots en `ForecastSnapshot`. Las tablas normalizadas son la arquitectura preparada para la siguiente migración, aún no el repositorio activo de equipos. Esto permite arrancar sin instalar PostgreSQL, sin ocultar la diferencia.

La cola local, el bloqueo entre procesos y el agregado `AppState` permiten operar en un único host. Antes de múltiples réplicas/usuarios: repositorios normalizados, transacciones por entidad, autenticación, roles, auditoría por actor y trabajos en cola. El prototipo local no debe exponerse a Internet sin ese control de acceso. `postgis.sql` agrega una geometría derivada y un índice espacial a la tabla objetivo. Las cachés comprimidas de investigación se conservan en `data/research/` y `data/long-range/`, excluidas de Git. Los archivos ERA5 se almacenan por año para reanudar descargas.

## Escenarios

El motor anterior `domain/simulation.ts` conserva 500 trayectorias reproducibles de ejecución, con acceso, capacidad y remuestreo histórico. Está separado del pronóstico climático y no se muestra como probabilidad calibrada. `GET /api/campaign?mode=climate` evita ejecutar esa simulación y devuelve solo reglas, equipos y potencial climático. Los módulos `Dashboard.tsx` y `MapWorkspace.tsx` permanecen como código anterior, sin montarse desde la pantalla actual.

## Siguientes etapas

1. Mediciones de estaciones y verificaciones de ventanas: viento, ráfagas, lluvia y causas reales de cancelación.
2. Hindcasts del mismo sistema para corregir sesgos y validar por región, época y horizonte; radar/nowcasting para próximas horas.
3. Ampliar la evaluación de la señal ENSO actual sin duplicar el efecto ya contenido en el modelo acoplado.
4. Mejorar la simulación con rutas, tiempos de traslado, duración por trabajo y dependencia temporal del acceso.
5. Evaluar/promover calibración logística solo cuando mejore fuera de muestra. La evaluación está implementada en `domain/evidence.ts`; actualmente no hay suficientes observaciones.

La interfaz principal es `components/ClimateWorkspace.tsx`, con mapa continuo en `OperationalMap.tsx`. `ClimateDataRules.tsx` implementa las tres pantallas administrativas actuales: Fuentes, Reglas y Equipos. La malla meteorológica es pública y fija, independiente de los pivots; usa 1° en el centro y 2° para el contexto regional. Las partículas animadas usan sus vectores reales de viento. Ver [modelo de previsibilidad](predictability.md) para alcance y límites.

## Fuentes de integración

- https://open-meteo.com/en/docs
- https://open-meteo.com/en/docs/gfs-api
- https://open-meteo.com/en/docs/gem-api
- https://docs.prisma.io/docs/orm/prisma-client/using-raw-sql/safeql

Las condiciones de uso y límites del proveedor deben revisarse antes del uso comercial. Las claves se leen exclusivamente en servidor.
