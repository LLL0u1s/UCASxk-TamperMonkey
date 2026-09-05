import base64

from fastapi.testclient import TestClient

from ucasxk_ocr.app import PNG_SIGNATURE, Recognition, create_app, decode_png


class FakeRecognizer:
    def __init__(self, *, fail: bool = False, accepted: bool = True):
        self.fail = fail
        self.accepted = accepted

    def recognize(self, image: bytes) -> Recognition:
        assert image.startswith(PNG_SIGNATURE)
        if self.fail:
            raise RuntimeError("model failure")
        return Recognition("AB123" if self.accepted else "AB12", 0.95, self.accepted)


def payload(image: bytes = PNG_SIGNATURE + b"test") -> str:
    return "data:image/png;base64," + base64.b64encode(image).decode()


def test_health_and_successful_recognition():
    app = create_app(lambda: FakeRecognizer())
    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "ok", "model_loaded": True}
        response = client.post(
            "/v1/ocr",
            headers={"X-UCASXK-Client": "tampermonkey"},
            json={"image": payload()},
        )
    assert response.status_code == 200
    assert response.json() == {"text": "AB123", "confidence": 0.95, "accepted": True}


def test_client_header_is_required():
    app = create_app(lambda: FakeRecognizer())
    with TestClient(app) as client:
        assert client.post("/v1/ocr", json={"image": payload()}).status_code == 403


def test_invalid_data_url_and_non_png_are_rejected():
    app = create_app(lambda: FakeRecognizer())
    headers = {"X-UCASXK-Client": "tampermonkey"}
    with TestClient(app) as client:
        assert client.post("/v1/ocr", headers=headers, json={"image": "bad"}).status_code == 400
        assert client.post("/v1/ocr", headers=headers, json={"image": payload(b"not-png")}).status_code == 400


def test_model_failure_returns_503():
    app = create_app(lambda: FakeRecognizer(fail=True))
    with TestClient(app) as client:
        response = client.post(
            "/v1/ocr",
            headers={"X-UCASXK-Client": "tampermonkey"},
            json={"image": payload()},
        )
    assert response.status_code == 503


def test_decode_rejects_oversized_image():
    oversized = PNG_SIGNATURE + b"x" * (2 * 1024 * 1024)
    try:
        decode_png(payload(oversized))
    except ValueError as exc:
        assert "2 MiB" in str(exc)
    else:
        raise AssertionError("oversized image was accepted")
