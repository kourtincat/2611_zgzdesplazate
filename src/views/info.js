// Información: para qué sirve, privacidad, buzón de sugerencias anónimo, código abierto, datos y créditos.
import { app, $, esc, simpleTop, toast } from "../app.js";
import { post } from "../crowd.js";

const REPO = "https://github.com/kourtincat/2611_zgzdesplazate";

export default {
  name: "info",
  snap: "full",
  enter(params) {
    simpleTop("ZGZ Desplázate", "Información");
    const open = (k) => (params.section === k ? "open" : "");
    $("sheet-body").innerHTML = `<div class="info">
      <details ${open("para-que")} data-k="para-que"><summary>Para qué sirve</summary>
        <p>Una web para moverte por Zaragoza en bus, tranvía y Bizi sin rodeos: tu poste, el bus que viene y cuándo llega <b>de verdad</b>.</p>
        <p>Los tiempos que muestran las marquesinas no suelen ser los correctos. Además, no hay una herramienta coherente que reúna
        todas las formas de moverse por la ciudad (bus, tranvía, Bizi y a pie) en una única app.</p>
        <p><b>He subido</b> sirve para construir entre todos un mapa urbano del servicio real. Cuando avisas de que has subido, se guarda de forma anónima
        dónde, a qué hora y qué tiempo anunciaba Avanza en ese momento. Con las subidas de muchos usuarios se ve en qué paradas y a qué horas
        se acierta o se falla. Así se pueden corregir los tiempos de espera y conocer la cadencia real de cada línea, y la previsión mejora para todos.</p>
        <p class="meta">Proyecto no oficial: no tiene relación con Avanza ni con el Ayuntamiento. Se realiza como parte de un ejercicio de investigación
        y mejora de productos relacionados con la movilidad urbana.</p></details>

      <details ${open("privacidad")} data-k="privacidad"><summary>Privacidad</summary>
        <p><b>No hay cuentas, ni cookies, ni publicidad, ni analíticas de terceros.</b> No guardamos tu nombre, tu correo, tu IP ni tu recorrido.</p>
        <ul>
          <li><b>En tu móvil</b> (y sólo ahí): favoritos, recientes, preferencias y un código aleatorio que sirve para frenar abusos (p. ej. pulsar «He subido» cien veces).</li>
          <li><b>He subido</b>: línea, sentido, parada, hora y los minutos que marcaba Avanza. Si compartes ubicación, sólo la distancia a la parada, nunca dónde estás. Si fue un error, un segundo toque lo borra.</li>
          <li><b>Avisos de «Estoy esperando»</b>: la dirección de notificaciones de tu navegador se guarda en memoria mientras esperas (75 min como mucho) y luego se olvida.</li>
          <li><b>Sugerencias</b>: el texto que escribas y el día. Nada más.</li>
        </ul>
        <p>Los datos agregados (cuántas subidas, cuánto acierta Avanza) serán públicos para que cualquiera los pueda consultar.</p>
        <p class="meta">Servicios externos que ve tu navegador: el mapa base (OpenFreeMap). Los tiempos de Avanza, el buscador de calles y Bizi se piden desde nuestro servidor, no desde tu móvil.</p>
        <button class="ghost-btn" data-act="wipe">Borrar mis datos de este dispositivo</button></details>

      <details ${open("sugerencias")} data-k="sugerencias"><summary>Buzón de sugerencias</summary>
        <p>Anónimo: no te pedimos correo ni guardamos quién eres. Si quieres respuesta, abre un <a href="${REPO}/issues" target="_blank" rel="noopener">issue en GitHub</a>.</p>
        <div class="fb-kind" role="radiogroup" aria-label="Tipo">${["idea", "error", "otro"].map((k, i) => `<label><input type="radio" name="fb-kind" value="${k}" ${i ? "" : "checked"}> ${{ idea: "💡 Idea", error: "🐞 Algo falla", otro: "💬 Otro" }[k]}</label>`).join("")}</div>
        <textarea id="fb-text" rows="4" maxlength="1500" placeholder="Cuéntanos qué mejorarías, qué falla o qué echas en falta…"></textarea>
        <button class="cta small wide" data-act="send">Enviar</button></details>

      <details ${open("codigo-abierto")} data-k="codigo-abierto"><summary>Código abierto</summary>
        <p>Todo el código es abierto (licencia MIT): puedes revisarlo, proponer mejoras o montar tu propia versión.</p>
        <p><a class="cta small" href="${REPO}" target="_blank" rel="noopener">Ver el código en GitHub</a></p></details>

      <details ${open("como-funciona")} data-k="como-funciona"><summary>Cómo calcula los tiempos</summary>
        <p>Usa el tiempo en vivo de Avanza en tu poste y en uno anterior para medir el ritmo real del bus, los tiempos entre paradas del horario oficial (GTFS),
        lo que ha pasado otros días a esa hora (el servidor guarda lo que marca Avanza cada 30 s) y las subidas reales de los usuarios.</p></details>

      <details ${open("instalar")} data-k="instalar"><summary>Instalar en el móvil</summary>
        <p><b>Android (Chrome)</b>: menú ⋮ → «Instalar aplicación». <b>iPhone (Safari)</b>: compartir → «Añadir a pantalla de inicio» (necesario para recibir avisos).</p></details>

      <details ${open("datos")} data-k="datos"><summary>Datos y créditos</summary>
        <p>Horarios, líneas y paradas: GTFS de Avanza Zaragoza y Tranvías de Zaragoza en el Punto de Acceso Nacional, bajo su
        <a href="https://nap.transportes.gob.es/licencia-datos" target="_blank" rel="noopener">licencia</a>. Powered by MITRAMS —
        <a href="https://www.transportes.gob.es/" target="_blank" rel="noopener">Ministerio de Transportes y Movilidad Sostenible</a>.</p>
        <p>Tiempos en vivo: webs públicas de Avanza Zaragoza. Bizi: datos abiertos del Ayuntamiento de Zaragoza.</p>
        <p>Mapa: © OpenStreetMap contributors, OpenMapTiles, OpenFreeMap. Buscador: Photon (komoot).</p>
        <p class="operated">Operated by <a href="https://github.com/kourtincat" target="_blank" rel="noopener">kourtin</a></p></details>
    </div>`;
    $("sheet-body").onclick = (e) => this.onClick(e);
    for (const d of document.querySelectorAll(".info details")) d.addEventListener("toggle", () => { if (d.open) { app.params.section = d.dataset.k; history.replaceState(history.state, "", `/info/${d.dataset.k}`); } });
  },
  async onClick(e) {
    const a = e.target.closest("[data-act]")?.dataset.act;
    if (a === "send") {
      const text = $("fb-text").value.trim(), kind = document.querySelector('input[name="fb-kind"]:checked')?.value || "otro";
      if (text.length < 3) return toast("Escribe algo más");
      try { await post("/api/feedback", { text, kind, view: "info" }); $("fb-text").value = ""; toast("¡Gracias! Lo leeremos"); }
      catch (err) { toast(err.message); }
    }
    if (a === "wipe") {
      if (!confirm("¿Borrar favoritos, recientes, preferencias y tu código anónimo de este dispositivo?")) return;
      try {
        const sub = await (await navigator.serviceWorker?.ready)?.pushManager?.getSubscription();
        await sub?.unsubscribe();
      } catch {}
      try { for (const k of Object.keys(localStorage)) if (k.startsWith("pw-")) localStorage.removeItem(k); } catch {}
      toast("Datos de este dispositivo borrados");
      setTimeout(() => location.assign("/"), 800);
    }
  },
};
