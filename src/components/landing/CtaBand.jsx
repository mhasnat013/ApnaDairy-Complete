import { Link } from 'react-router-dom'
import Reveal from './Reveal'
import { FarmScene } from '../Farm'

export default function CtaBand() {
  return (
    <section className="px-3 pb-6 pt-6 sm:px-6 lg:px-8">
      <div className="relative mx-auto max-w-[1600px] overflow-hidden rounded-[32px] bg-haldi sm:rounded-[40px]">
        <div className="mx-auto grid max-w-[1320px] items-center gap-8 px-6 py-16 sm:px-8 lg:grid-cols-[1.2fr_1fr] lg:py-20">
          <Reveal>
            <h2 className="display text-[44px] leading-[1] text-forest-deep sm:text-[68px]">Bring your center onto ApnaDairy.</h2>
            <p className="mt-5 max-w-lg text-[18px] text-forest-deep/80">Sign up, upload your documents, and start buying, testing and selling on one record once you're verified.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/signup" className="btn-primary h-[52px] px-7 text-[16px]">Join ApnaDairy</Link>
              <Link to="/marketplace" className="btn-secondary h-[52px] border-forest-deep/20 bg-transparent px-7 text-[16px] hover:bg-forest-deep/5">Browse the marketplace</Link>
              <Link to="/requests" className="btn-secondary h-[52px] border-forest-deep/20 bg-transparent px-7 text-[16px] hover:bg-forest-deep/5">Browse bulk requests</Link>
            </div>
          </Reveal>
          <div className="relative hidden h-[300px] overflow-hidden rounded-[28px] bg-forest-deep lg:block">
            <FarmScene className="absolute inset-0 h-full w-full" />
          </div>
        </div>
      </div>
    </section>
  )
}
