# Previsibilidad, fuentes y límites

## Cadena de pronóstico hasta diciembre

La aplicación no denomina pronóstico a una frecuencia histórica. Cada día futuro usa un pronóstico vigente o queda sin cobertura:

1. Próximos 14 días: ensembles ECMWF y GEFS con viento, ráfagas y lluvia. Se promedian fracciones favorables por familia, con igual peso. ICON y GEM sin ráfagas solo sirven para contraste parcial.
2. Horizonte posterior: 51 miembros de ECMWF Seasonal Seamless, que combina EC46 y SEAS5. Se consultan hasta el cierre de campaña más un día para alinear acumulados.
3. Ventanas horarias a partir del pronóstico de 6 h: modelo estadístico de análogos con 45 años de ERA5 horario, octubre–diciembre de 1981–2025.

Los primeros modelos tienen vigencia máxima de 12 h para el cálculo principal. Las estimaciones EC46/SEAS5 dejan de usarse después de 36 h desde la consulta. La caché del proveedor se reutiliza durante 12 h. Un cambio de reglas exige recalcular la evaluación, sin volver a descargar históricos disponibles.

## Modelo estadístico de ventanas

ERA5 aporta viento, ráfagas y precipitación horarios. Se alinean los máximos y acumulados sellados al final del intervalo antes de evaluar ventanas continuas. Cada día histórico recibe un label de cantidad de bloques no superpuestos de duración mínima, dentro de la jornada, que cumplen todas las reglas. Los datos incompletos no se rellenan con cero.

Para cada miembro estacional y fecha se extraen el máximo de las muestras de viento de 6 h dentro de la jornada y la precipitación total del día. Se buscan los 60 días ERA5 más parecidos dentro del mismo mes. La distancia usa viento normalizado por 5 km/h y `log(1 + lluvia)` normalizado por 0,8. Los pesos son `1 / (0,25 + distancia² normalizada)`. La probabilidad de tener una ventana es la fracción ponderada de análogos con al menos un bloque; los cupos son su cantidad ponderada de bloques. Se promedian después los resultados de los miembros.

La cuantización de consultas (2 km/h y cuartos en log-lluvia) permite reutilizar predicciones. Se requieren al menos 30 años y 30 muestras comparables. Los análogos incluyen la variabilidad de ráfagas y la secuencia horaria histórica: las ráfagas ausentes de SEAS5 no se fijan en cero ni se declaran observadas. La salida es una estimación estadística de ventanas, no una medición de continuidad.

Los días aptos esperados de un período son la suma de probabilidades diarias. La pantalla promedia espacialmente ponderando por ubicación de los trabajos pendientes; no suma días de distintas zonas como nuevas jornadas. El resumen excluye zonas sin cobertura completa del período y muestra cuántas están completas. Hoy se excluye por estar parcialmente transcurrido.

## ENSO y años Niño

Se descarga la serie oficial RONI de NOAA/CPC y se conserva con fecha y URL. Los episodios históricos requieren al menos cinco trimestres consecutivos sobre +0,5 °C o bajo −0,5 °C. La señal del último índice se informa con el mes central; no se presenta un índice aislado como declaración de un episodio.

La disponibilidad histórica se agrupa por fase del trimestre correspondiente a cada fecha. Un año puede aportar meses a fases diferentes; los conteos de años por fase no tienen por qué sumar 45. La comparación muestra días aptos y tamaño de muestra para Niño, Niña y neutral, con los mismos umbrales de trabajo.

SEAS5 es un pronóstico acoplado océano-atmósfera. No se añade un multiplicador ENSO arbitrario que cuente dos veces una señal ya presente en el pronóstico. La comparación de fases permanece separada de la predicción dinámica.

## Validación y confianza

El modelo de análogos se comprueba con separación temporal: entrenamiento hasta 2015 y evaluación desde 2016, tomando cada quinto día disponible. Se muestra Brier frente a una frecuencia mensual del entrenamiento. Esta evaluación usa predictores y labels de ERA5: comprueba la reconstrucción estadística de ventanas, **no la habilidad del pronóstico EC46/SEAS5**.

Todavía no hay calibración contra hindcasts SEAS5/EC46 ni observaciones locales de ensayos. Los sesgos entre el modelo estacional y ERA5 no están corregidos. Tampoco se mide confiabilidad por plazo de emisión, ni se conoce el error operativo de las ventanas estimadas. No se convierte la mejora de Brier interna en una afirmación de acierto del pronóstico final.

La resolución nativa estacional es de 6 h y su habilidad disminuye con el plazo. Es más apropiado interpretar semanas y períodos que comprometer una hora concreta a meses de distancia. Viento del modelo a 10 m y ráfagas del reanálisis no equivalen a mediciones a otra altura en el pivot.

## Campo meteorológico del mapa

Se usa una geografía pública fija, independiente de los pivots: malla de 1° para la región central y 2° para el contexto sudamericano, 527 nodos compartiendo muestras. El mapa combina series horarias de corto plazo con la media ensemble estacional. Muestra viento medio y lluvia media diaria del período seleccionado, no máximos ni lluvia total de toda la campaña. Las líneas animadas siguen el vector medio.

La interpolación es bilineal entre cuatro nodos presentes; usa el paso regional cuando faltan nodos de la malla central. No extrapola fuera de sus límites. No es una grilla nativa de 9/36 km ni permite identificar diferencias dentro de un establecimiento. La capa de disponibilidad se limita a las zonas con históricos y modelo estadístico, interpolada con un radio de aproximadamente 160 km.

## Datos y reglas

La pantalla actual tiene tres vistas: Fuentes, Reglas y Equipos. No monta el antiguo tablero operativo. Las fuentes muestran años, muestras, cobertura futura, errores y validación. Los cambios de reglas recalculan el modelo con la caché. La sincronización de Google My Maps actualiza coordenadas conservando identificadores, estados y comentarios; si una posición cambia, se elimina el pronóstico determinístico puntual anterior.

## Próximos datos que mejorarían la precisión

- Hindcasts del mismo sistema y versión: validación por horizonte, sesgo, calibración y comparación con climatología/ENSO.
- Estaciones en establecimientos, con altura, exposición, calidad y distancia al punto de trabajo.
- Resultados de cada ventana: inicio/fin, si pudo trabajarse y motivo de cancelación, diferenciando meteorología, acceso y logística.
- Comparación entre modelos y evaluación fuera de muestra por año completo, incluyendo episodios Niño fuertes.

Acceso, rutas y cuadrillas no forman parte de la disponibilidad climática principal. El antiguo motor de ejecución y su Monte Carlo siguen separados y no deben interpretarse como un pronóstico estacional calibrado.

## Fuentes

- [Open-Meteo Seasonal Forecast API](https://open-meteo.com/en/docs/seasonal-forecast-api)
- [Open-Meteo Historical Weather / ERA5](https://open-meteo.com/en/docs/historical-weather-api)
- [NOAA/CPC RONI](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/)
- [NOAA/CPC diagnóstico ENSO](https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml)
