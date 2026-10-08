import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../lib/roles'
import PublicHeader from '../components/landing/PublicHeader'
import Footer from '../components/landing/Footer'
import Marketplace from '../components/Marketplace'

// the public product catalog: anyone can see what milk and dairy products are on sale now. view only.
export default function PublicMarketplace() {
  const { profile } = useAuth()
  return (
    <div className="min-h-full bg-cream">
      <PublicHeader />
      <main className="mx-auto max-w-[1320px] px-4 pb-20 pt-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-5 animate-rise">
          <div>
            <h1 className="display text-[40px] text-forest-deep sm:text-[48px]">Marketplace</h1>
            <p className="mt-2 max-w-[640px] text-[16.5px] text-muted">Milk and dairy products on sale now at verified ApnaDairy centers. Every can of milk was tested on the center's IoT device and graded by our AI. Browse and compare here; buying happens in the ApnaDairy app.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/requests" className="btn-secondary">Bulk requests</Link>
            {profile?.role === 'business'
              ? <Link to="/business/marketplace" className="btn-primary">Open in your portal</Link>
              : profile ? <Link to={homeFor(profile.role)} className="btn-primary">Open your portal</Link>
              : <Link to="/signup?role=business" className="btn-primary">Need milk in bulk?</Link>}
          </div>
        </div>
        <div className="mt-6"><Marketplace /></div>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="panel p-5">
            <p className="display text-[20px]">What is on sale now</p>
            <p className="mt-1 text-[14.5px] text-muted">The marketplace shows what centers have in stock today. Milk sells for 2 days from collection, then it leaves the list on its own.</p>
          </div>
          <div className="rounded-[20px] bg-haldi p-5">
            <p className="display text-[20px] text-forest-deep">Need a large, specific amount?</p>
            <p className="mt-1 text-[14.5px] text-forest-deep/80">Businesses post a bulk request, like 1,000 L of premium milk in three weeks, and verified centers send their price.</p>
            <Link to="/requests" className="btn-primary btn-sm mt-4">See bulk requests</Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  )
}
