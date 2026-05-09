from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # DB接続情報はソースに埋め込まず、必ず環境変数から注入する
    database_url: str
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: str = "http://localhost:8080,http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()  # type: ignore[call-arg]

