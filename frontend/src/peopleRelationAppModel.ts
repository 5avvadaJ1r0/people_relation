import type { Dispatch, RefObject, SetStateAction } from "react";
import type { MainAppTab, SelectedPrincipal } from "./appScreenTypes";
import type { ApiPerson, RelationView } from "./lib/types";

/** 主体者入力（person.name 部分一致サジェスト） */
export type PeopleRelationPrincipalSearchModel = {
  query: string;
  setQuery: (value: string) => void;
  queryInputRef: RefObject<HTMLInputElement | null>;
  matches: ApiPerson[];
  suggestFetched: boolean;
  suggestFocused: boolean;
  setSuggestFocused: (focused: boolean) => void;
  suggestPanelOpen: boolean;
  highlightIdx: number;
  setHighlightIdx: Dispatch<SetStateAction<number>>;
  clearQuery: () => void;
  minSuggestQueryLen: number;
};

/** リスト左カード用（サジェスト + 選択で詳細へ） */
export type PeopleRelationListSearchPanelModel = PeopleRelationPrincipalSearchModel & {
  onSelectPerson: (person: ApiPerson) => void | Promise<void>;
};

/** 主体者詳細・関連者一覧 */
export type PeopleRelationPrincipalDetailModel = {
  detailRef: RefObject<HTMLDivElement | null>;
  selected: SelectedPrincipal | null;
  masterLabel: string;
  masterExecutedAtLabel: string | null;
  excludeZeroReverse: boolean;
  setExcludeZeroReverse: (value: boolean) => void;
  displayRelations: RelationView[];
  relations: RelationView[];
  resetDetail: () => void;
};

export type PeopleRelationNavModel = {
  mainTab: MainAppTab;
  setMainTab: Dispatch<SetStateAction<MainAppTab>>;
  diagramCenter: ApiPerson[];
  setDiagramCenter: Dispatch<SetStateAction<ApiPerson[]>>;
  diagramCenterPersonIds: ReadonlySet<number>;
  onAddRelatedPersonToDiagram: (person: ApiPerson) => void;
  onAddRelatedPersonsToDiagram: (persons: ApiPerson[]) => void;
  onRemoveRelatedPersonFromDiagram: (personId: number) => void;
  /** 相関図タブから「関連者リストアップ」タブへ切替え、主体者入力欄に `query` を反映する */
  onOpenListTabWithPrincipalQuery: (query: string) => void;
};

/** アプリ全体の ViewModel（画面コンポーネントへはこの単位で渡す） */
export type PeopleRelationAppModel = {
  error: string | null;
  nav: PeopleRelationNavModel;
  listSearch: PeopleRelationListSearchPanelModel;
  principalDetail: PeopleRelationPrincipalDetailModel;
};
