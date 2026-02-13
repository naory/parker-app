'use client'

export default function Settings() {
  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold text-parker-800">Lot Settings</h1>

      <div className="max-w-lg space-y-6">
        {/* Lot info */}
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold text-gray-700">Lot Information</h2>
          <div className="space-y-3">
            <Field label="Lot ID" value={process.env.NEXT_PUBLIC_LOT_ID || ''} disabled />
            <Field label="Lot Name" value="" placeholder="My Parking Lot" />
            <Field label="Address" value="" placeholder="123 Main St, Tel Aviv" />
            <Field label="Capacity" value="" placeholder="100" type="number" />
          </div>
        </section>

        {/* Pricing */}
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 font-semibold text-gray-700">Pricing</h2>
          <div className="space-y-3">
            <Field label="Rate per Hour (USDC)" value="" placeholder="3.30" type="number" />
            <Field label="Billing Increment (min)" value="15" type="number" />
            <Field label="Max Daily Fee (USDC)" value="" placeholder="25.00" type="number" />
          </div>
        </section>

        <button className="rounded-lg bg-parker-600 px-6 py-3 font-medium text-white transition hover:bg-parker-700">
          Save Settings
        </button>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  placeholder,
  type = 'text',
  disabled = false,
}: {
  label: string
  value: string
  placeholder?: string
  type?: string
  disabled?: boolean
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-gray-500">{label}</label>
      <input
        type={type}
        defaultValue={value}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-parker-500 focus:outline-none disabled:bg-gray-50 disabled:text-gray-400"
      />
    </div>
  )
}
