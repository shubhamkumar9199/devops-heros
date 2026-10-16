from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app import services
from app.db import get_db
from app.schemas import BookCreate, BookDetail, BookOut, BookUpdate, CopyCreate, CopyOut, CopyUpdate, Genre

router = APIRouter(prefix="/api", tags=["catalogue"])
DB = Annotated[Session, Depends(get_db)]


@router.get("/books", response_model=list[BookOut])
def list_books(
    db: DB,
    q: Annotated[str | None, Query(max_length=100, description="Title, author or ISBN")] = None,
    genre: Genre | None = None,
    available: bool | None = None,
):
    return services.list_books(db, q=q, genre=genre, available=available)


@router.post("/books", response_model=BookDetail, status_code=status.HTTP_201_CREATED)
def create_book(data: BookCreate, db: DB):
    book = services.create_book(db, data)
    return services.book_detail(db, book.id)


@router.get("/books/{book_id}", response_model=BookDetail)
def get_book(book_id: int, db: DB):
    return services.book_detail(db, book_id)


@router.put("/books/{book_id}", response_model=BookDetail)
def update_book(book_id: int, data: BookUpdate, db: DB):
    services.update_book(db, book_id, data)
    return services.book_detail(db, book_id)


@router.delete("/books/{book_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_book(book_id: int, db: DB):
    services.delete_book(db, book_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/books/{book_id}/copies", response_model=CopyOut, status_code=status.HTTP_201_CREATED)
def add_copy(book_id: int, data: CopyCreate, db: DB):
    return services.copy_out(services.add_copy(db, book_id, data))


@router.put("/copies/{copy_id}", response_model=CopyOut)
def update_copy(copy_id: int, data: CopyUpdate, db: DB):
    return services.copy_out(services.update_copy(db, copy_id, data))


@router.delete("/copies/{copy_id}", status_code=status.HTTP_204_NO_CONTENT)
def withdraw_copy(copy_id: int, db: DB):
    services.withdraw_copy(db, copy_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
