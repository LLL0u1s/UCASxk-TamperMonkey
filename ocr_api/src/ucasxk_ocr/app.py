from __future__ import annotations

import base64
import binascii
import re
from collections.abc import Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, Protocol

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel


PNG_PREFIX = "data:image/png;base64,"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_IMAGE_BYTES = 2 * 1024 * 1024
CLIENT_HEADER = "tampermonkey"


@dataclass(frozen=True, slots=True)
class Recognition:
    text: str
    confidence: float
    accepted: bool


class Recognizer(Protocol):
    def recognize(self, image: bytes) -> Recognition: ...


class OcrRequest(BaseModel):
    image: str


class OcrResponse(BaseModel):
    text: str
    confidence: float
    accepted: bool


def decode_png(data_url: str) -> bytes:
    if not data_url.startswith(PNG_PREFIX):
        raise ValueError("image must be a PNG data URL")
    encoded = data_url[len(PNG_PREFIX) :]
    try:
        image = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("image contains invalid base64") from exc
    if len(image) > MAX_IMAGE_BYTES:
        raise ValueError("image exceeds the 2 MiB limit")
    if not image.startswith(PNG_SIGNATURE):
        raise ValueError("decoded image is not a PNG")
    return image


def _confidence(raw: dict[str, Any]) -> float:
    if "confidence" in raw:
        return float(raw["confidence"])
    probabilities = raw.get("probability") or raw.get("probabilities") or []
    maxima = [max(float(value) for value in row) for row in probabilities if row]
    return min(maxima, default=1.0)


class DdddRecognizer:
    def __init__(self, minimum_confidence: float = 0.60) -> None:
        import ddddocr

        self.minimum_confidence = minimum_confidence
        self._ocr = ddddocr.DdddOcr(show_ad=False)

    def recognize(self, image: bytes) -> Recognition:
        raw = self._ocr.classification(image, probability=True)
        if isinstance(raw, str):
            text = raw
            confidence = 1.0
        elif isinstance(raw, dict):
            text = str(raw.get("text") or raw.get("result") or "")
            confidence = _confidence(raw)
        else:
            text = ""
            confidence = 0.0
        text = re.sub(r"[^A-Za-z0-9]", "", text)
        accepted = bool(re.fullmatch(r"[A-Za-z0-9]{5}", text)) and confidence >= self.minimum_confidence
        return Recognition(text=text, confidence=confidence, accepted=accepted)


def create_app(recognizer_factory: Callable[[], Recognizer] = DdddRecognizer) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.recognizer = recognizer_factory()
        yield

    app = FastAPI(
        title="UCASxk Local OCR",
        version="1.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    @app.get("/health")
    def health() -> dict[str, object]:
        return {"status": "ok", "model_loaded": hasattr(app.state, "recognizer")}

    @app.post("/v1/ocr", response_model=OcrResponse)
    def recognize(
        request: OcrRequest,
        x_ucasxk_client: str | None = Header(default=None),
    ) -> Recognition:
        if x_ucasxk_client != CLIENT_HEADER:
            raise HTTPException(status_code=403, detail="client header rejected")
        try:
            image = decode_png(request.image)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        try:
            return app.state.recognizer.recognize(image)
        except Exception as exc:
            raise HTTPException(status_code=503, detail="OCR model failed") from exc

    return app


app = create_app()


def main() -> None:
    import uvicorn

    uvicorn.run("ucasxk_ocr.app:app", host="127.0.0.1", port=8765, log_level="info")
