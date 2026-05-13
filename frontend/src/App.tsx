import { usePeopleRelationApp } from "./hooks/usePeopleRelationApp";
import { PeopleRelationAppView } from "./components/PeopleRelationAppView";

export const App = () => (
  <PeopleRelationAppView {...usePeopleRelationApp()} />
);
