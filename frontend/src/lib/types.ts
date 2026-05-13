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
  executed_as_master_at?: string | null;
};

export type ApiRelation = {
  master: {
    id: number;
    name: string;
    title: string;
    url: string;
    executed_as_master_at?: string | null;
  };
  slave: {
    id: number;
    name: string;
    title: string;
    url: string;
    executed_as_master_at?: string | null;
  };
  point: number;
};

export type DiagramRelationPair = {
  person1: string;
  person2: string;
  total_point: number;
};

export type DiagramCoreNetworkOut = {
  center_titles: string[];
  pairs: DiagramRelationPair[];
};

export type ApiRelationAggregate = {
  master: {
    id: number;
    name: string;
    title: string;
    url: string;
    executed_as_master_at?: string | null;
  };
  slave: {
    id: number;
    name: string;
    title: string;
    url: string;
    executed_as_master_at?: string | null;
  };
  forward_point: number;
  reverse_point: number;
  total_point: number;
};
