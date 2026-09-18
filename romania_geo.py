"""Judete si localitati Romania - nomenclator din data/romania_judete.json."""

import json
import os
import re
import shutil
import unicodedata
from functools import lru_cache

from paths import get_data_dir, get_resource_dir


def _normalize(text):
    """Comparare fara diacritice si case-insensitive."""
    if not text:
        return ""
    text = str(text).strip().casefold()
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _romania_judete_candidates():
    """Cauta nomenclatorul in data/ langa exe, apoi in resursele imbricate."""
    yield os.path.join(get_data_dir(), "romania_judete.json")
    yield os.path.join(get_resource_dir(), "data", "romania_judete.json")
    yield os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "romania_judete.json")


def _ensure_romania_judete_file():
    """Copiaza nomenclatorul in data/ daca lipseste (ex. prima rulare .exe)."""
    dest = os.path.join(get_data_dir(), "romania_judete.json")
    if os.path.isfile(dest):
        return dest
    for src in _romania_judete_candidates():
        if src == dest or not os.path.isfile(src):
            continue
        os.makedirs(get_data_dir(), exist_ok=True)
        shutil.copy2(src, dest)
        return dest
    return None


@lru_cache(maxsize=1)
def _load_judete_data():
    path = _ensure_romania_judete_file()
    if not path:
        return {"judete": []}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def lista_judete():
    data = _load_judete_data()
    return sorted(j["nume"] for j in data.get("judete", []))


def _gaseste_judet(data, judet):
    key = _normalize(judet)
    for j in data.get("judete", []):
        if _normalize(j.get("nume", "")) == key:
            return j
    return None


def _collapse_duplicate_letters(text):
    """ggorj -> gorj (corecteaza dubluri accidentale la tastare)."""
    if not text:
        return ""
    return re.sub(r"(.)\1+", r"\1", text)


def gaseste_judet_nume(judet):
    """Returneaza numele canonic al judetului din nomenclator."""
    raw = (judet or "").strip()
    if not raw:
        return ""
    data = _load_judete_data()
    found = _gaseste_judet(data, raw)
    if found:
        return (found.get("nume") or "").strip()

    norm = _normalize(raw)
    for prefix in ("municipiul ", "municipiu ", "judetul ", "judet ", "jud "):
        if norm.startswith(prefix):
            norm = norm[len(prefix):].strip()
            break

    # Cod SIRUTA scurt (ex: GJ, B, CJ)
    if len(norm) <= 2:
        for j in data.get("judete", []):
            cod = _normalize(j.get("cod") or j.get("auto") or "")
            if cod and cod == norm:
                return (j.get("nume") or "").strip()

    candidates = [norm, _collapse_duplicate_letters(norm)]
    for j in data.get("judete", []):
        nume = (j.get("nume") or "").strip()
        nume_norm = _normalize(nume)
        for cand in candidates:
            if not cand:
                continue
            if nume_norm == cand:
                return nume
            if nume_norm.startswith(cand) or cand.startswith(nume_norm):
                return nume
            # typo 1 caracter (ggorj vs gorj deja acoperit de collapse)
            if abs(len(nume_norm) - len(cand)) <= 1 and (
                nume_norm in cand or cand in nume_norm
            ):
                return nume
    return raw


