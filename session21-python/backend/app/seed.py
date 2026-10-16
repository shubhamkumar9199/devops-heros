"""Demo data: replays 60 days of a campus library through the real lending rules.

    python -m app.seed            # only if the catalogue is empty
    python -m app.seed --reset    # wipe everything first

Nothing is written around the rules: the script moves a simulated clock forward
day by day and calls the same service functions the API uses, so late returns,
fines, renewals, holds queues and lapsed pickups all come out of the rules
themselves, and the history ends at the real current time.

Titles and authors are real; ISBNs are synthetic (valid check digits, India's
978-93 group) and members are fictional.
"""

from __future__ import annotations

import argparse
import random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select

from app import clock, policy, services
from app.config import settings
from app.db import SessionLocal, engine
from app.models import Activity, Book, Copy, Hold, Loan, Member
from app.schemas import BookCreate, MemberIn

BOOKS = [  # title, author, genre, year, copies, popularity
    ("Pride and Prejudice", "Jane Austen", "Fiction", 1813, 2, 2),
    ("Nineteen Eighty-Four", "George Orwell", "Fiction", 1949, 3, 4),
    ("The God of Small Things", "Arundhati Roy", "Fiction", 1997, 2, 3),
    ("Midnight's Children", "Salman Rushdie", "Fiction", 1981, 1, 2),
    ("The Guide", "R. K. Narayan", "Fiction", 1958, 2, 2),
    ("Frankenstein", "Mary Shelley", "Fiction", 1818, 1, 1),
    ("To Kill a Mockingbird", "Harper Lee", "Fiction", 1960, 2, 2),
    ("A Brief History of Time", "Stephen Hawking", "Science", 1988, 2, 3),
    ("The Selfish Gene", "Richard Dawkins", "Science", 1976, 1, 2),
    ("Cosmos", "Carl Sagan", "Science", 1980, 2, 2),
    ("The Gene: An Intimate History", "Siddhartha Mukherjee", "Science", 2016, 1, 2),
    ("The Pragmatic Programmer", "Andrew Hunt and David Thomas", "Technology", 1999, 3, 5),
    ("Clean Code", "Robert C. Martin", "Technology", 2008, 3, 5),
    ("Designing Data-Intensive Applications", "Martin Kleppmann", "Technology", 2017, 2, 6),
    ("Site Reliability Engineering", "Betsy Beyer et al.", "Technology", 2016, 2, 4),
    ("The Phoenix Project", "Gene Kim, Kevin Behr and George Spafford", "Technology", 2013, 2, 4),
    ("Kubernetes: Up and Running", "Brendan Burns, Joe Beda and Kelsey Hightower", "Technology", 2017, 1, 6),
    ("Introduction to Algorithms", "Thomas H. Cormen et al.", "Technology", 1990, 4, 5),
    ("Sapiens", "Yuval Noah Harari", "History", 2011, 2, 4),
    ("The Discovery of India", "Jawaharlal Nehru", "History", 1946, 1, 1),
    ("India After Gandhi", "Ramachandra Guha", "History", 2007, 1, 2),
    ("Wings of Fire", "A. P. J. Abdul Kalam", "Biography", 1999, 2, 3),
    ("The Story of My Experiments with Truth", "M. K. Gandhi", "Biography", 1927, 1, 1),
    ("Thinking, Fast and Slow", "Daniel Kahneman", "Non-fiction", 2011, 2, 3),
    ("Atomic Habits", "James Clear", "Non-fiction", 2018, 1, 6),
    ("Malgudi Days", "R. K. Narayan", "Children", 1943, 2, 1),
    ("Charlotte's Web", "E. B. White", "Children", 1952, 1, 1),
    ("The Elements of Style", "William Strunk Jr. and E. B. White", "Reference", 1959, 2, 1),
]

MEMBERS = [  # name, type
    ("Aarav Sharma", "student"),
    ("Diya Patel", "student"),
    ("Kabir Singh", "student"),
    ("Ananya Iyer", "student"),
    ("Rohan Gupta", "student"),
    ("Meera Nair", "student"),
    ("Ishaan Reddy", "student"),
    ("Sara Khan", "student"),
    ("Kavita Rao", "faculty"),
    ("Arjun Menon", "faculty"),
    ("Neha Joshi", "faculty"),
    ("Vikram Desai", "faculty"),
]

DAYS = 60


def synthetic_isbn(n: int) -> str:
    first12 = f"97893{n:07d}"
    total = sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(first12))
    return first12 + str((10 - total % 10) % 10)


class SimClock:
    def __init__(self, start: datetime):
        self.value = start

    def __call__(self) -> datetime:
        return self.value


def _try(action, db, *args, **kwargs):
    """Run one desk action; a refusal is part of library life, so roll back and carry on."""
    try:
        return action(db, *args, **kwargs)
    except services.DomainError as exc:
        db.rollback()
        return exc


def reset() -> None:
    with engine.begin() as conn:
        for model in (Activity, Hold, Loan, Copy, Member, Book):  # children first
            conn.execute(delete(model))


