import { Link, useOutletContext } from 'react-router-dom'
import EmptyState from './EmptyState'
import PageHeader from './PageHeader'

// milk centers and dairy products sellers share the area manager portal; a few pages belong to only one of them
export default function MilkOnly({ children, products = false }) {
  const { center } = useOutletContext() ?? {}
  if (!center) return null
  const byproduct = center.type === 'byproduct'
  if (products ? byproduct : !byproduct) return children
  return (
    <>
      <PageHeader title={products ? 'Products' : 'For milk centers'} />
      <div className="panel">
        {products
          ? <EmptyState title="Milk centers sell fresh milk" action={<Link to="/manager/shop" className="btn-primary btn-sm">Go to My shop</Link>}>List your milk on the app from My shop. Dairy products are sold by byproduct sellers.</EmptyState>
          : <EmptyState title="This page is for milk collection centers" action={<Link to="/manager/products" className="btn-primary btn-sm">Go to your products</Link>}>Your account sells dairy products, so there is no milk collection or IoT testing here.</EmptyState>}
      </div>
    </>
  )
}
