import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { requestBoard, myBids, milkLabel, qualityLabel, reqTitle, qtyText, perUnit, isMilk, productLabel } from '../../lib/b2b'
import { useLoad } from '../../lib/useLoad'
import { rs, litres, date, relative, cap } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import EmptyState from '../../components/EmptyState'
import { SkeletonRows } from '../../components/Skeleton'

export default function BulkRequests() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const [tab, setTab] = useState('board')

  const { data, error, loading } = useLoad(async () => {
    const { data: center } = await supabase.from('area_managers').select('type').eq('user_id', profile.id).single()
    const [board, bids] = await Promise.all([requestBoard(), myBids()])
    return { board, bids, byproduct: center?.type === 'byproduct' }
  }, [profile.id])

  const bidFor = Object.fromEntries((data?.bids ?? []).map((b) => [b.requirement?.id, b]))
  const liveBids = (data?.bids ?? []).filter((b) => b.status === 'submitted').length

  return (
    <>
      <PageHeader title="Bulk requests" description={data?.byproduct
        ? 'Restaurants, hotels and shops looking for desi ghee, butter, yogurt and other dairy products in bulk. Offers are public; a buyer can split a big order between sellers.'
        : 'Restaurants, hotels and shops looking for milk in bulk. Offers are public; a buyer can split a big order between centers.'} />

      <div className="mb-4">
        <Segmented value={tab} onChange={setTab} options={[
          { value: 'board', label: 'Open requests', count: data?.board?.length },
          { value: 'mine', label: 'My bids', count: data ? liveBids : null },
        ]} />
      </div>
      <Alert>{error}</Alert>

      {tab === 'board' ? (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[900px]">
            <thead>
              <tr><th>Buyer</th><th>Needs</th><th>Delivery</th><th className="text-right">Target</th><th className="text-right">Offers</th><th>Closes</th><th>Your bid</th></tr>
            </thead>
            <tbody>
              {loading && <SkeletonRows cols={7} />}
              {!loading && data?.board?.length === 0 && (
                <tr><td colSpan={7}><EmptyState title="No open requests right now">New requests from businesses appear here as soon as they're posted.</EmptyState></td></tr>
              )}
              {data?.board?.map((r) => {
                const mine = bidFor[r.id]
                return (
                  <tr key={r.id} className="clickable" onClick={() => nav(`/manager/bulk-requests/${r.id}`)}>
                    <td><p className="font-semibold">{r.business_name}</p><p className="text-[13px] text-muted">{cap(r.business_type)}</p></td>
                    <td>
                      <Link to={`/manager/bulk-requests/${r.id}`} onClick={(e) => e.stopPropagation()} className="num font-semibold hover:underline">
                        {reqTitle(r)}
                      </Link>
                      {r.remaining_l != null && Number(r.remaining_l) < Number(r.quantity_l) && <p className="num text-[12.5px] font-semibold text-amber">{qtyText(r.remaining_l, r.unit)} still needed</p>}
                      <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold ${r.quality === 'fresh' ? 'bg-mint-soft text-forest' : r.quality === 'premium' ? 'bg-haldi-soft text-amber' : 'bg-cream-2 text-muted'}`}>{qualityLabel[r.quality]}</span>
                    </td>
                    <td className="num">{date(r.required_date)}<p className="text-[13px] text-muted">{r.delivery_city}</p></td>
                    <td className="num text-right">{r.target_price ? <>{rs(r.target_price)}<span className="text-[12px] text-muted"> / {perUnit(r.unit)}</span></> : <span className="text-muted">Open</span>}</td>
                    <td className="num text-right">{r.bid_count}{r.lowest_offer ? <p className="text-[12.5px] font-semibold text-forest">from {rs(r.lowest_offer)}</p> : null}</td>
                    <td className="text-muted">{relative(r.bid_deadline)}</td>
                    <td>{mine && mine.status === 'submitted' ? <Badge tone="green">{rs(mine.price_per_l)}</Badge> : <span className="btn-secondary btn-sm">Bid</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[820px]">
            <thead><tr><th>Request</th><th className="text-right">Your price</th><th className="text-right">Your quantity</th><th>You deliver</th><th>Status</th></tr></thead>
            <tbody>
              {data?.bids?.length === 0 && (
                <tr><td colSpan={5}><EmptyState title="You haven't bid yet">Open a request from the board to send your price.</EmptyState></td></tr>
              )}
              {data?.bids?.map((b) => (
                <tr key={b.id} className="clickable" onClick={() => b.requirement && nav(`/manager/bulk-requests/${b.requirement.id}`)}>
                  <td>
                    <p className="num font-semibold">{b.requirement ? reqTitle(b.requirement) : 'Request removed'}</p>
                    <p className="text-[13px] text-muted">{b.requirement?.delivery_city}{b.requirement?.target_price ? `, target ${rs(b.requirement.target_price)}` : ''}</p>
                  </td>
                  <td className="num text-right font-semibold">{rs(b.price_per_l)}<span className="text-[12px] font-normal text-muted"> / {perUnit(b.requirement?.unit)}</span></td>
                  <td className="num text-right">{qtyText(b.quantity_l, b.requirement?.unit)}</td>
                  <td className="num">{date(b.delivery_date)}</td>
                  <td><Badge status={b.status}>{b.status === 'submitted' ? 'Waiting for buyer' : b.status === 'accepted' ? 'Won' : undefined}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
