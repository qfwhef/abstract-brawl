# 开发指南

游戏前端是静态网页，格斗与回合战的在线模式另需 Node.js WebSocket 服务，服务端依赖 `ws`。根目录 `index.html` 是模式选择页，三个模式分别由各自 HTML 按顺序加载传统脚本。部分对象通过 `window` 共享，因此调整脚本顺序前应检查依赖。

## 从哪里修改

| 目标 | 文件 |
| --- | --- |
| 首页与随机角色展示 | `index.html`、`lobby.js`、`lobby.css` |
| 格斗基本角色与历史覆盖 | `roster.js`、`meme-roster.js`、`roster-revision3.js` |
| 格斗规则、碰撞、2V2 | `engine.js`、`meme-combat.js` |
| 格斗技能道具与表现 | `meme-art.js`、`meme-visuals.js` |
| 格斗界面和输入 | `ui.js`、`style.css`、`touch-input.js`、`touch-guard.js` |
| 联机客户端、房间协议与服务端 | `net-client.js`、`server/net-server.mjs` |
| 生产网页与 WebSocket 服务入口 | `server/static-server.mjs` |
| 回合战规则、角色、招式 | `turn-engine.js`、`turn-data.js`、`turn-cast.js` |
| 回合战四格布阵 | `turn-formation.js` |
| 回合战画面与界面 | `turn-renderer.js`、`turn-ui.js`、`turn.css` |
| 自走棋费档、羁绊与招牌 | `chess-data.js` |
| 自走棋经济、AI、布阵与战斗 | `chess-engine.js` |
| 自走棋拖放、画面与界面 | `chess-placement.js`、`chess-renderer.js`、`chess-ui.js`、`chess.css` |
| 自走棋开始页与存档阵容展示 | `chess.html`、`start-screen.css`、`chess-ui.js` |
| 自走棋专用场景、透明格线 | `board-themes.js`、`chess-scenes/` |
| 自走棋角色动画资源加载 | `character-art.js` |
| 动作索引和播放 | `animations.js`、`animation-player.js` |
| 图片索引 | `assets.js`、`assets/`、`raster/` |
| 格斗与回合战场景 | `stages.js`、`stages/` |
| 格斗音乐 / 其他模式音乐 | `music.js` / `mode-music.js` |

## 角色和兼容性

角色使用稳定 ID。删除角色产生的空缺不应通过重新编号填补，召唤、借招、索引和旧存档会引用这些 ID。要乐奈含左右独立动作以保留异瞳等不对称细节，不要仅依靠水平镜像替换所有角色素材。

自走棋中费用与星级不同：费用决定购卡价格和基础属性；三张同名同星合成下一星。经济状态还包括所有商店预留卡、候补、在场棋子和共享池。修改费档后须更新历史池映射及迁移，不能直接按新池检查旧档。

`AbstractChess.LineupEvaluator` 同时计算真实战斗常驻属性与综合布阵的估值。只统计场上不同角色；同名角色常驻关系加成仅由最高星副本领取。不要在 UI 里另写一套不一致的羁绊规则。

`tests/context.cjs` 在 Node VM 中按游戏依赖顺序加载纯规则。测试覆盖技能资源上限、关系触发、同名共享、穷举布阵、缓存等价性、远程攻击和完整赛事卡池守恒。`tests/ui-fixture.cjs` 提供轻量 DOM 模拟，检查开始页、存档恢复、首轮结算、场景切换和布阵格子坐标；没有模拟真实手机 GPU、浏览器布局或触控手感。

自走棋使用 `abstract-autochess-run-v1` 保存赛事，开始页只读取未结束赛事中的玩家棋盘。旧场景 ID 不属于当前六种棋盘时回退为随机，角色和经济状态仍保留。新增自走棋场景应加入 `board-themes.js` 与 `chess-scenes/`，不要写入其他模式的 `stages.js`；打包脚本和图片检查已包含这个资源目录。

## 本地和打包

首次运行先执行 `npm ci` 安装锁定的依赖。`npm run dev` 同时提供静态页面和 `/ws` 联机服务，只监听本机 `127.0.0.1`，默认端口 3100，可用 `npm run dev -- --port 3200` 换端口。不会自动暴露给局域网或互联网。生产环境入口为 `node server/static-server.mjs`，部署方式见 [ONLINE.md](ONLINE.md)。

`npm run build` 按明确的文件类型与运行资源目录生成 `dist/`，复制许可与素材说明。服务端、开发脚本、测试、Git 历史和环境文件不会进入网页包；在线对战需另行运行配套 Node.js 服务。`npm run pack` 在此基础上生成 ZIP 与校验文件；支持的文件大小和总包体须小于标准 ZIP 的 4 GiB 限制。

常用自走棋说明见 [DESIGN.md](DESIGN.md) 与 [BALANCE.md](BALANCE.md)。修改逻辑后，先运行已有测试；只有新行为需要时再扩充对应测试。
