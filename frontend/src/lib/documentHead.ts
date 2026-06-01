const queryMeta = (selector: string): HTMLMetaElement | null => {
  const el = document.head.querySelector(selector);
  return el instanceof HTMLMetaElement ? el : null;
};

const queryLink = (selector: string): HTMLLinkElement | null => {
  const el = document.head.querySelector(selector);
  return el instanceof HTMLLinkElement ? el : null;
};

/** head 内の meta を作成または content を更新する */
export const upsertMeta = (
  attr: "name" | "property",
  key: string,
  content: string,
): void => {
  const selector =
    attr === "name" ? `meta[name="${key}"]` : `meta[property="${key}"]`;
  let el = queryMeta(selector);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
};

/** head 内の link を作成または href を更新する */
export const upsertLink = (rel: string, href: string): void => {
  const selector = `link[rel="${rel}"]`;
  let el = queryLink(selector);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
};
