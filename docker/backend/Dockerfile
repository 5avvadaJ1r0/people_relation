# 3.14 では pydantic-core 等の manylinux ホイールが揃わず、slim イメージで gcc/Rust ビルドが必要になる。
# 本リポジトリの backend は 3.12 想定（.venv / CI と整合）。
FROM python:3.14-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN pip install --no-cache-dir -U pip

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app /app/app

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
