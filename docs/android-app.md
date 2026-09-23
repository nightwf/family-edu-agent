# 安卓客户端（平板 / 手机）

`android/` 是禾芽家庭私教的安卓客户端，**一个 APK 同时适配平板和手机**，横竖屏、分屏都不锁定方向。

## 设计原则

客户端只承载线上站点 `https://heyaagent.top/`，页面、登录、数据都来自服务端。
好处是**服务端更新后 App 不需要重新发版**；替换 App 只用于改原生体验（图标、启动方式、二维码登录方式等）。

app 里额外做的原生能力：

- 状态栏 / 手势条 / 刘海屏适配，界面保持禾芽米色配色，不出现系统黑边；
- 返回键优先回退网页历史，已在首页时双击返回键退出；
- 页面在顶部时向下滑动即刷新（移动端习惯的下拉刷新）；
- 断网、服务未启动时显示原生重试页，不用退出 App；
- 页面里的外部链接、`weixin://`、`tel:` 等交给系统应用打开；
- **登录二维码长按可保存到相册**：只有一台设备时，用微信「扫一扫 → 相册」选这张图即可完成扫码登录；
  页面上出现二维码时会提示一次「长按二维码可保存到相册」，避免用户不知道有这个操作。

微信登录沿用网页端同一套小程序码流程（`/api/auth/wechat/web/session`）：App 展示小程序码 → 微信扫码确认 → 网页会话被授权 → App 内自动登录，登录态保存在 WebView 的本地存储里，下次打开免登录。

## 工程结构

```text
android/
  settings.gradle.kts / build.gradle.kts / gradle.properties
  gradlew, gradle/wrapper/            # Gradle 8.13
  keystore/                           # 签名（不进版本库）
  app/
    build.gradle.kts                  # compileSdk 36 / targetSdk 34 / minSdk 24
    src/main/AndroidManifest.xml
    src/main/java/top/heyaagent/familyedu/MainActivity.java
    src/main/res/                     # 布局、配色、图标、网络策略
```

- 包名 `top.heyaagent.familyedu`，调试包后缀 `.debug`，两者可同时安装互不覆盖。
- `res/xml/network_security_config.xml` 默认禁止明文 HTTP，只对服务器 IP `49.234.4.212` 放开，方便直连调试。
- 最低支持 Android 7.0（API 24）。

## 构建

前置：JDK 17（`/opt/homebrew/opt/openjdk@17`）与 Android SDK（`~/Library/Android/sdk`，需要 `platforms/android-36`、`build-tools/35.0.0`）。

```bash
# 发布包（自动签名并复制到 dist/android/）
npm run android:apk

# 调试包
cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew :app:assembleDebug
```

产物：

- 发布包：`dist/android/heya-family-edu-<版本>.apk`（原始位置 `android/app/build/outputs/apk/release/app-release.apk`）
- 调试包：`android/app/build/outputs/apk/debug/app-debug.apk`

### 签名

签名文件 `android/keystore/heya-release.jks` 与 `android/keystore/keystore.properties` **不提交到版本库，请单独备份**。
丢失后无法覆盖升级已安装的设备，只能让用户先卸载旧版再安装新版。

### 图标

```bash
npm run android:icons
```

用浏览器按真实字体渲染「禾」字并输出各密度图标（含自适应图标），避免 AI 生图把汉字画错。

## 验证

```bash
APK="$(ls -t dist/android/heya-family-edu-*.apk | head -1)"   # 取最新一版发布包

# 1. 检查包信息与签名
~/Library/Android/sdk/build-tools/35.0.0/aapt dump badging "$APK" | head
~/Library/Android/sdk/build-tools/35.0.0/apksigner verify --print-certs "$APK"

# 2. 装到模拟器或真机，检查 App 内页面是否真的加载出来
~/Library/Android/sdk/platform-tools/adb install -r "$APK"
~/Library/Android/sdk/platform-tools/adb shell am start -n top.heyaagent.familyedu/top.heyaagent.familyedu.MainActivity
~/Library/Android/sdk/platform-tools/adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
node scripts/android-webview-probe.mjs ws://127.0.0.1:9222/devtools/page/<id> qr designs
```

`android-webview-probe.mjs` 直接连 WebView 调试通道，读取页面标题、正文、二维码图片尺寸并截图，
用于证明「App 里真的打开了站点、登录二维码真的生成」。调试包已开启 WebView 调试，**发布包不开**，
所以发布包要用 `adb shell input` 点击/长按来验证。

场景：

| 场景 | 用途 |
| --- | --- |
| `landing` | 默认，读落地页标题与正文 |
| `layout` | 用无效登录态进入系统骨架，回报侧边栏是固定还是收成汉堡按钮 |
| `login` | 点「登录」，回报登录页文字与图片 |
| `qr` | 点「登录」，回报登录按钮与二维码的 CSS / 设备坐标，便于用 `adb shell input` 复现长按 |

长按保存二维码的验证（平板上 WebView 从 y=36 起，CSS 需乘 `devicePixelRatio`）：

```bash
adb shell input swipe <x> <y> <x> <y> 1500   # 二维码中心的设备坐标
adb logcat -d -s HeYaApp                      # 期望：长按二维码，开始保存 / 二维码已保存到相册
adb shell ls /sdcard/Pictures/禾芽/            # 期望：heya-login-qrcode-*.png
```

```bash
# 3. 网页端在手机 / 平板宽度下的布局
npm run verify:web-responsive
```

## 修改范围提示

- 只改小程序、网页、REST 接口或展示逻辑：App 无需重新打包。
- 改 `MainActivity`、图标、包名、`versionCode`、最低版本或站点域名：需要重新构建 APK 并重新分发。
- 改域名时记得同步 `MainActivity` 里的 `HOME_URL` 与 `ALLOWED_HOST_SUFFIX`。

## 版本记录

- **1.0.1**：修复长按保存二维码必失败的问题。原实现在后台线程里调用
  `WebView#getSettings()` 取 User-Agent，触发 WebView 的线程检查异常（
  `A WebView method was called on thread ...`），导致保存链路始终抛错。
  现在改为在主线程先取好 Cookie 与 User-Agent 再下载，并支持 `data:` 形式的二维码图片。
  同时新增「检测到二维码 → 提示长按保存」的一次性提示。
- **1.0.0**：首个版本，WebView 承载线上站点，含系统栏适配、返回键、下拉刷新、断网重试。

### 模拟器注意事项

- 模拟器用软件渲染（`-gpu swiftshader_indirect`）时 `adb exec-out screencap` 可能整屏全黑，
  截图不能作为判据，改用 `uiautomator dump` 看视图边界 + `adb logcat` 看 App 日志。
- 冷启动慢是模拟器的问题，不是 App 的问题。1.0.1 的实机验收是在平板 AVD
  （2048x1536 / 240dpi）与手机宽度（1080x2340 / 440dpi，即 393dp）两种配置下完成的。
