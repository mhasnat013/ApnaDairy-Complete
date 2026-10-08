import { Link, useOutletContext } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'
import Icon from '../components/Icon'

// answers to the questions each kind of account asks most, in the order they come up
const FAQ = {
  milk_center: [
    ['How do I record milk from a farmer?', 'Open Record milk, pick the farmer and type the litres. Dip the probes and run the one-minute device test. AI Model 1 reads the temperature, pH and EC and predicts the quality (Good, Acceptable, Poor or Spoiled), freshness score, shelf life and spoilage risk. Good milk is bought as Premium, Acceptable as Fresh and Poor as Standard; Spoiled milk is not bought. Show the result and the suggested price to the farmer: if they accept, the milk goes into your stock; if they refuse, nothing is bought.'],
    ['Why can I not record milk right now?', 'Recording pauses when your ApnaDairy bill is overdue, or when your IoT device is not active yet. The device switches on once its bill is paid. Check the Billing page.'],
    ['How is the farmer’s price worked out?', 'ApnaDairy sets a market rate for each city. The AI adjusts it for the quality of each sample. You cannot offer less than the minimum farmer share the platform sets.'],
    ['How do I sell milk on the app?', 'Go to My shop and create a listing. You can list up to the fresh milk you have in stock, at up to the highest markup the platform allows. Customers order between the smallest and largest order size ApnaDairy sets.'],
    ['How do I give a discount on leftover milk?', 'Milk sells for 2 days from collection. On day 2, open My shop, press Edit on the listing and set a discount. No new test is needed. After 2 days the milk is discarded from stock and the listing ends, so it is never sold old. The AI shelf life shown for each batch is a prediction at the temperature it was tested; if it passes first, the milk can still be sold until its 2 days are up, so sell it first.'],
    ['What is dynamic pricing?', 'When you create or edit a milk listing, choose Free discount (you set any discount yourself) or Dynamic pricing. With dynamic pricing the price drops by itself, counted from when the oldest milk on the listing was tested: full price for the first 4 hours, 10% off until 12 hours, 20% off until 24 hours, 30% off (for yogurt or cooking) until the last 6 hours, then 40% off until it expires at 48 hours. The tested grade stays the same; customers see the stage and when the next drop comes. You can switch between the two at any time.'],
    ['How much can I bid on a bulk request?', 'Up to the milk you will really have at the grade the buyer asked for: milk of that grade still fresh on the delivery day, plus your usual share of that grade from what you collect by then, minus what you have already promised. If you have less than the buyer needs, bid what you have. The buyer can combine bids.'],
    ['What happens when I dispatch bulk milk?', 'No new test is needed. The milk goes out of your tested stock, of the grade you offered or better, and the buyer sees its grade, test time and freshness with the order. On arrival, the buyer gives your driver a 4-digit code to confirm delivery.'],
    ['How do I pay my ApnaDairy bill?', 'Pay by JazzCash, EasyPaisa or bank transfer, then enter the transaction ID on the Billing page. ApnaDairy checks it and marks the bill paid. Sellers with high monthly sales get a discount on the next month’s fee.'],
    ['How do I pay a farmer?', 'Open the farmer and press Pay. Choose cash or a mobile wallet. The farmer confirms in their app. If they say they were not paid, ApnaDairy looks into it.'],
  ],
  byproduct: [
    ['How do I add a product?', 'Go to Products and press Add product. Give the name, unit, price and how much you have, and the dates it was made and is best before. Expired stock is not sold.'],
    ['How do customers order?', 'Your products show in the ApnaDairy app under your shop. Orders appear on Shop orders. Move each order along, and the customer gives you a code when it arrives.'],
    ['How much can I bid on a bulk request?', 'Up to what you have in stock, plus what you will make by the delivery date. Say how much you will make so the buyer knows. The buyer can combine bids from several sellers.'],
    ['What do I pay ApnaDairy?', 'One monthly platform fee. Your sales are yours. Sellers with high monthly sales get a discount on the next month’s fee.'],
    ['How do I pay my bill?', 'Pay by JazzCash, EasyPaisa or bank transfer, then enter the transaction ID on the Billing page. ApnaDairy checks it and marks the bill paid.'],
  ],
  business: [
    ['How do I buy in bulk?', 'Post a requirement: what you need, how much, the delivery date and when bidding closes. Verified sellers bid in the open and you can see every offer.'],
    ['Can I take offers from more than one seller?', 'Yes. Accept bids one by one until your quantity is covered. You cannot accept more than you asked for.'],
    ['How do I confirm a delivery?', 'Each order has a 4-digit delivery code. Give it to the driver only when the order has arrived. You can also press Received yourself.'],
    ['How is milk quality checked?', 'You pick a grade: Standard, Fresh or Premium. Every can a center buys is tested on its IoT device and graded by AI Model 1: Good milk is Premium, Acceptable is Fresh and Poor is Standard. A center may offer a lower grade at a lower price, which is always shown clearly. Bulk milk goes out of the center’s tested stock of the grade offered or better, and you see its grade, test time and freshness on the order.'],
    ['How do I pay?', 'You pay the seller directly. ApnaDairy takes no cut from your orders.'],
    ['What if a seller cancels?', 'Your requirement opens again for bids for up to 12 hours, so other sellers can step in. Cancellations show on that seller’s track record.'],
  ],
}

export default function Help() {
  const { profile } = useAuth()
  const { center } = useOutletContext() ?? {}
  const kind = profile.role === 'business' ? 'business' : center?.type === 'byproduct' ? 'byproduct' : 'milk_center'
  return (
    <>
      <PageHeader title="Help" description="Answers to the questions people ask most about using ApnaDairy." />
      <div className="grid max-w-3xl gap-3">
        {FAQ[kind].map(([q, a]) => (
          <details key={q} className="panel group p-0 open:shadow-[0_18px_40px_-28px_rgb(23_58_40/.45)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[15.5px] font-semibold text-ink [&::-webkit-details-marker]:hidden">
              {q}
              <Icon name="plus" size={18} className="shrink-0 text-forest transition-transform group-open:rotate-45" />
            </summary>
            <p className="px-5 pb-5 text-[14.5px] leading-relaxed text-muted">{a}</p>
          </details>
        ))}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4 rounded-[20px] bg-forest-deep px-5 py-5 text-cream">
          <div>
            <p className="display text-[19px]">Still stuck?</p>
            <p className="mt-0.5 text-[14px] text-cream/75">Open a ticket and ApnaDairy will reply on the Support page.</p>
          </div>
          <Link to={`${profile.role === 'business' ? '/business' : '/manager'}/support?new=1`} className="btn-haldi">Contact support</Link>
        </div>
      </div>
    </>
  )
}
