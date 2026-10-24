# 投票人头像

按确认的移动端预览，投票人头像使用24px圆形图片，横向排列、超出时换行；桌面和手机共用规则。作者头像、投票选项、比例条及原生投票操作保持现状，用户卡片入口保留至少44px点击区。

## 样式范围

当前生效主题已经包含旧24px规则，但该规则嵌套依赖完整的 `.topic-post .cooked .poll-outer .poll` 祖先链。正文通用图片规则还通过 `#main-outlet` 设置高度和圆角，优先级高于旧规则。不能把“源码出现24px”当作实际生效的证据。

本次将投票人列表样式放到 `#main-outlet .cooked .poll-voters-list` 作用域，明确图片的宽高上下限、圆形裁切及列表伸缩行为，覆盖通用正文图片样式；无需改写原生组件或处理投票数据。缺少头像模板时，原生占位同样保持24px。排序投票保留每个名次的原生分组，并在组内横向换行。

原生结构依据当前 Core `132cc95d043db01251eedf9c93b3927cd5ffee91` 中的 `poll-voters.gjs`、`poll-voters-ranked-choice.gjs` 和头像 helper。没有修改 Core。匿名投票、结果权限、头像顺序、加载更多及实时更新沿用原生行为。

## 验证与发布

运行现有投票展示、发起投票和正文图片检查，Prettier、相关 ESLint、Stylelint、差异检查及实际 GitHub CI。对照公开编译 CSS 核对目标规则；未进行浏览器或 iPhone 真机测试，不在生产创建投票或投票。

分支 `codex/poll-voter-avatars`，PR 指向 `codex/severe-reporting`。CI通过并合并后，备份生效主题，按完整源哈希仅补丁更新 `extra_scss/poll`，保留同伴修改和回滚包。
