#!/usr/bin/env python3
"""
Opcional. Recorre los *.js de la carpeta, calcula el sha256 y sube 'version' solo si el script cambió.
Conserva todo lo demás que ya tengas en index.json (enabled, base, idx, desc, category…) y avisa si un idx
está mal (falta, repetido, o choca con un servidor interno de la app).

Uso:   python3 tools/gen_index.py        (desde la carpeta servidores-remotos)
"""
import hashlib, json, os, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
idx_path = os.path.join(root, "index.json")
idx = json.load(open(idx_path, encoding="utf-8")) if os.path.exists(idx_path) else {"enabled": True, "servers": {}}
servers = idx.setdefault("servers", {})

for fn in sorted(os.listdir(root)):
    if not fn.endswith(".js"):
        continue
    key = fn[:-3]
    h = hashlib.sha256(open(os.path.join(root, fn), "rb").read()).hexdigest()
    e = servers.setdefault(key, {"enabled": True, "version": 0, "script": fn})
    e["script"] = fn
    if e.get("sha256") != h:
        e["sha256"] = h
        e["version"] = int(e.get("version", 0)) + 1
        print(f"  {key}: actualizado → versión {e['version']}")

# ── Validación de idx ──
# Servidores que antes eran internos y ahora son remotos: conservan su idx original. Los nuevos: 24-199.
ORIGINALES = {"gamma": 1, "epsilon": 2, "beta": 3, "trace": 5, "princes": 7, "tv": 9, "flix": 12, "turbet": 13, "zha": 10, "dirma": 11, "cuevana": 16, "givan": 17, "abby": 18, "cuevan": 19, "flv": 20, "tur": 21, "entry": 22, "cartoons": 23, "delta": 0, "kuro": 4, "landzux": 6, "omega": 8, "nub": 14, "lis": 15}
usados = {}
for key, e in sorted(servers.items()):
    i = e.get("idx")
    if i is None:
        print(f"  ⚠ {key}: no tiene 'idx' (sin idx la app no lo muestra)")
        continue
    if not isinstance(i, int) or i < 0 or i > 199:
        print(f"  ⚠ {key}: idx {i!r} fuera de rango (0-199)")
    elif i < 24 and ORIGINALES.get(key) != i:
        print(f"  ⚠ {key}: idx {i} está reservado para servidores internos de la app; usa 24-199")
    if i in usados:
        print(f"  ⚠ {key}: idx {i} repetido (ya lo usa '{usados[i]}'); la app ignora uno de los dos")
    usados.setdefault(i, key)

# ── Validación de "bases" (dominios de respaldo) ──
for key, e in sorted(servers.items()):
    bs = e.get("bases")
    if bs is None:
        continue
    if not isinstance(bs, list) or not all(isinstance(b, str) for b in bs):
        print(f"  ⚠ {key}: 'bases' debe ser una lista de textos")
        continue
    for b in bs:
        if not (b.startswith("http://") or b.startswith("https://")):
            print(f"  ⚠ {key}: '{b}' en 'bases' debe empezar por http:// o https://")
        elif b.endswith("/"):
            print(f"  ℹ {key}: '{b}' termina en '/' (la app lo ignora, pero conviene quitarlo)")
    if e.get("base") and e["base"].rstrip("/") not in [b.rstrip("/") for b in bs]:
        print(f"  ℹ {key}: 'base' no está dentro de 'bases'; se usa igual como dominio principal")

json.dump(idx, open(idx_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("index.json listo")
