import { Link } from 'react-router-dom'
import PageHeader from '../../components/PageHeader'
import Marketplace from '../../components/Marketplace'
import Icon from '../../components/Icon'

// browse what centers have on sale now. view only: for a specific quantity, post a bulk requirement
export default function BusinessMarketplace() {
  return (
    <>
      <PageHeader title="Marketplace" description="Milk and dairy products verified sellers have on sale now. Browse and compare; to buy a specific amount, post a bulk requirement and sellers bid.">
        <Link to="/business/requirements/new" className="btn-primary"><Icon name="plus" size={17} />Post a requirement</Link>
      </PageHeader>
      <Marketplace business />
    </>
  )
}
