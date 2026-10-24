# 官方页筛选

仅在 Site serializer 提供 `isbf_official` 校区、类型和分类 ID 时替换官方分类信息流。没有此契约时保留原生分类列表。组件不依赖 Explore 开关。

两个原生 DMenu 向下单选菜单默认“全部校区 / 全部类型”，查询固定含 `isbf-official:<category_id> order:activity`；选中的校区和类型以 AND 组合。沿用 `store.findFiltered("topicList", ...)`、`TopicList.loadMore()` 和共享 `ISBFV2FeedCard`。筛选变化忽略旧响应；加载失败可重试。旧无元数据官方主题仍出现在“全部”，限定校区或类型时由服务端匹配。

新建官方主题和首帖编辑使用两个带复选框的 DMenu 菜单选择校区、类型，校区可选、类型至少一项。仅官方分类生效；回复、私信不发送这些字段。Draft 保存原始数组，首帖编辑从 Post / Topic 数组还原；清空 Composer 时重置。使用原生 Composer 的创建、更新序列化扩展点提交同名字段的 JSON 字符串，服务端解析与校验。保留 academy 插件原生官方身份开关与权限。

执行 `node --experimental-vm-modules scripts/check-official-ui.mjs` 验证查询、白名单、范围、字段传输、草稿恢复及过期响应。该检查已加入 Theme source checks。

本次未运行浏览器或预览验证。待完整运行环境验证：1440 / 1024 / 390px、亮暗色、访客/普通用户/官方成员、官方发布及首帖编辑/草稿恢复、回复和私信不受影响、筛选切换及分页失败重试。Admin 不渲染用户端 shell。

## 后台维护目录

官方插件的站点元数据保留全部固定 ID 与显示名称，并增加 `enabled` 和目录
`revision`。旧插件缺少这些属性时沿用原有启用状态。官方筛选仍展示停用项并标记
“已停用”，新帖只提供启用项；编辑首帖可保留或移除原有停用项。全部校区停用且
没有历史选择时，隐藏可选校区控件。后台改名或排序在前台刷新配置后同步。

Composer 保存前读取最新 `/site.json`，失效选择提示重新选择并保留标题、正文、
时间项及草稿。一次预检和原生提交共用 pending promise，避免双击重复发帖；
清空或重开 Composer 后旧响应不得提交。原生保存失败后尽力更新目录，并原样
交回原生错误，不替换原生发布、编辑或错误处理。

`scripts/check-official-catalog.mjs` 覆盖启停、历史选择、名称/顺序、长度限制、
失败保留、重复提交和过期请求；既有 Composer 扩展检查同时覆盖其他初始化顺序。
生产浏览器验收只读，不创建测试目录项。真机及其他真实角色验收另行记录。
