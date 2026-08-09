## 1. Ceñido como función pura

- [x] 1.1 `clampToViewport({ x, y, width, height, viewportW, viewportH, margin })`
      en `utils/contextMenu.ts`
- [x] 1.2 Pruebas: sitio de sobra (no se mueve), desbordamiento por la derecha,
      por abajo, por ambos, menú más grande que la ventana (queda en el margen),
      y clic en coordenadas negativas

## 2. Medir con el elemento montado

- [x] 2.1 El ref solo guarda la referencia; el ceñido pasa a un efecto que corre
      con el elemento ya insertado
- [x] 2.2 Volver a ceñir cada vez que se abre un menú (posición e ítems nuevos)
- [x] 2.3 Prueba de componente con `getBoundingClientRect` simulado: un menú
      abierto junto al borde derecho termina con un `left` menor que el clic

## 3. Cierre

- [x] 3.1 `pnpm test` verde
- [x] 3.2 Commit en Conventional Commits referenciando #318
