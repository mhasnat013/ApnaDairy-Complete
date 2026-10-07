import { categoryLabel } from '../lib/center'

// one picture per product kind (public/products/*.svg), the same on every listing and request,
// so milk, desi ghee, cheese and the rest are recognised at a glance. the mobile app can use the same files.
const PICS = ['milk', 'ghee', 'butter', 'yogurt', 'cheese', 'cream', 'lassi', 'other']
export const productImage = (category) => `/products/${PICS.includes(category) ? category : 'other'}.svg`

export default function ProductImage({ category = 'milk', size = 48, className = '' }) {
  return (
    <img src={productImage(category)} alt={categoryLabel[category] ?? 'Dairy'} width={size} height={size} loading="lazy"
      className={`shrink-0 select-none rounded-[22%] ${className}`} style={{ width: size, height: size }} />
  )
}
