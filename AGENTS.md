# 项目 UI 约定

- 新增或调整广州行程、广州记账及其章节、控件、弹层前，先阅读 `DESIGN.md` 的“广州页面已确认字体规范”。后续内容必须沿用该标准。
- 字族使用 `dist/typography.css` 的 `--journal-font`；字号与字重使用 `dist/guangzhou-typography.css` 的六级变量及 400 / 500 / 600，不自行新增字体、字号或字重。
- 新模块的字体规则集中在 `dist/guangzhou-typography.css` 中维护；页面保持最后加载该文件。横排日期统一加粗，航班起降时间 22px、机场名称 16px。
- 默认只修改用户指定的页面和内容；提交、推送或发布须由用户明确要求。
