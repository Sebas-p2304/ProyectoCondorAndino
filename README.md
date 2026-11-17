# Guardianes del Cóndor — juego de referencia

Juego web educativo sobre el cóndor andino (*Vultur gryphus*) para el proyecto de Aplicaciones Web del FABLAB.
Es un **ejemplo de referencia**: los equipos deben crear su propia versión, mejorarla y ampliarla.

## Cómo ejecutarlo

**Solo el juego (sin servidor):** abrir `static/index.html` en el navegador. Los puntajes se guardan en el navegador.

**Con el servidor en Python (recomendado):**

```bash
pip install -r requirements.txt
python app.py
```

Abrir http://127.0.0.1:5000. Los puntajes se guardan en `puntajes.json` a través de la API.

## Estructura

```
app.py                  Servidor Flask y API de puntajes (Python)
requirements.txt
static/
  index.html            Estructura de la página (HTML)
  css/estilos.css       Interfaz y diseño (CSS)
  js/datos.js           Datos del cóndor, niveles y preguntas (JavaScript)
  js/juego.js           Lógica del juego en <canvas> (JavaScript)
```

## Controles

| Acción | 1 jugador | Jugador 1 | Jugador 2 |
| --- | --- | --- | --- |
| Aletear | ↑ / Espacio | W | ↑ |
| Planear (alas abiertas) | Shift / G | Shift izq. | Shift der. / . |
| Avanzar / frenar | ← → | A D | ← → |
| Picada (bajar a comer) | ↓ | S | ↓ |
| Vista de cóndor | V | E | L |
| Pausa / sonido | Esc o P / M | | |

## Mecánicas y lo que enseñan

| Mecánica | Qué enseña |
| --- | --- |
| Aletear gasta energía; las térmicas te elevan gratis | El cóndor aletea cerca del 1 % del tiempo y planea en corrientes de aire caliente |
| Despegar desde el suelo cuesta más | ~75 % del aleteo ocurre al despegar |
| Vista de cóndor y gallinazos sobre la comida | Busca comida con la vista y siguiendo a otras aves |
| Carroña envenenada | El veneno es su principal amenaza (63 % de los casos registrados) |
| Cables eléctricos con desviadores | Choques y electrocución en tendidos eléctricos |
| Nido en el risco, un solo huevo | Anida a 3.000–5.000 m y pone un huevo cada dos años |
| Enciclopedia y preguntas | 18 datos con fuente y 4 preguntas |

## Fuentes de los datos

- Williams, H. J. et al. (2020). *Physical limits of flight performance in the heaviest soaring bird.* PNAS.
- Restrepo-Cardona, J. S. et al. (2022). *Anthropogenic threats to the Vulnerable Andean Condor in northern South America.* PLOS ONE.
- Wikipedia, «Andean condor» (y estudios que cita).
- Primicias (2019). Día del Cóndor Andino en Ecuador.

## Mejoras de esta versión (prototipo FabLab)

- **Tres acciones de vuelo diferenciadas:** aletear (gasta 7 de energía, 14 al despegar del suelo; sin aletear el cóndor cae rápido), **planear** (Shift: cae muy despacio y gasta 0,35/s en vez de 1/s) y térmicas (suben gratis). La acción actual se muestra en el HUD.
- **Alimentación por contacto:** la carroña **roja** (segura) da energía y la **morada con vetas verdes** (envenenada) quita una vida; se comen al tocarlas, así que hay que distinguirlas por color (la Vista de cóndor también las marca).
- **Suelo y borde:** en el suelo el cóndor no avanza pero el mundo sí: lo va dejando atrás hasta el borde izquierdo, donde pierde la partida. Hay que aletear para despegar a tiempo.
- **Mensajes educativos contextuales y sin pausar el juego:** aparecen la primera vez que aleteas, planeas, entras a una térmica, encuentras carroña o sufres una amenaza.
- **Controles visibles:** barra inferior, pista sobre el cóndor y botones táctiles para planear y comer.

### Criterio de diseño: cada mecánica responde a tres preguntas

| Comportamiento real | Qué hace el jugador | Qué aprende |
| --- | --- | --- |
| Casi no aletea; planea | Alterna aleteo, planeo y térmicas | Ahorrar energía es clave para el cóndor |
| Es carroñero | Desciende y toca la carne | Limpia el páramo y frena enfermedades |
| No detecta el veneno | Distingue por color (y con la Vista) qué comer | El veneno es su mayor amenaza |
| Choca con cables | Esquiva los tendidos | Los desviadores de vuelo los hacen visibles |
| Sigue a otras carroñeras | Observa los gallinazos | Encuentra comida con la vista y señales de otras aves |
| Anida en riscos | Llega al nido | Importancia de los riscos para reproducirse |
