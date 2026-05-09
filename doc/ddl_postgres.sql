-- PostgreSQL DDL for people_relation
-- 既存データを捨てて作り直す前提の定義

BEGIN;

-- person.name の中間一致検索 (ILIKE '%xxx%') を GIN で高速化するために必要。
-- 通常の B-tree では中間一致を扱えないため、数百万件規模では必須。
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DROP TABLE IF EXISTS relation;
DROP TABLE IF EXISTS person;

CREATE TABLE person (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  url VARCHAR(1000) NOT NULL UNIQUE,
  executed_as_master BOOLEAN NOT NULL DEFAULT FALSE,
  executed_as_master_at TIMESTAMP NULL,
  created TIMESTAMP NOT NULL DEFAULT now(),
  updated TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE relation (
  id BIGSERIAL PRIMARY KEY,
  master_person_id BIGINT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  slave_person_id BIGINT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  point INTEGER NOT NULL,
  created TIMESTAMP NOT NULL DEFAULT now(),
  updated TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT uq_relation_master_slave UNIQUE (master_person_id, slave_person_id)
);

-- person.name の部分一致検索 (search_persons) 用 GIN インデックス。
CREATE INDEX idx_person_name_trgm ON person USING gin (name gin_trgm_ops);

-- master_person_id でフィルタしつつ point DESC, id ASC で Top-N を取得するクエリ用。
-- 単独カラムの idx_relation_master_person_id を兼ねるため、こちらに統合する。
-- これにより ORDER BY のためのソート処理が不要になり、インデックスだけで Top-N が決まる。
CREATE INDEX idx_relation_master_point ON relation(master_person_id, point DESC, id ASC);

-- 逆方向リレーション (slave -> master) の JOIN/検索用。
-- 単独カラムの idx_relation_slave_person_id を兼ねるため、こちらに統合する。
CREATE INDEX idx_relation_slave_master ON relation(slave_person_id, master_person_id);

COMMIT;

