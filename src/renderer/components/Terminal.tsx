import { useEffect, useMemo, useRef } from "react";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

type TerminalProps = {
  command: string;
  args?: string[];
  cwd?: string;
};

type TerminalSize = {
  cols: number;
  rows: number;
};

const RESIZE_DEBOUNCE_MS = 90;

export const Terminal = ({
  command,
  args = [],
  cwd = ""
}: TerminalProps): JSX.Element => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionId = useMemo(() => crypto.randomUUID(), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new XTerm({
      cursorBlink: true,
      fontFamily: "Cascadia Mono, Consolas, monospace",
      fontSize: 13,
      scrollback: 8000,
      theme: {
        background: "#020617",
        foreground: "#e2e8f0",
        cursor: "#67e8f9",
        selectionBackground: "#334155"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.focus();

    let disposed = false;
    let spawned = false;
    let resizeTimer: number | undefined;
    let lastSize: TerminalSize = {
      cols: terminal.cols,
      rows: terminal.rows
    };

    const fit = (): TerminalSize => {
      fitAddon.fit();
      return {
        cols: terminal.cols,
        rows: terminal.rows
      };
    };

    const resizePty = (size: TerminalSize): void => {
      if (
        !spawned ||
        disposed ||
        (size.cols === lastSize.cols && size.rows === lastSize.rows)
      ) {
        return;
      }

      lastSize = size;
      void window.starship.pty.resize({
        sessionId,
        cols: size.cols,
        rows: size.rows
      });
    };

    const scheduleResize = (): void => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizePty(fit());
      }, RESIZE_DEBOUNCE_MS);
    };

    const resizeObserver = new ResizeObserver(scheduleResize);
    resizeObserver.observe(container);

    const dataDisposable = terminal.onData((data) => {
      if (spawned && !disposed) {
        void window.starship.pty.write({
          sessionId,
          data
        });
      }
    });

    const unsubscribeData = window.starship.pty.onData((event) => {
      if (event.sessionId === sessionId && !disposed) {
        terminal.write(event.data);
      }
    });

    const unsubscribeExit = window.starship.pty.onExit((event) => {
      if (event.sessionId === sessionId && !disposed) {
        terminal.writeln("");
        terminal.writeln(`[process exited: ${event.exitCode ?? "signal"}]`);
      }
    });

    requestAnimationFrame(() => {
      const initialSize = fit();
      lastSize = initialSize;
      void window.starship.pty
        .spawn({
          sessionId,
          command,
          args,
          cwd,
          cols: initialSize.cols,
          rows: initialSize.rows
        })
        .then(() => {
          spawned = true;
        })
        .catch((error: unknown) => {
          terminal.writeln(String(error));
        });
    });

    return () => {
      disposed = true;
      window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      unsubscribeData();
      unsubscribeExit();
      void window.starship.pty.kill({ sessionId });
      terminal.dispose();
    };
  }, [args, command, cwd, sessionId]);

  return (
    <div className="h-full min-h-0 w-full overflow-hidden bg-slate-950">
      <div ref={containerRef} className="h-full w-full p-3" />
    </div>
  );
};
