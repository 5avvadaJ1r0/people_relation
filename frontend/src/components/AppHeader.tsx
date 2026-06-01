import urlQrCodeSvg from "../assets/images/svg/url-qr-code.svg";
import { SITE_NAME } from "../lib/siteSeo";

export const AppHeader = () => (
  <header className="header">
    <div>
      <p className="siteBrand">{SITE_NAME}</p>
      <h1 className="title">有名人・著名人の関係者・相関図</h1>
      <p className="subtitle">
        有名人・著名人の関係者・関連者をWikipediaからリストアップし、相関図でつながりを可視化するWebツールです
      </p>
    </div>
    <div className="headerQr" aria-hidden="true">
      <img src={urlQrCodeSvg} alt="" width={68} height={68} />
    </div>
  </header>
);
