-- PostgreSQL DDL for people_relation
-- 既存データを捨てて作り直す前提の定義

BEGIN;

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

CREATE INDEX idx_relation_master_person_id ON relation(master_person_id);
CREATE INDEX idx_relation_slave_person_id ON relation(slave_person_id);

COMMIT;

