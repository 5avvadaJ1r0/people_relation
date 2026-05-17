import type { ApiPerson } from "./lib/types";

export type SelectedPrincipal = {
  serverPerson: ApiPerson;
};

export type MainAppTab = "list" | "diagram";
