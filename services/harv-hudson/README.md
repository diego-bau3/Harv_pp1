# Hudson de Harv

Copia independiente de la interfaz web y motor de Hudson 0.4.1, integrada en
Fabricacion. No ejecuta ni importa modulos desde la instalacion original.
`UPSTREAM.json` conserva las huellas del codigo de origen para revisar futuras
mejoras deliberadamente. No sincronizar carpetas completas entre instalaciones.

## Incluido

- Impresoras y colas persistentes por maquina.
- Biblioteca de archivos 3MF ya sliceados, validacion de modelo y boquilla.
- Filamento, reservas, consumo, cambios de rollo y ajustes.
- Recoleccion, piezas buenas/rechazadas, reintentos, historial y estadisticas.
- Acceso desde Fabricacion sin salir de Harv y sin mezclar sus estilos.
- Plan de fabricacion anterior conservado, sin migraciones ni borrado de datos.

## Aislamiento

- Servicio propio en 127.0.0.1:8789; 8787 y 8788 estan reservados y se rechazan.
- Datos exclusivos en `services/harv-hudson/data/`, ignorados por Git.
- Identidad `harv-hudson`, cookie `harv_hudson_session`, token y DPAPI propios.
- No se copian impresoras, colas, rollos, sesiones, secretos ni archivos de usuario.
- No se leen las variables HUDSON_*, perfiles de Bambu Studio ni la base original.
- Una carpeta con datos ajenos o enlazada mediante junction/symlink se rechaza.
- Buscar impresoras es manual. Descubrir no registra ni inicia una impresion.
- Vincular exige introducir el codigo LAN y confirmar que otros gestores no
  enviaran trabajos a esa impresora. Esta confirmacion no es un bloqueo entre
  aplicaciones: asignar maquinas diferentes o retirar su control del otro gestor.
- La API conserva autenticacion, comprobacion de origen y claves de idempotencia.
- Terminar una placa no libera la cama: se mantienen las confirmaciones fisicas.
- Los fallos inciertos requieren revision y no se reenvian al reconectar.

No compartir una misma carpeta `data` entre aplicaciones. No editar su SQLite
directamente. La recuperacion y las operaciones las realiza el motor.

## Ejecucion

Desde la raiz de Harv: `npm run hudson:install` y `npm run dev:plant`.
El iniciador arranca unicamente procesos propios y busca puertos libres. Para
cerrarlo usa Ctrl+C en esa terminal; nunca hay que detener Hudson original.

Para ejecutar solo el servicio: `npm run hudson:dev` desde la raiz.
Opciones propias:

- `HARV_HUDSON_PORT`: puerto local exclusivo (predeterminado 8789).
- `HARV_HUDSON_FRAME_ORIGINS`: origenes HTTP locales de Harv separados por coma.
  Predeterminados: http://127.0.0.1:5173 y http://localhost:5173.
- `VITE_HARV_HUDSON_URL`: direccion del servicio para el frontend. Nunca 8788.
- `HARV_HUDSON_DISABLE_MQTT=1`: deshabilita conexiones MQTT durante desarrollo.
  No sustituye los transportes falsos de las pruebas ni deshabilita todas las
  operaciones LAN; no registrar impresoras reales en una prueba.
- `HARV_HUDSON_FFMPEG`: ruta a una instalacion propia de ffmpeg para camaras RTSPS
  X1C/X2D. No se incluyen binarios ni se busca el ejecutable del Hudson original.

## Alcance pendiente

El slicer nativo modificado de Bambu Studio no esta copiado ni embebido. Exportar
un 3MF sliceado e importarlo a esta biblioteca es el flujo disponible.

Las ordenes de Harv todavia no generan placas automaticamente en esta cola. El
plan de fabricacion y la cola de ejecucion son vistas separadas. La siguiente
etapa debe relacionar orden/linea/componente/revision con biblioteca/placa/job,
persistir esa relacion, evitar duplicados y conciliar piezas recolectadas antes
de crear una entrada a almacen. No tomar nombres de archivos como archivos reales
ni descontar filamento otra vez en Harv.

## Verificacion

`npm run test:hudson` ejecuta pruebas heredadas y nuevas de aislamiento usando
bases temporales y transportes falsos. No se conecta a impresoras reales.
`npm run test:reliability` verifica los flujos existentes de Harv.

La integracion debe pasar tambien una revision visual en escritorio y movil,
incluyendo desconexion, recuperacion, cambio de secciones y formularios.
