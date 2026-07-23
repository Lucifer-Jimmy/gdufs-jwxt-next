import type { MajorRule } from "./rules";


export const MAJOR_RULES: readonly MajorRule[] = [
  {
    ruleId: "cybersecurity-2024",
    majors: ["网络空间安全"],
    aliases: [],
    version: "2024",
    totalCreditsRequired: 158,
    generalEducation: [
      { label: "人文科学", categories: ["人文科学"], creditsRequired: 4 },
      { label: "社会科学", categories: ["社会科学"], creditsRequired: 2 },
      { label: "艺术审美", categories: ["人文科学（艺术审美课程）"], creditsRequired: 2 },
    ],
    source: {
      title: "网络空间安全专业培养方案（2024版）",
      checkedAt: "2026-07-23",
    },
  },
];
