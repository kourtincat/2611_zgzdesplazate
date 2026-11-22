# Despliegue y SEO

## Qué necesita la web
- Un **servidor Node 22 siempre encendido**. La API pide los tiempos a Avanza (el navegador no puede, por CORS), el grabador guarda lo que marca Avanza cada 30 s y el servidor manda los avisos push.
- **Disco persistente** para `data/`: snapshots, subidas, claves de avisos y sugerencias.
- **HTTPS**, obligatorio para la ubicación, los avisos y la instalación como app.
- **No hace falta AWS.** Basta un servidor pequeño de 1-2 GB de RAM: el proceso usa unos 100 MB.

## Opciones (precios orientativos; compruébalos antes de contratar)
| Opción | Coste aprox. | Pros | Contras |
|---|---|---|---|
| **VPS Hetzner CX22** (2 vCPU, 4 GB, 40 GB, UE) | ~4-5 €/mes | Lo más barato, siempre encendido, disco incluido, control total de los registros (privacidad). Con `deploy/setup-vps.sh` queda listo en unos minutos | Hay que mantener el sistema (el script activa las actualizaciones de seguridad automáticas) |
| VPS OVHcloud / IONOS (UE) | ~4-6 €/mes | Igual que el anterior; hay centros de datos en España/Francia | Panel algo más tosco |
| Fly.io (Docker + volumen) | ~3-6 $/mes | Despliegue con un comando desde el `Dockerfile` | Facturación en $, volumen ligado a una región |
| Render (Docker + disco) | ~7-8 $/mes | Despliegue automático en cada push a GitHub | Más caro; el disco sólo está en planes de pago |
| Railway | ~5 $/mes | Muy sencillo | Uso medido: el coste varía |

**Recomendación:** un VPS Hetzner CX22 y un dominio `.es` (unos 10 €/año en Dondominio, OVH, Arsys…). Por ejemplo `zgzdesplazate.es` (comprueba si está libre).

Avanza podría bloquear peticiones que vengan de centros de datos. Si pasa, se verá en `/api/health` y habría que bajar el ritmo del grabador (`COLLECT_BUDGET`) o cambiar de proveedor.

## Pasos con un VPS (Ubuntu 24.04)
1. Crea el servidor (Ubuntu 24.04) y añade tu clave SSH.
2. En tu proveedor de dominio, crea los registros `A` de `tu-dominio.es` y de `www` apuntando a la IP del servidor (y `AAAA` si hay IPv6).
3. Entra por SSH como root y ejecuta:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/kourtincat/2611_zgzdesplazate/main/deploy/setup-vps.sh | bash -s -- tu-dominio.es
   ```
   El script instala Node 22 y Caddy, que se encarga del HTTPS automático. También crea un usuario sin privilegios, compila la web y la deja como servicio (`systemd`). Por último activa el cortafuegos y genera el token del buzón de sugerencias en `/etc/zgz-desplazate.env`.
4. Para actualizar a la última versión de GitHub:
   ```bash
   bash /opt/zgz-desplazate/deploy/update.sh
   ```
5. Para leer las sugerencias:
   ```bash
   curl -H "Authorization: Bearer $(grep FEEDBACK_TOKEN /etc/zgz-desplazate.env | cut -d= -f2)" https://tu-dominio.es/api/feedback
   ```

## Pasos con Docker (Fly.io, Render, Railway o tu propio servidor)
```bash
docker build -t zgz-desplazate .
docker run -d --restart unless-stopped -p 8080:8080 -v zgz-data:/app/data -e SITE_URL=https://tu-dominio.es zgz-desplazate
```
Monta `/app/data` como volumen persistente y pon HTTPS por delante (en estas plataformas viene incluido).

## Privacidad en producción
- El servidor Node no registra peticiones ni IPs. Caddy, sin directiva `log`, tampoco guarda registros de acceso.
- Revisa que el proveedor no tenga activado un registro de acceso propio, como un balanceador o una CDN.
- `data/` no se publica. Haz copias de seguridad de `data/vapid.json`: si se pierde, los avisos dejan de llegar hasta que cada móvil vuelva a suscribirse.

## SEO (ya incluido en el servidor)
- Cada URL (`/linea/35`, `/poste/236/av-san-juan-bosco-7`, `/lineas`, `/bizi`…) se sirve con su propio `<title>`, descripción, enlace canónico, Open Graph y datos estructurados (schema.org `BusStop`, `WebApplication`).
- Además lleva un resumen en HTML con enlaces, que los buscadores leen sin ejecutar JavaScript.
- `/sitemap.xml` incluye todas las líneas, sus dos sentidos y todos los postes (unas 1.100 URLs). `/robots.txt` deja fuera `/api/`.
- Pon `SITE_URL=https://tu-dominio.es` para que los enlaces canónicos usen tu dominio.

### Después de publicar
1. **Google Search Console** → añadir la propiedad de dominio (verificación con un registro TXT en el DNS) → enviar `https://tu-dominio.es/sitemap.xml`.
2. **Bing Webmaster Tools** → importar desde Search Console (también sirve para DuckDuckGo).
3. Comparte algún enlace (`/linea/35`, un poste) en redes o foros de Zaragoza: la vista previa sale con título y descripción.
4. Enlaces entrantes: asociaciones vecinales, foros de movilidad, el propio repositorio de GitHub, y avisar al Ayuntamiento y a la comunidad de datos abiertos de Aragón.
