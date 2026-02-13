'use client'

import { formatPlate } from '@parker/core'

interface PlateResultProps {
  plate: string
  mode: 'entry' | 'exit'
}

export function PlateResult({ plate, mode }: PlateResultProps) {
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Detected Plate</p>
          <p className="text-2xl font-bold tracking-wider text-parker-800">
            {formatPlate(plate)}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            mode === 'entry'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {mode === 'entry' ? 'ENTRY' : 'EXIT'}
        </span>
      </div>
    </div>
  )
}
