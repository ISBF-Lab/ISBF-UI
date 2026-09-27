# ISBF Campus Feed V2

从 Discourse 原版页面重新设计的独立预览主题。旧的 `isbf-theme` 保留作为历史快照；本主题使用不同名称和独立 Theme ID。

## 实现

- `api.renderInOutlet("above-main-container", ...)` 渲染导航、顶部筛选、发布入口和右栏。
- `topic-list-item-mobile-layout`、`topic-list-item-class` 与 `topic-list-item-expand-pinned` Transformers 继续渲染 Discourse 原生话题列表。
- `serialize_topic_excerpts` Theme Modifier 提供真实话题摘要。
- `body:has(.isbf-v2-shell)` 将布局样式限制在发现页与标签页；没有全局路由初始化代码。
- 发布、搜索、通知、书签、分类、用户资料均链接到 Discourse 原生功能。

“为你推荐”当前映射到 Discourse `/hot`，没有推荐算法。右栏只链接真实的热门、精华和分类页，不展示伪造数据。

主题已提供简体中文与英文文案，显示语言跟随 Discourse 的 `default_locale` 或用户个人语言偏好。开发站点现已将 `default_locale` 设为 `zh_CN`；部署到其他环境时需单独配置，GitHub 主题源码不会同步站点语言设置。

布局参考 X 的公开网页截图：桌面三栏、窄屏单栏、清晰边框和蓝色操作按钮。保留 ISBF 名称和校园社区内容，不使用 X 商标。

## 验证状态

已对静态布局做桌面与窄屏截图检查。主题 ID 2 的真实桌面页面显示三栏与原生话题流，用户确认 Console 无主题错误，站点切换 `zh_CN` 后导航显示中文。团队开发站点已将 ID 2 设为全站默认；未登录浏览器直接打开 `/` 的桌面截图确认中文三栏与真实话题流，首页 HTTP `200`。真实移动端、明暗模式、话题导航、Composer 和通知仍需验收。未修改 Discourse Core。
