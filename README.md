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
- **端口自动发现**：陶瓦联机的接口端口是随机的，扩展会先试缓存端口，再并发扫描本机端口，
  找到后记住；也可以在设置里填固定端口跳过扫描。

## 安装

1. 下载 `io.github.wjq0411.sjmcl-terracotta-<version>.sjmclx`。
2. 打开 SJMCL → 设置 → 扩展 → 右上角“添加”，选择下载的包。
3. 在设置 → 扩展 → 陶瓦联机 里填上陶瓦联机可执行文件路径（可选，用于一键启动）。

需要 SJMCL `1.0.0` 及以上版本。

## 使用

1. 先启动陶瓦联机，回到扩展的控制台，点“重新检测”（或等待自动检测）。
2. **开房**：进入存档 → ESC → “对局域网开放” → 回到控制台点“创建联机房间” → 把联机码发给朋友。
3. **加入**：把别人的联机码粘进输入框 → 点“加入” → 回到游戏，多人游戏列表里会出现陶瓦房间。

> 主机端要保证游戏内世界已经“对局域网开放”，陶瓦联机是靠监听局域网广播来发现世界的。

## 开发

```bash
npm install
npm run typecheck   # 类型检查
npm test            # 针对陶瓦联机 HTTP 接口的客户端单测（假服务器）
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
