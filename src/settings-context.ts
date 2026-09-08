import { createContext } from 'react'
import type { AppSettings } from './types'

export const DEFAULT_SETTINGS: AppSettings = { avatar: 'ゆ', voiceGender: 'female' }
export const SettingsContext = createContext<AppSettings>(DEFAULT_SETTINGS)
