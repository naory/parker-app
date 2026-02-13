'use client'

import { useRef, useState, useCallback } from 'react'

interface CameraFeedProps {
  onCapture: (plate: string) => void
}

export function CameraFeed({ onCapture }: CameraFeedProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [streaming, setStreaming] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 1280, height: 720 },
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setStreaming(true)
      }
    } catch (err) {
      console.error('Camera access denied:', err)
      setError('Camera access denied. Please allow camera permissions.')
    }
  }, [])

  const captureAndScan = useCallback(async () => {
    if (!videoRef.current || processing) return
    setProcessing(true)
    setError(null)

    try {
      const canvas = document.createElement('canvas')
      canvas.width = videoRef.current.videoWidth
      canvas.height = videoRef.current.videoHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(videoRef.current, 0, 0)

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.8),
      )
      if (!blob) return

      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve((reader.result as string).split(',')[1])
        reader.readAsDataURL(blob)
      })

      const apiUrl = process.env.NEXT_PUBLIC_API_URL
      const res = await fetch(`${apiUrl}/api/gate/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Scan failed')
        return
      }

      const data = await res.json()

      if (data.plateNumber) {
        onCapture(data.plateNumber)
      } else {
        setError('No valid plate detected. Try again or enter manually.')
      }
    } catch (err) {
      console.error('Scan failed:', err)
      setError('Network error — scan failed')
    } finally {
      setProcessing(false)
    }
  }, [onCapture, processing])

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-black shadow-sm">
      <div className="relative aspect-video">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
        />

        {!streaming && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
            <button
              onClick={startCamera}
              className="rounded-lg bg-parker-600 px-6 py-3 font-medium text-white hover:bg-parker-700"
            >
              Start Camera
            </button>
          </div>
        )}

        {/* ALPR overlay */}
        {streaming && (
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-4">
            {error && (
              <p className="rounded bg-red-500/90 px-3 py-1 text-xs font-medium text-white backdrop-blur">
                {error}
              </p>
            )}
            <button
              onClick={captureAndScan}
              disabled={processing}
              className="rounded-lg bg-white/90 px-6 py-2 text-sm font-medium text-parker-800 shadow backdrop-blur transition hover:bg-white disabled:opacity-50"
            >
              {processing ? 'Scanning...' : 'Scan Plate'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
