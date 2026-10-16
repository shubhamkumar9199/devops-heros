"""Lapse uncollected holds. Run by the Kubernetes CronJob: python -m app.expire_holds"""

from app import services
from app.db import SessionLocal


def main() -> None:
    with SessionLocal() as db:
        expired = services.expire_all_holds(db)
    print(f"expired {expired} uncollected hold(s)", flush=True)


if __name__ == "__main__":
    main()