def gaseste_localitate_nume(judet, localitate):
    """Returneaza numele canonic al localitatii din nomenclator."""
    raw = (localitate or "").strip()
    if not raw:
        return ""
    judet_canon = gaseste_judet_nume(judet)
    if not judet_canon:
        return raw

    data = _load_judete_data()
    j = _gaseste_judet(data, judet_canon)
    if not j:
        return raw

    if _normalize(judet_canon) == _normalize("Bucureşti"):
        m = re.search(r"sector\s*(\d+)", raw, re.I)
        if m:
            sector = f"Sector {m.group(1)}"
            for loc in j.get("localitati", []):
                if _normalize(loc.get("nume", "")) == _normalize(sector):
                    return (loc.get("nume") or sector).strip()
            return sector

    target = _normalize(raw)
    for prefix in ("municipiul ", "municipiu ", "orasul ", "oras ", "comuna ", "satul ", "sat "):
        if target.startswith(prefix):
            target = target[len(prefix):].strip()
            break
    if " mun " in f" {target} ":
        target = target.split(" mun ", 1)[0].strip()

    for loc in j.get("localitati", []):
        nume = (loc.get("nume") or "").strip()
        simplu = (loc.get("simplu") or "").strip()
        if _normalize(nume) == target or (simplu and _normalize(simplu) == target):
            return nume
    for loc in j.get("localitati", []):
        nume = (loc.get("nume") or "").strip()
        nume_norm = _normalize(nume)
        if nume_norm.startswith(target) or target.startswith(nume_norm):
            return nume
    return raw


def lista_localitati(judet):
    if not judet:
        return []
    data = _load_judete_data()
    j = _gaseste_judet(data, judet)
    if j:
        seen = set()
        result = []
        for loc in j.get("localitati", []):
            nume = (loc.get("nume") or "").strip()
            if nume and nume not in seen:
                seen.add(nume)
                result.append(nume)
        return sorted(result, key=lambda x: x.casefold())
    return []


def normalize_adresa_ro(judet="", localitate="", adresa_detaliu=""):
    """Normalizeaza judet/localitate dupa nomenclator. Returneaza (judet, localitate, detalii, erori)."""
    judet_in = (judet or "").strip()
    loc_in = (localitate or "").strip()
    det = (adresa_detaliu or "").strip()
    erori = []

    judet_out = gaseste_judet_nume(judet_in) if judet_in else ""
    if judet_in and judet_out:
        # daca nu e in nomenclator, gaseste_judet_nume intoarce raw
        if not _gaseste_judet(_load_judete_data(), judet_out):
            erori.append(f"Județ invalid: {judet_in}")
            judet_out = ""
    elif judet_in and not judet_out:
        erori.append(f"Județ invalid: {judet_in}")

    loc_out = ""
    if loc_in and judet_out:
        loc_out = gaseste_localitate_nume(judet_out, loc_in)
        locs = {_normalize(x) for x in lista_localitati(judet_out)}
        if _normalize(loc_out) not in locs:
            # localitate necunoscuta
            erori.append(f"Localitate invalidă pentru {judet_out}: {loc_in}")
            loc_out = ""
    elif loc_in and not judet_out:
        erori.append("Selectați județul înainte de localitate")
        loc_out = loc_in

    return judet_out, loc_out, det, erori


def adresa_valida_ro(judet="", localitate=""):
    """True daca judetul si localitatea exista in nomenclator."""
    j, l, _, errs = normalize_adresa_ro(judet, localitate, "")
    return bool(j and l and not errs)


def compose_adresa(judet="", localitate="", adresa_detaliu="", adresa_legacy=""):
    """Adresa formatata: judet, localitate, detalii strada."""
    j, loc, det, _ = normalize_adresa_ro(judet, localitate, adresa_detaliu)
    if not j:
        j = (judet or "").strip()
    if not loc:
        loc = (localitate or "").strip()
    parts = []
    if j:
        parts.append(f"Jud. {j}")
    if loc:
        parts.append(loc)
    if det:
        parts.append(det)
    if parts:
        return ", ".join(parts)
    return (adresa_legacy or "").strip()


def parse_partener_adresa(partener):
    """Returneaza adresa completa pentru afisare / factura."""
    if not partener:
        return ""
    p = dict(partener)
    compus = compose_adresa(
        p.get("judet", ""),
        p.get("localitate", ""),
        p.get("adresa_detaliu", ""),
        p.get("adresa", ""),
    )
    return compus or p.get("adresa", "") or ""