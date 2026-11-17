// =====================================================================
// Guardianes del Cóndor — juego de referencia (HTML + CSS + JavaScript)
// Vuela como un cóndor andino: planea en térmicas, limpia el páramo
// comiendo carroña, evita veneno, cables y tormentas, y llega al nido.
// =====================================================================
(() => {
  "use strict";

  // ---------- Constantes ----------
  const W = 960, H = 540, SUELO = 468;
  const ALTITUD_BASE = 3200, ALTITUD_TECHO = 6000;   // metros que representa la pantalla
  const API = "api/puntajes";                        // la sirve app.py (Flask)

  const lienzo = document.getElementById("lienzo");
  const ctx = lienzo.getContext("2d");
  const capa = document.getElementById("capa");
  const aviso = document.getElementById("aviso");
  const $ = (id) => document.getElementById(id);

  // ---------- Utilidades ----------
  const azar = (semilla) => () => {               // generador con semilla (niveles repetibles)
    semilla |= 0; semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const limitar = (v, a, b) => Math.max(a, Math.min(b, v));
  const escapar = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const leerLocal = (k, def) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };
  const guardarLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

  // ---------- Pantalla nítida ----------
  function ajustarLienzo() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    lienzo.width = W * dpr; lienzo.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  ajustarLienzo();
  window.addEventListener("resize", ajustarLienzo);

  // ---------- Sonido (Web Audio, sin archivos) ----------
  let audio = null, silencio = leerLocal("condor_silencio", false);
  function tono(frec, dur, tipo = "sine", vol = 0.08, desliz = 0) {
    if (silencio) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
      o.type = tipo; o.frequency.setValueAtTime(frec, t);
      if (desliz) o.frequency.exponentialRampToValueAtTime(frec * desliz, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur);
    } catch { /* audio no disponible */ }
  }
  const sonidos = {
    aleteo: () => tono(140, 0.12, "triangle", 0.05, 0.6),
    comer: () => { tono(520, 0.1, "square", 0.04); setTimeout(() => tono(780, 0.12, "square", 0.04), 90); },
    dano: () => tono(300, 0.4, "sawtooth", 0.06, 0.3),
    dato: () => { tono(880, 0.1); setTimeout(() => tono(1320, 0.18), 100); },
    nivel: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tono(f, 0.18, "triangle", 0.07), i * 120)),
    rayo: () => tono(90, 0.5, "sawtooth", 0.08, 0.5),
  };

  // ---------- Entrada ----------
  const teclas = new Set();
  const PARA_JUEGO = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"];
  window.addEventListener("keydown", (e) => {
    if (e.target && e.target.tagName === "INPUT") return;
    if (estado === "jugando" && PARA_JUEGO.includes(e.code)) e.preventDefault();
    teclas.add(e.code);
    if ((e.code === "Escape" || e.code === "KeyP") && (estado === "jugando" || estado === "pausa")) alternarPausa();
    if (e.code === "KeyM") { silencio = !silencio; guardarLocal("condor_silencio", silencio); mostrarAviso("Sonido", silencio ? "Silenciado" : "Activado", 1500); }
  });
  window.addEventListener("keyup", (e) => teclas.delete(e.code));
  window.addEventListener("blur", () => { teclas.clear(); if (estado === "jugando") alternarPausa(); });
  document.querySelectorAll("#tactil button").forEach((b) => {
    const k = b.dataset.tecla;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); teclas.add(k); });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => b.addEventListener(ev, () => teclas.delete(k)));
  });
  const algunaTecla = (lista) => lista.some((k) => teclas.has(k));

  const MANDOS = {
    solo: { arriba: ["ArrowUp", "KeyW", "Space"], abajo: ["ArrowDown", "KeyS"], izq: ["ArrowLeft", "KeyA"], der: ["ArrowRight", "KeyD"], vista: ["KeyV", "KeyE"], planear: ["ShiftLeft", "ShiftRight", "KeyG"], comer: ["KeyC"] },
    j1: { arriba: ["KeyW"], abajo: ["KeyS"], izq: ["KeyA"], der: ["KeyD"], vista: ["KeyE"], planear: ["ShiftLeft"], comer: ["KeyQ"] },
    j2: { arriba: ["ArrowUp"], abajo: ["ArrowDown"], izq: ["ArrowLeft"], der: ["ArrowRight"], vista: ["KeyL"], planear: ["ShiftRight", "Period"], comer: ["KeyK"] },
  };

  // ---------- Estado general ----------
  let estado = "menu";          // menu | intro | jugando | pausa | aprende | quiz | resumen | fin
  let numJugadores = 1, nivel = 0, puntos = 0, dist = 0, tiempo = 0;
  let mundo = null, jugadores = [], particulas = [], destello = 0;
  let desbloqueados = new Set(leerLocal("condor_datos", []));
  let vistosEsta = new Set();   // eventos que ya mostraron explicación en esta partida
  let carronasComidas = 0, carronasTotales = 0, correctas = 0;

  // ---------- Generación de nivel ----------
  function crearNivel(n) {
    const cfg = NIVELES[n], r = azar(1000 + n * 77);
    const largo = cfg.largo, inicio = 700, fin = largo - 300;
    const repartir = (cant, i) => inicio + (i + 0.15 + r() * 0.7) * ((fin - inicio) / cant);

    const termicas = Array.from({ length: cfg.termicas }, (_, i) => ({ x: repartir(cfg.termicas, i), ancho: 90 + r() * 50, fase: r() * 6 }));
    const carronas = [];
    for (let i = 0; i < cfg.carronas; i++) carronas.push({ x: repartir(cfg.carronas, i), veneno: false, comida: false, tipo: Math.floor(r() * 3) });
    for (let i = 0; i < cfg.venenos; i++) carronas.push({ x: repartir(cfg.venenos, i) + 150, veneno: true, comida: false, tipo: Math.floor(r() * 3) });
    carronas.sort((a, b) => a.x - b.x);
    const gallinazos = carronas.filter((c) => !c.veneno && r() < 0.6).map((c) => ({ c, fase: r() * 6 }));
    const cables = Array.from({ length: cfg.cables }, (_, i) => {
      const x1 = repartir(cfg.cables, i), alto = 150 + r() * 120;
      return { x1, x2: x1 + 240 + r() * 80, yA: SUELO - alto, yB: SUELO - alto - 30 + r() * 60, comba: 35 + r() * 20 };
    });
    const tormentas = Array.from({ length: cfg.tormentas }, (_, i) => ({ x: repartir(cfg.tormentas, i), ancho: 220 + r() * 80, reloj: 1 + r() * 2, rayo: 0, rayoX: 0 }));
    const decor = Array.from({ length: 70 }, () => ({ x: r() * (largo + 1200), t: r(), y: r() }));
    carronasTotales += carronas.filter((c) => !c.veneno).length;
    return { cfg, largo, termicas, carronas, gallinazos, cables, tormentas, decor, nidoX: largo + 520, nidoY: 236 };
  }

  function crearJugador(i) {
    const mando = numJugadores === 1 ? MANDOS.solo : (i === 0 ? MANDOS.j1 : MANDOS.j2);
    return { i, mando, x: 180 + i * 60, y: 170 + i * 70, vy: 0, energia: 100, vidas: 3, activo: true,
      invuln: 0, aleteo: 0, cadencia: 0, enSuelo: false, vista: 0, recarga: 0, anim: 0, comiendo: 0, cerca: null, accion: "cae" };
  }

  // ---------- Datos educativos ----------
  function desbloquear(id, mostrar = true) {
    if (desbloqueados.has(id)) return false;
    desbloqueados.add(id);
    guardarLocal("condor_datos", [...desbloqueados]);
    puntos += 50;
    const d = DATOS_CONDOR.find((x) => x.id === id);
    if (d && mostrar) { mostrarAviso("¿Sabías que…? " + d.titulo, d.texto, 7000); sonidos.dato(); }
    return true;
  }
  function siguienteDatoCarrona() {
    const id = ORDEN_CARRONA.find((x) => !desbloqueados.has(x));
    if (id) desbloquear(id);
  }

  let temporizadorAviso = 0;
  function mostrarAviso(titulo, texto, ms = 5000) {
    aviso.innerHTML = `<b>${escapar(titulo)}</b>${escapar(texto)}`;
    aviso.classList.remove("oculto");
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => aviso.classList.add("oculto"), ms);
  }

  // Mensaje educativo que NO pausa el juego: aparece cuando el jugador hace la acción.
  function consejo(clave, titulo, texto, idDato) {
    if (vistosEsta.has(clave)) return;
    vistosEsta.add(clave);
    if (idDato) desbloquear(idDato, false);
    mostrarAviso(titulo, texto, 6500);
  }
  function aprender(clave, titulo, texto, idDato) {
    const plano = texto.replace(/<[^>]+>/g, "");
    const repetido = vistosEsta.has(clave);
    vistosEsta.add(clave);
    if (idDato) desbloquear(idDato, false);
    mostrarAviso(titulo, repetido ? "Pierdes una vida. " + plano.split(". ")[0] + "." : plano, repetido ? 4000 : 9000);
  }

  // ---------- Bucle principal ----------
  let ultimo = performance.now();
  function bucle(ahora) {
    const dt = Math.min((ahora - ultimo) / 1000, 0.033);
    ultimo = ahora;
    if (estado === "jugando") actualizar(dt);
    dibujar(dt);
    if (estado === "jugando" || estado === "menu") actualizarHud();
    requestAnimationFrame(bucle);
  }

  function actualizar(dt) {
    tiempo += dt;
    const m = mundo, cfg = m.cfg;
    const avance = dist < m.largo ? cfg.velocidad * dt : 0;
    dist = Math.min(dist + avance, m.largo);

    for (const t of m.tormentas) {
      t.reloj -= dt;
      if (t.rayo > 0) t.rayo -= dt;
      if (t.reloj <= 0) {
        t.reloj = 2.2 + Math.random() * 1.8;
        t.rayo = 0.35;
        t.rayoX = t.x + 30 + Math.random() * (t.ancho - 60);
        const sx = t.rayoX - dist;
        if (sx > -50 && sx < W + 50) { destello = 0.25; sonidos.rayo(); }
      }
    }

    for (const j of jugadores) if (j.activo) actualizarJugador(j, dt);

    // Al terminar el recorrido, el nido queda a la vista en el risco.
    if (dist >= m.largo) {
      const nx = m.nidoX - dist;
      for (const j of jugadores) {
        if (j.activo && Math.abs(j.x - nx) < 46 && Math.abs(j.y - (m.nidoY - 14)) < 40) { completarNivel(); return; }
      }
    }

    particulas = particulas.filter((p) => (p.vida -= dt) > 0);
    for (const p of particulas) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; }
    if (destello > 0) destello -= dt;

    if (jugadores.every((j) => !j.activo)) finDelJuego(false);
  }

  function actualizarJugador(j, dt) {
    const m = mundo, k = j.mando;
    j.anim += dt;
    if (j.invuln > 0) j.invuln -= dt;
    if (j.vista > 0) j.vista -= dt;
    if (j.recarga > 0) j.recarga -= dt;
    j.cadencia -= dt;
    if (j.aleteo > 0) j.aleteo -= dt;

    // Movimiento horizontal dentro de la pantalla
    const vel = 190;
    if (!j.enSuelo) {
      if (algunaTecla(k.izq)) j.x -= vel * dt;
      if (algunaTecla(k.der)) j.x += vel * dt;
    } else if (dist < m.largo) {            // en el suelo el cóndor no avanza: el mundo lo deja atrás
      j.x -= m.cfg.velocidad * dt;
    }
    j.x = limitar(j.x, 30, W - 60);
    if (j.x <= 34) {                        // borde izquierdo: muerte
      j.vidas = 0; j.activo = false; plumas(j.x, j.y); sonidos.dano();
      mostrarAviso("Fuera de vuelo", "Te quedaste en el suelo y el mundo te dejó atrás: tocaste el borde izquierdo.", 4000);
      if (jugadores.every((p) => !p.activo)) finDelJuego(false);
      return;
    }

    // Aletear: sube, pero cuesta energía (despegar desde el suelo cuesta más)
    if (algunaTecla(k.arriba) && j.cadencia <= 0 && j.energia > 0) {
      const costo = j.enSuelo ? 14 : 7;
      j.vy = j.enSuelo ? -230 : -175;
      j.energia -= costo; j.cadencia = 0.32; j.aleteo = 0.3;
      sonidos.aleteo();
      consejo("aleteo", "Aletear", "Aletear te impulsa hacia arriba pero gasta energía. El cóndor real aletea solo cerca del 1 % de su tiempo de vuelo.");
      if (j.enSuelo) {
        j.enSuelo = false;
        if (!desbloqueados.has("despegue")) desbloquear("despegue");
      }
    }

    // Vista de cóndor: revela veneno y gallinazos por 3 s
    if (algunaTecla(k.vista) && j.recarga <= 0) {
      j.vista = 3; j.recarga = 9;
      if (!desbloqueados.has("vista")) desbloquear("vista");
    }

    // Planeo: cae despacio; picada si presiona abajo
    const picada = algunaTecla(k.abajo);
    const planea = !picada && !j.enSuelo && algunaTecla(k.planear);
    if (planea) consejo("planeo", "Planeando", "Con las alas abiertas caes más despacio y gastas muy poca energía. Así recorre el cóndor cientos de kilómetros.");
    const caidaObjetivo = picada ? 320 : planea ? 38 : 125;
    j.vy += (caidaObjetivo - j.vy) * Math.min(1, (picada ? 3.5 : 1.6) * dt);

    // Térmicas: empujan hacia arriba sin gastar energía
    let enTermica = false;
    for (const t of m.termicas) {
      const sx = t.x - dist;
      if (j.x > sx - t.ancho / 2 && j.x < sx + t.ancho / 2 && j.y < SUELO - 10) {
        enTermica = true;
        j.vy -= 420 * dt;
        j.vy = Math.max(j.vy, -150);
      }
    }
    if (enTermica) consejo("termica", "¡Estás en una térmica!", "El aire caliente sube y te eleva sin gastar energía. Los cóndores se apoyan en estas corrientes para volar sin aletear.", "vuelo");

    // Tormentas: corriente descendente y más gasto de energía
    let enTormenta = false;
    for (const t of m.tormentas) {
      const sx = t.x - dist;
      if (j.x > sx && j.x < sx + t.ancho) {
        enTormenta = true;
        j.vy += 160 * dt;
        if (t.rayo > 0 && Math.abs(j.x - (t.rayoX - dist)) < 22 && j.invuln <= 0) {
          herir(j, "rayo", "¡Te alcanzó un rayo!", "Las tormentas de montaña son peligrosas. Los cóndores buscan refugio en los riscos cuando el clima empeora.");
          return;
        }
      }
    }

    // Energía: el metabolismo siempre gasta un poco
    j.accion = j.aleteo > 0 ? "aletea" : enTermica ? "termica" : planea ? "planea" : picada ? "picada" : j.enSuelo ? "suelo" : "cae";
    j.energia -= (enTormenta ? 2.4 : planea ? 0.35 : 1.0) * dt;

    j.y += j.vy * dt;
    if (j.y < 36) { j.y = 36; j.vy = Math.max(j.vy, 0); }

    // Suelo: el cóndor aterriza y tendrá que despegar aleteando
    if (j.y >= SUELO - 22) {
      j.y = SUELO - 22; j.vy = 0;
      if (!j.enSuelo) {
        j.enSuelo = true; polvo(j.x, SUELO, 6);
        consejo("suelo", "Sobre el suelo", "En tierra no avanzas: el paisaje sigue pasando y te arrastra hacia el borde izquierdo. Despegar cuesta mucha energía, por eso el cóndor prefiere lanzarse desde riscos.");
      }
    }

    // Carroña: hay que descender y mantener la tecla de comer
    j.cerca = null;
    for (const c of m.carronas) {
      if (c.comida) continue;
      const sx = c.x - dist;
      if (Math.abs(j.x - sx) < 38 && j.y > SUELO - 62) {
        c.comida = true;
        if (c.veneno) {
          if (j.invuln <= 0) {
            herir(j, "veneno", "Carroña envenenada",
              "Comiste un cebo con veneno. En la vida real, el cóndor <strong>no puede detectar el veneno</strong>: el envenenamiento causó el 63 % de los casos de cóndores heridos o muertos registrados en el norte de Sudamérica. La solución está en las personas: no usar cebos envenenados.", "veneno");
          }
          return;
        }
        j.energia = Math.min(100, j.energia + 32);
        puntos += 100; carronasComidas++;
        polvo(sx, SUELO - 10, 10, "#c9a46a");
        sonidos.comer();
        if (!desbloqueados.has("carronero")) desbloquear("carronero");
        else siguienteDatoCarrona();
      }
    }

    // Cables eléctricos y torres
    for (const c of m.cables) {
      const s1 = c.x1 - dist, s2 = c.x2 - dist;
      if (s2 < -20 || s1 > W + 20) continue;
      if (c.x1 - dist < W - 80 && !vistosEsta.has("cables-aviso")) {
        vistosEsta.add("cables-aviso");
        mostrarAviso("¡Cuidado!", "Se acercan tendidos eléctricos. Pasa por encima o por debajo de los cables.", 4000);
      }
      let choque = false;
      if (j.x > s1 && j.x < s2) {
        const t = (j.x - s1) / (s2 - s1);
        const yc = c.yA + (c.yB - c.yA) * t + c.comba * 4 * t * (1 - t);
        if (Math.abs(j.y - yc) < 14) choque = true;
      }
      for (const [sx, top] of [[s1, c.yA], [s2, c.yB]]) if (Math.abs(j.x - sx) < 14 && j.y > top) choque = true;
      if (choque && j.invuln <= 0) {
        herir(j, "cables", "Choque con un tendido eléctrico",
          "Los choques y la electrocución en cables también matan cóndores. Por eso se instalan <strong>desviadores de vuelo</strong> (espirales de colores) que hacen visibles los cables.", "cables");
        return;
      }
    }

    if (j.energia <= 0) {
      herir(j, "energia", "Sin energía",
        "Aletear sin parar agota al cóndor. Planea en las térmicas y come carroña para recuperar energía.");
    }
  }

  function herir(j, clave, titulo, texto, idDato) {
    j.vidas--; j.invuln = 2.5; sonidos.dano();
    plumas(j.x, j.y);
    j.energia = Math.max(j.energia, 60);
    j.x = 160 + j.i * 60; j.y = 150 + j.i * 60; j.vy = 0; j.enSuelo = false;
    if (j.vidas <= 0) j.activo = false;
    if (jugadores.every((p) => !p.activo)) { finDelJuego(false); return; }
    aprender(clave, titulo, texto, idDato);
  }

  // ---------- Partículas ----------
  function polvo(x, y, n, color = "#b9a77c") {
    for (let i = 0; i < n; i++) particulas.push({ x, y, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 90, vida: 0.6, color, r: 2 + Math.random() * 2 });
  }
  function plumas(x, y) {
    for (let i = 0; i < 12; i++) particulas.push({ x, y, vx: (Math.random() - 0.5) * 200, vy: -Math.random() * 160, vida: 1.1, color: i % 3 ? "#1b1b1b" : "#e9e5dc", r: 3 });
  }

  // ---------- Dibujo ----------
  function dibujar(dt) {
    const cfg = mundo ? mundo.cfg : NIVELES[0];
    const offset = mundo ? dist : performance.now() / 1000 * 40;

    // Cielo
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, cfg.cielo[2]); g.addColorStop(0.6, cfg.cielo[1]); g.addColorStop(1, cfg.cielo[0]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // Sol
    ctx.fillStyle = "rgba(255, 230, 170, 0.55)";
    ctx.beginPath(); ctx.arc(760, 120, 46, 0, Math.PI * 2); ctx.fill();

    // Volcán Cotopaxi (capa lejana)
    const vx = 600 - (offset * 0.06) % 1600;
    for (const base of [vx, vx + 1600]) dibujarCotopaxi(base);

    // Cordillera media
    ctx.fillStyle = "#5d6f5a";
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 20) {
      const wx = x + offset * 0.25;
      ctx.lineTo(x, 360 + Math.sin(wx * 0.006) * 40 + Math.sin(wx * 0.017) * 14);
    }
    ctx.lineTo(W, H); ctx.fill();

    // Páramo (colinas cercanas)
    ctx.fillStyle = "#9b8d4e";
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) {
      const wx = x + offset * 0.55;
      ctx.lineTo(x, 420 + Math.sin(wx * 0.01) * 16 + Math.sin(wx * 0.023) * 6);
    }
    ctx.lineTo(W, H); ctx.fill();

    // Suelo
    ctx.fillStyle = "#7c6c34"; ctx.fillRect(0, SUELO, W, H - SUELO);
    ctx.fillStyle = "#8f8040"; ctx.fillRect(0, SUELO, W, 6);

    if (!mundo) { dibujarCondor(380 + Math.sin(performance.now() / 900) * 30, 210 + Math.sin(performance.now() / 600) * 14, 0, false, 1.3); return; }

    const m = mundo;
    // Pajonal y chuquiraguas
    for (const d of m.decor) {
      const sx = d.x - dist;
      if (sx < -20 || sx > W + 20) continue;
      ctx.strokeStyle = "#c2ae5c"; ctx.lineWidth = 2;
      for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(sx, SUELO + 2); ctx.lineTo(sx + k * 4, SUELO - 12 - d.t * 10); ctx.stroke(); }
      if (d.y < 0.25) { ctx.fillStyle = "#e07b2c"; ctx.beginPath(); ctx.arc(sx + 6, SUELO - 6, 4, 0, Math.PI * 2); ctx.fill(); }
    }

    const vistaActiva = jugadores.some((j) => j.activo && j.vista > 0);

    // Térmicas
    for (const t of m.termicas) {
      const sx = t.x - dist;
      if (sx < -100 || sx > W + 100) continue;
      const gr = ctx.createLinearGradient(0, SUELO, 0, 40);
      gr.addColorStop(0, "rgba(255, 170, 90, 0.28)"); gr.addColorStop(1, "rgba(255, 170, 90, 0)");
      ctx.fillStyle = gr; ctx.fillRect(sx - t.ancho / 2, 40, t.ancho, SUELO - 40);
      ctx.fillStyle = "rgba(255, 236, 200, 0.7)";
      for (let k = 0; k < 9; k++) {
        const yy = SUELO - ((tiempo * 70 + k * 50 + t.fase * 40) % (SUELO - 50));
        const xx = sx + Math.sin(yy * 0.05 + k) * t.ancho * 0.35;
        ctx.beginPath(); ctx.arc(xx, yy, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Tormentas
    for (const t of m.tormentas) {
      const sx = t.x - dist;
      if (sx < -t.ancho - 40 || sx > W + 40) continue;
      ctx.fillStyle = "rgba(40, 46, 56, 0.9)";
      for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(sx + 20 + k * t.ancho / 6, 70 + (k % 2) * 16, 46, 0, Math.PI * 2); ctx.fill(); }
      ctx.strokeStyle = "rgba(170, 190, 210, 0.35)"; ctx.lineWidth = 1.5;
      for (let k = 0; k < 18; k++) {
        const rx = sx + (k / 18) * t.ancho, ry = 110 + ((tiempo * 400 + k * 37) % (SUELO - 110));
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 6, ry + 16); ctx.stroke();
      }
      if (t.rayo > 0) {
        const rx = t.rayoX - dist;
        ctx.strokeStyle = "#fff6c2"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(rx, 100);
        for (let y = 100, xx = rx; y < SUELO; y += 40) { xx += (Math.random() - 0.5) * 30; ctx.lineTo(xx, y); }
        ctx.stroke();
      }
    }

    // Cables
    for (const c of m.cables) {
      const s1 = c.x1 - dist, s2 = c.x2 - dist;
      if (s2 < -30 || s1 > W + 30) continue;
      for (const [sx, top] of [[s1, c.yA], [s2, c.yB]]) dibujarTorre(sx, top);
      ctx.strokeStyle = "#20262b"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(s1, c.yA);
      const pasos = 20;
      for (let i = 1; i <= pasos; i++) { const t = i / pasos; ctx.lineTo(s1 + (s2 - s1) * t, c.yA + (c.yB - c.yA) * t + c.comba * 4 * t * (1 - t)); }
      ctx.stroke();
      // Desviadores de vuelo (espirales de colores)
      for (let i = 1; i < 4; i++) {
        const t = i / 4, xx = s1 + (s2 - s1) * t, yy = c.yA + (c.yB - c.yA) * t + c.comba * 4 * t * (1 - t);
        ctx.fillStyle = i % 2 ? "#f28c28" : "#f2e8d0"; ctx.fillRect(xx - 4, yy - 3, 8, 8);
      }
    }

    // Carroñas
    for (const c of m.carronas) {
      const sx = c.x - dist;
      if (sx < -60 || sx > W + 60 || c.comida) continue;
      dibujarCarrona(sx, c, vistaActiva);
    }

    // Gallinazos sobre la comida segura
    for (const gz of m.gallinazos) {
      if (gz.c.comida) continue;
      const sx = gz.c.x - dist;
      if (sx < -80 || sx > W + 80) continue;
      for (let k = 0; k < 2; k++) {
        const a = tiempo * 1.6 + gz.fase + k * Math.PI;
        dibujarGallinazo(sx + Math.cos(a) * 46, 250 + Math.sin(a) * 16, vistaActiva);
      }
    }

    // Risco con el nido
    const nx = m.nidoX - dist;
    if (nx < W + 200) dibujarRisco(nx, m.nidoY, nivel);

    // Cóndores
    for (const j of jugadores) {
      if (!j.activo) continue;
      if (j.invuln > 0 && Math.floor(j.invuln * 10) % 2 === 0) continue;
      dibujarCondor(j.x, j.y, j.anim, j.aleteo > 0, 1, j.enSuelo, j.i);
      if (numJugadores === 2) {
        ctx.fillStyle = j.i === 0 ? "#e2b44f" : "#8fd0e8"; ctx.font = "bold 12px Atkinson Hyperlegible, sans-serif";
        ctx.textAlign = "center"; ctx.fillText(`J${j.i + 1}`, j.x, j.y - 34);
      }
    }

    for (const p of particulas) { ctx.globalAlpha = Math.max(0, p.vida); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.r, p.r); }
    ctx.globalAlpha = 1;

    { const g2 = ctx.createLinearGradient(0, 0, 40, 0); g2.addColorStop(0, "rgba(200,40,40,0.55)"); g2.addColorStop(1, "rgba(200,40,40,0)"); ctx.fillStyle = g2; ctx.fillRect(0, 0, 40, H); }
    if (vistaActiva) { ctx.fillStyle = "rgba(255, 220, 140, 0.08)"; ctx.fillRect(0, 0, W, H); }
    if (destello > 0) { ctx.fillStyle = `rgba(255,255,240,${destello})`; ctx.fillRect(0, 0, W, H); }

    if (dist >= m.largo && estado === "jugando") {
      ctx.fillStyle = "rgba(16, 26, 34, 0.75)"; ctx.fillRect(W / 2 - 170, 18, 340, 34);
      ctx.fillStyle = "#e2b44f"; ctx.font = "bold 16px Atkinson Hyperlegible, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Vuela hasta el nido en el risco →", W / 2, 41);
    }
  }

  function dibujarCotopaxi(x) {
    ctx.fillStyle = "#6c7b8a";
    ctx.beginPath(); ctx.moveTo(x - 330, 400); ctx.lineTo(x - 40, 150); ctx.lineTo(x + 40, 150); ctx.lineTo(x + 330, 400); ctx.fill();
    ctx.fillStyle = "#eef2f3";
    ctx.beginPath(); ctx.moveTo(x - 40, 150); ctx.lineTo(x + 40, 150); ctx.lineTo(x + 110, 210);
    ctx.lineTo(x + 70, 200); ctx.lineTo(x + 40, 222); ctx.lineTo(x + 5, 204); ctx.lineTo(x - 30, 226);
    ctx.lineTo(x - 70, 202); ctx.lineTo(x - 110, 210); ctx.fill();
  }

  function dibujarTorre(x, top) {
    ctx.strokeStyle = "#3b434a"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 12, SUELO); ctx.lineTo(x, top); ctx.lineTo(x + 12, SUELO); ctx.stroke();
    for (let y = top + 20; y < SUELO; y += 26) {
      const a = 12 * (y - top) / (SUELO - top);
      ctx.beginPath(); ctx.moveTo(x - a, y); ctx.lineTo(x + a, y + 13); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(x - 14, top + 4); ctx.lineTo(x + 14, top + 4); ctx.stroke();
  }

  function dibujarCarrona(x, c, vista) {
    const y = SUELO - 4;
    if (c.veneno && vista) {
      ctx.fillStyle = "rgba(120, 230, 90, 0.35)"; ctx.beginPath(); ctx.arc(x, y - 10, 34, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = c.veneno ? ["#5b2d86", "#6a3a9a", "#4a2470"][c.tipo] : ["#b5483a", "#c25a44", "#a03c30"][c.tipo];
    ctx.beginPath(); ctx.ellipse(x, y - 8, 26, 10, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 24, y - 12, 8, 6, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = c.veneno ? "#9be35a" : "#efe6d2"; ctx.lineWidth = 2;
    for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(x + k * 7, y - 16); ctx.lineTo(x + k * 7, y - 2); ctx.stroke(); }
    if (c.veneno && vista) {
      ctx.fillStyle = "#ffe14d"; ctx.beginPath(); ctx.moveTo(x, y - 62); ctx.lineTo(x + 14, y - 38); ctx.lineTo(x - 14, y - 38); ctx.fill();
      ctx.fillStyle = "#1d1606"; ctx.font = "bold 16px sans-serif"; ctx.textAlign = "center"; ctx.fillText("!", x, y - 42);
    }
  }

  function dibujarGallinazo(x, y, resaltar) {
    ctx.strokeStyle = resaltar ? "#ffe9a8" : "#20252a"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - 12, y - 4); ctx.quadraticCurveTo(x - 5, y - 8, x, y); ctx.quadraticCurveTo(x + 5, y - 8, x + 12, y - 4); ctx.stroke();
  }

  function dibujarRisco(x, nidoY, n) {
    ctx.fillStyle = "#5b524a";
    ctx.beginPath(); ctx.moveTo(x - 80, SUELO); ctx.lineTo(x - 70, nidoY + 10); ctx.lineTo(x - 20, nidoY);
    ctx.lineTo(x + 30, nidoY + 2); ctx.lineTo(x + 40, nidoY - 120); ctx.lineTo(x + 200, nidoY - 160); ctx.lineTo(x + 260, SUELO); ctx.fill();
    ctx.fillStyle = "#6e645a"; ctx.fillRect(x - 70, nidoY, 110, 8);
    ctx.strokeStyle = "#a5895a"; ctx.lineWidth = 3;
    for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.moveTo(x - 30 + k * 6, nidoY - 2); ctx.lineTo(x - 20 + k * 6, nidoY - 12); ctx.stroke(); }
    if (n === 2) { ctx.fillStyle = "#f3eee2"; ctx.beginPath(); ctx.ellipse(x - 8, nidoY - 12, 8, 10, 0, 0, Math.PI * 2); ctx.fill(); }
    else if (n === 1) { ctx.fillStyle = "#8f8a84"; ctx.beginPath(); ctx.arc(x - 8, nidoY - 14, 10, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = "#e2b44f"; ctx.font = "bold 13px Atkinson Hyperlegible, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("NIDO", x - 8, nidoY - 34);
  }

  // Cóndor de perfil mirando a la derecha: alas negras con manchas blancas,
  // collar blanco, cabeza desnuda y cresta roja (macho).
  function dibujarCondor(x, y, anim, aleteando, escala = 1, enSuelo = false, idx = 0) {
    ctx.save(); ctx.translate(x, y); ctx.scale(escala, escala);
    const ang = enSuelo ? -0.9 : aleteando ? Math.sin(anim * 22) * 0.75 : -0.12 + Math.sin(anim * 2) * 0.05;
    const ala = (rot, tono) => {
      ctx.save(); ctx.translate(4, -4); ctx.rotate(rot);
      ctx.fillStyle = tono;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-30, -16, -62, -18);
      ctx.lineTo(-76, -15); ctx.lineTo(-66, -11); ctx.lineTo(-78, -7); ctx.lineTo(-66, -4);
      ctx.lineTo(-76, 1); ctx.lineTo(-62, 2); ctx.quadraticCurveTo(-30, 10, -4, 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#e9e5dc";
      ctx.beginPath(); ctx.moveTo(-8, 3); ctx.quadraticCurveTo(-30, 7, -54, 2); ctx.lineTo(-52, -3); ctx.quadraticCurveTo(-30, 0, -10, -2); ctx.closePath(); ctx.fill();
      ctx.restore();
    };
    ala(ang - 0.35, "#141414");                         // ala lejana
    ctx.fillStyle = "#161616";                            // cola y cuerpo
    ctx.beginPath(); ctx.moveTo(-24, -2); ctx.lineTo(-44, -6); ctx.lineTo(-44, 6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, 0, 27, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f1eee6";                            // collar blanco
    ctx.beginPath(); ctx.ellipse(22, -3, 8, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8a4a3c";                            // cabeza desnuda
    ctx.beginPath(); ctx.arc(31, -6, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = idx === 1 ? "#9e2a2a" : "#b23a2e";    // cresta (carúncula)
    ctx.beginPath(); ctx.ellipse(31, -13, 6, 3, -0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e6dcc0";                            // pico ganchudo
    ctx.beginPath(); ctx.moveTo(36, -8); ctx.lineTo(45, -5); ctx.lineTo(41, -1); ctx.lineTo(36, -3); ctx.fill();
    ctx.fillStyle = "#2a1a10"; ctx.beginPath(); ctx.arc(33, -7, 1.6, 0, Math.PI * 2); ctx.fill();
    if (enSuelo) { ctx.strokeStyle = "#5a4a3a"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-4, 10); ctx.lineTo(-6, 22); ctx.moveTo(6, 10); ctx.lineTo(8, 22); ctx.stroke(); }
    ala(ang, "#1e1e1e");                                  // ala cercana
    ctx.restore();
  }

  // ---------- HUD ----------
  const ACCIONES = { aletea: "Aleteando · gasta energía", planea: "Planeando · ahorras energía", termica: "En térmica · subes gratis",
    picada: "Picada · bajas rápido", suelo: "En el suelo · el mundo te deja atrás; aletea", cae: "Cayendo · abre las alas (Shift)" };
  let ultimoHud = 0;
  function actualizarHud() {
    const ahora = performance.now();
    if (ahora - ultimoHud < 90) return;
    ultimoHud = ahora;
    $("hud-datos").textContent = desbloqueados.size;
    $("hud-datos-total").textContent = DATOS_CONDOR.length;
    $("hud-puntos").textContent = puntos;
    if (!mundo) return;
    $("hud-nivel").textContent = mundo.cfg.nombre;
    $("hud-progreso").style.width = `${Math.round((dist / mundo.largo) * 100)}%`;
    $("hud-limpio").textContent = carronasTotales ? Math.round((carronasComidas / carronasTotales) * 100) : 0;
    const vivos = jugadores.filter((j) => j.activo);
    const alto = vivos.length ? Math.min(...vivos.map((j) => j.y)) : SUELO;
    $("hud-altitud").textContent = Math.round(ALTITUD_BASE + ((SUELO - alto) / SUELO) * (ALTITUD_TECHO - ALTITUD_BASE)).toLocaleString("es-EC");
    jugadores.forEach((j) => {
      const p = `hud-j${j.i + 1}`;
      $(`${p}-vidas`).textContent = j.activo ? "♥".repeat(j.vidas) + "♡".repeat(Math.max(0, 3 - j.vidas)) : "fuera";
      const barra = $(`${p}-barra`);
      barra.firstElementChild.style.width = `${limitar(j.energia, 0, 100)}%`;
      barra.classList.toggle("baja", j.energia < 30);
      $(`${p}-accion`).textContent = ACCIONES[j.accion] || "";
      $(`${p}-vista`).textContent = j.vista > 0 ? "Vista de cóndor: activa" : j.recarga > 0 ? `Vista de cóndor: ${Math.ceil(j.recarga)} s` : "Vista de cóndor: lista";
    });
  }

  // ---------- Pantallas ----------
  function mostrarCapa(html) { capa.innerHTML = html; capa.hidden = false; }
  function ocultarCapa() { capa.hidden = true; capa.innerHTML = ""; }

  const textoControles = () => `
    <div class="controles">
      <div><b>1 jugador</b><kbd>↑</kbd> o <kbd>Espacio</kbd> aletear · <kbd>←</kbd><kbd>→</kbd> avanzar/frenar · <kbd>↓</kbd> picada · <kbd>Shift</kbd> planear · <kbd>V</kbd> vista de cóndor</div>
      <div><b>2 jugadores</b>J1: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> + <kbd>Shift</kbd> planear, <kbd>E</kbd> vista · J2: flechas + <kbd>Ctrl der.</kbd>/<kbd>.</kbd> planear, <kbd>L</kbd> vista</div>
      <div><b>Objetivo</b>Planea en las térmicas, toca la carroña roja para recuperar energía, no toques el borde izquierdo, evita veneno, cables y rayos, y llega al nido.</div>
    </div>`;

  async function menu() {
    estado = "menu"; mundo = null;
    $("hud-nivel").textContent = "Guardianes del Cóndor";
    $("hud-j2").hidden = true;
    mostrarCapa(`
      <div class="tarjeta ancha">
        <span class="etiqueta">Páramo del Cotopaxi · Vultur gryphus</span>
        <h1>Guardianes del Cóndor</h1>
        <p>Vuela como un cóndor andino, el ave nacional del Ecuador. Aprende cómo vive, de qué se alimenta y qué lo pone en peligro.</p>
        ${textoControles()}
        <div class="botones">
          <button class="principal" id="b-uno">Jugar · 1 jugador</button>
          <button id="b-dos">2 jugadores</button>
          <button id="b-ficha">Enciclopedia del cóndor</button>
          <button id="b-puntajes">Mejores guardianes</button>
        </div>
      </div>`);
    $("b-uno").onclick = () => nuevaPartida(1);
    $("b-dos").onclick = () => nuevaPartida(2);
    $("b-ficha").onclick = () => enciclopedia(menu);
    $("b-puntajes").onclick = () => verPuntajes();
    $("b-uno").focus();
  }

  function nuevaPartida(n) {
    numJugadores = n; nivel = 0; puntos = 0; correctas = 0;
    carronasComidas = 0; carronasTotales = 0; vistosEsta = new Set();
    $("hud-j2").hidden = n === 1;
    $("hud-j1-nombre").textContent = n === 1 ? "Cóndor" : "Cóndor 1";
    jugadores = Array.from({ length: n }, (_, i) => crearJugador(i));
    introNivel();
  }

  function introNivel() {
    mundo = crearNivel(nivel); dist = 0; particulas = [];
    jugadores.forEach((j) => { if (j.activo) { j.x = 180 + j.i * 60; j.y = 170 + j.i * 70; j.vy = 0; j.energia = Math.max(j.energia, 80); j.enSuelo = false; j.invuln = 1; } });
    estado = "intro";
    const cfg = mundo.cfg;
    mostrarCapa(`
      <div class="tarjeta">
        <span class="etiqueta">Nivel ${nivel + 1} de ${NIVELES.length}</span>
        <h2>${escapar(cfg.nombre)}</h2>
        <p>${cfg.intro}</p>
        <p><strong>Meta:</strong> comer al menos ${cfg.meta} carroñas antes de llegar al nido.</p>
        <p class="fuente">Nuevo en este nivel: ${cfg.nuevo.map(escapar).join(" · ")}</p>
        <div class="botones"><button class="principal" id="b-volar">¡A volar!</button></div>
      </div>`);
    $("b-volar").onclick = () => { ocultarCapa(); estado = "jugando"; ultimo = performance.now(); };
    $("b-volar").focus();
  }

  function alternarPausa() {
    if (estado === "jugando") {
      estado = "pausa";
      mostrarCapa(`
        <div class="tarjeta">
          <span class="etiqueta">Pausa</span>
          <h2>Descansa en el risco</h2>
          ${textoControles()}
          <div class="botones">
            <button class="principal" id="b-reanudar">Continuar</button>
            <button id="b-ficha2">Enciclopedia</button>
            <button id="b-salir">Salir al menú</button>
          </div>
        </div>`);
      $("b-reanudar").onclick = alternarPausa;
      $("b-ficha2").onclick = () => enciclopedia(() => { estado = "jugando"; alternarPausa(); });
      $("b-salir").onclick = menu;
      $("b-reanudar").focus();
    } else if (estado === "pausa") {
      ocultarCapa(); estado = "jugando"; ultimo = performance.now();
    }
  }

  function completarNivel() {
    estado = "resumen"; sonidos.nivel();
    const cfg = mundo.cfg;
    const comidasNivel = mundo.carronas.filter((c) => c.comida && !c.veneno).length;
    const cumplio = comidasNivel >= cfg.meta;
    const energiaMedia = Math.round(jugadores.filter((j) => j.activo).reduce((s, j) => s + j.energia, 0) / Math.max(1, jugadores.filter((j) => j.activo).length));
    const bono = (cumplio ? 300 : 0) + energiaMedia * 2;
    puntos += bono;
    const estrellas = 1 + (cumplio ? 1 : 0) + (energiaMedia >= 50 ? 1 : 0);
    desbloquear(cfg.eventoNido, false);
    const d = DATOS_CONDOR.find((x) => x.id === cfg.eventoNido);
    mostrarCapa(`
      <div class="tarjeta">
        <span class="etiqueta">¡Llegaste al nido!</span>
        <h2>${escapar(cfg.nombre)}</h2>
        <div class="estrellas" aria-label="${estrellas} de 3 estrellas">${"★".repeat(estrellas)}${"☆".repeat(3 - estrellas)}</div>
        <div class="resumen">
          <div><span>Carroñas comidas</span><b>${comidasNivel}/${cfg.meta}</b></div>
          <div><span>Energía al llegar</span><b>${energiaMedia}</b></div>
          <div><span>Bono</span><b>+${bono}</b></div>
          <div><span>Puntos</span><b>${puntos}</b></div>
        </div>
        <p>${cumplio ? "Llevaste suficiente alimento al nido." : "Faltó alimento para el nido: el páramo necesita que comas más carroña."}</p>
        ${d ? `<p><strong>${escapar(d.titulo)}.</strong> ${escapar(d.texto)}</p>` : ""}
        <div class="botones"><button class="principal" id="b-quiz">Responder la pregunta del día</button></div>
      </div>`);
    $("b-quiz").onclick = () => quiz(nivel, () => {
      nivel++;
      if (nivel < NIVELES.length) introNivel();
      else quiz(NIVELES.length, () => finDelJuego(true));
    });
    $("b-quiz").focus();
  }

  function quiz(i, despues) {
    estado = "quiz";
    const q = PREGUNTAS[i];
    mostrarCapa(`
      <div class="tarjeta">
        <span class="etiqueta">Pregunta · +200 puntos</span>
        <h2>${escapar(q.pregunta)}</h2>
        <div class="opciones">${q.opciones.map((o, k) => `<button data-k="${k}">${escapar(o)}</button>`).join("")}</div>
        <p id="q-exp" hidden></p>
        <div class="botones"><button class="principal" id="b-q-seguir" hidden>Continuar</button></div>
      </div>`);
    const botones = capa.querySelectorAll(".opciones button");
    botones.forEach((b) => b.onclick = () => {
      const k = Number(b.dataset.k), bien = k === q.correcta;
      botones.forEach((x) => { x.disabled = true; if (Number(x.dataset.k) === q.correcta) x.classList.add("correcta"); });
      if (!bien) b.classList.add("incorrecta");
      if (bien) { puntos += 200; correctas++; sonidos.dato(); } else sonidos.dano();
      const exp = $("q-exp"); exp.hidden = false;
      exp.innerHTML = `<strong>${bien ? "¡Correcto!" : "No exactamente."}</strong> ${escapar(q.explicacion)}`;
      const seguir = $("b-q-seguir"); seguir.hidden = false; seguir.onclick = despues; seguir.focus();
    });
    botones[0].focus();
  }

  function finDelJuego(gano) {
    if (estado === "fin") return;
    estado = "fin";
    const limpio = carronasTotales ? Math.round((carronasComidas / carronasTotales) * 100) : 0;
    mostrarCapa(`
      <div class="tarjeta">
        <span class="etiqueta">${gano ? "Misión cumplida" : "Fin del vuelo"}</span>
        <h2>${gano ? "¡Eres un guardián del cóndor!" : "El páramo te necesita"}</h2>
        <div class="resumen">
          <div><span>Puntos</span><b>${puntos}</b></div>
          <div><span>Páramo limpio</span><b>${limpio}%</b></div>
          <div><span>Datos descubiertos</span><b>${desbloqueados.size}/${DATOS_CONDOR.length}</b></div>
          <div><span>Preguntas correctas</span><b>${correctas}</b></div>
        </div>
        <p>En Ecuador quedan entre 94 y 150 cóndores. Cada uno cuenta: no uses cebos envenenados y apoya la conservación del páramo.</p>
        <form id="f-nombre" class="botones" autocomplete="off">
          <label class="etiqueta" for="i-nombre" style="flex-basis:100%">Guarda tu puntaje</label>
          <input type="text" id="i-nombre" maxlength="16" placeholder="Tu nombre" required>
          <button class="principal" type="submit">Guardar</button>
        </form>
        <p id="f-estado" class="fuente" role="status"></p>
        <div class="botones">
          <button id="b-otra">Jugar otra vez</button>
          <button id="b-ficha3">Enciclopedia</button>
          <button id="b-menu">Menú</button>
        </div>
      </div>`);
    $("f-nombre").onsubmit = async (e) => {
      e.preventDefault();
      const nombre = $("i-nombre").value.trim().slice(0, 16);
      if (!nombre) return;
      const lugar = await guardarPuntaje({ nombre, puntos, limpio, datos: desbloqueados.size });
      $("f-estado").textContent = `Guardado ${lugar}.`;
      e.target.querySelector("button").disabled = true;
    };
    $("b-otra").onclick = () => nuevaPartida(numJugadores);
    $("b-ficha3").onclick = () => enciclopedia(menu);
    $("b-menu").onclick = menu;
    $("i-nombre").focus();
  }

  function enciclopedia(volver) {
    const prev = estado; estado = "ficha";
    mostrarCapa(`
      <div class="tarjeta ancha">
        <span class="etiqueta">Enciclopedia · ${desbloqueados.size} de ${DATOS_CONDOR.length} datos</span>
        <h2>Lo que sabes del cóndor andino</h2>
        <p>Cada dato se descubre jugando: comiendo carroña, usando térmicas, llegando al nido o aprendiendo de los peligros.</p>
        <div class="ficha-grid">${DATOS_CONDOR.map((d) => desbloqueados.has(d.id)
          ? `<article class="ficha"><h3>${escapar(d.titulo)}</h3><p>${escapar(d.texto)}</p><span class="fuente">${escapar(d.fuente)}</span></article>`
          : `<article class="ficha bloqueada"><h3>Dato por descubrir</h3><p>Sigue volando para desbloquearlo.</p></article>`).join("")}</div>
        <div class="botones"><button class="principal" id="b-volver">Volver</button></div>
      </div>`);
    $("b-volver").onclick = () => { estado = prev; volver(); };
    $("b-volver").focus();
  }

  // ---------- Puntajes: API en Python (Flask) o, sin servidor, el navegador ----------
  async function pedir(url, opciones) {
    const c = new AbortController(); const t = setTimeout(() => c.abort(), 1500);
    try { const r = await fetch(url, { ...opciones, signal: c.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
    finally { clearTimeout(t); }
  }
  async function leerPuntajes() {
    try { return { lista: await pedir(API), origen: "servidor" }; }
    catch { return { lista: leerLocal("condor_puntajes", []), origen: "este navegador" }; }
  }
  async function guardarPuntaje(reg) {
    reg.fecha = new Date().toISOString().slice(0, 10);
    try {
      await pedir(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reg) });
      return "en el servidor";
    } catch {
      const lista = leerLocal("condor_puntajes", []);
      lista.push(reg); lista.sort((a, b) => b.puntos - a.puntos);
      guardarLocal("condor_puntajes", lista.slice(0, 10));
      return "en este navegador";
    }
  }
  async function verPuntajes() {
    estado = "ficha";
    const { lista, origen } = await leerPuntajes();
    mostrarCapa(`
      <div class="tarjeta">
        <span class="etiqueta">Mejores guardianes · ${escapar(origen)}</span>
        <h2>Tabla de puntajes</h2>
        ${lista.length ? `<table class="tabla-puntajes"><thead><tr><th>#</th><th>Nombre</th><th>Páramo limpio</th><th>Puntos</th></tr></thead><tbody>
          ${lista.slice(0, 10).map((p, i) => `<tr><td>${i + 1}</td><td>${escapar(p.nombre)}</td><td>${escapar(p.limpio)}%</td><td>${escapar(p.puntos)}</td></tr>`).join("")}
        </tbody></table>` : `<p>Aún no hay puntajes. ¡Sé el primer guardián!</p>`}
        <div class="botones"><button class="principal" id="b-volver2">Volver</button></div>
      </div>`);
    $("b-volver2").onclick = menu;
    $("b-volver2").focus();
  }

  // Exponer el estado para pruebas automáticas
  window.__condor = { get estado() { return estado; }, get puntos() { return puntos; }, get dist() { return dist; },
    get jugadores() { return jugadores; }, get mundo() { return mundo; }, get datos() { return desbloqueados.size; } };

  menu();
  requestAnimationFrame(bucle);
})();
