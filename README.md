# ZGZ Desplázate (2611_zgzdesplazate)

Web móvil (MapLibre GL JS + Vite) para el bus y el tranvía de Zaragoza. Al abrir se muestra el **inicio** dentro del
**Localizador** (nombre interno del panel deslizable):

- **Buscador único**: número de poste (`262`), línea (`35`, `Ci1`), nombre de parada (`plaza españa`) o calle. Con una
  línea y tu ubicación ofrece directamente **el poste más cercano de esa línea en cada sentido**.
- **Accesos rápidos**: Cerca de mí (con filtro por línea), Líneas y Cómo llegar.
- **Favoritos y recientes** (sólo en este navegador): ☆ en un poste o en tu parada de una línea; el inicio muestra su
  próximo bus en vivo (cada 30 s).
- **URLs legibles** (todo en la ruta, sin `?parámetros`): `/poste/236/av-san-juan-bosco-7`,
  `/linea/35/hacia-parque-goya/sube-236/baja-707/destino-ezrkupqv`, `/cerca/linea-35/en-ezrkupqv`, `/bizi/en-ezrkupqv`,
  `/lineas`, `/ir`, `/info/privacidad`. Los puntos van como geohash (8 letras ≈ 20 m). Las URLs antiguas con
  `?sentido=&sube=…` se siguen entendiendo. Se pueden compartir y el botón atrás del móvil funciona.
- **Bizi** (acceso en el inicio): estaciones cerca de ti, de una calle escrita o de un punto del mapa, con bicis y anclajes libres en vivo.
- **Información** (botón *i* del inicio): para qué sirve, privacidad, buzón de sugerencias anónimo, código abierto, cómo calcula, instalar y créditos.
- **Ubicar parada**: por distancia (GPS o punto del mapa), por número de poste / nombre, o por ruta. La ficha de poste
  muestra todas sus líneas, su dirección y sus tiempos (Avanza en vivo o horario), con ↻ (10 s de enfriamiento).
- **Indicar a dónde voy**: origen (GPS, mapa o buscador de calles y números) → «Selecciona a dónde vas» → opciones
  con hasta 1 transbordo, tiempo total y hora de llegada. Tocar el mapa o tu ubicación muestra «Empezar aquí».
- **Explorar rutas**: todas las líneas; cada línea muestra sus dos sentidos en paralelo y resalta el elegido.
- **Vista de línea en directo**: buses (bolas amarillas), «Subo aquí / Bajo aquí» en la lista y en el mapa,
  tiempo estimado de trayecto, correspondencias (círculos de color) y funciones sociales (se pueden desactivar).
- **Estoy esperando** (en tu parada de una línea): cuenta atrás que te sigue por toda la app (barra superior) y aviso
  cuando falten N minutos y cuando llega. Con la app en segundo plano avisa el servidor con una **notificación push**.
- **He subido** (un toque): guarda la hora real de subida, lo que marcaba Avanza en ese momento y lo que marcaba cuando
  empezaste a mirar/esperar (Avanza dijo 7 min, tardó 10). El botón pasa a gris «Subido ✓»; otro toque = «Entrada
  incorrecta» y la subida se borra (30 min de margen), para que sólo queden datos reales. Si las funciones extra están activas y estás en la parada, arranca además el viaje verificado por GPS.
- **Quiero ir aquí**: en un poste o en tu parada de una línea, toca el mapa → la línea marca dónde bajarte (o el
  transbordo), dibuja el tramo a pie y propone alternativas desde tu poste. El destino va en la URL (`&hasta=lon,lat`).
- **Subidas reales** en la ficha de poste (por línea, 30 días) y «Bizi cerca» en Cerca de mí. El mapa de actividad
  completo irá a las analíticas públicas (ver «Hoja de ruta»).
- **Instalable (PWA)**: manifest e iconos; el service worker recibe las notificaciones y abre la línea al tocarlas.
- Mapa limitado al área de la red, con botones de tema claro/oscuro, Mi ubicación y funciones sociales (mostrar u ocultar).
  En un poste o en tu parada de una línea, tocar el mapa ofrece «Quiero ir aquí».

## Arrancar (PowerShell)
```
git clone https://github.com/kourtincat/2611_zgzdesplazate.git
cd 2611_zgzdesplazate
npm install            # requiere Node 18+ (probado con Node 22)
npm run dev            # http://localhost:5173
npm run dev:mobile     # HTTPS autofirmado: ábrelo desde el móvil en https://<ip-del-pc>:5173 (la geolocalización exige HTTPS)
```

