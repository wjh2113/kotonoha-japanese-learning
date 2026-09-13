import { Capacitor } from '@capacitor/core'

/** 手机端 / 安卓 APK：只练习，不上传词库与课文。 */
export function isPracticeOnlyClient() {
  if (Capacitor.isNativePlatform()) return true
  if (typeof window === 'undefined') return false
  try {
    return window.matchMedia('(max-width: 860px)').matches
  } catch {
    return false
  }
}
