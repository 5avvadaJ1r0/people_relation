from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_REPO_ROOT = Path(__file__).resolve().parents[2]
_ENV_FILES = (_REPO_ROOT / ".env", _REPO_ROOT / "backend" / ".env")


class Settings(BaseSettings):
    # Docker Compose 用の postgres_* など、アプリが使わない .env キーを許容する
    model_config = SettingsConfigDict(
        env_file=_ENV_FILES,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # DB接続情報はソースに埋め込まず、必ず環境変数から注入する
    database_url: str
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: str = "http://localhost:8080,http://localhost:5173"
    # Fernet 用 URL-safe base64 32-byte key（`cryptography.fernet.Fernet.generate_key()`）
    diagram_share_secret_key: str = ""
    # 共有 URL・OG のリンク先（末尾スラッシュなし）
    public_app_url: str = "http://localhost:5173"
    # OG 画像など API 絶対 URL のベース（末尾スラッシュなし、パスに `/api` を含む）
    public_api_url: str = "http://localhost:5173/api"
    # Wikipedia / Wikidata への outgoing Client User-Agent（公開運用時は連絡先付きURLを設定すること）
    wikipedia_user_agent: str = (
        "people_relation/1.0 (+https://example.com/; contact: set-WIKIPEDIA_USER_AGENT)"
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()  # type: ignore[call-arg]
