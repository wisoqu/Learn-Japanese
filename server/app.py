#!/usr/bin/env python3
"""
kana.app — серверная часть.

Что тут есть:
  * static-раздача фронтенда из /app
  * /api/health           — проверка, что сервер жив
  * /api/progress         — сохранение / загрузка прогресса (JSON-файл)
  * /api/chat             — прокси до Google Gemini. Ключ клиента передаётся
                             в заголовке X-Gemini-Key, server-side ключ из
                             переменной GEMINI_API_KEY — как fallback.

Прокси нужен по двум причинам: чтобы ключ не лежал в браузере и чтобы
вызовы Google не обходили CORS. Без этого сервера приложение всё равно
работает — прогресс уходит в localStorage, а чат просто выключен.

Запуск:
    python3 -m venv .venv && . .venv/bin/activate
    pip install -r requirements.txt
    uvicorn server.app:app --host 0.0.0.0 --port 10001
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
APP_DIR = ROOT / "app"
STATE_DIR = Path(os.environ.get("KANA_STATE_DIR", ROOT / "server" / "state"))
PROGRESS_FILE = STATE_DIR / "progress.json"

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

app = FastAPI(title="kana.app", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------ progress

def _load_progress() -> dict:
    if not PROGRESS_FILE.exists():
        return {}
    try:
        return json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}


def _save_progress(data: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = PROGRESS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, PROGRESS_FILE)


@app.get("/api/health")
def health():
    return {"ok": True, "server": "kana.app"}


@app.get("/api/progress")
def get_progress():
    data = _load_progress()
    if not data:
        return JSONResponse({"error": "no-progress"}, status_code=404)
    return data


@app.post("/api/progress")
async def put_progress(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"error": "bad-json"}, status_code=400)
    if not isinstance(payload, dict):
        return JSONResponse({"error": "bad-payload"}, status_code=400)
    payload.setdefault("stats", {}).setdefault("lastSync", int(time.time() * 1000))
    _save_progress(payload)
    return {"ok": True, "saved": payload["stats"].get("lastSync")}


# ------------------------------------------------------------------- gemini

async def _gemini_stream(key: str, model: str, payload: dict):
    """Async generator yielding SSE-formatted lines."""
    import httpx

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        async with client.stream(
            "POST",
            f"{GEMINI_ENDPOINT}/{model}:streamGenerateContent",
            params={"alt": "sse", "key": key},
            json=payload,
        ) as resp:
            if resp.status_code >= 400:
                body = (await resp.aread()).decode("utf-8", "replace")[:400]
                yield f"data: {json.dumps({'error': f'gemini {resp.status_code}: {body}'})}\n\n"
                return
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line or not line.startswith("data:"):
                    continue
                yield line + "\n"


def _build_payload(messages: list, model: str) -> dict:
    system = ""
    contents = []
    for m in messages:
        role = m.get("role")
        parts = m.get("parts") or []
        text = "".join(p.get("text", "") for p in parts)
        if role == "system":
            system = text
            continue
        contents.append({"role": "model" if role == "ai" else "user", "parts": [{"text": text}]})
    if not contents:
        contents = [{"role": "user", "parts": [{"text": "こんにちは"}]}]
    payload = {"contents": contents, "generationConfig": {"temperature": 0.7, "maxOutputTokens": 1024}}
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}
    return payload


@app.post("/api/chat")
async def chat(request: Request):
    key = request.headers.get("x-gemini-key", "").strip() or os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        return JSONResponse({"error": "no-key"}, status_code=400)

    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "bad-json"}, status_code=400)

    messages = body.get("messages") or []
    model = (body.get("model") or DEFAULT_MODEL).strip()

    payload = _build_payload(messages, model)

    async def gen():
        try:
            async for chunk in _gemini_stream(key, model, payload):
                yield chunk
        except Exception as exc:  # network, auth, rate limit — surface it to the client
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ------------------------------------------------------------------ static

if APP_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(APP_DIR)), name="static")

    @app.get("/")
    def index():
        return FileResponse(str(APP_DIR / "index.html"))

    @app.get("/{path:path}")
    def spa(path: str):
        """SPA fallback: unknown non-API paths serve index.html."""
        if path.startswith("api/"):
            return JSONResponse({"error": "not-found"}, status_code=404)
        candidate = (APP_DIR / path).resolve()
        if APP_DIR in candidate.parents and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(APP_DIR / "index.html"))
