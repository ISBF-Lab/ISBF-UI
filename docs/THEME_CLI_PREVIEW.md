# V3 主题近实时预览

Discourse 官方 `discourse_theme watch` 在保存主题文件时同步到站点。此工作区在 Windows 文件系统中，WSL 默认的文件事件监听无法捕捉 Windows 编辑器的保存；启动脚本使用 Listen 的轮询适配器，已用 Windows 侧修改文件验证能检测到事件。

## 本机准备

- WSL Ubuntu 已安装 Ruby 3.2 与 `discourse_theme` 2.1.6；无需本地完整 Discourse 环境。
- 本机 Theme CLI 的非敏感配置已绑定此主题目录、`http://localhost:3000` 和现有预览主题 ID 3；`~/.discourse_theme` 权限为 `600`，其中没有 API key。
- 保持 VS Code 对团队开发站点的 `localhost:3000` 端口转发打开。
- 在团队开发站点 Admin → API Keys 创建一个关联本人管理员账户的 **Single User / Global** API key。只在下述脚本的终端提示中输入，不发到聊天或提交到 Git。Theme CLI 官方文档要求此权限范围：[Theme CLI 使用说明](https://meta.discourse.org/t/install-the-discourse-theme-cli-console-app-to-help-you-build-themes/82950)。

## 启动

在 PowerShell 中进入本主题仓库，先检查连接：

```powershell
.\scripts\watch-v3-preview.ps1 -Check
```

然后启动监听：

```powershell
.\scripts\watch-v3-preview.ps1
```

首次运行时，脚本会无回显地询问 API key，并保存到 WSL 用户目录 `~/.config/isbf/discourse-theme-api-key`，权限为 `600`。Theme CLI 的 `~/.discourse_theme` 仅记录本目录、`http://localhost:3000` 与主题 ID 3，不保存 API key。CLI 出现主题选择时，选 **Sync with existing theme: ISBF Campus Feed V3 (id:3)**；不要创建新主题。首次启动会完整上传当前 Git 工作目录中的主题文件，以后保存 SCSS/GJS 会自动同步。保持终端运行，在浏览器以管理员身份打开 <http://localhost:3000/?preview_theme_id=3>；停止时按 Ctrl+C。

如果重建本机配置，可运行 `.\scripts\watch-v3-preview.ps1 -Configure`；它只写入非敏感的主题 ID 和站点 URL，不连接 Admin API。

CLI 只连接团队开发站点的 V3 预览主题 ID 3。默认 V2 主题 ID 2、Discourse Core 和其他环境不在此流程中。预览中的文件保存同步不等于正式发布；正式修改仍须提交并推送 GitHub，通过 PR 和集成验证。

如果要撤销当前预览内容，服务器保留了原 V3 导入包 `/home/tangency/isbf-v3-a814e7e.zip`。回滚需要在服务器终端使用已有的 `update-v3-preview.sh` 运行一次交互式 sudo，不能靠关闭监听器恢复。
