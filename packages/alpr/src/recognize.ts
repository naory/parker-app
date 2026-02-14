import vision from '@google-cloud/vision'

import { normalizePlate } from './normalize'

const client = new vision.ImageAnnotatorClient()

export interface RecognitionResult {
  raw: string
  normalized: string | null
  confidence: number
}

/**
 * Recognize a license plate from an image buffer using Google Cloud Vision API.
 * Optionally pass a `countryCode` (ISO 3166-1 alpha-2) to restrict normalization
 * to that country's plate format. Without it, all known formats are tried.
 */
export async function recognizePlate(
  imageBuffer: Buffer,
  countryCode?: string,
): Promise<RecognitionResult | null> {
  const [result] = await client.textDetection({
    image: { content: imageBuffer.toString('base64') },
  })

  const detections = result.textAnnotations
  if (!detections || detections.length === 0) {
    return null
  }

  // The first annotation is the full text, rest are individual words
  // Look through all detections for something that looks like a plate
  for (const detection of detections) {
    const text = detection.description?.trim()
    if (!text) continue

    const normalized = normalizePlate(text, countryCode)
    if (normalized) {
      return {
        raw: text,
        normalized,
        confidence: detection.score ?? 0.8,
      }
    }
  }

  // Fallback: return the full text for manual review
  const fullText = detections[0]?.description?.trim() || ''
  return {
    raw: fullText,
    normalized: normalizePlate(fullText, countryCode),
    confidence: 0,
  }
}
