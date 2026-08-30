const config = require("../config");

function clearSession() {
  try {
    wx.removeStorageSync("familyEduToken");
    wx.removeStorageSync("familyEduUser");
    wx.removeStorageSync("familyEduFamily");
  } catch (_error) {
    // ignore storage errors
  }
}

function buildNetworkError(prefix, detail) {
  let hint = "";
  if (/ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET/i.test(detail)) {
    hint = "。连接被中途关闭，请先关闭手机 VPN/代理/加速器，切换普通 Wi-Fi 或蜂窝网络后重试";
  } else if (/^request:fail$/i.test(detail)) {
    hint = "。微信网络层没有返回具体原因，通常是开发者工具或当前网络链路临时失败，请稍后重试";
  } else if (/domain|url not in domain|合法域名/i.test(detail)) {
    hint = "。请确认微信公众平台 request 合法域名已配置 https://edu.skillstores.com，并在开发者工具刷新域名";
  } else if (/timeout/i.test(detail)) {
    hint = "。请求超时，请切换网络后重试";
  }
  return `${prefix}：${detail}${hint}`;
}

function isTransientNetworkError(detail) {
  if (/domain|url not in domain|合法域名/i.test(detail || "")) return false;
  return /request:fail|ERR_SOCKET_NOT_CONNECTED|ERR_CONNECTION_CLOSED|ERR_CONNECTION_RESET|timeout|socket|connection/i.test(detail || "");
}

function request(options) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync("familyEduToken");
    const url = `${config.baseUrl}${options.url}`;
    const canCache = (options.method || "GET") === "GET" && options.auth !== false;
    const cacheKey = `familyEduCache:${url}`;
    const header = {
      "Content-Type": "application/json"
    };
    if (options.auth !== false && token) {
      header.Authorization = `Bearer ${token}`;
    }
    const maxRetry = options.retry === undefined ? 2 : Number(options.retry || 0);
    const send = (attempt) => {
      wx.request({
        url,
        method: options.method || "GET",
        data: options.data || {},
        header,
        timeout: 15000,
        enableHttp2: false,
        enableQuic: false,
        success(res) {
          if (res.statusCode === 401 && options.auth !== false) {
            clearSession();
            wx.reLaunch({ url: "/pages/login/login" });
            reject(new Error("登录已过期，请重新登录"));
            return;
          }
          if (res.statusCode >= 400) {
            const message = (res.data && res.data.error) || "请求失败";
            reject(new Error(message));
            return;
          }
          if (canCache) {
            try {
              wx.setStorageSync(cacheKey, { data: res.data, cachedAt: Date.now() });
            } catch (_error) {
              // ignore cache write errors
            }
          }
          resolve(res.data);
        },
        fail(error) {
          const detail = error && error.errMsg ? error.errMsg : "unknown request error";
          console.error("[family-edu request failed]", { url, detail, attempt });
          if (attempt < maxRetry && isTransientNetworkError(detail)) {
            setTimeout(() => send(attempt + 1), 350 + attempt * 500);
            return;
          }
          if (canCache) {
            try {
              const cached = wx.getStorageSync(cacheKey);
              if (cached && cached.data) {
                resolve({ ...cached.data, __stale: true, __cachedAt: cached.cachedAt });
                return;
              }
            } catch (_error) {
              // ignore cache read errors
            }
          }
          reject(new Error(buildNetworkError("网络连接失败", detail)));
        }
      });
    };
    send(0);
  });
}

function uploadFile(options) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync("familyEduToken");
    const url = `${config.baseUrl}${options.url}`;
    wx.uploadFile({
      url,
      filePath: options.filePath,
      name: options.name || "file",
      formData: options.formData || {},
      header: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 15000,
      success(res) {
        let data = {};
        try {
          data = JSON.parse(res.data || "{}");
        } catch (_error) {
          data = {};
        }
        if (res.statusCode >= 400) {
          reject(new Error(data.error || "上传失败"));
          return;
        }
        resolve(data);
      },
      fail(error) {
        const detail = error && error.errMsg ? error.errMsg : "unknown upload error";
        console.error("[family-edu upload failed]", { url, detail });
        reject(new Error(buildNetworkError("文件上传失败", detail)));
      }
    });
  });
}

module.exports = {
  request,
  uploadFile,
  clearSession
};
