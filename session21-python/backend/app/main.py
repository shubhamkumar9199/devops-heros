"""ShelfWise API: a library's lending desk.

/health   liveness: the process answers, no database call
/ready    readiness: the database answers and the schema is migrated
/metrics  Prometheus: HTTP metrics plus the library's business gauges
/api/...  the application (Swagger UI at /api/docs)
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, RedirectResponse
from prometheus_fastapi_instrumentator import Instrumentator
from prometheus_fastapi_instrumentator import metrics as http_metrics
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app import metrics
from app.config import settings
from app.db import engine
from app.routes import books, dashboard, holds, loans, members
from app.services import DomainError


@asynccontextmanager
async def lifespan(_app: FastAPI):
    metrics.register()
    yield


app = FastAPI(
    title="ShelfWise API",
    version=settings.version,
    description="Lending desk for a campus library: catalogue, copies, members, loans, holds and fines.",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
    lifespan=lifespan,
)


@app.exception_handler(DomainError)
async def domain_error(_request: Request, exc: DomainError) -> JSONResponse:
    if exc.status == 409:
        metrics.RULE_REJECTIONS.labels(code=exc.code).inc()
    return JSONResponse(status_code=exc.status, content={"detail": exc.message, "code": exc.code})


@app.exception_handler(IntegrityError)
async def integrity_error(_request: Request, _exc: IntegrityError) -> JSONResponse:
    """Safety net: a constraint the services did not anticipate is still a 409, not a 500."""
    metrics.RULE_REJECTIONS.labels(code="conflict").inc()
    return JSONResponse(
        status_code=409, content={"detail": "The change clashes with existing data", "code": "conflict"}
    )


for module in (books, members, loans, holds, dashboard):
    app.include_router(module.router)


@app.get("/", include_in_schema=False)
def root() -> dict:
    return {"app": settings.app_name, "version": settings.version, "docs": "/api/docs"}


@app.get("/docs", include_in_schema=False)
def docs_redirect() -> RedirectResponse:
    return RedirectResponse("/api/docs")


@app.get("/health", tags=["probes"])
def health() -> dict:
    return {"status": "ok"}


@app.get("/ready", tags=["probes"])
def ready():
    try:
        with engine.connect() as conn:
            # The newest table: fails until every migration has run.
            conn.execute(text("SELECT 1 FROM activity LIMIT 1"))
    except Exception as exc:
        return JSONResponse(status_code=503, content={"status": "not ready", "reason": type(exc).__name__})
    return {"status": "ready"}


# Default buckets start at 100 ms, which puts every fast request in the first
# bucket and makes p95 meaningless; these start at 5 ms.
LATENCY_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5)

instrumentator = Instrumentator(
    should_group_status_codes=True,
    should_ignore_untemplated=True,
    excluded_handlers=["/metrics", "/health", "/ready"],
)
instrumentator.add(http_metrics.default(latency_lowr_buckets=LATENCY_BUCKETS))
instrumentator.instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
