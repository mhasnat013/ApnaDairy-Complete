// where each role lands after login. a customer account on the portal is usually a new google sign-in, so it
// goes to the sign-up form (which also links to the app for home buyers); farmers use the app
export const homeFor = (role) =>
  ({
    super_admin: '/admin',
    area_manager: '/manager',
    business: '/business',
    customer: '/welcome',
  })[role] ?? '/mobile-only'

export const roleLabel = {
  super_admin: 'Super Admin',
  area_manager: 'Area Manager',
  business: 'Business Buyer',
  farmer: 'Farmer',
  customer: 'Customer',
}
