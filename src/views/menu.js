// Menú principal del Localizador.
import { app, $, go, topbar, pref, snap, fitTo, toast } from "../app.js";

export default {
  name: "menu",
  snap: "half",
  enter() {
    topbar(`<div class="brand"><span class="brand-mark"></span><span>ZGZ <b>Movilidad</b> <em>Hecha Fácil</em></span></div>`);
    $("sheet-body").innerHTML = `
      <div class="menu">
        <h2 class="welcome-title">Bienvenido, elige por dónde empezar</h2>
        <button class="menu-item" data-go="find"><span class="mi-icon">◉</span><span><b>Ubicar parada</b><small>Por distancia, por número de poste o por ruta. Tiempos de todas las líneas.</small></span></button>
        <button class="menu-item" data-go="plan"><span class="mi-icon">⇢</span><span><b>Indicar a dónde voy</b><small>Elige origen y destino: te decimos qué bus coger, dónde bajar y si hay transbordo.</small></span></button>
        <button class="menu-item" data-go="explore"><span class="mi-icon">≡</span><span><b>Explorar rutas</b><small>Todas las líneas de bus y tranvía con sus dos sentidos.</small></span></button>
        <label class="switch-row"><span><b>Opciones sociales</b><small>«Estoy en la parada», «He cogido el bus» y señales de otros usuarios. Desactívalo para ganar espacio.</small></span>
          <input type="checkbox" id="social-sw" ${app.social ? "checked" : ""}><span class="switch"></span></label>
        <p class="meta center">Consejo: toca el mapa o tu ubicación para empezar un trayecto desde ahí.</p>
      </div>`;
    $("sheet-body").querySelector(".menu").onclick = (e) => {
      const b = e.target.closest("[data-go]");
      if (b) go(b.dataset.go, {});
    };
    $("social-sw").onchange = (e) => { app.social = e.target.checked; pref.set("pw-social", app.social ? "1" : "0"); };
    this.center();
  },
  // Zaragoza entera, vista cenital.
  center() { snap("half"); fitTo(app.net.core, { maxZoom: 13, duration: 1200 }); },
};