## Producción / grabador siempre encendido
```
npm run serve          # compila (dist/) y arranca server/index.mjs en http://localhost:8080
npm start              # sólo arranca (si dist/ ya está compilado)
```
`server/index.mjs` es un servidor Node sin dependencias: sirve `dist/` y la API, y arranca el grabador al iniciar
(en `npm run dev` el grabador sólo arranca con la primera llamada a `/api`). Variables: `PORT` (8080), `HOST` (0.0.0.0),
`COLLECT_BUDGET`. Ejecútalo desde la raíz del proyecto (usa `./data`). No arranques dev y producción a la vez:
los dos grabadores escribirían en los mismos ficheros.

**Publicar en internet** (VPS o Docker, HTTPS, dominio y SEO): ver [DEPLOY.md](DEPLOY.md). El servidor de producción ya sirve
cada URL con su título, descripción y resumen para buscadores, además de `/sitemap.xml` y `/robots.txt` (`SITE_URL` fija el dominio).

## Datos
`public/data/network.json` (la red ya procesada) va incluido en el repo, así que la app arranca sin descargar nada más.
La carpeta `data/` (GTFS crudo, snapshots del grabador, modelo de hábitos y avisos de usuarios) se genera en local y no se publica.

| Qué | De dónde |
|---|---|
| Líneas, trazados, paradas, horarios | GTFS oficial de Avanza (vía Mobility Database, `latest.zip`). `npm run build:data` → `public/data/network.json`; `npm run update:data` vuelve a descargar la última versión |
| Tiempo en vivo de tu poste | `zaragoza-pasobus.avanzagrupo.com` → `/api/arrivals` (botón ↻ con 10 s de enfriamiento, auto cada 20 s) |
| "Revisar línea" | Igual que `zaragoza.avanzagrupo.com/lineas-y-horarios`: lista oficial de postes + `tiempos_de_llegada` de cada uno → `/api/scan` (30 s de enfriamiento) |
| Snapshots | El servidor guarda cada 30 s los tiempos conocidos en `data/snapshots/AAAA-MM-DD.ndjson` y los pasos detectados en `…passes.ndjson` |
| Modelo de hábitos | `data/model/habits.json`, recalculado cada día con los pasos de los últimos 28 días |
| Buscador de calles | OpenStreetMap vía Photon, limitado a Zaragoza → `/api/geocode` (caché 1 h) |
| Avisos de usuarios | `data/reports.json` (sólo línea, parada, hora y estado). `npm run seed:reports` crea avisos DEMO |
| Subidas («He subido») | `data/boardings.ndjson`: línea, sentido, parada, hora, minutos que marcaba Avanza (los consulta el servidor), si la ubicación lo respalda |
| Bizi | API abierta del Ayuntamiento (`estacion-bicicleta.json`, WGS84) → `/api/bizi` (caché 60 s, reintentos: la API es irregular) |
| Actividad | `/api/activity` agrega `data/boardings.ndjson` (30 días). `npm run seed:boardings` crea subidas DEMO (`-- --remove` las borra) |
| Notificaciones | Web Push sin dependencias (`server/push.mjs`). Claves VAPID generadas al primer uso en `data/vapid.json` (no se publican; si se borran, los móviles vuelven a suscribirse) |

> El GTFS de bus actual cubre hasta 05/10/2026 y Avanza no ha publicado otro (comprobado el 22/11/2026 en Mobility Database
> y Transitland): se usan los horarios del último miércoles/sábado/domingo con servicio y la vista de línea lo avisa en el pie.
> Algunos postes (p. ej. 237, 238, 262-265, 471) dan HTTP 500 en Avanza: el fallo se cuenta por poste y no marca toda la API como caída.
> Las notificaciones exigen HTTPS (o `localhost`): en el móvil usa `npm run dev:mobile` o pon el servidor detrás de HTTPS.
> En iPhone sólo funcionan con la web añadida a la pantalla de inicio (iOS 16.4+). Las esperas viven en memoria del servidor (75 min máx.).
> El tranvía sólo tiene horario. El grabador sólo funciona mientras el servidor está encendido.
> `COLLECT_BUDGET` (por defecto 8) fija cuántos postes consulta el grabador por cada tick de 30 s.

## Cómo predice
1. **Avanza en tu poste** + tiempos entre paradas del GTFS + un poste 5 paradas antes para calibrar el ritmo.
2. **Revisar línea**: con el ETA de todos los postes se sitúa cada bus (bolas amarillas) entre dos paradas.
3. **Si Avanza cae** (fallos seguidos): aviso en pantalla y previsión por **hábito** (lo observado otros días) y horario.
4. **Usuarios**: un aviso verificado aguas arriba ("subió en X a las 22:10") se proyecta a tu parada:
   "llegaría hacia las 22:18, 1 min antes de lo que marca Avanza". Los viajes en curso se ven como bolas con borde blanco.

