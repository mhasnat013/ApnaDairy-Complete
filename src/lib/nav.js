// sidebar items per role. "ready: false" items are listed under "coming next" until built.
export const navFor = {
  super_admin: [
    { to: '/admin', label: 'Overview', icon: 'grid', end: true, ready: true },
    { to: '/admin/approvals', label: 'Approvals', icon: 'check', ready: true },
    { to: '/admin/users', label: 'Users', icon: 'users', ready: true },
    { to: '/admin/bulk-market', label: 'Bulk market', icon: 'gavel', ready: true },
    { to: '/admin/iot-devices', label: 'IoT devices', icon: 'chip' },
    { to: '/admin/pricing', label: 'Dynamic pricing', icon: 'tag' },
    { to: '/admin/complaints', label: 'Complaints & support', icon: 'chat' },
    { to: '/admin/analytics', label: 'Analytics', icon: 'chart' },
  ],
  area_manager: [
    { to: '/manager', label: 'Overview', icon: 'grid', end: true, ready: true },
    { to: '/manager/collection', label: 'Milk collection', icon: 'drop', ready: true },
    { to: '/manager/farmers', label: 'Farmers', icon: 'users', ready: true },
    { to: '/manager/inventory', label: 'Inventory', icon: 'box', ready: true },
    { to: '/manager/orders', label: 'Shop orders', icon: 'cart', ready: true },
    { to: '/manager/bulk-requests', label: 'Bulk requests', icon: 'gavel', ready: true },
    { to: '/manager/bulk-orders', label: 'Bulk orders', icon: 'truck', ready: true },
    { to: '/manager/iot', label: 'IoT readings', icon: 'chip', ready: true },
    { to: '/manager/ai-pricing', label: 'AI price engine', icon: 'spark', ready: true },
    { to: '/manager/support', label: 'Support', icon: 'chat' },
  ],
  business: [
    { to: '/business', label: 'Overview', icon: 'grid', end: true, ready: true },
    { to: '/business/requirements', label: 'My requirements', icon: 'box', ready: true },
    { to: '/business/orders', label: 'Bulk orders', icon: 'truck', ready: true },
    { to: '/business/support', label: 'Support', icon: 'chat' },
  ],
}
