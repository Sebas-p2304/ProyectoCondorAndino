"""
Guardianes del Cóndor — servidor en Python (Flask)

Sirve el juego (carpeta static/) y una pequeña API de puntajes:
  GET  /api/puntajes   -> los 10 mejores puntajes
  POST /api/puntajes   -> guarda {nombre, puntos, limpio, datos, fecha}

Uso:
  pip install -r requirements.txt
  python app.py
  Abrir http://127.0.0.1:5000
"""
import json
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

BASE = Path(__file__).parent
ARCHIVO = BASE / "puntajes.json"

app = Flask(__name__, static_folder="static", static_url_path="")


def leer_puntajes():
    if ARCHIVO.exists():
        return json.loads(ARCHIVO.read_text(encoding="utf-8"))
    return []


def guardar_puntajes(lista):
    ARCHIVO.write_text(json.dumps(lista, ensure_ascii=False, indent=2), encoding="utf-8")


@app.get("/")
def inicio():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/puntajes")
def obtener_puntajes():
    return jsonify(leer_puntajes()[:10])


@app.post("/api/puntajes")
def nuevo_puntaje():
    datos = request.get_json(silent=True) or {}
    nombre = str(datos.get("nombre", "")).strip()[:16]
    try:
        puntos = int(datos.get("puntos", 0))
        limpio = int(datos.get("limpio", 0))
        cantidad_datos = int(datos.get("datos", 0))
    except (TypeError, ValueError):
        return jsonify(error="Datos inválidos"), 400
    if not nombre:
        return jsonify(error="Falta el nombre"), 400

    registro = {
        "nombre": nombre,
        "puntos": max(0, puntos),
        "limpio": max(0, min(100, limpio)),
        "datos": max(0, cantidad_datos),
        "fecha": str(datos.get("fecha", ""))[:10],
    }
    lista = leer_puntajes()
    lista.append(registro)
    lista.sort(key=lambda r: r["puntos"], reverse=True)
    guardar_puntajes(lista[:50])
    return jsonify(registro), 201


if __name__ == "__main__":
    app.run(debug=True)
