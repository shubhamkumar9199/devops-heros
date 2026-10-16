from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app import clock, policy, services
from app.config import settings
from app.db import get_db
from app.schemas import ActivityOut, Info, Stats

router = APIRouter(prefix="/api", tags=["dashboard"])
DB = Annotated[Session, Depends(get_db)]


@router.get("/info", response_model=Info)
def info():
    """Build, pod and the lending rules, so the UI never hardcodes them."""
    return {
        "app": settings.app_name,
        "version": settings.version,
        "pod": settings.pod_name,
        "server_time": clock.now(),
        "timezone": settings.timezone,
        "policy": policy.as_dict(),
    }


@router.get("/stats", response_model=Stats)
def stats(db: DB):
    return services.stats(db)


@router.get("/activity", response_model=list[ActivityOut])
def activity(db: DB, limit: Annotated[int, Query(ge=1, le=100)] = 20):
    return services.recent_activity(db, limit)
