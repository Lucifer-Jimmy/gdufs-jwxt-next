---
name: GDUFS JWXT Next
description: 有重量、安静且可信的教务查询界面
colors:
  background: "oklch(0.985 0 0)"
  surface: "oklch(1 0 0)"
  foreground: "oklch(0.205 0.012 35)"
  muted: "oklch(0.955 0.004 35)"
  muted-foreground: "oklch(0.455 0.012 35)"
  border: "oklch(0.885 0.008 35)"
  input: "oklch(0.82 0.01 35)"
  primary: "oklch(0.56 0.17 35)"
  primary-hover: "oklch(0.51 0.17 35)"
  primary-foreground: "oklch(0.99 0 0)"
  destructive-muted: "oklch(0.955 0.025 25)"
  destructive-foreground: "oklch(0.43 0.15 25)"
  success-muted: "oklch(0.955 0.03 155)"
  success-foreground: "oklch(0.42 0.09 155)"
typography:
  display:
    fontFamily: "SF Pro Text, SF Pro Display, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: "2.625rem"
    fontWeight: 700
    lineHeight: 1.14
    letterSpacing: "0"
  title:
    fontFamily: "SF Pro Text, SF Pro Display, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0"
  body:
    fontFamily: "SF Pro Text, SF Pro Display, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.8
    letterSpacing: "0"
  label:
    fontFamily: "SF Pro Text, SF Pro Display, -apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0"
rounded:
  sm: "6px"
  md: "8px"
spacing:
  xs: "8px"
  sm: "16px"
  md: "24px"
  lg: "42px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.sm}"
    height: "44px"
    padding: "0 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.primary-foreground}"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    height: "44px"
    padding: "0 14px"
  auth-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "42px"
---

# Design System: GDUFS JWXT Next

## Overview

**Creative North Star: “有重量的静谧界面”**

界面像一件长期使用的精密工具：背景安静、结构稳定，重要操作和状态才获得颜色与动效。信息层级依靠空间、明度和排版建立，不依靠装饰性卡片、宽阴影或营销式视觉。认证入口以真实任务为首屏，清楚说明数据来源、只读边界和隐私约束。

系统拒绝模板化 SaaS 仪表盘、无差别卡片矩阵、装饰性渐变和频繁改变核心交互。响应式通过布局重组完成，常规状态变化保持 150–250ms，并为 `prefers-reduced-motion` 降级。

**Key Characteristics:**

- 纯中性表面与低占比暖珊瑚锚点。
- 单一跨平台中文友好的系统字体栈。
- shadcn/ui 组件语义与最高 8px 圆角。
- 平坦静止层级、清晰焦点与原位错误恢复。

## Colors

颜色采用克制策略：无色偏背景承担主要空间，暖珊瑚只标记主操作、焦点和少量最高优先级信息。

### Primary

- **暖珊瑚锚点**：用于主按钮、焦点 ring、选中态和关键状态；单屏面积保持在约 10% 以内。
- **深珊瑚交互态**：只在 hover/active 中出现，强化操作反馈而不改变布局。

### Neutral

- **无色偏底面**：页面背景，避免米色纸张感。
- **纯白工作面**：认证面板和未来需要明确边界的工作容器。
- **高对比墨色**：标题、正文和关键数据。
- **次级墨色**：说明、元数据和非主导标签，仍须满足正文对比度。
- **分隔灰**：边框与分隔线；静止容器不同时叠加宽阴影。

**The Ten Percent Rule.** 暖珊瑚的稀缺性就是识别度，只用于行动、选择和最高优先级信息。

**The Semantic Color Rule.** 除主色外的颜色必须具有错误、成功、警告或信息等明确语义。

## Typography

**Display Font:** SF Pro / 平台系统无衬线字体栈
**Body Font:** 与 Display 相同
**Label/Mono Font:** 与 Body 相同；学业数值启用 `tabular-nums`

**Character:** 一套中文友好的系统字体贯穿标题、正文、控件和数据，以固定字号、字重和行高建立精密而稳定的层级，避免额外字体下载和字形闪动。

### Hierarchy

- **Display**（700，42px，1.14）：桌面页面最高层标题；移动端固定降为 30px。
- **Title**（700，24px，1.3）：表单、页面和主要内容区标题。
- **Body**（400，16px，1.8）：主要说明，阅读段落不超过约 65–75ch。
- **Label**（600，14px，1）：字段、按钮和紧凑数据标签，不使用全大写或额外字距。

**The Stable Scale Rule.** 字号不随视口连续缩放；移动端通过明确断点和结构调整响应。

## Elevation

