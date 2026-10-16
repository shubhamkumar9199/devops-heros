from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app import clock, services
from app.db import get_db
from app.schemas import LoanCreate, LoanOut

router = APIRouter(prefix="/api/loans", tags=["loans"])
DB = Annotated[Session, Depends(get_db)]

LoanFilter = Literal["active", "overdue", "returned", "lost", "closed", "unpaid", "all"]


def _out(db: Session, loan_id: int) -> dict:
    return services.loan_out(services.get_loan(db, loan_id), clock.now())


@router.get("", response_model=list[LoanOut])
def list_loans(
    db: DB,
    status: LoanFilter = "active",
    member_id: int | None = None,
    book_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
):
    return services.list_loans(db, status=status, member_id=member_id, book_id=book_id, limit=limit)


@router.post("", response_model=LoanOut, status_code=status.HTTP_201_CREATED)
def borrow(data: LoanCreate, db: DB):
    """Lend a copy. Picks the member's reserved copy if a hold is ready, else any copy on the shelf."""
    loan = services.borrow(db, member_id=data.member_id, book_id=data.book_id, copy_id=data.copy_id)
    return _out(db, loan.id)


@router.get("/{loan_id}", response_model=LoanOut)
def get_loan(loan_id: int, db: DB):
    return _out(db, loan_id)


@router.post("/{loan_id}/return", response_model=LoanOut)
def return_loan(loan_id: int, db: DB):
    services.return_loan(db, loan_id)
    return _out(db, loan_id)


@router.post("/{loan_id}/renew", response_model=LoanOut)
def renew(loan_id: int, db: DB):
    services.renew(db, loan_id)
    return _out(db, loan_id)


@router.post("/{loan_id}/lost", response_model=LoanOut)
def mark_lost(loan_id: int, db: DB):
    services.mark_lost(db, loan_id)
    return _out(db, loan_id)


@router.post("/{loan_id}/pay", response_model=LoanOut)
def pay_fine(loan_id: int, db: DB):
    services.pay_fine(db, loan_id)
    return _out(db, loan_id)
