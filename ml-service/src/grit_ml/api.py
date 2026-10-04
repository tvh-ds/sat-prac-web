import hmac
import json
import logging
import os
import threading
import time
import uuid
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.responses import JSONResponse

from .artifacts import load_artifact
from .contracts import Prediction, QuestionInput
from .predictor import Predictor


def create_app(predictor=None, token=None):
    token = token or os.environ.get("ML_SERVICE_TOKEN")
    if not token or len(token) < 32:
        raise ValueError("ML_SERVICE_TOKEN must contain at least 32 characters")
    predictor = predictor or Predictor(*load_artifact(os.environ["ML_ARTIFACT_PATH"]))
    if os.environ.get("GRIT_BENCHMARK_NO_CACHE") == "1" and hasattr(predictor.model, "config"):
        predictor.model.config["use_cache"] = False
    if hasattr(predictor.model, "encoder"):
        import torch
        torch.set_num_threads(min(8, predictor.model.config.get("inference_threads", os.cpu_count() or 1)))
    app = FastAPI(title="Grit private classification", docs_url=None, redoc_url=None)
    guard = HTTPBearer()
    lock = threading.Lock()

    @app.middleware("http")
    async def telemetry(request, call_next):
        # A private service still enforces a request cap; no raw question text is logged.
        try:
            length = int(request.headers.get("content-length", "0"))
        except ValueError:
            return JSONResponse({"detail": "Invalid content length"}, status_code=400)
        if length > 18000000:
            return JSONResponse({"detail": "Request too large"}, status_code=413)
        if request.method == "POST":
            body = bytearray()
            async for piece in request.stream():
                body.extend(piece)
                if len(body) > 18000000:
                    return JSONResponse({"detail": "Request too large"}, status_code=413)
            request._body = bytes(body)
        start = time.perf_counter()
        trace_id = str(uuid.uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = trace_id
        logging.getLogger("grit.classification").info(json.dumps({"trace_id": trace_id,
            "model_version": predictor.metadata["model_version"], "status": response.status_code,
            "latency_ms": (time.perf_counter() - start) * 1000}))
        return response

    def auth(credentials: Annotated[HTTPAuthorizationCredentials, Security(guard)]):
        if not hmac.compare_digest(credentials.credentials, token):
            raise HTTPException(401, "Unauthorized")

    @app.get("/health", dependencies=[Depends(auth)])
    def health():
        return {"ok": True, "model_version": predictor.metadata["model_version"]}

    @app.post("/v1/classify", response_model=Prediction, dependencies=[Depends(auth)])
    def classify(question: QuestionInput):
        if not lock.acquire(blocking=False):
            raise HTTPException(429, "Classifier busy; retry later")
        try:
            return predictor.predict(question)
        except (ValueError, OSError):
            raise HTTPException(422, "Unsupported or malformed model input") from None
        finally:
            lock.release()

    return app
