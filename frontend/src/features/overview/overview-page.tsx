import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Link } from "react-router-dom";

import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import {
  currentSemester,
  earnedCredits,
  filterGrades,
  formatCredits,
  formatGpa,
  formatSemester,
  generalEducationCredits,
  semesterTrend,
  weightedGpa,
} from "../../lib/academics";
import { ApiError } from "../../lib/api";
import type { Grade } from "../../lib/api";
import { computeRuleProgress, matchMajorRule } from "../../lib/rules";
import { MAJOR_RULES } from "../../lib/rules-data";
import { useAuthRedirect, usePersonalInfo } from "../app/app-layout";
import { useGrades } from "../app/use-grades";

export function OverviewPage() {
  const me = usePersonalInfo();
  const gradesQuery = useGrades();
  useAuthRedirect(gradesQuery.error);

  const grades: Grade[] = gradesQuery.data?.grades ?? [];
  const person = me.data;

  if (gradesQuery.isPending) {
    return (
      <div className="page-stack" aria-label="正在加载学业概览">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (gradesQuery.isError) {
    const error =
      gradesQuery.error instanceof ApiError ? gradesQuery.error : undefined;
    return (
      <div className="page-stack page-narrow">
        <h1 className="page-title">学业概览</h1>
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

  const gpa = weightedGpa(grades);
  const semester = currentSemester(grades);
  const semesterGpa =
    semester === null
      ? null
      : weightedGpa(filterGrades(grades, { semester, courseAttribute: null }));
  const credits = earnedCredits(grades);
  const trend = semesterTrend(grades);
  const geCredits = generalEducationCredits(grades);
  const ruleMatch = person
    ? matchMajorRule(person.major, MAJOR_RULES)
    : { status: "unmatched" as const };

  return (
    <div className="page-stack">
      <header className="page-heading">
        <h1 className="page-title">学业概览</h1>
        {person ? (
          <p className="page-subtitle">
            {person.college} · {person.major}
          </p>
        ) : null}
      </header>

      {gradesQuery.data?.reachedPageLimit ? (
        <Alert>
          <p>
            成绩记录达到单页获取上限，当前数据可能不完整。如缺少早期学期记录，请稍后在成绩页手动刷新重试。
          </p>
        </Alert>
      ) : null}

      {grades.length === 0 ? (
        <section className="empty-block">
          <h2>暂无成绩数据</h2>
          <p>
            教务系统暂未返回任何成绩记录。可以前往
            <Link to="/grades" className="text-link">
              成绩页
            </Link>
            手动刷新，或稍后再试。
          </p>
        </section>
      ) : (
        <>
          <section className="metrics-band" aria-label="关键学业指标">
            <div className="metric-item">
              <span className="metric-label">总平均绩点</span>
              <span className="metric-value">{formatGpa(gpa)}</span>
              <span className="metric-sub">全部学期加权</span>
            </div>
            <div className="metric-item">
              <span className="metric-label">本学期绩点</span>
              <span className="metric-value">{formatGpa(semesterGpa)}</span>
              <span className="metric-sub">
                {semester === null ? "暂无学期记录" : formatSemester(semester)}
              </span>
            </div>
            <div className="metric-item">
              <span className="metric-label">已修学分</span>
              <span className="metric-value">{formatCredits(credits)}</span>
              <span className="metric-sub">
                通识课程 {formatCredits(geCredits)} 学分
              </span>
            </div>
          </section>

          <section className="section-block" aria-labelledby="trend-heading">
            <div className="section-heading">
              <h2 id="trend-heading">分学期趋势</h2>
              <p>每学期加权平均绩点变化</p>
            </div>
            <TrendChart trend={trend} />
            <details className="trend-data">
              <summary>查看数据表</summary>
              <table>
                <thead>
                  <tr>
                    <th scope="col">学期</th>
                    <th scope="col">平均绩点</th>
                    <th scope="col">学分</th>
                    <th scope="col">课程门数</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((point) => (
                    <tr key={point.semester}>
                      <th scope="row">{point.label}</th>
                      <td>{point.gpa.toFixed(2)}</td>
                      <td>{formatCredits(point.credits)}</td>
                      <td>{point.courseCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>

          <section className="section-block" aria-labelledby="rules-heading">
            <div className="section-heading">
              <h2 id="rules-heading">毕业与通识进度</h2>
            </div>
            {ruleMatch.status === "matched" ? (
              <RuleProgressView grades={grades} match={ruleMatch} />
            ) : (
              <div className="rules-fallback">
                <Alert variant="info">
                  <p>
                    该专业规则暂未配置或无法准确匹配，毕业与通识完成比例暂不展示。已修学分与
                    GPA 统计不受影响。
                  </p>
                </Alert>
                <p className="rules-note">
                  不依赖培养方案的统计：已修 {formatCredits(credits)}{" "}
                  学分，其中通识课程 {formatCredits(geCredits)} 学分。
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function TrendChart({
  trend,
}: {
  trend: ReturnType<typeof semesterTrend>;
}) {
  const yMax = Math.max(
    4,
    Math.ceil(Math.max(...trend.map((point) => point.gpa), 0)),
  );
  return (
    <div
      className="trend-chart"
      role="img"
      aria-label="分学期平均绩点折线图，等价数据见下方表格"
    >
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="shortLabel"
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickMargin={8}
          />
          <YAxis
            domain={[0, yMax]}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickCount={yMax + 1}
          />
          <Tooltip
            content={<TrendTooltip />}
            cursor={{ stroke: "var(--border)" }}
          />
          <Line
            type="linear"
            dataKey="gpa"
            name="平均绩点"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--primary)", strokeWidth: 0 }}
            activeDot={{ r: 4.5, fill: "var(--primary)", strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ReturnType<typeof semesterTrend>[number] }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) {
    return null;
  }
  return (
    <div className="trend-tooltip">
      <p className="trend-tooltip-title">{point.label}</p>
      <p>
        平均绩点 <strong>{point.gpa.toFixed(2)}</strong>
      </p>
      <p>
        {formatCredits(point.credits)} 学分 · {point.courseCount} 门课程
      </p>
    </div>
  );
}

function RuleProgressView({
  grades,
  match,
}: {
  grades: readonly Grade[];
  match: Extract<ReturnType<typeof matchMajorRule>, { status: "matched" }>;
}) {
  const progress = computeRuleProgress(match.rule, grades);
  return (
    <div className="rules-progress">
      <ProgressRow
        label="毕业学分"
        earned={progress.totalEarned}
        required={progress.totalRequired}
        ratio={progress.totalRatio}
      />
      <ProgressRow
        label="通识学分"
        earned={progress.generalEarned}
        required={progress.generalRequired}
        ratio={progress.generalRatio}
      />
      <p className="rules-note">
        依据《{match.rule.source.title}》（规则版本 {match.rule.version}
        ，核对于 {match.rule.source.checkedAt}）计算，仅供参考。
      </p>
    </div>
  );
}

function ProgressRow({
  label,
  earned,
  required,
  ratio,
}: {
  label: string;
  earned: number;
  required: number;
  ratio: number;
}) {
  const percent = Math.round(ratio * 100);
  return (
    <div className="progress-row">
      <div className="progress-row-head">
        <span>{label}</span>
        <span>
          {formatCredits(earned)} / {formatCredits(required)} 学分 ·{" "}
          {percent}%
        </span>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, percent)}
        aria-label={`${label}完成比例`}
      >
        <div
          className="progress-fill"
          style={{ transform: `scaleX(${Math.min(100, percent) / 100})` }}
        />
      </div>
    </div>
  );
}
