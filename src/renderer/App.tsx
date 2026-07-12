import type { Project } from "../shared/ipc";
import { Shelf } from "./components/Shelf";

export const App = (): JSX.Element => {
  const launchProject = (_project: Project): void => {
    // T5 wires this handoff to a real Claude Code terminal session.
  };

  return (
    <main className="h-screen min-h-0 bg-zinc-950">
      <Shelf onLaunch={launchProject} />
    </main>
  );
};
