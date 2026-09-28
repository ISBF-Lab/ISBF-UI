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
