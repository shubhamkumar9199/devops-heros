from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app import services
from app.db import get_db
from app.schemas import HoldCreate, HoldOut

router = APIRouter(prefix="/api/holds", tags=["holds"])
DB = Annotated[Session, Depends(get_db)]

HoldFilter = Literal["open", "waiting", "ready", "fulfilled", "cancelled", "expired", "all"]


@router.get("", response_model=list[HoldOut])
def list_holds(db: DB, status: HoldFilter = "open", member_id: int | None = None, book_id: int | None = None):
    return services.list_holds(db, status=status, member_id=member_id, book_id=book_id)


@router.post("", response_model=HoldOut, status_code=status.HTTP_201_CREATED)
def place_hold(data: HoldCreate, db: DB):
    """Join the queue for a book with no copy on the shelf."""
    hold = services.place_hold(db, member_id=data.member_id, book_id=data.book_id)
    return services.get_hold(db, hold.id)


@router.get("/{hold_id}", response_model=HoldOut)
def get_hold(hold_id: int, db: DB):
    return services.get_hold(db, hold_id)


@router.delete("/{hold_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_hold(hold_id: int, db: DB):
    """Leave the queue. A ready hold's copy passes to the next member waiting."""
    services.cancel_hold(db, hold_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/expire")
def expire_holds(db: DB) -> dict:
    """Lapse ready holds whose pickup window has passed (the CronJob calls this logic too)."""
    return {"expired": services.expire_all_holds(db)}
