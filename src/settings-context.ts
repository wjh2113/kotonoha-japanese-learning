import { createContext } from 'react'
import type { AppSettings } from './types'

export const DEFAULT_SETTINGS: AppSettings = { avatar: 'ゆ', voiceGender: 'female', theme: 'matcha', streakDays: 0, lastStudyDate: '', displayName: '小林同学' }
export const SettingsContext = createContext<AppSettings>(DEFAULT_SETTINGS)