def simulate(seed: int = 2110) -> dict:
    rng = random.Random(seed)  # noqa: S311 (demo data, not security)
    tz = ZoneInfo(settings.timezone)
    real_now = clock.now()
    opening = (real_now.astimezone(tz) - timedelta(days=DAYS)).replace(hour=9, minute=0, second=0, microsecond=0)
    sim = SimClock(opening)
    original_now = clock.now
    clock.now = sim
    plans: dict[int, dict] = {}  # loan id -> when the member brings it back, and how
    try:
        with SessionLocal() as db:
            book_ids, weights = [], []
            for n, (title, author, genre, year, copies, popularity) in enumerate(BOOKS, start=1):
                data = BookCreate(
                    isbn=synthetic_isbn(n), title=title, author=author, genre=genre, published_year=year, copies=copies
                )
                book_ids.append(services.create_book(db, data).id)
                weights.append(popularity)
            members = []
            for name, kind in MEMBERS:
                sim.value += timedelta(minutes=rng.randint(5, 50))
                email = name.lower().replace(" ", ".") + "@campus.example"
                members.append(services.create_member(db, MemberIn(name=name, email=email, member_type=kind)))

            for day in range(DAYS + 1):
                day_start = opening + timedelta(days=day)
                if day_start > real_now:
                    break
                events = []
                for member in members:
                    chance = 0.16 if member.member_type == "student" else 0.10
                    if rng.random() < chance:
                        events.append(("visit", member.id))
                for loan_id, plan in plans.items():
                    if plan["day"] == day:
                        events.append((plan["action"], loan_id))
                for hold in db.execute(select(Hold).where(Hold.status == "ready")).scalars():
                    if rng.random() < 0.55:
                        events.append(("pickup", hold.id))
                rng.shuffle(events)

                for minute, (kind, ref) in zip(sorted(rng.sample(range(10, 540), len(events))), events, strict=True):
                    at = day_start + timedelta(minutes=minute)
                    if at > real_now:
                        break
                    sim.value = at
                    if kind == "visit":
                        book_id = rng.choices(book_ids, weights=weights)[0]
                        result = _try(services.borrow, db, member_id=ref, book_id=book_id)
                        if isinstance(result, Loan):
                            _plan_return(plans, result, day, rng)
                        elif result.code == "no_copy_available" and rng.random() < 0.6:
                            _try(services.place_hold, db, member_id=ref, book_id=book_id)
                    elif kind == "pickup":
                        hold = db.get(Hold, ref)
                        if hold is not None and hold.status == "ready":
                            result = _try(services.borrow, db, member_id=hold.member_id, book_id=hold.book_id)
                            if isinstance(result, Loan):
                                _plan_return(plans, result, day, rng)
                    elif kind == "renew":
                        result = _try(services.renew, db, ref)
                        if isinstance(result, Loan):
                            plans[ref] = {"day": day + rng.randint(4, 12), "action": "return"}
                        else:  # refused (someone is waiting, or it's overdue): bring it back soon
                            plans[ref] = {"day": day + rng.randint(0, 3), "action": "return"}
                    elif kind == "return":
                        result = _try(services.return_loan, db, ref)
                        if isinstance(result, Loan) and result.fine_amount and rng.random() < 0.5:
                            plans[-ref] = {"day": day + rng.randint(0, 6), "action": "pay"}  # key: -loan id
                    elif kind == "pay":
                        _try(services.pay_fine, db, -ref)

            # The last copy of a popular title went missing a week ago.
            sim.value = real_now - timedelta(days=7)
            lost = db.execute(
                select(Loan)
                .where(Loan.status == "active", Loan.borrowed_at < sim.value - timedelta(days=1))
                .order_by(Loan.borrowed_at)
                .limit(1)
            ).scalar_one_or_none()
            if lost is not None:
                _try(services.mark_lost, db, lost.id)
            sim.value = real_now
            services.expire_all_holds(db)
            return services.stats(db, real_now)
    finally:
        clock.now = original_now


def _plan_return(plans: dict, loan: Loan, day: int, rng: random.Random) -> None:
    period = (loan.due_at - loan.borrowed_at).days
    roll = rng.random()
    if roll < 0.07:  # forgets about it: still out (and overdue) at the end
        plans[loan.id] = {"day": day + period + 30 + rng.randint(0, 20), "action": "return"}
    elif roll < 0.27:  # renews before the due date
        plans[loan.id] = {"day": day + max(1, period - rng.randint(1, 4)), "action": "renew"}
    elif roll < 0.45:  # brings it back late
        plans[loan.id] = {"day": day + period + rng.randint(1, 9), "action": "return"}
    else:  # on time
        plans[loan.id] = {"day": day + rng.randint(2, period), "action": "return"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="delete all library data first")
    args = parser.parse_args()
    if args.reset:
        reset()
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(Book)):
            print("catalogue already has books; nothing to do (use --reset to start over)")
            return
    summary = simulate()
    print("seeded:", ", ".join(f"{k}={v}" for k, v in summary.items() if k != "copies_by_status"))
    print("copies:", summary["copies_by_status"])
    print("rules:", policy.as_dict()["members"])


if __name__ == "__main__":
    main()
