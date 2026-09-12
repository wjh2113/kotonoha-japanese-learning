import { createContext } from 'react'
import type { AppSettings } from './types'

export const DEFAULT_SETTINGS: AppSettings = { avatar: 'ゆ', voiceGender: 'female', theme: 'aka' }
export const SettingsContext = createContext<AppSettings>(DEFAULT_SETTINGS)
