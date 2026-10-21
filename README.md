# ProjectWeb · Bus Zaragoza en modo "metro"

Web móvil (MapLibre GL JS + Vite) para el bus y el tranvía de Zaragoza:
bienvenida → permiso de ubicación (opcional) → líneas cercanas a ti o a un pin → ruta con sentido, buses en vivo,
recorrido tipo metro con subida/bajada y funciones extra anónimas ("estoy en la parada", "he cogido el bus").

## Arrancar (PowerShell)
```
cd C:\Users\kourt\Downloads\ProjectWeb\ProjectWeb
npm install
npm run dev            # http://localhost:5173
npm run dev:mobile     # HTTPS autofirmado: ábrelo desde el móvil en https://<ip-del-pc>:5173 (la geolocalización exige HTTPS)
```

## Datos
| Qué | De dónde |
|---|---|
| Líneas, trazados, paradas, horarios | GTFS oficial de Avanza (vía Mobility Database). `npm run build:data` → `public/data/network.json` |
| Tiempo en vivo de tu poste | `zaragoza-pasobus.avanzagrupo.com` → `/api/arrivals` (botón ↻ con 10 s de enfriamiento, auto cada 20 s) |
| "Revisar línea" | Igual que `zaragoza.avanzagrupo.com/lineas-y-horarios`: lista oficial de postes + `tiempos_de_llegada` de cada uno → `/api/scan` (30 s de enfriamiento) |
| Snapshots | El servidor guarda cada 30 s los tiempos conocidos en `data/snapshots/AAAA-MM-DD.ndjson` y los pasos detectados en `…passes.ndjson` |
| Modelo de hábitos | `data/model/habits.json`, recalculado cada día con los pasos de los últimos 28 días |
| Avisos de usuarios | `data/reports.json` (sólo línea, parada, hora y estado). `npm run seed:reports` crea avisos DEMO |

> El GTFS de bus actual cubre hasta 05/10/2026; después se usan los horarios del último miércoles/sábado/domingo con servicio.
> El tranvía sólo tiene horario. El grabador sólo funciona mientras el servidor está encendido.
> `COLLECT_BUDGET` (por defecto 8) fija cuántos postes consulta el grabador por cada tick de 30 s.

## Cómo predice
1. **Avanza en tu poste** + tiempos entre paradas del GTFS + un poste 5 paradas antes para calibrar el ritmo.
2. **Revisar línea**: con el ETA de todos los postes se sitúa cada bus (bolas amarillas) entre dos paradas.
3. **Si Avanza cae** (fallos seguidos): aviso en pantalla y previsión por **hábito** (lo observado otros días) y horario.
4. **Usuarios**: un aviso verificado aguas arriba ("subió en X a las 22:10") se proyecta a tu parada:
   "llegaría hacia las 22:18, 1 min antes de lo que marca Avanza". Los viajes en curso se ven como bolas con borde blanco.

## Antitrampas (server/trips.mjs)
- *Estoy en la parada*: a ≤ 80 m de la parada y precisión GPS ≤ 100 m.
- *He cogido el bus*: check-in de hace < 30 min y seguir cerca de la parada → aviso "pendiente".
- Se **verifica** cuando avanzas ≥ 250 m sobre el trazado de la línea, a ≤ 100 m de él y a velocidad plausible.
  Si terminas el viaje sin verificar, el aviso se descarta.

## Estructura
- `src/main.js` vistas y UI · `src/map.js` mapa · `src/diagram.js` recorrido y línea temporal
- `src/network.js` red, geometría 2D/3D y horario de servicio · `src/prediction.js` predicción
- `src/crowd.js` hábitos y señales de usuarios · `src/trip.js` funciones extra (GPS)
- `server/api.mjs` rutas API · `server/avanza.mjs` acceso a Avanza · `server/recorder.mjs` snapshots y hábitos · `server/trips.mjs` validación
