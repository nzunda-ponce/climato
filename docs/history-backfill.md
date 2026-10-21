# Historia utilizada por el estimador

La referencia se completa con ERA5 horario, octubre a diciembre de los últimos
45 años cerrados (1981–2025 en la campaña 2026), por coordenada de equipo. Se
descarga también el 30 de septiembre y el 1 de enero para comprobar la lluvia
previa y alinear los acumulados horarios. Los equipos con la misma coordenada
comparten la serie.

La acción **Completar históricos ERA5** inicia una pasada al publicar este
workflow y puede retomarse desde GitHub Actions con **Run workflow**. No agrega
otro horario automático. Comparte la cola con la actualización habitual para
evitar dos procesos descargando a la vez. Cada pasada dura como máximo 65
minutos más la tarea en curso y la publicación final; cada lote confirmado
queda guardado y las siguientes pasadas solicitan solamente los años faltantes.

Las solicitudes históricas usan el mismo control de descargas de pronósticos:
una respuesta completa por vez, separación de dos segundos y un solo reintento
ante errores transitorios. Un HTTP 429 detiene la pasada, conserva los avances
y publica su estado parcial. No se aumenta la cantidad de solicitudes para
eludir una cuota.

Después de la importación, el informe vuelve a ajustar y comparar los modelos
históricos con años anteriores al período evaluado, reservando las últimas cinco
temporadas para validación. La cantidad de años cargados y los resultados de esa
validación se encuentran en `/api/planning`, en `sources.historyYears` y `science`
por ubicación. Más años no equivalen automáticamente a mayor precisión; la
validación determina si un método supera la frecuencia mensual histórica.
