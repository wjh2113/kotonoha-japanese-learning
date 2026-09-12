import { useEffect, useRef, useState } from 'react'
import { apiFetch, readApiJson } from './api'
import { publicApiMessage } from './error-text'

const GATEWAY_PREF_KEY = 'kotonoha.preferSpeechGateway'

function browserSpeechSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
}

function shouldEscalateToGateway(errorCode: string) {
  return ['network', 'service-not-allowed', 'not-supported'].includes(errorCode)
}

function readPreferGateway() {
  try {
    return sessionStorage.getItem(GATEWAY_PREF_KEY) === '1'
  } catch {
    return false
  }
}

function writePreferGateway() {
  try {
    sessionStorage.setItem(GATEWAY_PREF_KEY, '1')
  } catch {
    // ignore quota / private mode
  }
}

export function usePronunciationPractice(onTranscript: (text: string) => void, resetKey?: string) {
  const [recording, setRecording] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [error, setError] = useState('')
  const recognition = useRef<SpeechRecognition | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const onTranscriptRef = useRef(onTranscript)
  // Default: free browser STT. Escalate to paid speech after Google STT fails (common in CN).
  const preferGateway = useRef(readPreferGateway())
  onTranscriptRef.current = onTranscript

  const cleanup = () => {
    recognition.current?.stop()
    if (recorder.current?.state === 'recording') recorder.current.stop()
    stream.current?.getTracks().forEach((track) => track.stop())
  }

  useEffect(() => () => cleanup(), [])

  useEffect(() => {
    if (resetKey === undefined) return
    setError('')
    setRecording(false)
    setEvaluating(false)
    cleanup()
  }, [resetKey])

  const finish = (text: string) => {
    onTranscriptRef.current(text)
    setRecording(false)
    setEvaluating(false)
    setError('')
  }

  const sendToGateway = async (blob: Blob) => {
    setEvaluating(true)
    try {
      const audioBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '')
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      const extension = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm'
      const response = await apiFetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64,
          mimeType: blob.type || 'audio/webm',
          filename: `pronunciation.${extension}`,
        }),
      })
      const data = await readApiJson<{ text?: string; error?: string }>(
        response,
        '云端语音识别暂时不可用，请稍后重试。',
      )
      if (!response.ok || !data.text) {
        throw new Error(publicApiMessage(data.error, '云端语音识别失败，请稍后重试。'))
      }
      finish(String(data.text))
    } catch (reason) {
      setEvaluating(false)
      setError(publicApiMessage(reason instanceof Error ? reason.message : '', '云端语音识别失败，请稍后重试。'))
    }
  }

  const startGateway = async () => {
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      setError('当前环境无法录音，请使用最新版 Chrome 或 Edge。')
      return
    }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = mediaStream
      const supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((type) => MediaRecorder.isTypeSupported(type))
      const mediaRecorder = new MediaRecorder(mediaStream, supported ? { mimeType: supported } : undefined)
      recorder.current = mediaRecorder
      chunks.current = []
      mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data) }
      mediaRecorder.onstop = () => {
        mediaStream.getTracks().forEach((track) => track.stop())
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || 'audio/webm' })
        setRecording(false)
        if (blob.size) void sendToGateway(blob)
      }
      setError('')
      setRecording(true)
      mediaRecorder.start()
    } catch {
      setError('请允许浏览器使用麦克风。')
    }
  }

  const escalateToGateway = () => {
    preferGateway.current = true
    writePreferGateway()
    // Mic permission is fine; Chrome's Google STT cloud is unreachable (common in CN).
    setError('浏览器自带识别连不上（需访问 Google），已改用云端识别。')
    void startGateway()
  }

  const startBrowser = () => {
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!Constructor) {
      escalateToGateway()
      return
    }
    const instance = new Constructor()
    recognition.current = instance
    instance.lang = 'ja-JP'
    instance.interimResults = false
    instance.continuous = false
    instance.onresult = (event) => finish(event.results[0][0].transcript)
    instance.onerror = (event) => {
      setRecording(false)
      if (event.error === 'not-allowed') {
        setError('请允许浏览器使用麦克风。')
        return
      }
      if (event.error === 'no-speech' || event.error === 'aborted') {
        setError('没有听清，请再读一次。')
        return
      }
      if (shouldEscalateToGateway(event.error)) {
        escalateToGateway()
        return
      }
      setError('没有听清，请再读一次。')
    }
    instance.onend = () => setRecording(false)
    setError('')
    setRecording(true)
    try {
      instance.start()
    } catch {
      escalateToGateway()
    }
  }

  const start = () => {
    if (preferGateway.current || !browserSpeechSupported()) {
      preferGateway.current = true
      writePreferGateway()
      void startGateway()
      return
    }
    startBrowser()
  }

  const stop = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
    else recognition.current?.stop()
  }

  return {
    recording,
    evaluating,
    error,
    usingGateway: preferGateway.current,
    start,
    stop,
    setError,
  }
}
