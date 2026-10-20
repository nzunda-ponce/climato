# Conexión de Climato con Neon

Proyecto creado y estructura verificada el 20 de octubre de 2026.

- Panel: https://console.neon.tech/app/projects/misty-mountain-41853228
- Organización: Nicolás, plan Free.
- Proyecto: `misty-mountain-41853228` (Climato).
- Región: São Paulo (`aws-sa-east-1`).
- Rama principal: `production` (`br-mute-field-b6aplq1a`).
- Base: `climato`.
- Rol: `climato_owner`.
- Pool de conexiones habilitado. Cómputo limitado a 0,25 CU.

La tabla `ClimatoRecord` y sus índices están creados con el mismo SQL que usa la aplicación. Se validaron primero en una rama temporal `setup-check`, configurada para vencer automáticamente una hora después de su creación.

## Activación desde la PC con los datos

1. Abrir el panel del proyecto y seleccionar **Connect / Conectar**.
2. Elegir rama `production`, base `climato`, rol `climato_owner` y la conexión con **Pooling**. Copiar la cadena completa con SSL.
3. En la carpeta local del proyecto ejecutar `npm run db:setup` y pegar la cadena cuando la solicite. La entrada queda oculta y se guarda en `.env.local`, excluido de Git.
4. Al terminar la importación automática, reiniciar Climato una vez. La página debe indicar «Datos guardados en la nube». `npm run db:status` permite verificarlo en la terminal.

Si el comando todavía no existe, actualizar una vez la rama `codex/automatic-data-import`, instalar dependencias y ejecutar `npm run db:generate`. Las instalaciones con el actualizador activo reciben el código automáticamente.

No se copiaron datos de campaña desde este entorno de desarrollo: los originales están en la PC del usuario. La base principal se dejó sin registros ni marcador de migración para que el primer arranque desde esa PC importe su campaña, históricos y validación. No abrir otra instalación vacía contra esta base antes de completar esa importación.

No compartir contraseñas por chat ni subir cadenas de conexión a Git. Los identificadores de este documento no son credenciales. No se cambió el plan ni se contrataron servicios pagos. El proveedor rechazó modificar el intervalo de suspensión en esta cuenta Free; se conservó su política de cuenta. Revisar las cuotas en el panel; este proyecto no convierte el alojamiento de la aplicación en un servicio permanente.
