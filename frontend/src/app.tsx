import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "./features/app/app-layout";
import { AuthLayout } from "./features/auth/auth-layout";
import { LoginPage } from "./features/auth/login-page";
import { MfaPage } from "./features/auth/mfa-page";
import { GradesPage } from "./features/grades/grades-page";
import { OverviewPage } from "./features/overview/overview-page";

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
            <Route path="overview" element={<OverviewPage />} />
            <Route path="grades" element={<GradesPage />} />
          </Route>
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
