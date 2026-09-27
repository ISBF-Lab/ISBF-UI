# ISBF Campus Feed V3

在 V2 话题流基础上扩展用户端页面的独立主题。服务器当前默认主题仍是 V2（ID 2）；V3 需要作为独立预览主题验证，通过后再讨论全站切换。

桌面端对照基准、设计 token 和逐页验收顺序见 [桌面端 UI 基准与设计系统](docs/DESKTOP_UI.md)。
本机 V3 预览的文件监听与启动方法见 [Theme CLI 近实时预览](docs/THEME_CLI_PREVIEW.md)。

## 实现

- `api.renderInOutlet("before-main-outlet", ...)` 在用户端话题、搜索、通知、个人页等路由渲染共享导航；管理员页面不渲染。
- `topic-list-item-mobile-layout`、`topic-list-item-class` 与 `topic-list-item-expand-pinned` Transformers 继续渲染 Discourse 原生话题列表。
- `serialize_topic_excerpts` Theme Modifier 提供真实话题摘要。
- `body:has(.isbf-v2-shell)` 将布局样式限制在主题覆盖的用户端页面；没有全局路由初始化代码。
- 移动端发布框和话题回复保留 Discourse 原生 Composer 与权限判定，并按参考录屏调整视觉和位置。
- 发布、搜索、通知、书签、分类、用户资料均链接到 Discourse 原生功能。

“最新”映射到 Discourse `/latest`；“官方”映射到现有 Staff 分类。该分类由 Discourse 原生权限控制：普通用户可查看和回复，staff 可创建主题。右栏只链接真实的热门、精华和分类页，不展示伪造数据。

主题已提供简体中文与英文文案，显示语言跟随 Discourse 的 `default_locale` 或用户个人语言偏好。开发站点现已将 `default_locale` 设为 `zh_CN`；部署到其他环境时需单独配置，GitHub 主题源码不会同步站点语言设置。

布局参考 X 的公开网页截图：桌面三栏、窄屏单栏、清晰边框和蓝色操作按钮。保留 ISBF 名称和校园社区内容，不使用 X 商标。

## 验证状态

V2 已在团队开发站点作为 ID 2 全站默认运行。V3 已作为 ID 3 独立管理员预览导入；移动首页、话题详情和发布框已做首轮截图检查，未见主题 JavaScript 错误。本次移动端布局修复尚待重新导入后复验。明暗模式、通知及其他页面仍需验收。未修改 Discourse Core。
