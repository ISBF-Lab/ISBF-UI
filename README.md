# ISBF Campus Feed

国金综合平台当前用户端主题。源码以服务器主题导出包为基线，复用 Discourse 原生话题、用户、通知和 Composer；不修改 Core。

## 本次功能

- 左侧导航新增“日历 / 工作台”，手机底栏增加日历并启用工作台入口。
- 日历提供月视图、每日列表、个人行程与社区活动筛选。个人行程依赖独立的 [ISBF-Calendar](https://github.com/ISBF-Lab/ISBF-Calendar) 插件；社区活动读取 Discourse Events 的活动话题。
- 工作台以组件网格展示规划中的校园服务，所有卡片均标记“即将开放”且不可点击。
- 普通动态仍使用正文优先的 Discourse Composer；“校园活动”分类的活动发布保留原生事件 Composer 的标题与活动字段。

## 部署顺序

先安装 `ISBF-Calendar` 插件并迁移数据库，再启用站点已有的 Discourse Events 插件、创建“校园活动”分类并设置其发布权限。随后导入此主题，并把分类 ID、分类路径写入 `calendar_category_id`、`calendar_category_path` 主题设置。功能部署前不要把带日历导航的主题单独设为默认主题。

主题的简体中文和英文文案随 Discourse 站点或用户语言切换。首页“最新”映射 `/latest`，“官方”映射现有官方分类；工作台不展示虚构数据。

## 统一发布编辑器

- 桌面编辑器以现有发布框为样式基准，在窗口底部与中栏对齐；回复、引用转发、编辑和私信共享框体样式，保留原生操作、草稿和校验。手机保留全屏编辑及安全区域。
- 普通新帖的标题为可选项，使用独立 ID 的原生文本控件、提示组件及标题模型校验。填写的标题通过原生 `title` 提交；`isbf_optional_title` 仅随草稿保存，不进入发帖接口。
- 标题留空时，保存独立的 `校园动态 [isbf-untitled:<UUID>]` 内部标题，以兼容 Discourse 的非空标题约束和重复标题检查；不从正文提取标题。首页和话题详情卡片识别这一专用格式并省略标题行，其他原生导航、邮件或导出可能显示内部标题。普通手写的“校园动态”不会被隐藏。
- 分类中的事件发布、私信主题及首帖编辑继续使用其原生标题要求。没有新增接口、数据库表或 Core 修改。

检查：`node --experimental-vm-modules scripts/check-composer-ui.mjs`，以及仓库现有主题检查。

## 左栏更多与反馈

- 桌面与紧凑左栏在个人资料下方提供“更多”，使用原生 DMenu 向上展开设置、反馈和加入我们；访客设置入口使用原生登录流程。手机导航保持原有入口。
- `feedback_category_id` 指向当前用户可见的真实反馈分类。该分类复用首页发布栏、帖子卡片和分页；发布预选分类，发帖权限仍由 Core 校验。
- `join_us_description` 配置纯文本招募说明和联系方式；留空显示“招募信息筹备中”。

检查：`node --experimental-vm-modules scripts/check-sidebar-more-ui.mjs`。
