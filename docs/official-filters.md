# 官方页筛选

仅在 Site serializer 提供 `isbf_official` 校区、类型和分类 ID 时替换官方分类信息流。没有此契约时保留原生分类列表。组件不依赖 Explore 开关。

两个原生 DMenu 向下单选菜单默认“全部校区 / 全部类型”，查询固定含 `isbf-official:<category_id> order:activity`；选中的校区和类型以 AND 组合。沿用 `store.findFiltered("topicList", ...)`、`TopicList.loadMore()` 和共享 `ISBFV2FeedCard`。筛选变化忽略旧响应；加载失败可重试。旧无元数据官方主题仍出现在“全部”，限定校区或类型时由服务端匹配。

新建官方主题和首帖编辑使用两个带复选框的 DMenu 菜单选择校区、类型，每组至少一项。仅官方分类生效；回复、私信不发送这些字段。Draft 保存原始数组，首帖编辑从 Post / Topic 数组还原；清空 Composer 时重置。使用原生 Composer 的创建、更新序列化扩展点提交同名字段的 JSON 字符串，服务端解析与校验。保留 academy 插件原生官方身份开关与权限。

执行 `node --experimental-vm-modules scripts/check-official-ui.mjs` 验证查询、白名单、范围、字段传输、草稿恢复及过期响应。该检查已加入 Theme source checks。

本次未运行浏览器或预览验证。待完整运行环境验证：1440 / 1024 / 390px、亮暗色、访客/普通用户/官方成员、官方发布及首帖编辑/草稿恢复、回复和私信不受影响、筛选切换及分页失败重试。Admin 不渲染用户端 shell。
