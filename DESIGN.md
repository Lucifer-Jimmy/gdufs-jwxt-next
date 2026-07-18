<!-- SEED: re-run $impeccable document once there's code to capture the actual tokens and components. -->

---

name: GDUFS JWXT Next
description: 高级、优雅、丝滑且长期稳定的教务查询体验
---

# Design System: GDUFS JWXT Next

## Overview

**Creative North Star: "有重量的静谧界面"**

界面应像一件经过长期打磨的精密工具：安静、克制，却在每个层级和状态中提供足够的信息。它借鉴 Linear 的极简但不简单、Vercel 的及时反馈与状态清晰，以及 Apple 动效中的重量感、自然缓动和极轻阴影；参考的是品质原则，不复制任何产品的品牌外观或布局。

前端以 shadcn/ui 为主要组件与交互体系。视觉定制必须建立在 shadcn/ui 的 token、variant、可访问语义和组件源码之上，不能另造一套平行 UI 库。信息结构由教务查询任务决定：关键 GPA 和学分可以使用大指标区域，但每一处强调都必须有真实的信息优先级，不能落入千篇一律的 SaaS 仪表盘模板。

整体动效采用响应式能量：筛选、刷新、展开、切换和数据变化都要顺畅及时，但禁止编排式入场和没有状态含义的表演。普通模式保留完整动效；仅对开启 `prefers-reduced-motion` 的用户降低位移和缩放，同时保留必要反馈。

**Key Characteristics:**

- 极简但不简单，信息层级精确而完整。
- 高级、优雅、丝滑，稳定性高于追逐新鲜感。
- shadcn/ui 组件语义统一，状态反馈即时清楚。
- 动效有重量，缓动自然，阴影极轻。
- 关键数据醒目，但整体不呈现通用 SaaS 仪表盘观感。

## Colors

采用克制型颜色策略：纯中性表面承担主要空间，暖珊瑚/陶土橙作为低占比品牌锚点，用于关键操作、选中状态、重要数据强调和少量图表焦点。具体 OKLCH token 在实现 shadcn/ui 主题时确定，并通过 WCAG 2.1 AA 对比度验证。

### Primary

- **暖珊瑚锚点**（`[implementation token pending]`）：品牌主色，占单屏视觉面积不超过约 10%；用于主操作、选中态和少量最高优先级强调，不作为大面积背景。

### Secondary

- **状态辅助色**（`[implementation tokens pending]`）：仅按成功、警告、错误和信息等语义建立，不为了丰富画面而增加装饰色。

### Neutral

- **纯中性背景**（`[implementation token pending]`）：页面主背景保持无暖色偏移，让品牌暖色承担身份表达。
- **分层表面**（`[implementation token pending]`）：导航、工具栏、表格和必要容器通过轻微明度差形成层级。
- **高对比墨色**（`[implementation token pending]`）：正文和关键数据必须清晰稳定，正文对比度至少达到 WCAG 2.1 AA。
- **次级墨色**（`[implementation token pending]`）：用于辅助说明，但不得以浅灰牺牲可读性。

**The Ten Percent Rule.** 暖珊瑚色必须稀缺；它只标记行动、选择和最高优先级信息，不得把整个界面染成暖色。

**The Semantic Color Rule.** 除品牌锚点外，颜色必须具有明确状态含义；禁止为装饰引入无角色颜色。

## Typography

**Display Font:** 单一人文精密型无衬线字体（`[font family to be chosen at implementation]`）
**Body Font:** 与 Display 相同（`[font family to be chosen at implementation]`）
**Label/Mono Font:** 默认沿用同一字体；数据使用等宽数字特性（`font-variant-numeric: tabular-nums`）

**Character:** 一套字体贯穿标题、正文、控件和数据，通过固定字号、字重、行高和数字特性建立层级。中文阅读稳定性、加载性能和跨平台字形质量优先于展示性字体个性。

### Hierarchy

- **Display**（`[implementation scale pending]`）：只用于页面最高层标题或极少量关键数字，不使用营销式超大字号。
- **Headline**（`[implementation scale pending]`）：用于页面和主要内容区标题，层级明确但不抢占数据注意力。
- **Title**（`[implementation scale pending]`）：用于表格区、详情区和必要容器标题。
- **Body**（`[implementation scale pending]`）：用于主要阅读内容，说明文字行长控制在约 65–75ch。
- **Label**（`[implementation scale pending]`）：用于控件、表头和状态标签，不使用过度字距或模板化全大写。

**The One Family Rule.** 产品界面只使用一个主无衬线字体家族；层级通过排版参数建立，禁止靠混搭近似字体制造虚假丰富度。

**The Stable Scale Rule.** 产品字号采用固定层级，不随视口连续缩放；响应式通过结构调整完成。

## Elevation

界面默认保持平坦，通过中性表面的轻微明度差、分隔和空间建立结构。阴影只用于浮层、菜单、对话框、临时抬升状态及必须脱离背景的交互反馈，并保持极轻、宽而自然；具体阴影值在实现阶段随 shadcn/ui token 确定。

