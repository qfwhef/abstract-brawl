# 抽象大乱斗 · 联机对战与系统问题排查与技术交接手册 (Agent / Dev Handbook)

> **适用对象**：后续接手此项目的 AI Agent、开发者或维护者。  
> **仓库地址**：`E:\All Project\webapp\abstract-brawl-qfwh` (GitHub Fork: `https://github.com/qfwhef/abstract-brawl.git`)  
> **生产服务器**：阿里云 Linux (`/opt/abstract-brawl`，systemd 服务：`abstract-brawl.service`)

---

## 目录
1. [系统整体架构与关键模块职责](#1-系统整体架构与关键模块职责)
2. [已修复的 8 大关键踩坑问题与根因分析](#2-已修复的-8-大关键踩坑问题与根因分析)
   - [问题 1：战场布阵区域 Canvas 空白](#问题-1战场布阵区域-canvas-空白)
   - [问题 2：出招方点击“执行指令”后卡在“指令发送中…”，对手能看到动画](#问题-2出招方点击执行指令后卡在指令发送中对手能看到动画)
   - [问题 3：会话失效后无法创建/加入房间，必须重启浏览器](#问题-3会话失效后无法创建加入房间必须重启浏览器)
   - [问题 4：特定角色辅助/防御技能点击后按钮灰一秒又亮起，技能无法释放](#问题-4特定角色辅助防御技能点击后按钮灰一秒又亮起技能无法释放)
   - [问题 5：对局中偶然出现某方连续行动两次或双方按钮全灰死锁](#问题-5对局中偶然出现某方连续行动两次或双方按钮全灰死锁)
   - [问题 6：对局结束后点击结算界面的“再来一局”无任何反应](#问题-6对局结束后点击结算界面的再来一局无任何反应)
   - [问题 7：手机浏览器静态资源缓存导致修复不生效](#问题-7手机浏览器静态资源缓存导致修复不生效)
   - [问题 8：Fork 仓库目录嵌套与多仓库同步规范](#问题-8fork-仓库目录嵌套与多仓库同步规范)
3. [自动化测试与代码质量验证体系](#3-自动化测试与代码质量验证体系)
4. [生产服务器部署与运维规范](#4-生产服务器部署与运维规范)

---

## 1. 系统整体架构与关键模块职责

本项目是一个纯前端静态 + Node.js 权威房间服务器实现的回合制战棋与格斗游戏：

```
[ 浏览器客户端 (turn.html / turn-ui.js) ]
       │                ▲
       │  WebSocket 协议 │  (JSON 消息驱动)
       ▼                │
[ 权威房间服务 (server/net-server.mjs) ]
       │
       ├─► Node VM deterministic sandbox (独立载入纯规则引擎)
       └─► HTTP 静态资源服务 (server/static-server.mjs / scripts/serve.mjs)
```

### 核心文件清单与作用：
- **`turn.html`**：回合战入口，定义 UI 结构、画布 Canvas 及全局脚本依赖加载顺序。
- **`turn-ui.js`**：回合战客户端主控逻辑（UI 事件监听、出招交互、网络消息订阅、视图切换）。
- **`turn-engine.js`**：纯确定性战斗规则引擎（`Battle` 类，负责行动队列、出招判定、伤害/击破/护盾结算）。
- **`turn-renderer.js`**：战场画面 Canvas 渲染器，支持阵营视角切换（`mySide`，1P 为蓝，2P 为红）。
- **`net-client.js`**：客户端网络通信层（WebSocket 封装、心跳保活、会话 Token 保持与重连机制）。
- **`server/net-server.mjs`**：服务端权威房间服务器（房间管理、双端出招合法性校验、重连 90s Grace 状态回放）。
- **`meme-roster.js` & `roster-revision3.js`**：特色/梗技能覆写与角色属性修补层。**（极重要：服务端 VM 必须同步加载！）**

---

## 2. 已修复的 8 大关键踩坑问题与根因分析

### 问题 1：战场布阵区域 Canvas 空白
- **现象**：进入“抽象回合战”页面后，上方的“战场布阵”区域 Canvas 是一片空白，无法拖动交换，也无法预览角色动作。
- **根本原因**：
  `turn.html` 中的发射参数容器之前仅写了 `class="launch-settings"`，缺少了 `id="launch-settings"`。在页面初始化 `refreshSetup()` 时，代码执行 `$('launch-settings').style.display = ...` 触发未捕获异常：`TypeError: Cannot read properties of null (reading 'style')`，打断了后续所有的 `loadFormationScene()`、`renderRoster()` 以及关键动画主循环 `requestAnimationFrame(animatePreviews)`。
- **解决方案**：
  1. `turn.html` 节点补全 `id="launch-settings"`。
  2. `turn-ui.js` 采用容错获取：`$('launch-settings') || document.querySelector('.launch-settings')`。

---

### 问题 2：出招方点击“执行指令”后卡在“指令发送中…”，对手能看到动画
- **现象**：联机对局中，出招方点击“执行指令”，对手屏幕上能看到角色出招动作，但出招方自己屏幕完全静止，底部一直停留在“指令发送中…”，无法再做任何操作。
- **根本原因**：
  1. 本地点击“执行”进入 `perform()` 时，在发送 `net.act()` 前将 `busy = true`、`online.turnSent = true` 并直接 `return` 挂起等待服务端 ACK；
  2. 服务端广播 `opponent_action` 并向出招方返回 `action_ack`；
  3. 出招方收到 `action_ack` 后调用 `perform(..., true)`（`fromNetwork = true`），但函数开头写着：
     ```javascript
     if (!battle || busy || paused || view !== 'combat') return;
     ```
     由于第 1 步设置的 `busy` 仍为 `true`，导致出招方把自己的网络确认指令当作“出招中”直接拦截退出！导致永远没有进入动画演出，`busy` 永远无法重置，造成死锁。
- **解决方案**：
  1. `perform()` 开头判断改为 `(!fromNetwork && busy)`，确保来自服务端的 ACK 绝不被丢弃。
  2. 发包等待阶段只标记 `online.turnSent = true`，不在发包阶段设置 `busy`。
  3. `action_ack` 携带完整出招参数 `{ slot, target, origin }`，确保双端出招数据严格一致。

---

### 问题 3：会话失效后无法创建/加入房间，必须重启浏览器
- **现象**：对局意外中断或服务器重启后，再次进入对局创建或加入房间时，一直提示“会话已失效”或“连接已断开”，只能关闭并重新打开浏览器。
- **根本原因**：
  客户端将 `sessionToken` 保存在了 `localStorage` 中。服务端重启后内存中的旧 Token 已失效，客户端发送请求时服务端返回 `TOKEN_INVALID`，但客户端此前没有在收到错误时清除本地 Token，导致后续所有连接请求一直反复携带过期的无效 Token。
- **解决方案**：
  在 `net-client.js` 与 `turn-ui.js` 的 `net.on('error')` 中，一旦检测到 `TOKEN_INVALID`，自动调用 `net.forgetSession()` 清除持久化 Token，并自动生成新 Token 重新握手。

---

### 问题 4：特定角色辅助/防御技能点击后按钮灰一秒又亮起，技能无法释放
- **现象**：
  向晚行动时，点击 2 号技能“顶碗节拍”（友方护盾/回血）、四时小路行动时点击 1 号技能“路口禁止通行”（友方立牌），点击执行后按钮变灰显示“指令发送中…”，一秒后又重新亮起恢复可用，技能未生效；但攻击技能（如向晚的“水母有梦”）却能正常打出。
- **根本原因（双重原因）**：
  1. **服务端 VM 虚拟机依赖链缺失（核心致命原因）**：
     浏览器端按顺序加载了 `roster.js` -> `meme-roster.js` -> `roster-revision3.js`，其中 `meme-roster.js` 将向晚和四时小路的技能重写为对友军释放（`target: 'ally'`）。
     然而服务端 `server/net-server.mjs` 之前启动虚拟机沙盒时只加载了：
     ```javascript
     // 错误：缺少 meme-roster 和 roster-revision3
     for (const f of ['assets', 'roster', 'turn-engine', 'turn-cast', 'turn-data'])
     ```
     导致服务端里的向晚还是原版攻击敌人的“大小姐上挑”，四时小路还是“春风飞叶”（`target: 'enemy'`）。客户端发来友军 ID，服务端校验发现目标不是敌方，直接判定为非法出招拒绝：`BAD_ACTION: 请选择有效目标`！而“水母有梦”恰好在两端都是攻击敌方，因而碰巧通过。
  2. **客户端错误回显被瞬间覆盖**：
     服务端拒绝后返回 `error`，客户端收到后调用了 `renderCombat()`，但 `renderCombat()` 开头无条件重新计算了 `preview.textContent`，把服务端的报错文本秒速覆盖，导致玩家在手机上只能看到按钮亮灭。
- **解决方案**：
  1. 服务端 VM 加载链补齐：
     ```javascript
     for (const f of ['assets', 'roster', 'meme-roster', 'roster-revision3', 'turn-engine', 'turn-cast', 'turn-data'])
     ```
  2. 服务端在 `handleAction` 中加入详细日志：`[ACTION OK]` 与 `[ACTION REJECTED]`。
  3. 客户端在 `action-banner` 与 `preview` 中高亮保留展示错误原因 3 秒，玩家切换技能/目标时自动清除。

---

### 问题 5：对局中偶然出现某方连续行动两次或双方按钮全灰死锁
- **现象**：
  在打到特定回合后，出现某一方角色行动完毕后紧接着又行动一次，或者双方的操作按钮全部变灰无法点击。
- **根本原因**：
  1. **随机数生成器 RNG 状态脱轨**：
     当两名角色速度相同时，引擎会调用 `this.random()` 打破平局。
     客户端为了显示“对手准备：XX 招式”，在渲染时调用了 `plan()`，而 `plan()` 内部此前调用了 `this.random()` 引入微扰，导致客户端每渲染一帧，随机数种子就往前跑了一步，彻底与服务端种子脱节。一旦发生速度平局，客户端排出的行动者与服务端权威排序不一致！
  2. **缺少权威状态纠偏**：客户端只信任本地计算结果，未强行与服务端 active / queue 对齐。
- **解决方案**：
  1. `plan()` 算法中的微扰去除 `this.random()`，改为确定性正弦函数：
     ```javascript
     const jitter = (((Math.sin((this.turn + 1) * 997 + slot * 31 + (t.uid + 1) * 17) * 43758.5453) % 1) + 1) % 1;
     ```
     彻底杜绝任何 UI 预览消耗引擎主 RNG 种子。
  2. 服务端在 `startBattle`、`action_ack`、`opponent_action` 中统一附带权威状态 `{ active: b.active, queue: [...b.queue], round: b.round }`，客户端出招演出完成后强制以此为准进行同步校准。

---

### 问题 6：对局结束后点击结算界面的“再来一局”无任何反应
- **现象**：战斗分出胜负进入结算页后，点击“再来一局 ↗”按钮没有任何反应，界面不刷新，也没有发送任何网络请求。
- **根本原因**：
  1. `finish()` 执行时未更新 `online.phase = 'finished'`，状态停留在 `'battle'`。
  2. `net.on('result')` 监听之前加了 `if (msg.forfeit)`，导致正常获胜时未触发结算。
  3. `$('again').onclick` 写了 `if (online.phase === 'finished')`，因条件不符直接 `return` 吞没。
  4. 双方同意再战后触发 `rematch` 事件，未调用 `setView('setup')` 切换回选人布阵界面。
  5. 服务端广播 `rematch` 时未清空 `room.rematch = [false, false]`。
- **解决方案**：
  1. `finish()` 与 `net.on('result')` 中无论如何结算均标记 `online.phase = 'finished'`。
  2. `$('again').onclick` 点击后立即调用 `net.rematch()` 并置灰显示“等待对手接受…”，提供即时反馈。
  3. 对手先点击时，文案动态变成“对手已就绪 · 再来一局 ↗”。
  4. 收到 `rematch` 事件后自动调用 `setView('setup')` 切回选人阶段，清空上一局队伍重新布阵。
  5. 服务端重置 `room.rematch = [false, false]`。

---

### 问题 7：手机浏览器静态资源缓存导致修复不生效
- **现象**：服务端和代码已经部署，但玩家用手机浏览器打开时依然运行旧逻辑（如辅助技能依然无法释放）。
- **根本原因**：
  移动端浏览器（Safari / Chrome / 微信内置浏览器）对同名 `.js` 与 `.css` 文件具有极强的本地 HTTP 缓存机制，即使刷新也优先使用本地缓存。
- **规范与对策**：
  在 `turn.html` 中引入静态资源时统一采用版本号查询参数（Cache Busting）：
  ```html
  <link rel="stylesheet" href="turn.css?v=2026091706">
  <script src="net-client.js?v=2026091706"></script>
  <script src="turn-engine.js?v=2026091706"></script>
  <script src="turn-renderer.js?v=2026091706"></script>
  <script src="turn-ui.js?v=2026091706"></script>
  ```
  **每次修改前端核心文件，必须递增版本号！**

---

### 问题 8：Fork 仓库目录嵌套与多仓库同步规范
- **现象**：用户在 `E:\All Project\webapp\abstract-brawl-qfwh` 下执行 `git clone` 默认生成了嵌套的 `abstract-brawl-qfwh/abstract-brawl` 子目录，导致根目录下缺少 `.git`，外部执行 git 报错。
- **规范与对策**：
  - 已拍平到 `E:\All Project\webapp\abstract-brawl-qfwh\` 根目录下。
  - 源仓库 `e:\All Project\webapp\abstract-brawl` 与 Fork 仓库 `E:\All Project\webapp\abstract-brawl-qfwh` 保持同级与平级，两者均拥有 clean 的工作区与对应的 Git 远程源。

---

## 3. 自动化测试与代码质量验证体系

在向用户交付或部署任何改动前，**必须在本地依次运行以下三组命令**并通过全部检查：

1. **项目语法、文件存在性与引用一致性检查**：
   ```bash
   node scripts/check.mjs
   ```
   > 检查项：全量 31 个 JS 文件、290 张素材图片引用、样式与 HTML 标签闭合。

2. **角色特定技能与增益目标断言测试**：
   ```bash
   node tests/verify-skills.mjs
   ```
   > 检查项：验证向晚（顶碗节拍）、四时小路（路口禁止通行）等友方目标技能在 1P 和 2P 视角下的合法性。

3. **权威房间服务真实 WebSocket 链路集成测试**：
   ```bash
   node tests/net-server.test.cjs
   ```
   > 检查项：28 项自动化断言，包含创建、加入、锁定、出招、换位、平局、重连断线恢复、重战重置等。

4. **全局综合回归测试套件**：
   ```bash
   node scripts/test.mjs
   ```
   > 检查项：全量 8 大测试套件（布阵算法、规则模拟、循环锦标赛、排位计算等）。

---

## 4. 生产服务器部署与运维规范

- **服务器地址**：生产服务器（用户已配置 SSH 连接）。
- **部署目录**：`/opt/abstract-brawl/`。
- **Node 环境路径**：`/root/.nvm/versions/node/v22.22.1/bin/node`。
- **系统服务**：`abstract-brawl.service`。

### 部署标准流程：
1. **上传修改的文件**（通过 MCP `ssh-server:upload` 工具）：
   - `/opt/abstract-brawl/server/net-server.mjs`
   - `/opt/abstract-brawl/turn-ui.js`
   - `/opt/abstract-brawl/turn.html`
2. **重启服务并检查运行状态**：
   ```bash
   systemctl restart abstract-brawl.service
   systemctl status abstract-brawl.service --no-pager
   ```
3. **查看实时运行与出招日志**：
   ```bash
   journalctl -u abstract-brawl -n 80 --no-pager
   ```
   可看到详细的出招审计输出：
   - `[ACTION OK] room=... actor=... slot=... target=...`
   - `[ACTION REJECTED] room=... reason=...`
   - `[REMATCH] room=... both players agreed, resetting to select phase`
