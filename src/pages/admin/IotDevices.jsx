import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import { allDevices, deviceActivity, saveDevice, assignDevice, activeCenters } from '../../lib/center'
import { relative } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Card, { Kpi } from '../../components/Card'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import Sheet from '../../components/Sheet'
import EmptyState from '../../components/EmptyState'

// where the device writes in firebase: the live folder, or a folder of typed values for demos
const FOLDERS = [['Result', 'Live device'], ['Demo', 'Demo values']]
const DEFAULT_DB = 'https://milk123-3b7d4-default-rtdb.firebaseio.com'

export default function IotDevices() {
  const { data, error, reload } = useLoad(async () => {
    const [devices, activity, centers] = await Promise.all([allDevices(), deviceActivity(), activeCenters()])
    return { devices, activity, centers }
  })
  const [editing, setEditing] = useState(null)
  const devices = data?.devices ?? []
  const act = (serial) => data?.activity?.find((a) => a.serial === serial)
  const inUse = devices.filter((d) => d.area_manager_id && d.is_active).length
  const tests = (data?.activity ?? []).reduce((n, a) => n + Number(a.tests_7d), 0)
  const failed = (data?.activity ?? []).reduce((n, a) => n + Number(a.failed_7d), 0)
  const without = (data?.centers ?? []).filter((c) => !devices.some((d) => d.area_manager_id === c.id))

  return (
    <>
      <PageHeader title="IoT devices" description="Every ESP32 milk tester. A center can only test and buy milk with the device given to it here, after its device bill is paid.">
        <button className="btn-primary" onClick={() => setEditing({})}><Icon name="plus" size={17} />Add device</button>
      </PageHeader>
      <Alert>{error}</Alert>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi accent label="Devices" value={data ? devices.length : null} icon={<Icon name="chip" size={16} />} note={data ? `${devices.length - devices.filter((d) => d.area_manager_id).length} not given yet` : ''} />
        <Kpi label="In use" value={data ? inUse : null} note="given to a center and switched on" />
        <Kpi label="Centers without a device" value={data ? without.length : null} note="they cannot buy milk yet" />
        <Kpi label="Tests in 7 days" value={data ? tests : null} note={data ? `${failed} needed a re-test` : ''} />
      </div>

      <Card className="mt-5" title="All devices" bodyClass="pt-3">
        {data && devices.length === 0 && <EmptyState title="No devices yet">Add the serial printed on each tester.</EmptyState>}
        <div className="overflow-x-auto">
          {devices.length > 0 && (
            <table className="table min-w-[820px]">
              <thead><tr><th>Device</th><th>Center</th><th>Reads from</th><th>Last test</th><th className="text-right">Tests, 7 days</th><th>Status</th><th /></tr></thead>
              <tbody>
                {devices.map((d) => {
                  const a = act(d.serial)
                  return (
                    <tr key={d.serial}>
                      <td><p className="num font-semibold">{d.serial}</p><p className="max-w-[220px] truncate text-[12.5px] text-muted">{d.label ?? 'ESP32 tester'}</p></td>
                      <td>{d.center ? <><p className="font-medium">{d.center.center_name}</p><p className="text-[12.5px] text-muted">{d.center.city}</p></> : <span className="text-muted">Not given yet</span>}</td>
                      <td><span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${d.path === 'Result' ? 'bg-mint-soft text-forest' : 'bg-haldi-soft text-amber'}`}>{d.path === 'Result' ? 'Live device' : d.path === 'Demo' ? 'Demo values' : d.path}</span></td>
                      <td className="text-[13.5px]">{a?.last_test ? relative(a.last_test) : <span className="text-muted">Never</span>}</td>
                      <td className="num text-right">{a ? Number(a.tests_7d) : 0}{Number(a?.failed_7d) > 0 && <p className="text-[12px] text-amber">{Number(a.failed_7d)} re-test</p>}</td>
                      <td>{d.is_active ? <Badge tone="green">On</Badge> : <Badge tone="grey">Off</Badge>}</td>
                      <td className="text-right"><button className="btn-secondary btn-sm" onClick={() => setEditing(d)}>Manage</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {without.length > 0 && (
        <Card className="mt-5" title="Centers waiting for a device" subtitle="Approved milk centers with no tester yet. Give them one from Manage.">
          <ul className="flex flex-wrap gap-2">
            {without.map((c) => <li key={c.id} className="rounded-full bg-cream px-3 py-1.5 text-[13px]"><b className="font-semibold">{c.center_name}</b><span className="text-muted"> · {c.city}</span></li>)}
          </ul>
        </Card>
      )}

      <DeviceSheet key={editing ? editing.serial ?? 'new' : 'closed'} device={editing} devices={devices} centers={data?.centers ?? []}
        onClose={() => setEditing(null)} onSaved={reload} />
    </>
  )
}

function DeviceSheet({ device, devices, centers, onClose, onSaved }) {
  const { toast, confirm } = useUi()
  const isNew = device && !device.serial
  const [f, setF] = useState(() => ({
    serial: '', label: '', db_url: DEFAULT_DB, path: 'Result', is_active: true, ...(device ?? {}),
    center: device?.area_manager_id ?? '',
  }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e?.target ? e.target.value : e }))
  // a center has one device: giving this one takes away the one it has
  const holder = f.center && devices.find((d) => d.area_manager_id === f.center && d.serial !== device?.serial)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!/^[A-Za-z0-9-]{3,30}$/.test(f.serial.trim())) return setErr('Serial: 3 to 30 letters, numbers or dashes, as printed on the device.')
    if (isNew && devices.some((d) => d.serial === f.serial.trim().toUpperCase())) return setErr('A device with this serial already exists.')
    if (!/^https:\/\/[a-z0-9.-]+\.(firebaseio\.com|firebasedatabase\.app)\/?$/i.test(f.db_url.trim())) return setErr('Database link: the Firebase Realtime Database URL, like https://name-default-rtdb.firebaseio.com')
    if (!/^[A-Za-z0-9_/-]{1,60}$/.test(f.path.trim())) return setErr('Folder: letters, numbers, dashes or slashes only.')
    const moving = (device?.area_manager_id ?? '') !== f.center
    if (moving && device?.area_manager_id) {
      const from = device.center?.center_name ?? 'its center'
      if (!(await confirm({ title: f.center ? `Move ${device.serial}?` : `Take ${device.serial} back?`, body: `${from} will no longer be able to test and buy milk with it.`, confirmLabel: f.center ? 'Move device' : 'Take back', danger: true }))) return
    }
    setBusy(true)
    try {
      const saved = await saveDevice(f)
      if (moving) await assignDevice(saved.serial, f.center || null)
      toast(isNew ? `Device ${saved.serial} added.` : `Device ${saved.serial} saved.`)
      onSaved(); onClose()
    } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }

  return (
    <Sheet open={!!device} onClose={onClose} title={isNew ? 'Add device' : `Device ${device?.serial ?? ''}`}
      subtitle={isNew ? 'The serial printed on the tester and where it sends readings.' : 'Change where it reads from, who has it, or switch it off.'}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" form="device-form" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="device-form" onSubmit={submit} className="grid gap-4">
        <Alert>{err}</Alert>
        <div className="field"><label htmlFor="ds">Serial</label>
          <input id="ds" className="input num uppercase" placeholder="AD-IOT-0002" value={f.serial} onChange={set('serial')} disabled={!isNew} required /></div>
        <div className="field"><label htmlFor="dl">Name <span className="font-normal text-muted">(optional)</span></label>
          <input id="dl" className="input" placeholder="ESP32 tester: temperature, pH, TDS" value={f.label ?? ''} onChange={set('label')} /></div>
        <div className="field"><label htmlFor="du">Firebase database link</label>
          <input id="du" className="input text-[14px]" value={f.db_url} onChange={set('db_url')} required />
          <span className="hint">The secret key stays on the server, never here.</span></div>
        <div className="field"><span className="label">Reads from folder</span>
          <div className="flex flex-wrap gap-1.5">
            {FOLDERS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => set('path')(k)}
                className={`rounded-full border-[1.5px] px-3.5 py-1.5 text-[13.5px] font-medium transition-all ${f.path === k ? 'border-forest bg-mint-soft text-forest' : 'border-line bg-white hover:border-[#cdbd98]'}`}>
                <span className="num">/{k}</span> · {l}</button>
            ))}
          </div>
          <span className="hint">{f.path === 'Demo' ? 'Readings come from values typed into the Demo folder in Firebase. Use this only for demos.' : 'Readings come from what the ESP32 sends.'}</span></div>
        <div className="field"><label htmlFor="dc">Given to</label>
          <select id="dc" className="input" value={f.center} onChange={set('center')}>
            <option value="">Nobody yet</option>
            {centers.map((c) => <option key={c.id} value={c.id}>{c.center_name}, {c.city}{devices.some((d) => d.area_manager_id === c.id && d.serial !== device?.serial) ? ' (has a device)' : ''}</option>)}
          </select>
          {holder && <span className="hint text-amber">This center already has {holder.serial}. It will be taken back and this one given instead.</span>}</div>
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-cream px-4 py-3">
          <span><span className="block text-[14px] font-semibold">Switched on</span><span className="text-[12.5px] text-muted">When off, the center cannot take readings with it.</span></span>
          <button type="button" role="switch" aria-checked={f.is_active} aria-label="Switched on" onClick={() => set('is_active')(!f.is_active)}
            className={`relative h-7 w-[52px] shrink-0 rounded-full transition-colors ${f.is_active ? 'bg-forest' : 'bg-line'}`}>
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${f.is_active ? 'left-[26px]' : 'left-0.5'}`} />
          </button>
        </div>
      </form>
    </Sheet>
  )
}
