# 抽象大乱斗

60 名角色，三种玩法：**抽象格斗 / 抽象回合战 / 抽象自走棋**。

这是一个可直接运行的 HTML、CSS、JavaScript 同人游戏项目。公开源码供大家非商业学习、交流和继续开发。

**禁止商用。** 本项目采用 [非商业学习交流许可](LICENSE)，不是 MIT 或 GPL。角色、原图和相关素材的权利归各自权利人所有，详见 [素材说明](ASSET_NOTICE.md)。

by bilibili：[Xz乔希](https://space.bilibili.com/5859321)

[在线游玩](https://abfighters.pages.dev/) · [玩法与设计](docs/DESIGN.md) · [开发指南](docs/DEVELOPMENT.md) · [贡献说明](CONTRIBUTING.md) · [在线对战规范](docs/ONLINE.md) · [问题排查与技术交接手册](docs/TROUBLESHOOTING.md)

## 包含什么

| 模式 | 内容 |
| --- | --- |
| 抽象格斗 | 横版即时格斗、1V1、2V2、同键盘双人、人机和训练场，手机触控操作 |
| 抽象回合战 | 四人编队、直接点击或拖动站位、自由对战、同屏轮流、五战远征 |
| 抽象自走棋 | 1 名玩家与 7 名 CPU、共享卡池、三合一升星、经济、羁绊、棋盘连续混战 |

包含角色待机、行走、攻击、受击和技能动画。格斗与回合战使用 13 张场景，自走棋单独使用雪山、森林、熔岩、玄幻、海底和赛博朋克六种风景棋盘，透明格线覆盖在环境图上。场景可选择或随机，三个模式的程序合成音乐各自独立。运行时不依赖付费 API，也没有账号服务器。

自走棋围绕角色羁绊、费用、升星和经济展开。一键布阵会综合角色属性、技能、承伤与已激活羁绊进行推荐，再按职责安排近战前排与远程后排；CPU 使用同一布阵规则。也可以手动调整阵容和站位。

自走棋开始页可新建或继续赛事。有未结束存档时展示实际保存的棋子和站位，没有可继续存档时展示空棋盘。

## 直接游玩

在本仓库 [Releases](https://github.com/XzJoshZ/abstract-brawl/releases) 下载网页 ZIP，解压后打开 `index.html`。

也可以点击 **Code → Download ZIP** 下载源码，解压后打开根目录的 `index.html`。手机推荐横屏。音乐在首次点击后启动；存档只保存在当前浏览器，不跨设备同步。

## 继续开发

安装 Node.js 22 或更新版本，在项目目录运行：

```sh
npm run dev
```

打开命令提示的 `http://127.0.0.1:3100/`。**没有第三方 npm 依赖，不需要 npm install。** 修改根目录 `.js`、`.css`、`.html` 后刷新页面即可。查看 [模块地图](docs/DEVELOPMENT.md) 了解改角色、技能、羁绊和操作的位置。

```sh
npm run check   # JavaScript 语法、页面和图片引用
npm test        # 技能规则、综合布阵、缓存与卡池行为检查
npm run build  # 生成可部署的 dist/
npm run pack   # 生成 releases/ 下的网页 ZIP 和 SHA-256
```

## 部署

Cloudflare Pages 的直接上传：运行 `npm run pack`，将 `releases/` 中的网页 ZIP 上传到 Pages 项目。ZIP 根目录就是 `index.html`，没有多套一层文件夹。

通过 Git 集成部署时，构建命令填写 `npm run build`，输出目录填写 `dist`，使用 Node.js 22 或更新版本。纯静态托管即可，无需数据库或环境密钥。

线上网址的更新与仓库提交独立，已有网址不一定已更新到最新提交。

## 项目说明

- 本仓库直接提供游戏运行源码和优化后的运行图片。无需原开发环境、托管平台配置或私人参考图。
- 角色动画保留原分辨率和透明通道，使用已验证的发布包 WebP；场景按网页加载需求导出，不包含早期生成草稿或原作者私人文件。
- 本地单人、CPU、同屏玩法均可运行；目前没有互联网实时联机匹配。
- [棋子手册](docs/ROSTER.md)、[数值设计](docs/BALANCE.md)、[版本说明](docs/RELEASE.md) 可用于继续设计。
- 仿真和规则检查不能保证所有阵容绝对平衡；修改后请测试代表阵容和手机体验。

欢迎通过 Issue 反馈问题，或通过 Pull Request 提交修复。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)，不要上传密钥、他人私人资料或缺少必要授权的素材。仓库会对提交和 Pull Request 自动运行检查。
