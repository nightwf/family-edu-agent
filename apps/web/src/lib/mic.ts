/**
 * 文字模式语音输入的麦克风。
 *
 * 这里刻意不启用浏览器默认的音频处理链（回声消除 + 自动增益）：
 * 这两级都要几百毫秒才能收敛，收敛期间会把开头的声音压低甚至整段丢掉。
 * 孩子是"点一下马上就开口"，第一个字正好说在这段窗口里，
 * 表现就是识别结果稳定地少一个字。
 *
 * 关掉它们的代价很小：录音是整段发给服务端识别的，不存在"边听边放"，
 * 回声消除本来就没有用途；增益交给识别模型自己处理，比浏览器先抢着放大更稳。
 *
 * 注意：连续对话（免提）不能用这套参数——那边靠回声消除把私教自己的声音
 * 从麦克风里滤掉，否则它会听见自己说话而反复打断。两处需求相反，别合并。
 */
export const DICTATION_AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    autoGainControl: false,
    // 降噪保留：它不影响开头，家里的背景声（电视、空调）交给它压一压更划算。
    noiseSuppression: true,
    channelCount: 1,
  },
};

export function openDictationStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia(DICTATION_AUDIO_CONSTRAINTS);
}

/**
 * 录音开始后再等这么久，才把提示从"正在打开麦克风…"换成"正在聆听，点击结束"。
 *
 * 前一条解决"谁先把麦克风打开"，这一条解决"什么时候才算真的在听"：
 * 设备从开始采集到稳定出声音还有一小段，这段时间说什么都录不进去。
 * 提示语留在"正在打开麦克风…"，孩子看到"正在聆听"再开口，
 * 开头那一个字就不会落在预热窗口里；等待期间也不会有"以为在录其实没录"的错觉。
 */
export const DICTATION_WARMUP_MS = 220;
