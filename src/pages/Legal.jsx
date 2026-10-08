import PublicHeader from '../components/landing/PublicHeader'
import Footer from '../components/landing/Footer'

const UPDATED = '7 October 2026'
const CONTACT = 'apnadairy.fyp@gmail.com'

const PRIVACY = [
  ['Who we are', 'ApnaDairy is a final year project at Air University, Islamabad: a dairy procurement and marketplace platform that connects farmers, milk collection centers, dairy sellers, businesses and customers in Pakistan.'],
  ['What we collect', 'Your name, email address and mobile number. For area managers and businesses: the center or business name, city, address and the verification documents you upload. When you sign in with Google we receive only your name, email address and profile picture. We also keep the records you create on the platform, such as milk collections, IoT test results, listings, bids, orders, payments and support tickets.'],
  ['How we use it', 'To create and run your account, check that sellers and businesses are genuine, show your listings and requests to other users, process orders and deliveries, send account emails (confirmation, password reset, approval) and answer support tickets. Your phone number is kept for records only. We do not send SMS.'],
  ['Who can see it', 'Other users see only what they need: a seller sees a buyer\'s delivery address only after accepting their order, and businesses see sellers\' names, ratings and prices. ApnaDairy admins can see account details to approve accounts and resolve complaints. We do not sell or share your data with advertisers.'],
  ['Where it is stored', 'Data is stored with Supabase (database, files and sign-in). Emails are sent through Gmail.'],
  ['Your choices', `You can change your name, phone and password on the My account page. To delete your account and its data, email ${CONTACT}.`],
  ['Contact', `Questions about this policy: ${CONTACT}.`],
]

const TERMS = [
  ['Using ApnaDairy', 'ApnaDairy is a student project offered as is, for testing and demonstration. By creating an account you agree to give true details and to use the platform only for genuine dairy trade.'],
  ['Accounts', 'Area managers and businesses can use the portal only after ApnaDairy checks their documents. We may refuse, suspend or remove any account that gives false information or misuses the platform.'],
  ['Orders and payments', 'Buyers pay sellers directly. ApnaDairy does not take a share of orders and is not a party to the sale. Sellers pay ApnaDairy their monthly platform fee and device fee as shown on their Billing page.'],
  ['Milk quality', 'Quality grades and the added-water check come from IoT sensor readings and ApnaDairy’s AI models. They help both sides but are not a laboratory certificate.'],
  ['Complaints', 'Problems with an order can be reported on the Support page. ApnaDairy will look into them but is not responsible for losses between buyers and sellers.'],
  ['Changes', `We may update these terms. The date at the top shows the latest version. Contact: ${CONTACT}.`],
]

// public privacy policy and terms (google sign-in needs both links)
export default function Legal({ kind = 'privacy' }) {
  const privacy = kind === 'privacy'
  const items = privacy ? PRIVACY : TERMS
  return (
    <>
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-10 sm:px-8">
        <h1 className="display text-[38px] text-forest-deep">{privacy ? 'Privacy policy' : 'Terms of service'}</h1>
        <p className="mt-2 text-[14px] text-muted">Last updated {UPDATED}</p>
        <div className="mt-8 grid gap-6">
          {items.map(([h, t]) => (
            <section key={h}>
              <h2 className="text-[18px] font-semibold text-forest-deep">{h}</h2>
              <p className="mt-1.5 text-[15.5px] leading-relaxed text-ink/85">{t}</p>
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </>
  )
}
