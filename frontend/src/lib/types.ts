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

export type ApiPerson = {
  id: number;
  name: string;
  title: string;
  url: string;
  /** `relation` に主体（master）として少なくとも 1 行ある */
  has_relations: boolean;
  /** 主体者として `POST /relation`（executed_master_url 付き等）で実行済みフラグ */
  is_executed_master: boolean;
  executed_as_master_at?: string | null;
};

export type RelationView = {
  slave: PersonRef;
  /** サーバーまたは POST 直後の関連者行に限り。`is_executed_master` が真なら相関図の中心に追加可能 */
  slavePerson?: ApiPerson;
  forwardPoint: number;
  reversePoint: number;
  totalPoint: number;
  hasWikiPage: boolean;
};

export type ApiRelation = {
  master: {
    id: number;
    name: string;
    title: string;
    url: string;
    has_relations: boolean;
    is_executed_master: boolean;
    executed_as_master_at?: string | null;
  };
  slave: {
    id: number;
    name: string;
    title: string;
    url: string;
    has_relations: boolean;
    is_executed_master: boolean;
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
    has_relations: boolean;
    is_executed_master: boolean;
    executed_as_master_at?: string | null;
  };
  slave: {
    id: number;
    name: string;
    title: string;
    url: string;
    has_relations: boolean;
    is_executed_master: boolean;
    executed_as_master_at?: string | null;
  };
  forward_point: number;
  reverse_point: number;
  total_point: number;
};
