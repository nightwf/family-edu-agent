# 禾芽家庭教务 微信小程序

小程序是现有禾芽家长管理端的移动端适配，复用同一套 Fastify API、PostgreSQL 数据、家庭专属 MCP Token 和账号体系。页面按微信底部导航调整，学习相关功能集中在一个页面内用二级 Tab 切换。

## 页面结构

| Tab | 页面 | 能力 |
| --- | --- | --- |
| 首页 | `pages/home` | 家庭概览、统计、孩子、最近报告、快速入口 |
| 学生 | `pages/students` | 学生列表、新建、编辑、删除 |
| 成长 | `pages/growth` | 成长记录、报告、成长轨迹、记录详情 |
| 学习 | `pages/learning` | 题库、错题本、教材、作业、知识库 |
| 我的 | `pages/settings` | 账号、微信绑定、WorkBuddy 提示词、教育方式、退出 |

学习页内包含：

- 题库：题目列表、题型分类、学生掌握度、题目详情、编辑、删除、掌握状态调整；
- 错题本：错题列表、掌握证据、针对性试卷、教学规划、错题详情与状态管理；
- 教材：列表、导入、文件上传、编辑、删除；
- 作业：列表、新增、编辑、完成、删除；
- 知识库：列表、新增、删除。

## 微信开发者工具导入

1. 打开微信开发者工具，选择“导入项目”；
2. 目录选择仓库根目录 `/Users/nightwf/Desktop/儿童AI教育/family-edu-agent`，AppID 可先使用测试号或 `touristappid`；
3. 开发者工具中打开“详情 - 本地设置 - 不校验合法域名”；
4. 修改 [config.js](/Users/nightwf/Desktop/儿童AI教育/family-edu-agent/miniprogram/config.js) 中的 `baseUrl`，默认指向 `https://edu.skillstores.com/family-edu`；
5. 点击编译即可使用邮箱密码登录，或使用微信一键登录。

正式发布前必须：

- 将 `baseUrl` 改为已备案的 HTTPS 域名；
- 在微信公众平台配置 request 合法域名；
- 将 `touristappid` 换成真实小程序 AppID；
- 在服务端配置 `WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。

## 微信登录

登录页提供三种方式：

- 邮箱密码登录；
- 邀请码注册；
- 微信一键登录。

微信登录流程：

1. 小程序调用 `wx.login` 获取 code；
2. 小程序把 code 发给 `/api/auth/wechat/login`；
3. 后端使用 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` 调用微信 `jscode2session` 获取 openid；
4. 已绑定账号直接登录；未绑定账号返回 `need_bind` 和短期 `bind_token`；
5. 家长选择“绑定已有账号”或“注册新账号”，完成绑定后进入小程序。

已登录邮箱账号也可以在“我的”页绑定当前微信，之后可使用微信一键登录。

## 后端新增接口

```text
POST /api/auth/wechat/login
POST /api/auth/wechat/bind
POST /api/auth/wechat/bind-current
```

数据库新增 `User.wechatOpenId`、`User.wechatUnionId`、`User.wechatNickname`、`User.wechatAvatarUrl`、`User.lastWechatLoginAt`，迁移文件为 `20260827000000_wechat_login`。

## 本地校验

```bash
npm run check:miniprogram
```

该命令会校验小程序 JSON、页面文件完整性和所有 JS 语法。真机效果、微信登录、上传、图片预览仍需要在微信开发者工具和真机中验收。