## Privacidad
Sin cuentas, cookies, publicidad ni analíticas de terceros; tipografías servidas desde la propia web (no Google Fonts).
- En el móvil: favoritos, recientes, preferencias y un código aleatorio (`pw-client-id`) que el servidor sólo usa en memoria para frenar abusos.
- `data/boardings.ndjson`: línea, sentido, parada, hora (al segundo), minutos de Avanza y, si hay ubicación, la distancia a la parada (no la posición). Sin IP ni identificador.
- `data/reports.json`: viajes verificados (línea, sentido, parada, hora, estado).
- `data/feedback.ndjson`: texto, tipo y día. Se lee con `GET /api/feedback` y `Authorization: Bearer $FEEDBACK_TOKEN`.
- Las suscripciones push viven en memoria mientras dura la espera (75 min máx.).
- «Borrar mis datos de este dispositivo» (en Información) limpia todo lo local y cancela la suscripción de avisos.

## Hoja de ruta
1. **Analíticas públicas (GitHub Pages)**: usuarios por día (contados sin identificar a nadie: código diario con sal que
   rota), líneas y postes consultados, y la gráfica de cada línea: paradas en horizontal, tiempo en vertical, lo que dijo
   Avanza frente a lo que tardó de verdad según las subidas. El servidor publica sólo agregados; una GitHub Action los
   recoge cada día y publica la web estática.
2. **Despliegue y SEO**: servidor Node con disco (VPS pequeño o PaaS con volumen; no hace falta AWS), dominio, HTTPS,
   `robots.txt`, `sitemap.xml` con todas las líneas y postes, títulos y metadatos por página y Open Graph para compartir.

## Antitrampas (server/trips.mjs)
- *Estoy en la parada*: a ≤ 80 m de la parada y precisión GPS ≤ 100 m.
- *He cogido el bus*: check-in de hace < 30 min y seguir cerca de la parada → aviso "pendiente".
- Se **verifica** cuando avanzas ≥ 250 m sobre el trazado de la línea, a ≤ 100 m de él y a velocidad plausible.
  Si terminas el viaje sin verificar, el aviso se descarta.

## Estructura
- `src/app.js` navegación con URLs e historial, Localizador deslizable, cámara (`fly`, `fitTo`) y utilidades · `src/saved.js` favoritos y recientes
- `src/views/` menu (inicio: buscador, favoritos) · find (Ubicar parada) · poste · explore (lista y línea) · route (línea en directo) · plan (Indicar a dónde voy)
- `src/planner.js` planificador con hasta 1 transbordo (frecuencias del horario + tiempos entre paradas)
- `src/main.js` arranque y eventos globales · `src/map.js` mapa · `src/diagram.js` recorrido y línea temporal
- `src/network.js` red, geometría 2D/3D y horario de servicio · `src/prediction.js` predicción
- `src/crowd.js` hábitos y señales de usuarios · `src/trip.js` funciones extra (GPS)
- `src/wait.js` «Estoy esperando» y «He subido» · `public/sw.js` service worker · `scripts/make-icons.mjs` iconos PWA
- `src/bizi.js` Bizi (datos y capa) · `src/views/bizi.js` pantalla Bizi · `src/views/info.js` información
- `server/feedback.mjs` buzón anónimo
- `server/push.mjs` Web Push y vigilante de esperas · `server/boardings.mjs` subidas y mapa de actividad · `server/bizi.mjs` Bizi
- `server/api.mjs` rutas API · `server/avanza.mjs` acceso a Avanza · `server/recorder.mjs` snapshots y hábitos · `server/trips.mjs` validación

## Atribuciones
- Horarios, líneas y paradas: GTFS de Avanza Zaragoza y Tranvías de Zaragoza publicado en el Punto de Acceso Nacional
  (feed 1176) bajo su [licencia](https://nap.transportes.gob.es/licencia-datos). Powered by MITRAMS —
  [Ministerio de Transportes y Movilidad Sostenible](https://www.transportes.gob.es/).
- Tiempos en vivo: webs públicas de Avanza Zaragoza. Proyecto no oficial, sin relación con Avanza ni con el Ayuntamiento.
- Mapa: © OpenStreetMap contributors, OpenMapTiles, OpenFreeMap. Buscador: Photon (komoot). Bizi: datos abiertos del Ayuntamiento de Zaragoza.

## Licencia
Código bajo licencia MIT (ver `LICENSE`). Los datos de transporte pertenecen a sus titulares.
