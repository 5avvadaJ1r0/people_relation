import type { ApiPerson, WikiSearchItem } from "./lib/types";

export type SelectedPrincipal = {
  wiki: WikiSearchItem;
  serverPerson?: ApiPerson;
};

export type MainAppTab = "list" | "diagram";
