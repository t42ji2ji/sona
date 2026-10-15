// 背景 shader 讀的共用狀態：平常安靜，播放時跟著音樂，生成完成時綻放一次
export const fx = {
  bloomAt: -1e9,
  bloomHue: 280,
  hue: 280,
  analyser: null as AnalyserNode | null,
  playing: false,
  bloom(hue?: number) {
    this.bloomAt = performance.now()
    if (hue !== undefined) this.bloomHue = hue
  },
}
