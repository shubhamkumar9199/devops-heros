from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app import clock, services
from app.db import get_db
from app.schemas import MemberDetail, MemberIn, MemberOut

router = APIRouter(prefix="/api/members", tags=["members"])
DB = Annotated[Session, Depends(get_db)]


@router.get("", response_model=list[MemberOut])
def list_members(
    db: DB,
    q: Annotated[str | None, Query(max_length=100, description="Name or email")] = None,
    include_inactive: bool = False,
):
    return services.list_members(db, q=q, include_inactive=include_inactive)


@router.post("", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
def create_member(data: MemberIn, db: DB):
    member = services.create_member(db, data)
    return services.member_out(db, member, clock.now())


@router.get("/{member_id}", response_model=MemberDetail)
def get_member(member_id: int, db: DB):
    return services.member_detail(db, member_id)


@router.put("/{member_id}", response_model=MemberOut)
def update_member(member_id: int, data: MemberIn, db: DB):
    member = services.update_member(db, member_id, data)
    return services.member_out(db, member, clock.now())


@router.delete("/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_member(member_id: int, db: DB):
    """Closes the membership. History is kept, so the row is deactivated, not deleted."""
    services.deactivate_member(db, member_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
