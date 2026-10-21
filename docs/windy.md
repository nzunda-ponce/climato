# Conexión con Windy

El inicio utiliza Windy Map Forecast API cuando está configurada la variable
`WINDY_MAP_API_KEY`. Guardarla en Vercel para Production, con una licencia
de producción válida y el dominio `climato-eta.vercel.app` autorizado en Windy.
Se requiere un despliegue para aplicar cambios de variables de Vercel.

La clave se lee en el servidor y se entrega al SDK de Windy en una vista
independiente, sin almacenarla en Git ni en el bundle de la aplicación. Las
claves de Map Forecast son credenciales de navegador por diseño: restringirlas
al dominio autorizado. No usar una clave privada de otro producto de Windy.

El mapa muestra un marcador por equipo visible. Los filtros de zona y equipo
actualizan los marcadores y centran el mapa; pulsar un marcador selecciona
ese equipo en el panel. El selector de capas permite
alternar viento y lluvia, con unidades de km/h y mm. El enlace «Windy ↗» abre
la misma selección directamente en Windy. El período filtra las estimaciones
del panel; Windy conserva sus propios controles temporales del pronóstico.

Sin clave se conserva el mapa embebido gratuito con un marcador:
https://embed.windy.com/config/map

## Redes restringidas

El mapa descarga sus capas desde otros servidores además de embed.windy.com.
Si aparece «offline», revisar la política de red del navegador o entorno.
Para la API se requieren `api.windy.com` y `unpkg.com`, además de los servidores
de datos y capas. En este entorno se observaron conexiones bloqueadas a:

- node.windy.com
- tiles-s.windy.com
- ims-s.windy.com
- www.windy.com
- fonts.googleapis.com

Mantener permitido embed.windy.com. Las fuentes de Google también pueden
requerir fonts.gstatic.com. Windy puede usar otros servidores según la capa
y región: comprobar las solicitudes fallidas si aún falta contenido.

La política de red se modifica en la configuración del entorno, no editando
/etc/codex/network-policy.json. No desactivar el proxy ni la verificación TLS.

Si falla la conexión, el mapa permite reintentar o abrir la versión básica.
La clave de pruebas de Windy no habilita su uso en producción.

Referencia: https://api.windy.com/map-forecast/docs
