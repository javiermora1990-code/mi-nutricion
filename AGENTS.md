# Mi Nutrición — instrucciones para agentes de código

PWA Android-first y local-first para **planificar comidas semanalmente con ayuda de una IA** (ChatGPT o Gemini). Llevar registros es útil pero secundario: ninguna función debe exigir anotar datos a diario.

## Dónde está cada cosa

- **Diseño (fuente de verdad)**: `docs/drive_pendiente/Decisiones_de_diseno.md` y `docs/drive_pendiente/estado_diseno.json`. Esa carpeta está en `.gitignore` porque contiene datos personales del usuario: léela, pero **nunca la subas ni copies su contenido personal al repositorio**. Si no existe en tu máquina, pídele los dos archivos al usuario (están en su Google Drive, carpeta "Mi Nutrición").
- **Código**: `src/db` (17 tablas Dexie y tipos), `src/schemas` (5 esquemas Zod de los JSON de intercambio), `src/lib` (lógica pura y operaciones de base de datos), `src/screens`, `src/components`, `src/ui/kit.tsx` (piezas de interfaz), `src/routes.ts` (rutas por `location.hash`).
- **Pruebas**: `tests/` (Vitest + fake-indexeddb). `npm test` debe quedar siempre en verde.
- **Publicación**: `npm run deploy -- "mensaje"` compila y publica en la rama `gh-pages` (GitHub Pages). La rama `main` es el código.

## Estado

- Etapas 1 y 2 completadas y verificadas por el usuario en su teléfono (versión 0.2.1).
- **Siguiente: Etapa 3** (sección 16.3 del diseño): catálogo inicial de 80–120 alimentos (USDA, CC0, nombres en español), búsqueda en Open Food Facts, recetas versionadas, diario y panel Hoy.
- **Decisión pendiente del usuario**: si el planificador de menús y la lista de compra (hoy en la Etapa 5) se adelantan a justo después del catálogo y las recetas. Empieza por catálogo y recetas, que hacen falta en ambos casos, y **pregunta al usuario antes de empezar el diario**.

## Reglas que no se negocian

1. **Versiones exactas** en `package.json` (sin `^` ni `~`). No añadas paquetes si una API nativa del navegador resuelve la función. Si de verdad hace falta uno, justifícalo y fija la versión.
2. **Los valores desconocidos son `null`, nunca `0`.** En pantalla se muestran como «Sin dato». Los promedios solo cuentan los registros con dato.
3. **Nada se activa ni se descuenta sin aprobación explícita del usuario**: metas, inventario e importaciones de la IA pasan siempre por propuesta → revisión → confirmación.
4. **El historial no se reescribe**: perfiles, metas y recetas se versionan; los registros pasados guardan instantáneas; los movimientos de inventario son un libro inmutable.
5. **Repositorio público**: ningún dato personal del usuario en código, pruebas, mensajes de commit ni ejemplos. Usa siempre personas ficticias.
6. **No cambies el esquema de la base de datos a la ligera.** Hay datos reales en el teléfono del usuario. Si necesitas índices o tablas nuevas, sube `DB_SCHEMA_VERSION` con una migración de Dexie que conserve los datos, y avisa al usuario antes.
7. **Intercambio de archivos verificado en Android** (no lo cambies sin volver a probar en el teléfono): al compartir, el archivo se llama `nombre.json.txt` con tipo `text/plain` y el título compartido es el propio nombre del archivo; al descargar, `nombre.json`; al importar, los documentos se reconocen por su contenido (campo `schema`), nunca por tipo o extensión.
8. **Convención de intervalos**: en `{ central, minTolerance, maxTolerance }`, mínimo y máximo son límites absolutos en la misma unidad que `central`.
9. **Licencias del catálogo**: la semilla incluida en el código solo puede salir de USDA FoodData Central (dominio público). No empaquetes datos de BEDCA. Los datos de Open Food Facts se consultan en línea, se guardan como «pendiente de verificar» y exigen atribución ODbL en la aplicación.
10. Interfaz en español de España; fechas y números con `Intl` (`es-ES`); moneda EUR.

## Forma de trabajar

- Lógica en funciones puras o en `src/lib`, con pruebas; las pantallas solo presentan. Sigue el estilo de los archivos existentes.
- Antes de dar algo por terminado: `npx tsc --noEmit`, `npm test` y `npm run build`. Di con claridad qué has probado tú y qué solo puede probar el usuario en el teléfono.
- Trabaja en una rama por etapa o cambio; fusiona en `main` solo cuando el usuario lo apruebe. Publica con `npm run deploy` cuando haya algo que él deba probar.
- Al cerrar una etapa o cambiar una decisión, actualiza los dos archivos de `docs/drive_pendiente` (sube el número de versión interno) y dile al usuario que los sustituya en Drive: allí solo debe quedar la versión vigente.
- Si el diseño no da una cifra o un criterio, propón uno, márcalo como «propuesto» en el diseño y pide confirmación; no lo des por decidido.
