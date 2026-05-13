import urlQrCodeSvg from "../assets/images/svg/url-qr-code.svg";

export const AppHeader = () => (
  <div className="header">
    <div>
      <div className="title">著名人関連者リストアップ・相関図作成</div>
      <div className="subtitle">
        ネット上から著名人の関連者をリストアップし、相関図を作成するツールです
      </div>
    </div>
    <div className="headerQr" aria-hidden="true">
      <img src={urlQrCodeSvg} alt="" width={68} height={68} />
    </div>
  </div>
);
