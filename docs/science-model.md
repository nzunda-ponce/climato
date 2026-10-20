# Ciencia de datos y estimación hasta diciembre

La página `/ciencia-de-datos` consulta exclusivamente la publicación guardada en Neon. El proceso de datos calcula los diagnósticos; abrir la página no descarga ni entrena meteorología.

Al cambiar el código del modelo en la rama publicada, GitHub Actions ejecuta `data:publish` para recalcular el informe desde los datos existentes, sin consultar la API de clima. Las descargas periódicas conservan los horarios 07:17 y 19:17 de Argentina.

## Zonas de trabajo

Se usa la segunda letra del nombre: `BE1187` y `BE4577` pertenecen a Zona E. La carpeta geográfica del mapa se conserva como metadato de origen, pero no clasifica el análisis. Cuando dos zonas comparten coordenadas, las pertenencias se separan y el agregado climático global deduplica la coordenada.

## Qué significa el resultado

- Días integrados: suma de las probabilidades disponibles hasta la fecha límite, media por coordenada. Combina pronóstico, proyección y respaldo histórico conforme a su cobertura. No es cantidad de trabajos ejecutables.
- Ventana histórica: una secuencia máxima de días consecutivos con al menos un ensayo climático completo por día. No equivale al número de horarios de ensayo ni a una ventana confirmada del año actual.
- Rangos: percentiles 10–90 de temporadas históricas completas, combinando el mismo año entre ubicaciones. El agregado usa sólo años comunes y explicita la cobertura. No se presenta este rango como intervalo calibrado de la estimación integrada.

## Selección y evaluación de la referencia histórica

1. Sólo se usan etiquetas de años anteriores al año objetivo y compatibles con los criterios del ensayo.
2. Se reservan las cinco temporadas más recientes para evaluación. La selección compara ventanas máximas de 10, 20, 30 y 45 años con frecuencias directas o suavizado Beta(1,1), además de la referencia mensual, usando Brier en predicciones de origen móvil de los años anteriores a esa reserva. Se comparan los mismos casos observados entre candidatos. Si la referencia mensual gana, se utiliza: no se exige complejidad que no mejore los resultados.
3. Se exige un mínimo de diez años por probabilidad diaria y cinco temporadas internas para seleccionar. Si falta muestra para seleccionar, se conserva la base histórica sin afirmar selección validada.
4. Se evalúa la configuración fijada en los cinco años reservados. Cada temporada sólo usa las anteriores: se permiten años de prueba anteriores en una evaluación posterior de origen móvil, nunca datos futuros.
5. El Brier se compara con una referencia mensual calculada con datos previos. Se muestran también error absoluto de días para el período pendiente y cobertura observada del rango histórico. Los resultados negativos y las muestras insuficientes permanecen visibles.
6. Después de evaluar, la configuración elegida utiliza los años históricos disponibles para la campaña actual. Las etiquetas por día no se tratan como observaciones independientes; las temporadas completas son la unidad de los rangos.

Esta evaluación valida una referencia histórica, no todo el pronóstico integrado. El ajuste de análogos con clima reconstruido, los pronósticos archivados y los ensayos realmente efectuados son pruebas distintas.

## Datos adicionales y límites de consulta

La meta de preparación sigue siendo completar hasta 45 años ERA5 en cada coordenada. Durante las dos actualizaciones diarias existentes, si el pronóstico terminó sin errores, se procesan hasta seis tareas históricas adicionales; `CLIMATO_HISTORY_TASKS_PER_REFRESH=0` desactiva esa ampliación. Se reutilizan los años ya descargados y se respetan los bloqueos, presupuestos y pausas HTTP 429. No se añadió otro cron.

Más datos no garantizan más precisión. La ventana reciente puede superar a una larga; la elección se contrasta con años posteriores. Los datos de campo (horarios reales, mediciones, acceso y cancelaciones) siguen siendo necesarios para medir el resultado operativo. ERA5 no sustituye una estación o un ensayo real.
