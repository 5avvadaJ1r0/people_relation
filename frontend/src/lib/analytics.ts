/** GTM が参照する dataLayer へイベントを送る（index.html で dataLayer を初期化済み） */

export type PrincipalInputPhase1Payload = {
  query_char_count: number;
  wiki_result_count: number;
  server_match_count: number;
};

export type RelatedSearchPhase2Payload = {
  source: "wikipedia" | "server";
  relation_count: number;
  master_title: string;
};

const pushToDataLayer = (obj: Record<string, unknown>) => {
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push(obj);
};

export const trackPrincipalInputPhase1 = (payload: PrincipalInputPhase1Payload) => {
  pushToDataLayer({
    event: "pr_phase1_principal_input",
    ...payload,
  });
};

export const trackRelatedSearchPhase2 = (payload: RelatedSearchPhase2Payload) => {
  pushToDataLayer({
    event: "pr_phase2_related_search",
    ...payload,
  });
};