静止页面不使用阴影。背景、纯白工作面、边框和空间承担结构；菜单、对话框和临时浮层未来可使用极轻阴影，但必须由交互层级驱动。焦点通过 2px ring 表达，不通过位移或尺寸变化表达。

**The Flat-by-Default Rule.** 静止表面保持平坦；阴影只属于真正离开文档平面的临时浮层。

## Components

组件以 shadcn/ui 源码、Radix 可访问语义和统一 token 为基础，状态直接、克制且可预测。

### Buttons

- **Shape:** 6px 圆角，高度 40px；主要表单按钮高度 44px。
- **Primary:** 暖珊瑚填充与近白文本，只用于页面主操作。
- **Hover / Focus:** 200ms ease-out 色彩过渡，2px focus ring；active 仅下移 1px。
- **Outline / Ghost:** 中性边框或透明底面，不与主操作竞争。

### Cards / Containers

- **Corner Style:** 最高 8px。
- **Background:** 页面无色偏背景，工作面纯白。
- **Shadow Strategy:** 静止容器无阴影。
- **Border:** 1px 中性边框；不得同时添加装饰性宽阴影。
- **Internal Padding:** 桌面认证面板 42px，手机 22px。

### Inputs / Fields

- **Style:** 44px 稳定高度、6px 圆角、常驻标签和明确边框。
- **Focus:** 主色边框与低透明度 2px ring。
- **Error / Disabled:** 错误在字段或表单原位呈现；禁用保持尺寸并降低不透明度。

### Navigation

- **App Shell:** 顶部品牌栏 + 主导航（概览 / 成绩），当前项用 2px 主色下划线标记，不用药丸或色块。
- **认证区:** 轻量品牌栏；移动端只收缩次要隐私文案，不改变认证操作。
- **User Zone:** 姓名 + 幽灵退出按钮常驻右上；退出是破坏性较低的即时操作，不做二次确认弹窗。

### Feedback

内容加载使用维持布局的 Skeleton；持续错误在原位置显示消息和请求编号；按钮 loading 保留固定尺寸并提供准确文本。Alert 分 destructive（错误，默认）与 info（中性提示，用于规则降级、通知）两种 variant，均不使用侧边粗色条。

### Data Display

- **指标带:** 单一描边工作面内的横向指标分区，细分隔线连接；大数值（tabular-nums）+ 小标签 + 一行上下文，不是悬浮卡片矩阵。
- **表格:** 桌面成绩表使用标准 Table 语义，数值列右对齐 + tabular-nums；可排序表头内嵌按钮并带 `aria-sort` 与方向图标。移动端（≤720px）切换为整行可点的条目列表，同一数据两种结构，不靠缩小字体硬塞表格。
- **徽标:** 课程属性用实心 Badge、通识类别用 outline Badge，小字号不承担主要信息。
- **趋势图:** Recharts 线性折线（不做平滑拟合），主色单线 + 细网格；图表必须配等价数据表（`<details>` 折叠），颜色不是唯一信息通道。

### Overlays

- **Dialog:** 成绩组成详情用居中 Dialog，180–220ms ease-out 缩放淡入，管理焦点并支持 Esc；内容以上游原始键值 `<dl>` 呈现，不做字段美化。
- **Select / Dropdown Menu:** Radix 语义 + 160ms popup 动效；菜单项文字左对齐，导出等破坏性低的操作直接列出，不套确认。
- **Input OTP:** 6 位分段验证码框，继承 Input 的边框与 focus ring，caret 闪烁是唯一循环动效。

### Motion

常规状态 150–250ms ease-out；浮层入场 160–220ms；`prefers-reduced-motion` 下取消位移与循环动画，仅保留即时状态切换。

## Do's and Don'ts

### Do:

- **Do** 优先组合仓库内 shadcn/ui 组件，并通过上述 token 与 variant 扩展。
- **Do** 让登录、加载、错误、刷新和认证状态始终可以理解和恢复。
- **Do** 使用 6–8px 圆角、稳定控件尺寸、清晰 focus-visible 与 150–250ms 状态动效。
- **Do** 在移动端重组结构，并检查最长中文专业名、课程名和错误消息。

### Don't:

- **Don't** 做成模板化 SaaS 侧边栏、无差别卡片矩阵或营销落地页。
- **Don't** 使用渐变文字、装饰性渐变、玻璃拟态、网格背景、光球、粗侧边色条或模板化 uppercase eyebrow。
- **Don't** 用频繁改版、视觉噱头或装饰性动效破坏稳定交互契约。
- **Don't** 把静止页面铺满阴影，或在同一元素上叠加 1px 边框和宽模糊阴影。
- **Don't** 引入与 shadcn/ui 重叠的综合 UI 库，也不要复制 Linear、Vercel 或 Apple 的品牌外观。
