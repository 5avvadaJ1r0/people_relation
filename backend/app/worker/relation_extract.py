"""
`person.executed_as_master = false` の人物に対し、画面の「関連者を探す」と同じ処理を繰り返すワーカー。

起動例:
  python -m app.worker.relation_extract
  python -m app.worker.relation_extract --once
  RELATION_EXTRACT_SLEEP_SECONDS=30 python -m app.worker.relation_extract
  python -m app.worker.relation_extract --pid-file /tmp/relation_extract.pid
  python -m app.worker.relation_extract --stop --pid-file /tmp/relation_extract.pid
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import signal
import sys
import time
from pathlib import Path

from sqlalchemy.orm import Session

from app import crud
from app.db import SessionLocal, init_db
from app.services.related_search import (
    DEFAULT_MAX_RELATED,
    run_related_search_for_person,
)

log = logging.getLogger(__name__)

_DEFAULT_SLEEP_SECONDS = 10.0
_SLEEP_SECONDS_ENV = "RELATION_EXTRACT_SLEEP_SECONDS"

_shutdown_requested = False


def _default_sleep_seconds() -> float:
    """環境変数 RELATION_EXTRACT_SLEEP_SECONDS から sleep 既定値を返す。"""
    raw = os.environ.get(_SLEEP_SECONDS_ENV)
    if raw is None or not raw.strip():
        return _DEFAULT_SLEEP_SECONDS
    try:
        return float(raw.strip())
    except ValueError as e:
        raise ValueError(
            f"invalid {_SLEEP_SECONDS_ENV}: {raw!r}",
        ) from e


def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def _request_shutdown(signum: int, _frame: object | None) -> None:
    global _shutdown_requested
    _shutdown_requested = True
    log.info("shutdown requested (signal=%s)", signum)


def _write_pid_file(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(os.getpid()), encoding="utf-8")


def _remove_pid_file(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError as e:
        log.warning("failed to remove pid file %s: %s", path, e)


def _stop_worker_via_pid_file(pid_file: Path) -> int:
    if not pid_file.is_file():
        log.error("pid file not found: %s", pid_file)
        return 1
    raw = pid_file.read_text(encoding="utf-8").strip()
    try:
        pid = int(raw)
    except ValueError:
        log.error("invalid pid in %s: %r", pid_file, raw)
        return 1
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        log.error("no process with pid %s", pid)
        return 1
    except PermissionError:
        log.error("permission denied sending SIGTERM to pid %s", pid)
        return 1
    log.info("sent SIGTERM to pid %s", pid)
    return 0


def _should_continue(*, once: bool, max_iterations: int | None, iteration: int) -> bool:
    if _shutdown_requested:
        return False
    if once:
        return iteration < 1
    if max_iterations is not None and iteration >= max_iterations:
        return False
    return True


async def _process_one_person(
    db: Session,
    *,
    max_related: int,
) -> bool:
    """1 件処理。対象が無ければ False。"""
    person = crud.pick_random_person_not_executed_as_master(db)
    if person is None:
        log.info("no person with executed_as_master=false; skipping")
        return False
    log.info(
        "processing person id=%s title=%r name=%r",
        person.id,
        person.title,
        person.name,
    )
    await run_related_search_for_person(db, person, max_related=max_related)
    return True


async def _run_loop(
    *,
    sleep_seconds: float,
    once: bool,
    max_iterations: int | None,
    max_related: int,
) -> int:
    init_db()
    iteration = 0
    while _should_continue(
        once=once, max_iterations=max_iterations, iteration=iteration
    ):
        db = SessionLocal()
        try:
            await _process_one_person(db, max_related=max_related)
        except Exception:
            log.exception("related search failed")
            db.rollback()
        finally:
            db.close()

        iteration += 1
        if not _should_continue(
            once=once, max_iterations=max_iterations, iteration=iteration
        ):
            break
        log.info("sleeping %.1fs before next iteration", sleep_seconds)
        await _async_sleep_interruptible(sleep_seconds)

    log.info("worker finished after %s iteration(s)", iteration)
    return 0


async def _async_sleep_interruptible(seconds: float) -> None:
    """SIGTERM 等で `_shutdown_requested` になったら早期終了する sleep。"""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if _shutdown_requested:
            return
        await asyncio.sleep(min(1.0, end - time.monotonic()))


def _build_parser(*, default_sleep_seconds: float) -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="未実行主体の人物に対し Wikipedia 関連抽出をバックグラウンドで繰り返す",
    )
    p.add_argument(
        "--once",
        action="store_true",
        help="1 件だけ処理して終了する",
    )
    p.add_argument(
        "--max-iterations",
        type=int,
        default=None,
        metavar="N",
        help="最大ループ回数（省略時は無制限）",
    )
    p.add_argument(
        "--sleep",
        type=float,
        default=default_sleep_seconds,
        metavar="SEC",
        help=(
            f"各処理の間隔（秒）。環境変数 {_SLEEP_SECONDS_ENV} でも指定可（CLI が優先）。"
            f" 既定 {_DEFAULT_SLEEP_SECONDS:g}"
        ),
    )
    p.add_argument(
        "--max-related",
        type=int,
        default=DEFAULT_MAX_RELATED,
        metavar="N",
        help=f"抽出する関連者上限（既定 {DEFAULT_MAX_RELATED}）",
    )
    p.add_argument(
        "--pid-file",
        type=Path,
        default=None,
        help="起動時に PID を書き込むパス（--stop と併用）",
    )
    p.add_argument(
        "--stop",
        action="store_true",
        help="--pid-file の PID に SIGTERM を送ってワーカーを停止する",
    )
    return p


def main(argv: list[str] | None = None) -> int:
    _configure_logging()
    try:
        default_sleep = _default_sleep_seconds()
    except ValueError as e:
        log.error("%s", e)
        return 2
    args = _build_parser(default_sleep_seconds=default_sleep).parse_args(argv)

    if args.stop:
        if args.pid_file is None:
            log.error("--stop requires --pid-file")
            return 2
        return _stop_worker_via_pid_file(args.pid_file)

    if args.max_iterations is not None and args.max_iterations < 1:
        log.error("--max-iterations must be >= 1")
        return 2
    if args.sleep < 0:
        log.error("--sleep must be >= 0")
        return 2

    signal.signal(signal.SIGINT, _request_shutdown)
    signal.signal(signal.SIGTERM, _request_shutdown)

    pid_path: Path | None = args.pid_file
    if pid_path is not None:
        _write_pid_file(pid_path)

    try:
        return asyncio.run(
            _run_loop(
                sleep_seconds=args.sleep,
                once=args.once,
                max_iterations=args.max_iterations,
                max_related=args.max_related,
            )
        )
    finally:
        if pid_path is not None:
            _remove_pid_file(pid_path)


if __name__ == "__main__":
    sys.exit(main())
