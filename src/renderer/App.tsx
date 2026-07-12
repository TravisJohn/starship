import { Terminal } from "./components/Terminal";

export const App = (): JSX.Element => {
  return (
    <main className="flex h-screen min-h-0 flex-col bg-slate-950 text-slate-100">
      <header className="flex h-12 shrink-0 items-center border-b border-slate-800 px-4">
        <div>
          <p className="text-sm font-semibold leading-none">Starship</p>
          <p className="mt-1 text-xs leading-none text-slate-400">
            Phase 1 shell diagnostic
          </p>
        </div>
      </header>
      <section className="min-h-0 flex-1">
        <Terminal command="powershell.exe" args={["-NoLogo"]} />
      </section>
    </main>
  );
};
