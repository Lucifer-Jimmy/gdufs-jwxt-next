import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import {
  courseAttributesOf,
  filterGrades,
  formatCredits,
  isFailingGrade,
  semestersOf,
  sortGrades,
  type GradeFilter,
  type GradeSortKey,
  type SortDirection,
} from "../../lib/academics";
import {
  ApiError,
  getGradeDetail,
  isAuthErrorCode,
  refreshGrades,
  type Grade,
  type GradeDetail,
} from "../../lib/api";
import { downloadGradesCsv, downloadGradesExcel } from "../../lib/export";
import { cn } from "../../lib/utils";
import { useAuthRedirect } from "../app/app-layout";
import { useGrades } from "../app/use-grades";

function useRefreshCooldown(): [number, (seconds: number) => void] {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (remaining <= 0) {
      return;
    }
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1_000);
    return () => clearTimeout(timer);
  }, [remaining]);
  return [remaining, setRemaining];
}

export function GradesPage() {
  const queryClient = useQueryClient();
  const gradesQuery = useGrades();
  useAuthRedirect(gradesQuery.error);

  const [filter, setFilter] = useState<GradeFilter>({
    semester: null,
    courseAttribute: null,
  });
  const [sortKey, setSortKey] = useState<GradeSortKey | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [detailGrade, setDetailGrade] = useState<Grade | null>(null);
  const [exportError, setExportError] = useState<string>();
  const [exporting, setExporting] = useState(false);
  const [cooldown, startCooldown] = useRefreshCooldown();

  const refresh = useMutation({
    mutationFn: refreshGrades,
    onSuccess: (data) => {
      queryClient.setQueryData(["grades"], {
        grades: data.grades,
        reachedPageLimit: data.reachedPageLimit,
      });
      startCooldown(data.retryAfterSeconds);
    },
  });
  useAuthRedirect(refresh.error);

  const grades = useMemo(() => gradesQuery.data?.grades ?? [], [gradesQuery.data]);
  const semesters = useMemo(() => semestersOf(grades), [grades]);
  const attributes = useMemo(() => courseAttributesOf(grades), [grades]);
  const visible = useMemo(
    () => sortGrades(filterGrades(grades, filter), sortKey, sortDirection),
    [grades, filter, sortKey, sortDirection],
  );

  const refreshError =
    refresh.error instanceof ApiError &&
    !isAuthErrorCode(refresh.error.code)
      ? refresh.error
      : undefined;

  function toggleSort(key: GradeSortKey) {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("desc");
    }
  }

  async function handleExport(kind: "csv" | "excel") {
    setExportError(undefined);
    setExporting(true);
    try {
      const now = new Date();
      if (kind === "csv") {
        downloadGradesCsv(visible, now);
      } else {
        await downloadGradesExcel(visible, now);
      }
    } catch {
      setExportError("导出未能完成，请重试。");
    } finally {
      setExporting(false);
    }
  }

  if (gradesQuery.isPending) {
    return (
      <div className="page-stack" aria-label="正在加载成绩">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (gradesQuery.isError) {
    const error =
      gradesQuery.error instanceof ApiError ? gradesQuery.error : undefined;
    return (
      <div className="page-stack page-narrow">
        <h1 className="page-title">成绩查询</h1>
        <Alert>
          <p>{error?.message ?? "成绩加载失败，请稍后重试。"}</p>
          {error ? (
            <p className="request-id">请求编号：{error.requestId}</p>
          ) : null}
        </Alert>
        <div className="page-actions">
          <Button onClick={() => void gradesQuery.refetch()}>重新加载</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <header className="page-heading">
        <h1 className="page-title">成绩查询</h1>
        <p className="page-subtitle">
          共 {grades.length} 门课程
          {visible.length !== grades.length
            ? `，当前筛选 ${visible.length} 门`
            : ""}
        </p>
      </header>

      {gradesQuery.data?.reachedPageLimit ? (
        <Alert>
          <p>成绩记录达到单页获取上限，当前数据可能不完整，请稍后手动刷新重试。</p>
        </Alert>
      ) : null}
      {refreshError ? (
        <Alert>
          <p>{refreshError.message}</p>
          <p className="request-id">请求编号：{refreshError.requestId}</p>
        </Alert>
      ) : null}
      {exportError ? <Alert>{exportError}</Alert> : null}

      <div className="grades-toolbar">
        <div className="grades-filters">
          <Select
            value={filter.semester ?? "all"}
            onValueChange={(value) =>
              setFilter((current) => ({
                ...current,
                semester: value === "all" ? null : value,
              }))
            }
          >
            <SelectTrigger aria-label="按学期筛选" className="grades-filter">
              <SelectValue placeholder="全部学期" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部学期</SelectItem>
              {semesters.map((semester) => (
                <SelectItem key={semester} value={semester}>
                  {semester}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filter.courseAttribute ?? "all"}
            onValueChange={(value) =>
              setFilter((current) => ({
                ...current,
                courseAttribute: value === "all" ? null : value,
              }))
            }
          >
            <SelectTrigger aria-label="按课程属性筛选" className="grades-filter">
              <SelectValue placeholder="全部属性" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部属性</SelectItem>
              {attributes.map((attribute) => (
                <SelectItem key={attribute} value={attribute}>
                  {attribute}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grades-actions">
          <Button
            variant="outline"
            className="grades-action"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending || cooldown > 0}
            aria-label={
              cooldown > 0 ? `刷新冷却中，${cooldown} 秒后可用` : "刷新成绩"
            }
            title={cooldown > 0 ? `${cooldown} 秒后可再次刷新` : "刷新成绩"}
          >
            {refresh.isPending ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" />
            )}
            <span className="grades-action-text">
              {cooldown > 0 ? `${cooldown}s` : "刷新"}
            </span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="grades-action"
                disabled={exporting || visible.length === 0}
                aria-label="导出当前列表"
              >
                {exporting ? (
                  <LoaderCircle className="spin" aria-hidden="true" />
                ) : (
                  <Download aria-hidden="true" />
                )}
                <span className="grades-action-text">导出</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void handleExport("excel")}>
                <FileSpreadsheet aria-hidden="true" />
                导出 Excel（当前列表）
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleExport("csv")}>
                <FileText aria-hidden="true" />
                导出 CSV（当前列表）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {grades.length === 0 ? (
        <section className="empty-block">
          <h2>暂无成绩数据</h2>
          <p>教务系统暂未返回成绩记录，可以点击上方刷新按钮重试。</p>
        </section>
      ) : visible.length === 0 ? (
        <section className="empty-block">
          <h2>没有符合条件的成绩</h2>
          <p>
            当前筛选组合没有匹配的课程，试试{" "}
            <button
              type="button"
              className="text-link inline-button"
              onClick={() => setFilter({ semester: null, courseAttribute: null })}
            >
              清除筛选条件
            </button>
            。
          </p>
        </section>
      ) : (
        <>
          <div className="grades-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>课程</TableHead>
                  <SortableHead
                    label="学期"
                    active={sortKey === "semester"}
                    direction={sortDirection}
                    onToggle={() => toggleSort("semester")}
                  />
                  <SortableHead
                    label="学分"
                    align="right"
                    active={sortKey === "credits"}
                    direction={sortDirection}
                    onToggle={() => toggleSort("credits")}
                  />
                  <SortableHead
                    label="总评"
                    align="right"
                    active={sortKey === "numericScore"}
                    direction={sortDirection}
                    onToggle={() => toggleSort("numericScore")}
                  />
                  <SortableHead
                    label="绩点"
                    align="right"
                    active={sortKey === "gradePoint"}
                    direction={sortDirection}
                    onToggle={() => toggleSort("gradePoint")}
                  />
                  <TableHead>考核</TableHead>
                  <TableHead>属性</TableHead>
                  <TableHead className="grades-op">
                    <span className="sr-only">操作</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((grade) => {
                  const failing = isFailingGrade(grade);
                  return (
                  <TableRow key={grade.detailKey.gradeRecordKey}>
                    <TableCell className="grades-course">
                      <span className="grades-course-name">
                        {grade.courseName}
                      </span>
                      <span className="grades-course-code">
                        {grade.courseCode}
                      </span>
                    </TableCell>
                    <TableCell className="grades-semester">
                      {grade.semester}
                    </TableCell>
                    <TableCell className="grades-num">
                      {formatCredits(grade.credits)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "grades-num grades-score",
                        failing && "grades-fail",
                      )}
                    >
                      {grade.score}
                    </TableCell>
                    <TableCell
                      className={cn("grades-num", failing && "grades-fail")}
                    >
                      {grade.gradePoint.toFixed(1)}
                    </TableCell>
                    <TableCell className="grades-method">
                      {grade.assessmentMethod}
                    </TableCell>
                    <TableCell>
                      <span className="grades-badges">
                        <Badge>{grade.courseAttribute}</Badge>
                        {grade.courseCategory !== null ? (
                          <Badge variant="outline">{grade.courseCategory}</Badge>
                        ) : null}
                        {failing ? (
                          <Badge variant="destructive">不及格</Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="grades-op">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`查看 ${grade.courseName} 成绩组成`}
                        onClick={() => setDetailGrade(grade)}
                      >
                        <FileText aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <ul className="grades-cards">
            {visible.map((grade) => {
              const failing = isFailingGrade(grade);
              return (
              <li key={grade.detailKey.gradeRecordKey}>
                <button
                  type="button"
                  className="grade-entry"
                  onClick={() => setDetailGrade(grade)}
                  aria-label={`查看 ${grade.courseName} 成绩组成`}
                >
                  <span className="grade-entry-head">
                    <span className="grade-entry-name">{grade.courseName}</span>
                    <span
                      className={cn(
                        "grade-entry-score",
                        failing && "grades-fail",
                      )}
                    >
                      <span className="grade-entry-score-label">总评</span>
                      {grade.score}
                    </span>
                  </span>
                  <span className="grade-entry-meta">
                    <span>{grade.semester}</span>
                    <span>{grade.courseAttribute}</span>
                    <span>
                      {formatCredits(grade.credits)} 学分 · 绩点{" "}
                      {grade.gradePoint.toFixed(1)}
                    </span>
                    {failing ? (
                      <Badge variant="destructive">不及格</Badge>
                    ) : null}
                  </span>
                </button>
              </li>
              );
            })}
          </ul>
        </>
      )}

      <GradeDetailDialog
        grade={detailGrade}
        onClose={() => setDetailGrade(null)}
      />
    </div>
  );
}

function SortableHead({
  label,
  active,
  direction,
  onToggle,
  align = "left",
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onToggle: () => void;
  align?: "left" | "right";
}) {
  const Icon = active ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead
      className={align === "right" ? "grades-num" : undefined}
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" className="sort-button" onClick={onToggle}>
        {align === "right" ? null : label}
        <Icon aria-hidden="true" className="sort-icon" data-active={active || undefined} />
        {align === "right" ? label : null}
        <span className="sr-only">
          {active ? `（当前${direction === "asc" ? "升序" : "降序"}）` : "排序"}
        </span>
      </button>
    </TableHead>
  );
}

/**
 * 详情弹窗内容加载完成、骨架切换为正文时高度会突变（实测 ~67px），
 * 因弹窗垂直居中，突变会让整框瞬间上跳造成卡顿。返回一个 callback ref：
 * Radix 挂载内容节点时即接上 ResizeObserver，监听内容盒高度，在换入时对
 * 容器高度做一次性补间，让盒子平滑长高并重新居中。用 callback ref 而非
 * useEffect 是因为 Radix 延迟挂载浮层，effect 首次运行时节点尚不存在。
 * borderBoxSize 不受入场缩放动画影响，故不会误触发；尊重
 * prefers-reduced-motion，动画只作用于这一浮层。
 */
function useDialogHeightTransition(): (node: HTMLDivElement | null) => void {
  const detach = useRef<(() => void) | null>(null);
  return useCallback((el: HTMLDivElement | null) => {
    detach.current?.();
    detach.current = null;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let prevHeight: number | null = null;
    let animating = false;
    let animation: Animation | null = null;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const next = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
      const prev = prevHeight;
      prevHeight = next;
      // 首次观测只建立基线；自身补间引起的尺寸变化直接忽略，避免自激。
      if (prev === null || animating || Math.abs(next - prev) < 1) {
        return;
      }
      if (reduceMotion || typeof el.animate !== "function") {
        return;
      }
      animating = true;
      const previousOverflow = el.style.overflow;
      el.style.overflow = "hidden";
      // FLIP：先把高度同步钉在起点，避免自然高度先绘制一帧造成回跳闪烁。
      el.style.height = `${prev}px`;
      animation = el.animate(
        [{ height: `${prev}px` }, { height: `${next}px` }],
        { duration: 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
      const restore = () => {
        el.style.overflow = previousOverflow;
        el.style.height = "";
        animating = false;
      };
      animation.addEventListener("finish", restore);
      animation.addEventListener("cancel", restore);
    });
    observer.observe(el);
    detach.current = () => {
      observer.disconnect();
      animation?.cancel();
    };
  }, []);
}

function GradeDetailDialog({
  grade,
  onClose,
}: {
  grade: Grade | null;
  onClose: () => void;
}) {
  // 骨架换入正文时内容盒高度变化，由 callback ref 上的 ResizeObserver 捕捉并补间。
  const contentRef = useDialogHeightTransition();
  const detailQuery = useQuery({
    queryKey: ["grade-detail", grade?.detailKey.gradeRecordKey],
    queryFn: () => {
      // enabled 已保证 grade 非空才会执行
      if (grade === null) {
        throw new Error("grade-detail query requires a grade");
      }
      return getGradeDetail(grade.detailKey);
    },
    enabled: grade !== null,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1_000,
  });
  useAuthRedirect(detailQuery.error);

  return (
    <Dialog open={grade !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent ref={contentRef} aria-describedby={undefined}>
        {grade ? (
          <>
            <DialogHeader>
              <DialogTitle>{grade.courseName}</DialogTitle>
              <DialogDescription>
                {grade.semester} · {grade.courseCode} · 总评 {grade.score}
              </DialogDescription>
            </DialogHeader>
            {detailQuery.isPending ? (
              <div className="detail-loading" aria-label="正在加载成绩组成">
                <Skeleton className="h-5 w-3/5" />
                <Skeleton className="h-5 w-4/5" />
                <Skeleton className="h-5 w-2/5" />
                <Skeleton className="h-5 w-3/5" />
              </div>
            ) : detailQuery.isError ? (
              <div className="detail-error animate-detail-in">
                <Alert>
                  <p>
                    {detailQuery.error instanceof ApiError
                      ? detailQuery.error.message
                      : "成绩组成加载失败，请稍后重试。"}
                  </p>
                  {detailQuery.error instanceof ApiError ? (
                    <p className="request-id">
                      请求编号：{detailQuery.error.requestId}
                    </p>
                  ) : null}
                </Alert>
                <Button variant="outline" onClick={() => void detailQuery.refetch()}>
                  重试
                </Button>
              </div>
            ) : (
              <GradeDetailView detail={detailQuery.data ?? {}} />
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 成绩组成键名映射：把上游教务系统的字段代码翻译成中文标签。
 * 上游可能返回中文键（已可读）或拼音缩写代码；已知代码翻译，
 * 已是中文或未收录的键回退原样显示，绝不比原始更差。
 */
const DETAIL_KEY_LABELS: Record<string, string> = {
  zcj: "总评成绩",
  zpcj: "总评成绩",
  pscj: "平时成绩",
  qzcj: "期中成绩",
  qmcj: "期末成绩",
  bkcj: "补考成绩",
  cxcj: "重修成绩",
  kscj: "考试成绩",
  sycj: "实验成绩",
  kchcj: "课程环节成绩",
  kclbmc: "课程类别",
  ksxz: "考试性质",
  ksxzmc: "考试性质",
};

/** 单个成绩组成键的展示标签：已知代码译为中文，其余原样返回。 */
function formatDetailLabel(key: string): string {
  return DETAIL_KEY_LABELS[key.toLowerCase()] ?? key;
}

/** 详情对象是上游原样透传的单层 JSON：标量直接展示，嵌套值序列化展示。 */
function formatDetailValue(value: unknown): string {
  if (value === null) {
    return "—";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function GradeDetailView({ detail }: { detail: GradeDetail }) {
  const entries = Object.entries(detail);
  if (entries.length === 0) {
    return (
      <p className="detail-empty animate-detail-in">
        教务系统未返回成绩组成内容。
      </p>
    );
  }
  return (
    <dl className="detail-list animate-detail-in">
      {entries.map(([key, value]) => (
        <div key={key} className="detail-row">
          <dt>{formatDetailLabel(key)}</dt>
          <dd>{formatDetailValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
