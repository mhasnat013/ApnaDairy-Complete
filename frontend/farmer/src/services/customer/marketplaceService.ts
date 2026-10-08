// Marketplace service — public product browsing + customer wishlist.
// Products come from the WEB project (read-only); wishlist is customer-isolated
// server-side (identity from JWT).
import { b2cGet, b2cPost, b2cDelete, qs } from '../../api/b2cClient';
import type { Product, ProductList, WishlistItem } from '../../types/customerModels';

export interface ProductFilters {
  category?: string;
  milk_type?: string;
  city?: string;
  q?: string;
  sort?: 'newest' | 'price_asc' | 'price_desc';
  page?: number;
  page_size?: number;
}

/** Paginated product list with optional filters. */
export async function listProducts(filters: ProductFilters = {}): Promise<ProductList> {
  return b2cGet<ProductList>(
    '/api/v1/marketplace/products/' + qs({ ...filters }),
  );
}

/** Single product detail. */
export async function getProduct(productId: string): Promise<Product> {
  return b2cGet<Product>(`/api/v1/marketplace/products/${encodeURIComponent(productId)}`);
}

/** The customer's wishlist. */
export async function listWishlist(): Promise<WishlistItem[]> {
  const res = await b2cGet<{ items: WishlistItem[] }>('/api/v1/marketplace/wishlist/');
  return res.items;
}

/** Add a product to the wishlist. */
export async function addToWishlist(productId: string): Promise<WishlistItem> {
  return b2cPost<WishlistItem>('/api/v1/marketplace/wishlist/', { product_id: productId });
}

/** Remove a product from the wishlist. */
export async function removeFromWishlist(productId: string): Promise<void> {
  await b2cDelete<void>(`/api/v1/marketplace/wishlist/${encodeURIComponent(productId)}`);
}
