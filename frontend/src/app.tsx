import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { Skeleton } from "./components/ui/skeleton";
import { AppLayout } from "./features/app/app-layout";
import { AuthLayout } from "./features/auth/auth-layout";
import { LoginPage } from "./features/auth/login-page";
import { MfaPage } from "./features/auth/mfa-page";

// 登录后的页面按需加载：Recharts 只随概览页进入对应 chunk
const OverviewPage = lazy(() =>
  import("./features/overview/overview-page").then((module) => ({
    default: module.OverviewPage,
  })),
);
const GradesPage = lazy(() =>
  import("./features/grades/grades-page").then((module) => ({
    default: module.GradesPage,
  })),
);

function PageFallback() {
  return (
    <div className="page-stack" aria-label="正在加载">
      <Skeleton className="h-9 w-44" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 0,
            gcTime: 10 * 60 * 1000,
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AuthLayout />}>
            <Route index element={<LoginPage />} />
            <Route path="mfa" element={<MfaPage />} />
          </Route>
          <Route element={<AppLayout />}>
            <Route
              path="overview"
              element={
                <Suspense fallback={<PageFallback />}>
                  <OverviewPage />
                </Suspense>
              }
            />
            <Route
              path="grades"
              element={
                <Suspense fallback={<PageFallback />}>
                  <GradesPage />
                </Suspense>
              }
            />
          </Route>
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
