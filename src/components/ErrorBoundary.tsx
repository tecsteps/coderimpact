import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { hrefFor } from "@/lib/router";

interface State {
  error: Error | null;
}

/** Last line of defense: a friendly page with a reload instead of a blank screen. */
export class ErrorBoundary extends Component<Readonly<{ children: ReactNode }>, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-[var(--app-h,100dvh)] flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <h1 className="text-[18px] font-semibold text-foreground">Something went wrong</h1>
        <p className="max-w-md text-[13.5px] text-muted-foreground">
          Coderimpact ran into an unexpected problem while showing this page. Reloading usually helps; your settings and cached files are kept.
        </p>
        <p className="max-w-md truncate font-mono text-[11.5px] text-subtle-foreground">{this.state.error.message}</p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => window.location.reload()}>
            <RefreshCw /> Reload
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.assign(hrefFor("/"))}>
            Start page
          </Button>
        </div>
      </main>
    );
  }
}
