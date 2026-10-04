import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { UiProvider } from './context/UiContext'
import ProtectedRoute from './components/ProtectedRoute'
import ModuleSoon from './components/ModuleSoon'
import DashboardLayout from './layouts/DashboardLayout'

import Login from './pages/auth/Login'
import Signup from './pages/auth/Signup'
import Pending from './pages/auth/Pending'
import MobileOnly from './pages/auth/MobileOnly'
import AdminHome from './pages/admin/AdminHome'
import Approvals from './pages/admin/Approvals'
import Users from './pages/admin/Users'
import BulkMarket from './pages/admin/BulkMarket'
import BulkRequests from './pages/manager/BulkRequests'
import RequestDetail from './pages/manager/RequestDetail'
import BulkOrders from './pages/manager/BulkOrders'
import Requirements from './pages/business/Requirements'
import NewRequirement from './pages/business/NewRequirement'
import RequirementDetail from './pages/business/RequirementDetail'
import BusinessOrders from './pages/business/BusinessOrders'
import PublicRequests from './pages/PublicRequests'
import Home from './pages/Home'
import ManagerHome from './pages/manager/ManagerHome'
import BusinessHome from './pages/business/BusinessHome'
import Collection from './pages/manager/Collection'
import RecordMilk from './pages/manager/RecordMilk'
import Farmers from './pages/manager/Farmers'
import FarmerDetail from './pages/manager/FarmerDetail'
import Inventory from './pages/manager/Inventory'
import ShopOrders from './pages/manager/ShopOrders'
import IotReadings from './pages/manager/IotReadings'
import AiPricing from './pages/manager/AiPricing'


export default function App() {
  return (
    <AuthProvider>
      <UiProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/pending" element={<Pending />} />
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
              <Route path="*" element={<ModuleSoon />} />
            </Route>
          </Route>

          <Route element={<ProtectedRoute allow={['area_manager']} />}>
            <Route path="/manager" element={<DashboardLayout />}>
              <Route index element={<ManagerHome />} />
              <Route path="bulk-requests" element={<BulkRequests />} />
              <Route path="bulk-requests/:id" element={<RequestDetail />} />
              <Route path="bulk-orders" element={<BulkOrders />} />
              <Route path="collection" element={<Collection />} />
              <Route path="collection/new" element={<RecordMilk />} />
              <Route path="farmers" element={<Farmers />} />
              <Route path="farmers/:id" element={<FarmerDetail />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="orders" element={<ShopOrders />} />
              <Route path="iot" element={<IotReadings />} />
              <Route path="ai-pricing" element={<AiPricing />} />
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
      </BrowserRouter>
      </UiProvider>
    </AuthProvider>
  )
}
