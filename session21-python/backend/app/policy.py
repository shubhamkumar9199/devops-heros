"""Lending rules. The API publishes these at /api/info so the UI never hardcodes them.

The status lists are also enforced by CHECK constraints in the migrations; change
both together.
"""

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class MemberPolicy:
    max_loans: int
    loan_days: int


MEMBER_POLICIES = {
    "student": MemberPolicy(max_loans=3, loan_days=14),
    "faculty": MemberPolicy(max_loans=6, loan_days=28),
}
MEMBER_TYPES = tuple(MEMBER_POLICIES)

MAX_RENEWALS = 2
FINE_PER_DAY = 5  # rupees for each day (or part of a day) a loan is late
FINE_CAP = 200  # rupees, the most one late return can cost
LOST_FEE = 500  # rupees, replacement fee for a copy reported lost
FINE_BLOCK_AT = 100  # unpaid fines at or above this block borrowing, renewals and holds
HOLD_PICKUP_DAYS = 3  # how long a returned copy waits on the hold shelf

GENRES = (
    "Fiction",
    "Non-fiction",
    "Science",
    "Technology",
    "History",
    "Biography",
    "Children",
    "Reference",
)
COPY_CONDITIONS = ("new", "good", "worn", "damaged")
COPY_STATUSES = ("available", "on_loan", "on_hold_shelf", "lost", "withdrawn")
LOAN_STATUSES = ("active", "returned", "lost")
HOLD_STATUSES = ("waiting", "ready", "fulfilled", "cancelled", "expired")


def as_dict() -> dict:
    return {
        "members": {kind: asdict(rule) for kind, rule in MEMBER_POLICIES.items()},
        "max_renewals": MAX_RENEWALS,
        "fine_per_day": FINE_PER_DAY,
        "fine_cap": FINE_CAP,
        "lost_fee": LOST_FEE,
        "fine_block_at": FINE_BLOCK_AT,
        "hold_pickup_days": HOLD_PICKUP_DAYS,
        "currency": "INR",
        "genres": list(GENRES),
        "copy_conditions": list(COPY_CONDITIONS),
    }
