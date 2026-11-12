# 陶瓦联机 · SJMCL 扩展

在 [SJMCL（SJMC Launcher）](https://github.com/UNIkeEN/SJMCL) 里直接创建 / 加入
[Terracotta（陶瓦联机）](https://github.com/burningtnt/Terracotta) 房间，不用手动转发端口、
不用来回切窗口。

扩展本身只是陶瓦联机本地 HTTP 接口的一个前端：**不打包、不修改、不链接** 陶瓦联机的任何代码，
因此两边都可以各自独立升级。

## 功能

- **主页卡片**：实时显示陶瓦联机是否在运行、当前房间状态和联机码，一键复制。
- **联机控制台**（`扩展页面 → 陶瓦联机`）：
  - 一键启动陶瓦联机（在设置里配置可执行文件路径后）
  - 创建房间：自动扫描游戏内“对局域网开放”的世界，生成 `U/XXXX-XXXX-XXXX-XXXX` 联机码
  - 加入房间：粘贴别人发来的联机码（聊天里混着文字也能识别）
  - 房间内玩家列表、连接难度、一键断开
- **存档菜单**：在实例的存档条目上右键即可跳到联机控制台。
- **内置下载器**：一键读取 GitHub 上的 latest release，按当前平台挑对应压缩包，
  解压后**直接写入固定的 core 路径** `data/core/terracotta[.exe]`——不需要选目录、也不用手填路径。
- **端口直读，不扫描**：默认端口 **11451**（设置项保留，在 设置 → 扩展 → 陶瓦联机 里改）。
  连接时按顺序试：设置里的端口 → `--hmcl` 写下的端口文件 `data/terracotta-port.json` →
  锁文件 `<临时目录>/terracotta/terracotta.lock` → 上次成功的端口，全程不扫描。

## 安装

1. 下载 `io.github.wjq0411.sjmcl-terracotta-<version>.sjmclx`。
2. 打开 SJMCL → 设置 → 扩展 → 右上角“添加”，选择下载的包。
3. 打开 扩展页面 → 陶瓦联机 → 控制台，点「下载最新版」，扩展会把它写进固定的 core 路径
   `data/core/`。
4. 控制台会给出一条**后台启动命令**（带 `--hmcl <端口文件>`），复制到终端执行即可；
   扩展不自己拉起进程，避免 Tauri 的 open 改写路径（某些环境会变成 `smb://...` 导致 no such file）。

> Linux / macOS 还需要给下载下来的文件执行权限，控制台会给出可直接复制的 `chmod +x` 命令。

需要 SJMCL `1.0.0` 及以上版本。

## 使用

1. 先启动陶瓦联机，回到扩展的控制台点「连接陶瓦联机」（默认试 11451，可在设置页改）。

> 控制台给出的启动命令就是 `--hmcl <扩展目录>/data/terracotta-port.json`：
> 陶瓦联机启动后把实际端口写进该文件，扩展直接读取，全程不扫描。
2. **开房**：进入存档 → ESC → “对局域网开放” → 回到控制台点“创建联机房间” → 把联机码发给朋友。
3. **加入**：把别人的联机码粘进输入框 → 点“加入” → 回到游戏，多人游戏列表里会出现陶瓦房间。

> 主机端要保证游戏内世界已经“对局域网开放”，陶瓦联机是靠监听局域网广播来发现世界的。

## 开发

```bash
npm install
npm run typecheck   # 类型检查
npm test            # 客户端单测 + 下载解包单测 + React 渲染冒烟测试
npm run test:live   # 联网：对真实 latest release 下载并解包校验
npm run build       # 产出 build/<identifier>/
npm run pack        # 额外打出 .sjmclx
```

目录结构：

```
src/
  index.ts                 扩展注册入口（homeWidget / pages / settingsPage / slots）
  pages/console-page.tsx   联机控制台
  pages/settings-page.ts   设置页
  widgets/home-status.ts   主页卡片
  shared/terracotta.ts     陶瓦联机 HTTP 客户端（无 React 依赖，可单测）
  shared/terracotta-download.ts  latest release 解析、tar.gz 解包、base64 写入（固定 core 路径）
  shared/session.ts        会话状态、轮询、动作封装
  shared/settings.ts       配置持久化（data/settings.json）
  types/host.ts            SJMCL 宿主注入 API 的类型（来自官方脚手架）
```

## 许可

本扩展以 **GNU Affero General Public License v3.0 or later** 发布，见 [LICENSE](LICENSE)。

## 第三方说明

- 联机能力由 [Terracotta（陶瓦联机）](https://github.com/burningtnt/Terracotta) 提供，
  版权归其原作者所有，同样以 AGPL-3.0-or-later 授权。
- 本扩展通过陶瓦联机提供的**进程间通信接口（本地 HTTP API）**与其交互，并在界面显著位置
  标注了其版权信息，符合上游 AGPL 例外条款第 2 条。
- 扩展与 SJMCL 官方无隶属关系。
