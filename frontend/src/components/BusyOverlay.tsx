type BusyOverlayProps = {
  caption: string;
};

export const BusyOverlay = ({ caption }: BusyOverlayProps) => (
  <div
    className="busyOverlay"
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label={caption}
  >
    <div className="busySpinner" aria-hidden />
    <div className="busyOverlayCaption">{caption}</div>
  </div>
);
