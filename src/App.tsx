import { navigate, useRoute, type Route } from "@/lib/router";
import { useAppearanceEffect } from "@/hooks/useAppearance";
import { Landing } from "@/components/Landing";
import { Reader } from "@/components/reader/Reader";
import { ErrorState } from "@/components/ErrorState";
import { LogoMark } from "@/components/icons";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ListingIndicator } from "@/components/LocalFolder";
import { ProjectGitHubLink } from "@/components/ProjectGitHubLink";

function RouteView({ route }: Readonly<{ route: Route }>) {
  if (route.kind === "landing") return <Landing />;
  if (route.kind === "invalid") {
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-12 items-center border-b border-border bg-surface px-3">
          <button type="button" onClick={() => navigate("/")} aria-label="CoderImpact home" className="rounded p-1 hover:bg-surface-2 cursor-pointer">
            <LogoMark className="size-5 text-foreground" />
          </button>
          <ProjectGitHubLink className="ml-auto" />
        </header>
        <ErrorState error={route.error} />
      </div>
    );
  }
  return <Reader key={`${route.parsed.owner}/${route.parsed.repo}`.toLowerCase()} parsed={route.parsed} />;
}

export function App() {
  useAppearanceEffect();
  const route = useRoute();
  return (
    <TooltipProvider>
      <RouteView route={route} />
      <ListingIndicator />
    </TooltipProvider>
  );
}
