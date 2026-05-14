import type { Dispatch, RefObject, SetStateAction } from "react";
import type { MainAppTab, SelectedPrincipal } from "./appScreenTypes";
import type { AppProgress } from "./hooks/peopleRelationApp/useAppBusyProgress";
import type { ApiPerson, RelationView, WikiSearchItem } from "./lib/types";

/** 主体者検索フェーズ（Wikipedia / サーバー検索） */
export type PeopleRelationPrincipalSearchModel = {
  query: string;
  setQuery: (value: string) => void;
  queryInputRef: RefObject<HTMLInputElement | null>;
  onSearch: (queryOverride?: string) => void | Promise<void>;
  hasSearched: boolean;
  wikiResults: WikiSearchItem[];
  /** Wikipedia の pageid → `POST /person/resolve_wiki_masters` で突合した主体者（相関図リンク用） */
  wikiMastersByPageId: Readonly<Partial<Record<number, ApiPerson>>>;
  wikiDisplayNameCounts: Map<string, number>;
  wikiEmptyMessage: string | null;
};

/** リスト左カード用（検索 + 選択で詳細へ） */
export type PeopleRelationListSearchPanelModel = PeopleRelationPrincipalSearchModel & {
  onSelect: (item: WikiSearchItem) => void;
  /** ❷ の Wikipedia 行ごと。仕様: (1) 検索突合で主体者実行済み (2)(3) 当該行が選択中かつ関連者1名以上かつ相関図投入可能 */
  getDiagramPersonIfReadyForWikiRow: (item: WikiSearchItem) => ApiPerson | undefined;
  onAddWikiRowPersonToDiagram: (person: ApiPerson) => void;
};

export type PeopleRelationAppBusyModel = {
  busy: boolean;
  progress: AppProgress;
  isSearchProgress: boolean;
  progressPct: number;
  busyOverlayCaption: string;
};

/** 主体者詳細・関連者一覧 */
export type PeopleRelationPrincipalDetailModel = {
  detailRef: RefObject<HTMLDivElement | null>;
  selected: SelectedPrincipal | null;
  masterLabel: string;
  source: "server" | "wikipedia" | "";
  masterExecutedAtLabel: string | null;
  /** Wikipedia 抽出後に `POST /relation` が成功した（主体者として保存済み） */
  principalRelationPostSaved: boolean;
  excludeZeroReverse: boolean;
  setExcludeZeroReverse: (value: boolean) => void;
  displayRelations: RelationView[];
  relations: RelationView[];
  resetDetail: () => void;
  loadFromServer: (p: ApiPerson) => void | Promise<void>;
  extractFromWikipedia: (title: string) => void | Promise<void>;
};

export type PeopleRelationNavModel = {
  mainTab: MainAppTab;
  setMainTab: Dispatch<SetStateAction<MainAppTab>>;
  diagramQueueCenterPerson: { person: ApiPerson; requestId: number } | null;
  onDiagramQueueCenterPersonApplied: () => void;
  onAddRelatedPersonToDiagram: (person: ApiPerson) => void;
  /** 相関図タブから「関連者リストアップ」タブへ切替え、主体者入力欄に `query` を反映する */
  onOpenListTabWithPrincipalQuery: (query: string) => void;
};

export type PeopleRelationSearchActionsModel = Pick<
  PeopleRelationPrincipalSearchModel,
  "setQuery" | "onSearch"
>;

/** アプリ全体の ViewModel（画面コンポーネントへはこの単位で渡す） */
export type PeopleRelationAppModel = {
  error: string | null;
  nav: PeopleRelationNavModel;
  appBusy: PeopleRelationAppBusyModel;
  listSearch: PeopleRelationListSearchPanelModel;
  principalDetail: PeopleRelationPrincipalDetailModel;
};
