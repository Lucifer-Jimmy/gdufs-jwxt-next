import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useEffect } from "react";
import {
  NavLink,
  Outlet,
  useNavigate,
  type To,
} from "react-router-dom";

import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { getPersonalInfo, isAuthError, logout } from "../../lib/api";

const NAV_ITEMS: ReadonlyArray<{ to: To; label: string; end?: boolean }> = [
  { to: "/overview", label: "概览" },
  { to: "/grades", label: "成绩" },
];

/** 任何查询返回认证错误时，统一回到登录页并说明原因。 */
export function useAuthRedirect(error: unknown): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (isAuthError(error)) {
      void navigate("/", {
        replace: true,
        state: { authNotice: "登录状态已过期，请重新登录。" },
      });
    }
  }, [error, navigate]);
}

export function usePersonalInfo() {
  return useQuery({
    queryKey: ["me"],
    queryFn: getPersonalInfo,
    staleTime: 5 * 60 * 1_000,
    refetchOnWindowFocus: false,
  });
}

export function AppLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = usePersonalInfo();
  useAuthRedirect(me.error);

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSettled: () => {
      // 无论退出请求成功与否都清空本地内存数据并回到登录页；
      // 后端始终幂等清除 Cookie。
      queryClient.clear();
      void navigate("/", { replace: true });
    },
  });

  const person = me.data;
  const fatalError =
    me.isError && !isAuthError(me.error)
      ? me.error instanceof Error
        ? me.error
        : undefined
      : undefined;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-header-top">
            <NavLink className="brand" to="/overview" aria-label="学业概览">
              <span className="brand-mark" aria-hidden="true">
                G
              </span>
              <span>JWXT Next</span>
            </NavLink>
            <div className="app-user">
              {person ? (
                <span className="app-user-name" title={person.studentId}>
                  {person.name}
                </span>
              ) : (
                <Skeleton className="h-5 w-16" aria-hidden="true" />
              )}
              <Button
                variant="ghost"
                size="icon"
                className="app-logout"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                aria-label="退出登录"
              >
                <LogOut aria-hidden="true" />
                <span className="app-logout-text">退出</span>
              </Button>
            </div>
          </div>
          <nav className="app-nav" aria-label="主导航">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.end ?? false}
                className={({ isActive }) =>
                  isActive ? "app-nav-link is-active" : "app-nav-link"
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="app-main">
        {me.isPending ? (
          <div className="page-stack" aria-label="正在加载">
            <Skeleton className="h-9 w-44" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : fatalError ? (
          <div className="page-stack page-narrow" role="alert">
            <h1 className="page-title">暂时无法进入</h1>
            <Alert>
              <p>{fatalError.message || "个人信息加载失败，请稍后重试。"}</p>
            </Alert>
            <div className="page-actions">
              <Button onClick={() => void me.refetch()}>重新加载</Button>
              <Button
                variant="outline"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              >
                退出登录
              </Button>
            </div>
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
