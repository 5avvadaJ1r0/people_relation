from __future__ import annotations

from app import crud
from app.db import SessionLocal
from app.schemas import PersonOut, RelationIn, RelationOut


def save_relations_batch(
    payload: list[RelationIn],
    *,
    executed_master_url: str | None,
) -> list[RelationOut]:
    db = SessionLocal()
    try:
        out: list[RelationOut] = []
        for item in payload:
            master = crud.upsert_person(db, name=item.master.name, url=item.master.url, title=item.master.title)
            slave = crud.upsert_person(db, name=item.slave.name, url=item.slave.url, title=item.slave.title)
            rel = crud.upsert_relation(db, master_id=master.id, slave_id=slave.id, point=item.point)
            out.append(
                RelationOut(
                    master=PersonOut(id=master.id, name=master.name, title=master.title, url=master.url),
                    slave=PersonOut(id=slave.id, name=slave.name, title=slave.title, url=slave.url),
                    point=rel.point,
                )
            )

        # 逆向き(slave->master)も一緒に保存しているため、今回の「主体者」を明示的に渡してもらい
        # その人物のみ「主体者として実行済み」フラグを立てる。
        if executed_master_url:
            crud.mark_executed_as_master_by_url(db, url=executed_master_url)
        db.commit()
        return out
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
