import { useQuery } from "@tanstack/react-query";

import { getGrades } from "../../lib/api";

/**
 * 全量成绩查询，供概览与成绩页共享同一份内存缓存。
 * 独立成模块是为了让两个页面可以路由级分包，互不把对方的
 * 重组件（如 Recharts）拉进自己的 chunk。
 */
export function useGrades() {
  return useQuery({
    queryKey: ["grades"],
    queryFn: getGrades,
    staleTime: 10 * 60 * 1_000,
    refetchOnWindowFocus: false,
  });
}
