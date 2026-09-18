# 在线对战技术规范与协议说明

`abstract-brawl` 回合战模式支持两名玩家通过 WebSocket 进行远程实时对战。

> 💡 **排查与运维参考**：如需了解历史问题排查（如技能校验、断线死锁、重战流转等踩坑记录）与生产部署规范，请参阅 [问题排查与技术交接手册](TROUBLESHOOTING.md)。

## 1. 架构总览

```
[ 客户端 A (1P) ] <==== WebSocket ====> [ Node.js 权威房间服务 ] <==== WebSocket ====> [ 客户端 B (2P) ]
       |                                           |                                          |
  本地确定性                                   Node.js vm                                 本地确定性
  Battle 实例                               Battle 权威校验                              Battle 实例
```

- **权威校验**：服务端运行由 `turn-engine.js` 驱动的真实战斗状态机，客户端发送的任何操作必须经由服务端校验合法性。
- **确定性对齐**：双方以服务端生成的随机种子 `seed` 与选人阵容初始化，通过顺序同步出招、模仿技能来源 `origin` 和换位 `move`，保持三端完全一致。
- **断线与宽限期**：战斗中掉线享有 90 秒重连宽限期（`GRACE_MS = 90_000`）。重连后通过 `sessionStorage` 中的 Token 恢复会话，服务端下发完整 `actionLog` 供客户端本地快进回放。

---

## 2. 房间生命周期

```
  [ WAITING ] (等待对手)
       |
       v (对手加入)
  [ SELECT ]  (双方选人并锁定)
       |
       v (双方阵容均锁定)
  [ BATTLE ]  (确定性战斗推进)
       |
       v (产生胜负或断线判负)
 [ FINISHED ] (结算与再战)
       |
       v (双方均申请再来一局)
  [ SELECT ]
```

---

## 3. WebSocket 消息协议

协议交互采用标准 JSON 格式，挂载路径为 `/ws`。

### 3.1 握手与连接管理

#### 客户端 -> 服务端
- **`hello`**：连接建立后发送。
  ```json
  { "type": "hello", "name": "玩家昵称", "version": 1, "token": "可选已有会话Token" }
  ```
- **`create`**：创建六位数字房间。
  ```json
  { "type": "create" }
  ```
- **`join`**：输入房号加入房间。
  ```json
  { "type": "join", "code": "123456" }
  ```
- **`leave`**：离开房间。
  ```json
  { "type": "leave" }
  ```

#### 服务端 -> 客户端
- **`welcome`**：握手响应，下发客户端 ID 与新分配的会话 Token。
  ```json
  { "type": "welcome", "id": "...", "token": "...", "protocol": 1 }
  ```
- **`created`** / **`joined`**：成功进入房间。
  ```json
  { "type": "created", "code": "123456", "side": 0, "token": "...", "protocol": 1 }
  ```
- **`opponent_joined`**：对手加入房间通知。
- **`opponent_left`**：对手离开或掉线（含宽限期毫秒数）。
  ```json
  { "type": "opponent_left", "graceMs": 90000 }
  ```
- **`opponent_reconnected`**：对手在宽限期内重连成功。
- **`room_closed`**：房间关闭通知。

---

### 3.2 选人与对战

#### 阵容锁定
- **客户端 -> 服务端 (`lock`)**：
  ```json
  {
    "type": "lock",
    "team": [
      { "id": 1, "cell": 0 },
      { "id": 5, "cell": 1 },
      { "id": 12, "cell": 2 },
      { "id": 18, "cell": 3 }
    ]
  }
  ```
- **服务端广播 (`start`)**：双方锁定后正式开局。
  ```json
  {
    "type": "start",
    "teams": [ [ /* Side 0 阵容 */ ], [ /* Side 1 阵容 */ ] ],
    "seed": 184920381
  }
  ```

#### 战斗行动
- **客户端 -> 服务端 (`action`)**：
  ```json
  {
    "type": "action",
    "slot": 0,          // 0..3 或 "guard"
    "target": 2,        // 目标角色 uid
    "move": 3           // 可选：本回合出招前的换位目标格子 (0..3)
  }
  ```
- **服务端 -> 出招方 (`action_ack`)**：
  ```json
  { "type": "action_ack", "turn": 5, "slot": 0, "target": 2, "origin": null }
  ```
- **服务端 -> 对手方 (`opponent_action`)**：
  ```json
  { "type": "opponent_action", "turn": 5, "slot": 0, "target": 2, "move": 3, "origin": null }
  ```
- **服务端广播 (`result`)**：
  ```json
  { "type": "result", "winner": 0, "round": 8, "forfeit": false }
  ```

#### 状态重连与重放
- **服务端 -> 重连方 (`room_state`)**：
  ```json
  {
    "type": "room_state",
    "phase": "battle",
    "code": "123456",
    "side": 0,
    "teams": [ ... ],
    "seed": 184920381,
    "actions": [
      { "turn": 1, "slot": 0, "target": 5, "move": null, "origin": null },
      { "turn": 2, "slot": "guard", "target": null, "move": 2, "origin": null }
    ]
  }
  ```

---

## 4. 部署与运维

- 服务端默认监听端口由环境变量 `PORT` 指定（默认 80），静态资源根目录由 `ROOT` 指定（默认项目根目录）。
- 守护进程通过 systemd 管理：`systemctl restart abstract-brawl`。
