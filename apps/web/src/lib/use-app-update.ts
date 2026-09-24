import { useCallback, useEffect, useRef, useState } from "react";
import { currentAppVersion, fetchServerVersion, switchToLatestVersion } from "./app-version";

/** 挂着不动时也隔一阵问一次，别让孩子盯着一个几小时前的页面用 */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** 刚打开就先让页面把内容渲染出来，版本检查晚一点再问 */
const FIRST_CHECK_DELAY_MS = 3000;

/**
 * 盯着"服务器上是不是已经换成新版了"。
 *
 * 三个检查时机，对应三种真实场景：
 * - 打开页面：进来时先对一次
 * - 页面重新可见：App 从后台切回来，这是最常遇到的一种（App 不会自己重载）
 * - 定时：一直挂在前面不动的时候
 *
 * 孩子点了"稍后"就整个停下，不再问也不再提示——
 * 提示的意义是告诉他"可以更新了"，不是逼他更新。
 */
export function useAppUpdate(baseUrl: string) {
  const [availableVersion, setAvailableVersion] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const ownVersionRef = useRef("");

  const check = useCallback(async () => {
    if (dismissed) return;
    const own = ownVersionRef.current || currentAppVersion();
    // 没有版本号就无从比较（老包或构建异常），当作"不知道"，不打扰用户
    if (!own) return;
    let server = "";
    try {
      server = await fetchServerVersion(baseUrl);
    } catch {
      // 离线或接口抽风：静默跳过，下次时机再问
      return;
    }
    if (server && server !== own) setAvailableVersion(server);
  }, [baseUrl, dismissed]);

  useEffect(() => {
    // 孩子点了"稍后"就整个收工：下面这些定时器和监听一个都不再挂上，
    // 免得过五分钟又冒出来。想更新的话，下次打开 App 还会再提示一次。
    if (dismissed) return;
    ownVersionRef.current = currentAppVersion();
    let stopped = false;

    const firstTimer = window.setTimeout(() => {
      if (!stopped) void check();
    }, FIRST_CHECK_DELAY_MS);
    const interval = window.setInterval(() => {
      if (!stopped && document.visibilityState === "visible") void check();
    }, CHECK_INTERVAL_MS);
    // App 切回前台是最容易碰上"已经被更新过了"的时刻，单独听一下
    const onVisibility = () => {
      if (!stopped && document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      window.clearTimeout(firstTimer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [check, dismissed]);

  return {
    /** 有新版本时是新的版本号，否则空字符串 */
    availableVersion,
    /** 换到新版：整页重载，拿到新的那份 index.html */
    apply: useCallback(() => switchToLatestVersion(availableVersion), [availableVersion]),
    /** 这次不更新，别再提示了 */
    dismiss: useCallback(() => {
      setAvailableVersion("");
      setDismissed(true);
    }, []),
  };
}
