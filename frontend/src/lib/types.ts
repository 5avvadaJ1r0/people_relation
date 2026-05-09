export type WikiSearchItem = {
  title: string;
  pageid: number;
  snippet?: string;
};

export type PersonRef = {
  name: string;
  url: string;
  title?: string;
};

export type RelationIn = {
  master: PersonRef;
  slave: PersonRef;
  point: number;
};

export type RelationView = {
  slave: PersonRef;
  forwardPoint: number;
  reversePoint: number;
  totalPoint: number;
  hasWikiPage: boolean;
};

export type ApiPerson = {
  id: number;
  name: string;
  title: string;
  url: string;
  has_relations: boolean;
};

export type ApiRelation = {
  master: { id: number; name: string; title: string; url: string };
  slave: { id: number; name: string; title: string; url: string };
  point: number;
};

export type ApiRelationAggregate = {
  master: { id: number; name: string; title: string; url: string };
  slave: { id: number; name: string; title: string; url: string };
  forward_point: number;
  reverse_point: number;
  total_point: number;
};

export type ApiWikiHuman = {
  title: string;
  qid: string | null;
  is_human: boolean;
  source: string;
};

