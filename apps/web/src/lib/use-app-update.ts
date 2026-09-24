import { useCallback, useEffect, useRef, useState } from "react";
import { currentAppVersion, fetchServerVersion, switchToLatestVersion } from "./app-version";

/** 刚打开就先让页面把内容渲染出来，版本检查晚一点再问，不跟首屏抢带宽 */
const FIRST_CHECK_DELAY_MS = 3000;

/**
 * 盯一下"服务器上是不是已经换成新版了"。
 *
 * 只对一次，不做定时轮询：页面每次加载（打开 App、刷新）查一次就够了。
 * 轮询会平白多出很多请求，而且提示可能在你正用着的时候冒出来，很打扰。
 *
 * 另外听一下"页面重新可见"：App 从后台切回来时页面并不会重新加载，
 * 不查这一下就永远发现不了更新（这正是当初做这个功能要解决的事）。
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
    // 孩子点了"稍后"就整个收工，连监听也一并摘掉，
    // 免得切一次后台就冒出来一次。想更新的话，下次打开 App 还会再提示。
    if (dismissed) return;
    ownVersionRef.current = currentAppVersion();
    let stopped = false;

    const firstTimer = window.setTimeout(() => {
      if (!stopped) void check();
    }, FIRST_CHECK_DELAY_MS);
    // App 切回前台时页面不会重新加载，所以这一下必须查，否则发现不了更新
    const onVisibility = () => {
      if (!stopped && document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      window.clearTimeout(firstTimer);
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
