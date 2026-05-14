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
  wikiDisplayNameCounts: Map<string, number>;
  wikiEmptyMessage: string | null;
};

/** リスト左カード用（検索 + 選択で詳細へ） */
export type PeopleRelationListSearchPanelModel = PeopleRelationPrincipalSearchModel & {
  onSelect: (item: WikiSearchItem) => void;
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
  onAddPrincipalToDiagram: () => void;
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
