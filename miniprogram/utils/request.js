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

function request(options) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync("familyEduToken");
    const url = `${config.baseUrl}${options.url}`;
    const header = {
      "Content-Type": "application/json"
    };
    if (options.auth !== false && token) {
      header.Authorization = `Bearer ${token}`;
    }
    wx.request({
      url,
      method: options.method || "GET",
      data: options.data || {},
      header,
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
        resolve(res.data);
      },
      fail(error) {
        const detail = error && error.errMsg ? error.errMsg : "unknown request error";
        console.error("[family-edu request failed]", { url, detail });
        reject(new Error(`网络连接失败：${detail}`));
      }
    });
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
        reject(new Error(`文件上传失败：${detail}`));
      }
    });
  });
}

module.exports = {
  request,
  uploadFile,
  clearSession
};
