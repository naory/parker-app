'use client'

export default function OperatorDashboard() {
  // TODO: Fetch lot stats from API

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-parker-800">Operator Dashboard</h1>

      {/* Stats cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Current Occupancy" value="0 / --" />
        <StatCard label="Revenue Today" value="$0.00" />
        <StatCard label="Sessions Today" value="0" />
        <StatCard label="Avg Duration" value="--" />
      </div>

      {/* Revenue chart placeholder */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-700">Revenue This Week</h2>
        <div className="flex h-48 items-center justify-center text-gray-300">
          Chart coming soon...
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-parker-800">{value}</p>
    </div>
  )
}
