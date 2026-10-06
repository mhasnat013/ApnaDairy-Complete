import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useUi } from '../../context/UiContext'
import { SkeletonRows } from '../../components/Skeleton'
import { useAuth } from '../../context/AuthContext'
import { roleLabel } from '../../lib/roles'
import PageHeader from '../../components/PageHeader'
import Alert from '../../components/Alert'
import Badge from '../../components/Badge'
import Segmented from '../../components/Segmented'
import EmptyState from '../../components/EmptyState'
import { date } from '../../lib/format'
import { setDemoCenter } from '../../lib/center'

const roleFilters = ['all', 'super_admin', 'area_manager', 'business', 'farmer', 'customer']


export default function Users() {
  const { profile: me } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('all')
  const [busy, setBusy] = useState(null)
  const { toast, confirm } = useUi()

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, role, status, created_at')
      .order('created_at', { ascending: false })
    const { data: centers } = await supabase.from('area_managers').select('id, user_id, is_demo, center_name, type')
    const { data: devs } = await supabase.from('iot_devices').select('serial, area_manager_id')
    const byUser = Object.fromEntries((centers ?? []).map((c) => [c.user_id, { ...c, device: (devs ?? []).find((d) => d.area_manager_id === c.id)?.serial }]))
    setError(error?.message ?? '')
    setUsers((data ?? []).map((u) => ({ ...u, center: byUser[u.id] })))
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter((u) =>
      (role === 'all' || u.role === role) &&
      (!q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.phone ?? '').includes(q)))
  }, [users, search, role])

  const countOf = (r) => users.filter((u) => u.role === r).length

  const run = async (u, rpc, args, ask) => {
    if (ask && !(await confirm(ask))) return
    setBusy(u.id)
    const { error } = await supabase.rpc(rpc, { p_user: u.id, ...args })
    setBusy(null)
    if (error) return toast(error.message, 'error')
    toast(`${u.full_name} updated.`)
    load()
  }

  return (
    <>
      <PageHeader title="Users" description="Everyone with an ApnaDairy account. Suspend or reactivate accounts here; new admins are created on the Admins page." />


      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input className="input w-full sm:w-72" placeholder="Search name, email or phone"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <Segmented value={role} onChange={setRole}
          options={roleFilters.map((r) => ({ value: r, label: r === 'all' ? 'All' : roleLabel[r], count: r === 'all' ? users.length : countOf(r) }))} />
      </div>

      <Alert>{error}</Alert>

      <div className="panel mt-3 overflow-x-auto">
        <table className="table min-w-[760px]">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows cols={5} />}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={5}><EmptyState title="No users match">Try a different name, email or role.</EmptyState></td></tr>
            )}
            {!loading && shown.map((u) => {
              const isMe = u.id === me.id
              const isAdmin = u.role === 'super_admin'
              const canToggle = !isMe && !isAdmin && ['active', 'suspended'].includes(u.status)
              return (
                <tr key={u.id}>
                  <td>
                    <p className="font-semibold text-ink">{u.full_name}{isMe && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}</p>
                    <p className="text-[13px] text-muted">{u.email}</p>
                    {u.center && <p className="text-[12.5px] text-muted">{u.center.center_name}{u.center.is_demo && <span className="ml-2 rounded-full bg-haldi-soft px-2 py-0.5 text-[11.5px] font-semibold text-amber">Demo</span>}{u.center.device && <Link to="/admin/iot-devices" className="ml-2 rounded-full bg-mint-soft px-2 py-0.5 text-[11.5px] font-semibold text-forest hover:underline">Device {u.center.device}</Link>}</p>}
                  </td>
                  <td>{roleLabel[u.role]}</td>
                  <td>
                    <Badge status={u.status} />
                  </td>
                  <td className="num text-muted">{date(u.created_at)}</td>
                  <td>
                    <div className={`flex justify-end gap-2 ${busy === u.id ? 'opacity-50 pointer-events-none' : ''}`}>
                      {isAdmin && !isMe && <Link to="/admin/admins" className="btn-ghost btn-sm">Manage on Admins</Link>}
                      {u.center && u.status === 'active' && (
                        <button className="btn-secondary btn-sm" onClick={async () => {
                          const demo = !u.center.is_demo
                          if (!(await confirm(demo
                            ? { title: `Make ${u.center.center_name} a demo account?`, body: 'It can then load sample farmers, milk, orders and reviews. Use this only for test or presentation accounts.', confirmLabel: 'Make demo' }
                            : { title: `Turn off demo for ${u.center.center_name}?`, body: 'It can no longer load sample data. Sample data already loaded stays until the center clears it.', confirmLabel: 'Turn off' }))) return
                          setBusy(u.id)
                          try { await setDemoCenter(u.id, demo); toast(demo ? 'Marked as a demo account.' : 'Demo turned off.'); load() } catch (e) { toast(e.message, 'error') }
                          setBusy(null)
                        }}>{u.center.is_demo ? 'Demo off' : 'Make demo'}</button>
                      )}
                      {canToggle && (u.status === 'active' ? (
                        <button onClick={() => run(u, 'set_user_status', { p_status: 'suspended' }, { title: `Suspend ${u.full_name}?`, body: 'They are signed out of the portal until you reactivate them.', confirmLabel: 'Suspend', danger: true })}
                          className="btn-danger btn-sm">Suspend</button>
                      ) : (
                        <button onClick={() => run(u, 'set_user_status', { p_status: 'active' })}
                          className="btn-primary btn-sm">Reactivate</button>
                      ))}
                      {['pending', 'rejected'].includes(u.status) && (
                        <span className="text-[13px] text-muted">Use Approvals</span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
