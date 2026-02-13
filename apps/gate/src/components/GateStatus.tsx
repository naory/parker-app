'use client'

interface GateStatusProps {
  open: boolean
  mode: 'entry' | 'exit'
}

export function GateStatus({ open, mode }: GateStatusProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg p-8 transition-colors duration-500 ${
        open ? 'bg-green-500' : 'bg-red-500'
      }`}
    >
      <div className="text-6xl">{open ? '\u2191' : '\u2193'}</div>
      <p className="mt-2 text-xl font-bold text-white">{open ? 'GATE OPEN' : 'GATE CLOSED'}</p>
      <p className="mt-1 text-sm text-white/80">
        Mode: {mode === 'entry' ? 'Entry' : 'Exit'}
      </p>
    </div>
  )
}
