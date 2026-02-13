'use client'

export default function Sessions() {
  // TODO: Fetch active sessions for this lot from API
  const lotId = process.env.NEXT_PUBLIC_LOT_ID

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-parker-800">Active Sessions</h1>
      <p className="mb-4 text-sm text-gray-500">Lot: {lotId}</p>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search by plate number..."
          className="w-full max-w-md rounded-lg border border-gray-300 px-4 py-2 focus:border-parker-500 focus:outline-none"
        />
      </div>

      {/* Sessions table */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Plate</th>
              <th className="px-4 py-3">Entry Time</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Est. Fee</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* TODO: Map over active sessions */}
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                No active sessions
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
