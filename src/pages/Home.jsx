import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useLoad } from '../lib/useLoad'
import PublicHeader from '../components/landing/PublicHeader'
import Hero from '../components/landing/Hero'
import ModuleDial from '../components/landing/ModuleDial'
import HowItWorks from '../components/landing/HowItWorks'
import Journey from '../components/landing/Journey'
import Problem from '../components/landing/Problem'
import LiveBoard from '../components/landing/LiveBoard'
import WhoFor from '../components/landing/WhoFor'
import CtaBand from '../components/landing/CtaBand'
import Footer from '../components/landing/Footer'

// the public homepage: hero → marquee → modules → video → six steps → live bulk market → who it's for → problem → call to action
// → live bulk market → who it's for → call to action
export default function Home() {
  const { data: requests } = useLoad(async () => {
    const { data, error } = await supabase.from('public_requests').select('*').order('bid_deadline')
    if (error) return [] // homepage still renders if the board can't load
    return data
  })
  // gentle snapping between full-screen sections, homepage only
  useEffect(() => {
    document.documentElement.classList.add('home-snap')
    return () => document.documentElement.classList.remove('home-snap')
  }, [])
  const live = requests && { count: requests.length, litres: requests.reduce((n, r) => n + Number(r.quantity_l), 0) }

  return (
    <div className="min-h-full bg-cream">
      <PublicHeader />
      <main>
        {/* first screen: photo hero + marquee */}
        <div className="screen flex flex-col pb-0 lg:h-[calc(100svh-68px)]">
          <Hero live={live} />
        
        </div>
        <ModuleDial />
        <Journey />
        <HowItWorks />
        <LiveBoard requests={requests} />
        <WhoFor />
        <Problem />
        <CtaBand />
      </main>
      <Footer />
    </div>
  )
}
