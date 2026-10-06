import { lazy, Suspense } from 'react'
import Loader from './components/Loader'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { UiProvider } from './context/UiContext'
import ProtectedRoute from './components/ProtectedRoute'
import ModuleSoon from './components/ModuleSoon'
import DashboardLayout from './layouts/DashboardLayout'

import Login from './pages/auth/Login'
import Signup from './pages/auth/Signup'
import Pending from './pages/auth/Pending'
import ForgotPassword from './pages/auth/ForgotPassword'
import ResetPassword from './pages/auth/ResetPassword'
import MobileOnly from './pages/auth/MobileOnly'
const AdminHome = lazy(() => import('./pages/admin/AdminHome'))
const Approvals = lazy(() => import('./pages/admin/Approvals'))
const Users = lazy(() => import('./pages/admin/Users'))
const BulkMarket = lazy(() => import('./pages/admin/BulkMarket'))
const BulkRequests = lazy(() => import('./pages/manager/BulkRequests'))
const RequestDetail = lazy(() => import('./pages/manager/RequestDetail'))
const BulkOrders = lazy(() => import('./pages/manager/BulkOrders'))
const Requirements = lazy(() => import('./pages/business/Requirements'))
const NewRequirement = lazy(() => import('./pages/business/NewRequirement'))
const RequirementDetail = lazy(() => import('./pages/business/RequirementDetail'))
const BusinessOrders = lazy(() => import('./pages/business/BusinessOrders'))
import PublicRequests from './pages/PublicRequests'
import Home from './pages/Home'
const ManagerHome = lazy(() => import('./pages/manager/ManagerHome'))
const BusinessHome = lazy(() => import('./pages/business/BusinessHome'))
const Collection = lazy(() => import('./pages/manager/Collection'))
const RecordMilk = lazy(() => import('./pages/manager/RecordMilk'))
const Farmers = lazy(() => import('./pages/manager/Farmers'))
const FarmerDetail = lazy(() => import('./pages/manager/FarmerDetail'))
const Inventory = lazy(() => import('./pages/manager/Inventory'))
const ShopOrders = lazy(() => import('./pages/manager/ShopOrders'))
const IotReadings = lazy(() => import('./pages/manager/IotReadings'))
const AiPricing = lazy(() => import('./pages/manager/AiPricing'))
const Billing = lazy(() => import('./pages/manager/Billing'))
const MyShop = lazy(() => import('./pages/manager/MyShop'))
const AdminBilling = lazy(() => import('./pages/admin/Billing'))
const MarketRates = lazy(() => import('./pages/admin/MarketRates'))
const Audit = lazy(() => import('./pages/admin/Audit'))
const IotDevices = lazy(() => import('./pages/admin/IotDevices'))
const Analytics = lazy(() => import('./pages/admin/Analytics'))
const Admins = lazy(() => import('./pages/admin/Admins'))
const Products = lazy(() => import('./pages/seller/Products'))
import MilkOnly from './components/MilkOnly'


export default function App() {
  return (
    <AuthProvider>
      <UiProvider>
      <BrowserRouter>
        <Suspense fallback={<Loader />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/pending" element={<Pending />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/requests" element={<PublicRequests />} />

          <Route element={<ProtectedRoute allow={['farmer', 'customer']} />}>
            <Route path="/mobile-only" element={<MobileOnly />} />
          </Route>

          <Route element={<ProtectedRoute allow={['super_admin']} />}>
            <Route path="/admin" element={<DashboardLayout />}>
              <Route index element={<AdminHome />} />
              <Route path="approvals" element={<Approvals />} />
              <Route path="users" element={<Users />} />
              <Route path="bulk-market" element={<BulkMarket />} />
              <Route path="billing" element={<AdminBilling />} />
              <Route path="market-rates" element={<MarketRates />} />
              <Route path="audit" element={<Audit />} />
              <Route path="iot-devices" element={<IotDevices />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="admins" element={<Admins />} />
              <Route path="*" element={<ModuleSoon />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allow={['area_manager']} />}>
            <Route path="/manager" element={<DashboardLayout />}>
              <Route index element={<ManagerHome />} />
              <Route path="bulk-requests" element={<BulkRequests />} />
              <Route path="bulk-requests/:id" element={<RequestDetail />} />
              <Route path="bulk-orders" element={<BulkOrders />} />
              <Route path="collection" element={<MilkOnly><Collection /></MilkOnly>} />
              <Route path="collection/new" element={<MilkOnly><RecordMilk /></MilkOnly>} />
              <Route path="farmers" element={<MilkOnly><Farmers /></MilkOnly>} />
              <Route path="farmers/:id" element={<MilkOnly><FarmerDetail /></MilkOnly>} />
              <Route path="inventory" element={<MilkOnly><Inventory /></MilkOnly>} />
              <Route path="orders" element={<ShopOrders />} />
              <Route path="iot" element={<MilkOnly><IotReadings /></MilkOnly>} />
              <Route path="ai-pricing" element={<MilkOnly><AiPricing /></MilkOnly>} />
              <Route path="billing" element={<Billing />} />
              <Route path="shop" element={<MyShop />} />
              <Route path="products" element={<MilkOnly products><Products /></MilkOnly>} />
              <Route path="*" element={<ModuleSoon />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allow={['business']} />}>
            <Route path="/business" element={<DashboardLayout />}>
              <Route index element={<BusinessHome />} />
              <Route path="requirements" element={<Requirements />} />
              <Route path="requirements/new" element={<NewRequirement />} />
              <Route path="requirements/:id" element={<RequirementDetail />} />
              <Route path="orders" element={<BusinessOrders />} />
              <Route path="*" element={<ModuleSoon />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
      </UiProvider>
    </AuthProvider>
  )
}
