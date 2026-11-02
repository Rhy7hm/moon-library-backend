"""
Languages and file-name rules the server needs (ported from src/lib/langs.ts, variants.ts and library.ts).
The same codes, labels and order as the TypeScript code; keep them in step with admin/src/lib/langs.ts.
"""
from __future__ import annotations

import re
import unicodedata

LANG_CODES = ["en", "ms", "zh", "yue", "ta", "bn", "vi", "th"]
FILE_LANGS = LANG_CODES + ["all"]
FILE_LANG_LABEL = {"en": "EN", "ms": "BM", "zh": "简体", "yue": "繁体", "ta": "TA", "bn": "BN", "vi": "VI", "th": "TH", "all": ""}


def is_file_lang(v) -> bool:
    return isinstance(v, str) and v in FILE_LANGS


def clean_langs(v) -> list[str]:
    """Known codes only, no repeats (first wins), 'all' only on its own."""
    out: list[str] = []
    for x in v if isinstance(v, list) else []:
        if is_file_lang(x) and x not in out:
            out.append(x)
    return ["all"] if "all" in out else out


# ---------------------------------------------------------------- file names (variants.ts)

LANG_TOKENS = {
    "en": "en", "eng": "en", "english": "en", "英文": "en", "英语": "en", "英文版": "en",
    "bm": "ms", "my": "ms", "ms": "ms", "malay": "ms", "melayu": "ms", "马来": "ms", "马来文": "ms", "马来语": "ms",
    "cn": "zh", "zh": "zh", "chinese": "zh", "中文": "zh", "国语": "zh", "华语": "zh", "简体": "zh",
    "ct": "yue", "hk": "yue", "tc": "yue", "cantonese": "yue", "粤语": "yue", "繁体": "yue", "繁體": "yue",
    "ta": "ta", "tm": "ta", "tamil": "ta", "淡米尔": "ta", "淡米尔文": "ta",
    "bn": "bn", "bd": "bn", "bangla": "bn", "bengali": "bn", "বাংলা": "bn", "孟加拉": "bn", "孟加拉语": "bn",
    "vi": "vi", "vn": "vi", "viet": "vi", "vietnam": "vi", "vietnamese": "vi", "tiếng việt": "vi", "越南": "vi", "越南语": "vi", "越南文": "vi",
    "th": "th", "thai": "th", "ไทย": "th", "泰": "th", "泰文": "th", "泰语": "th",
}
_SEP = re.compile(r"[\s_\-–—()（）\[\]]+")
_CJK_ONLY = re.compile(r"^[一-鿿]+$")
_DIGITS = re.compile(r"^[0-9]+$")
_LEADING_DATE = re.compile(r"^[0-9]{1,2}-[0-9]{1,2}\s+")


def _strip_ext(name: str) -> str:
    i = name.rfind(".")
    return name[:i] if i > 0 else name


def file_name_lang(file_name: str) -> str:
    """The language a file name says ('all' = none), exactly as parseFileName() decides it."""
    base = _LEADING_DATE.sub("", unicodedata.normalize("NFC", _strip_ext(file_name)).strip(), count=1)
    tokens = [t for t in _SEP.split(base) if t]
    lang = "all"
    i = len(tokens) - 1
    while i >= 0 and _DIGITS.match(tokens[i]):
        i -= 1
    if i >= 0:
        j = i
        while j >= 0 and tokens[j].lower() in LANG_TOKENS:
            j -= 1
        if j < i:
            lang = LANG_TOKENS[tokens[j + 1].lower()]
    if lang == "all" and tokens:
        last = tokens[-1]
        for t in LANG_TOKENS:
            if _CJK_ONLY.match(t) and len(last) > len(t) and last.endswith(t):
                lang = LANG_TOKENS[t]
                break
    return lang


# ---------------------------------------------------------------- download names (library.ts)

def _opt_ext(opt_mime: str | None) -> str:
    return {"image/webp": "webp", "image/png": "png", "video/mp4": "mp4"}.get(opt_mime or "", "jpg")


def opt_name(name: str, opt_mime: str | None) -> str:
    base = re.sub(r"\.[^.]+$", "", name)
    return f"{base}.{_opt_ext(opt_mime)}"


def with_lang_tag(name: str, langs: list[str]) -> str:
    tags = [FILE_LANG_LABEL[l] for l in langs if l != "all"]
    if not tags or file_name_lang(name) != "all":
        return name
    dot = name.rfind(".")
    return f"{name[:dot]} - {' '.join(tags)}{name[dot:]}" if dot > 0 else f"{name} - {' '.join(tags)}"


# the language postfix on downloaded names, as in the upload naming rule ("Rebate_BM.png")
DL_LANG_TAG = {"en": "EN", "ms": "BM", "zh": "CN", "yue": "TC", "ta": "TA", "bn": "BN", "vi": "VI", "th": "TH", "all": ""}

# fallback order when a title is missing in a language (TEXT_FALLBACK in langs.ts)
TEXT_FALLBACK = {
    "en": ["en", "ms", "zh", "yue", "ta", "bn", "vi", "th"],
    "ms": ["ms", "en", "zh", "yue", "ta", "bn", "vi", "th"],
    "zh": ["zh", "yue", "en", "ms", "ta", "bn", "vi", "th"],
    "yue": ["yue", "zh", "en", "ms", "ta", "bn", "vi", "th"],
    "ta": ["ta", "en", "ms", "zh", "yue", "bn", "vi", "th"],
    "bn": ["bn", "en", "ms", "zh", "yue", "ta", "vi", "th"],
    "vi": ["vi", "en", "ms", "zh", "yue", "ta", "bn", "th"],
    "th": ["th", "en", "ms", "zh", "yue", "ta", "bn", "vi"],
}


def pick_text(t, lang: str) -> str:
    """The text in `lang`, else the next language in its fallback order (pickText in langs.ts)."""
    if not isinstance(t, dict):
        return ""
    for l in TEXT_FALLBACK.get(lang, TEXT_FALLBACK["en"]):
        v = t.get(l)
        if isinstance(v, str) and v.strip():
            return v
    return ""


_UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f\x7f]+')


def safe_file_base(title: str) -> str:
    """A card title made safe as a file name (safeFileBase in library.ts)."""
    s = re.sub(r"\s+", " ", _UNSAFE.sub(" ", unicodedata.normalize("NFC", title))).strip()
    return s.lstrip(".")[:120].strip()


def titled_name(title: str, file_name: str, langs: list[str]) -> str:
    """'Game Rebate List_BM.png' — the card title, the language, the file's extension (titledName in library.ts)."""
    base = safe_file_base(title)
    if not base:
        return with_lang_tag(file_name, langs)
    dot = file_name.rfind(".")
    ext = file_name[dot:].lower() if dot > 0 else ""
    tags = [l for l in langs if l != "all"]
    said = len(tags) == 1 and file_name_lang(f"{base}.x") == tags[0]
    return f"{base}{'_' + '_'.join(DL_LANG_TAG[l] for l in tags) if tags and not said else ''}{ext}"


def dl_name(name: str, opt_mime: str | None, opt: str | None, lang: str, langs: list[str] | None, original: bool = False, title: str = "") -> str:
    """The name a version downloads under (dlName in library.ts): the card title + language when there is a title."""
    langs_all = langs if langs else [lang]
    file = opt_name(name, opt_mime) if (not original and opt) else name
    return titled_name(title, file, langs_all) if title else with_lang_tag(file, langs_all)
