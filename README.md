# Harv

Software para administrar una planta de ensamble y producción.

## Desarrollo

```bash
npm install
npm run dev
```

La app corre localmente con Vite.

## Hudson dentro de Fabricacion

Requiere Node.js 24 en Windows. La copia integrada no depende de una instalacion
de Hudson original y no comparte sus datos ni credenciales.

```bash
npm run hudson:install
npm run dev:plant
```

Abre la direccion de Harv que imprime la terminal y entra a **Fabricacion > Hudson**.
El iniciador usa puertos libres (5173 y 8789 por defecto); no detiene servicios existentes.
El plan anterior sigue disponible en **Plan de fabricacion**.

```bash
npm run test:hudson
npm run test:reliability
npm run build
```

Detalles, limites y almacenamiento: [Hudson de Harv](services/harv-hudson/README.md).
