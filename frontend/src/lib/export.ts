import type { Grade } from "./api";

/**
 * 浏览器端导出：全部在当前页面内存完成，不上传或暂存任何数据。
 * Excel 使用 SheetJS（按需动态导入，避免拖累首屏体积），CSV 为纯函数生成。
 */

export const GRADE_EXPORT_HEADERS = [
  "课程代码",
  "课程名称",
  "学期",
  "学分",
  "总评成绩",
  "百分制成绩",
  "绩点",
  "考核方式",
  "课程属性",
  "通识类别",
] as const;

type ExportCell = string | number;

export function gradesToRows(grades: readonly Grade[]): ExportCell[][] {
  return grades.map((grade) => [
    grade.courseCode,
    grade.courseName,
    grade.semester,
    grade.credits,
    grade.score,
    grade.numericScore,
    grade.gradePoint,
    grade.assessmentMethod,
    grade.courseAttribute,
    grade.courseCategory ?? "",
  ]);
}

function csvCell(cell: ExportCell): string {
  if (typeof cell === "number") {
    return String(cell);
  }
  return `"${cell.replace(/"/g, '""')}"`;
}

/** 带 BOM 的 CSV，保证 Excel 直接打开时中文不乱码。 */
export function gradesToCsv(grades: readonly Grade[]): string {
  const lines = [
    GRADE_EXPORT_HEADERS.map(csvCell).join(","),
    ...gradesToRows(grades).map((row) => row.map(csvCell).join(",")),
  ];
  return `\ufeff${lines.join("\r\n")}`;
}

export function exportFileBasename(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `成绩-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadGradesCsv(grades: readonly Grade[], now: Date): void {
  const blob = new Blob([gradesToCsv(grades)], {
    type: "text/csv;charset=utf-8",
  });
  triggerDownload(blob, `${exportFileBasename(now)}.csv`);
}

export async function downloadGradesExcel(
  grades: readonly Grade[],
  now: Date,
): Promise<void> {
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.aoa_to_sheet([
    [...GRADE_EXPORT_HEADERS],
    ...gradesToRows(grades),
  ]);
  worksheet["!cols"] = [
    { wch: 14 },
    { wch: 32 },
    { wch: 20 },
    { wch: 6 },
    { wch: 9 },
    { wch: 10 },
    { wch: 6 },
    { wch: 10 },
    { wch: 12 },
    { wch: 14 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "成绩");
  XLSX.writeFile(workbook, `${exportFileBasename(now)}.xlsx`);
}
