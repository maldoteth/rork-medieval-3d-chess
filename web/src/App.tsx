import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import Index from "./pages/Index";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          {/*
            DEHUB PATCH (2 of 3) — see public/chess-game/README.md in the
            dehubweb repo.

            Upstream mounts the game at `path="/"` and everything else at
            NotFound. dehub.io serves this build from the subpath
            `/chess-game/index.html`, which matched the catch-all instead: the
            iframe rendered "Oops! Page not found" and no game at all.

            The game is a single screen with no routes of its own, so the
            honest fix is to let any path render it. `basename` would work too,
            but only for one hard-coded mount point, and it would break the
            standalone dev server at `/`.
          */}
          <Route path="*" element={<Index />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
