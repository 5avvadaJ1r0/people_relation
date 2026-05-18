/**
 * Font Awesome Classic Regular「diagram-project」相当（viewBox 0 0 576 512）
 * @see https://fontawesome.com/icons/classic/regular/diagram-project
 */
const IconDiagramProjectRegular = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 576 512"
    className="principalRelationsDiagramIconSvg"
    fill="none"
    stroke="currentColor"
    strokeWidth={48}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="48" y="32" width="96" height="96" rx="48" />
    <rect x="384" y="32" width="96" height="96" rx="48" />
    <rect x="272" y="288" width="96" height="96" rx="48" />
    <path d="M144 80 H384" />
    <path d="M144 128 V224 H320 V288" />
    <path d="M432 128 V224" />
  </svg>
);

type PrincipalDiagramAddLinkProps = {
  onClick: () => void;
};

export const PrincipalDiagramAddLink = ({ onClick }: PrincipalDiagramAddLinkProps) => (
  <button
    type="button"
    className="principalDiagramAddLink"
    aria-label="相関図に追加"
    title="相関図に追加"
    onClick={onClick}
  >
    <span className="principalDiagramAddLinkIcon" aria-hidden="true">
      <IconDiagramProjectRegular />
    </span>
    <span className="principalDiagramAddLinkLabel">相関図に追加</span>
  </button>
);
