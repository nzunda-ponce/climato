# Estimación con árboles potenciados

La implementación entrena dos clasificadores de gradient boosting, con árboles
regularizados de profundidad 2 o 3, parada temprana y calibración sigmoide:

- **Meteorológico:** convierte cada escenario EC46/SEAS5 en probabilidad de día
  apto. Usa la posición dentro de la temporada, ciclos anuales/semestrales,
  viento en la jornada, lluvia diaria y previa, acumulados anteriores de 3 y 7
  días, cambio de viento y racha seca previa.
- **Climático:** aprende la estacionalidad de la aptitud sin exigir conocer el
  tiempo futuro. Sus probabilidades se promedian por semana. Se compara con la
  referencia histórica semanal existente.

Las etiquetas siguen los criterios horarios configurados. Las variables de
lluvia/viento proceden de las muestras históricas compatibles con la resolución
estacional, no de nombres de equipos ni del mapa Windy. No se incorporan valores
inventados de temperatura, suelo, acceso ni índices futuros de ENSO. Estas
variables necesitarían cobertura histórica y una entrada válida al pronosticar.

## Entrenar en la computadora que tiene los históricos

Node y las dependencias del proyecto son suficientes. La web puede seguir
abierta y mantener `CLIMATO_DISABLE_AUTO_SYNC=1`.

Primero probar una ubicación, con los datos guardados:

```powershell
node --import tsx scripts/train-ml.ts --limit=1
```

Para entrenar todas las ubicaciones pendientes y consultar escenarios
estacionales vigentes cuando hagan falta:

```powershell
node --import tsx scripts/train-ml.ts --refresh-forecast
```

`--refresh-forecast` permite consultar el proveedor estacional; no vuelve a
bajar ERA5. Sin esa opción, solo se reprocesan escenarios existentes en caché.
El modelo meteorológico puede quedar preparado sin estar aplicado a un
pronóstico vigente. El tablero distingue esos estados.

`--limit=N` limita las ubicaciones procesadas. `--force` vuelve a entrenar aun
cuando la versión guardada coincide. Cada ubicación se guarda antes de pasar a
la siguiente. Un reinicio conserva los modelos completados; una ejecución
posterior omite los modelos vigentes. Las credenciales de `.env` se usan sin
imprimirlas. No se cambian las reglas, coordenadas ni estados de equipos.

## Datos mínimos y división temporal

Se requieren **21 temporadas completas o suficientemente cubiertas**, con al
menos 60 etiquetas y muestras meteorológicas por año y suficientes casos de
ambas clases. Las divisiones respetan años enteros y el orden temporal:

1. Entrenamiento: todos los años elegibles anteriores a los once más recientes;
   por lo menos diez años.
2. Selección: tres años posteriores, para profundidad y parada temprana.
3. Calibración: tres años posteriores, para ajustar probabilidades.
4. Prueba final: cinco años más recientes, sin modificar árboles ni calibración.

Se comparan las mismas fechas con los análogos meteorológicos existentes y la
referencia semanal, construidos usando el bloque de entrenamiento. Los datos
faltantes de los predictores se imputan con medianas del entrenamiento y llevan
un indicador explícito; una etiqueta desconocida nunca se convierte en cero.
Los acumulados y cambios usan únicamente días anteriores a la fecha objetivo.

La prueba final se usa una vez como criterio de despliegue. El candidato se
habilita solo si mejora el Brier de selección y calibración y supera a la base
en al menos 0,002 de Brier en la prueba final. Esto es selección retrospectiva,
no una garantía de mejora futura ni una evaluación independiente de la política
completa de selección. Repetir ajustes sobre esos mismos años requerirá nuevas
pruebas futuras para medir generalización.

El tablero expone modelos seleccionados/rechazados, particiones, cantidad de
casos, Brier por etapa e importancia de variables. Los faltantes de la referencia
se excluyen de las comparaciones, que usan cohortes comunes. La importancia por
ganancia no prueba causalidad. Las ventanas esperadas del ML se aproximan con la
probabilidad y la capacidad media de los días aptos del entrenamiento; no
reconstruyen franjas horarias futuras.

## Persistencia y ejecución

Los árboles se guardan en la base configurada, junto al histórico correspondiente,
con versión, firma de criterios y huella del conjunto de datos. El entrenamiento
ocurre en este proceso de consola, **no en Next ni al abrir una zona**. La web
solo aplica los árboles guardados y publica métricas resumidas, sin enviar los
pesos al navegador. Nuevos históricos o criterios requieren reentrenar; los
pronósticos procesados con una huella de modelo incompatible se descartan.

La evaluación meteorológica usa variables ERA5 del día evaluado. Mide el modelo
que traduce meteorología en aptitud; **no mide el acierto del pronóstico
estacional**. Para eso siguen faltando hindcasts de EC46/SEAS5 y resultados reales
de campo. Las pruebas sintéticas verifican el software y no establecen precisión
sobre los equipos reales.
