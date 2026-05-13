import type { MainAppTab } from "../appScreenTypes";

type MainTabBarProps = {
  mainTab: MainAppTab;
  onTabChange: (tab: MainAppTab) => void;
};

export const MainTabBar = ({ mainTab, onTabChange }: MainTabBarProps) => (
  <nav className="mainTabBar" aria-label="機能の切り替え">
    <div className="mainTabList" role="tablist">
      <button
        type="button"
        role="tab"
        id="main-tab-list"
        aria-selected={mainTab === "list"}
        aria-controls="main-panel-list"
        tabIndex={mainTab === "list" ? 0 : -1}
        className={`mainTab ${mainTab === "list" ? "mainTabActive" : ""}`}
        onClick={() => onTabChange("list")}
      >
        関連者リストアップ
      </button>
      <button
        type="button"
        role="tab"
        id="main-tab-diagram"
        aria-selected={mainTab === "diagram"}
        aria-controls="main-panel-diagram"
        tabIndex={mainTab === "diagram" ? 0 : -1}
        className={`mainTab ${mainTab === "diagram" ? "mainTabActive" : ""}`}
        onClick={() => onTabChange("diagram")}
      >
        相関図作成
      </button>
    </div>
  </nav>
);