**The Weight Without Drama Rule.** 动效通过自然 easing、短距离位移和速度变化表达重量，不能依靠夸张弹跳、过冲或大面积阴影制造存在感。

**The Flat-by-Default Rule.** 静止页面层级优先使用空间与表面明度；如果所有容器都带阴影，说明层级设计失败。

## Components

shadcn/ui 是组件实现的唯一主体系。实现阶段必须优先安装、组合并维护其 Button、Input、Form、Alert、Dialog、Sheet、Tabs、Table、Select、Dropdown Menu、Tooltip、Skeleton 和 Sonner 等组件源码，再通过项目 token 与 variant 形成统一视觉语言。

### Buttons

- **Shape:** 延续 shadcn/ui 的克制几何感，采用紧凑且一致的圆角；具体值在实现主题时确定，默认不得超过 8px。
- **Primary:** 暖珊瑚只用于真正的主操作，饱和填充必须搭配清晰高对比文本。
- **Hover / Focus:** hover、active 和 loading 都要有即时、稳定且不引发布局位移的反馈；focus-visible 必须清晰可辨。
- **Secondary / Ghost:** 次要操作以中性层级表达，不能与主按钮竞争；纯图标工具操作优先使用 shadcn/ui Button 的 icon size 与 Tooltip。

### Chips

- **Style:** 用于筛选与状态时必须区分可操作和只读语义；默认中性，选中后使用低面积品牌强调。
- **State:** 选中、未选中、禁用和键盘焦点都必须可感知，不能只靠细微颜色变化。

### Cards / Containers

- **Corner Style:** 克制圆角，默认上限 8px；不得使用夸张大圆角。
- **Background:** 依靠中性表面层级承载内容，禁止暖米色纸张感背景。
- **Shadow Strategy:** 静止卡片默认无阴影；浮层和临时抬升遵守 Elevation 规则。
- **Border:** 边框与阴影择其一承担边界，不同时叠加成装饰性“幽灵卡片”。
- **Internal Padding:** 随信息密度分级，数据表与工具区可以紧凑，关键摘要保留更充分空间。

### Inputs / Fields

- **Style:** 使用 shadcn/ui 表单结构，标签常驻、边界明确、尺寸稳定，并配置正确自动填充属性。
- **Focus:** 统一 focus-visible ring，不靠布局变化表达焦点。
- **Error / Disabled:** 字段级错误与提交级错误分开表达；禁用、加载和只读不能混淆。

### Navigation

导航必须稳定、轻量并以当前任务为中心。桌面与移动端可以改变结构，但页面名称、信息归属和主要路径保持一致。活动状态以清晰层级和低面积品牌色表达，不使用模板化 SaaS 侧边栏装饰。

### Data Summary and Tables

GPA、学分等关键数据可以使用大指标组件，但数量、尺寸和位置由信息优先级决定，禁止复制等大卡片矩阵。成绩表使用清晰表头、稳定列宽、右对齐等宽数字和适当行高；移动端必须转换为适合核对的结构，不能简单横向压缩桌面表格。

### Motion and Feedback

所有 shadcn/ui 交互组件必须补齐 hover、focus、active、disabled、loading、success 和 error 状态。常规过渡采用响应式动效，目标时长约 150–250ms；自然 ease-out 的精确曲线在实现阶段确定。Skeleton 保持内容布局，Toast 只承载短暂结果，持续性问题必须在原位置显示。

## Do's and Don'ts

### Do:

- **Do** 以 shadcn/ui 作为页面、表单、导航、反馈和数据组件的主要实现体系，并在其源码、token 与 variant 上定制。
- **Do** 让暖珊瑚只承担关键操作、选中态和少量重要数据强调。
- **Do** 使用大指标区域清晰展示 GPA 和学分，但让结构由数据优先级而非模板决定。
- **Do** 让加载、刷新、筛选、导出、认证和错误恢复始终提供及时、明确、可恢复的状态反馈。
- **Do** 让普通模式动效具有重量和自然 easing，并为 `prefers-reduced-motion` 提供必要降级。
- **Do** 保持核心导航、术语和交互契约长期稳定；改版必须解决明确问题。

### Don't:

- **Don't** 做成千篇一律的 SaaS 仪表盘：禁止模板化侧边栏、无差别卡片矩阵、装饰性渐变和缺乏重点的信息堆叠。
- **Don't** 频繁改版、为变化而变化，或破坏用户已经形成的操作习惯。
- **Don't** 用视觉噱头掩盖功能不完整、状态不清楚或数据不准确。
- **Don't** 使用渐变文字、玻璃拟态、装饰性网格背景、渐变光球、粗侧边色条或模板化小号大写 eyebrow。
- **Don't** 使用夸张弹跳、弹性过冲、编排式页面入场或没有状态含义的动画。
- **Don't** 让阴影成为静止页面的默认层级工具，也不要在同一元素上叠加装饰性宽阴影和细边框。
- **Don't** 引入与 shadcn/ui 重叠的综合 UI 库，或另建一套平行组件体系。
- **Don't** 复制 Linear、Vercel 或 Apple 的品牌外观、布局和特征性视觉资产。
