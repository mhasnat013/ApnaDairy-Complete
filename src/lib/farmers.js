import { supabase } from './supabase'

// farmers join through the app (supabase/35_farmer_onboarding.sql)
const must = ({ data, error }) => { if (error) throw error; return data }

// a short-lived link to a farmer's private picture
export async function farmerPhotoUrl(path) {
  if (!path) return null
  if (/^(https?:)?\//.test(path)) return path   // a picture already hosted with the site
  const { data } = await supabase.storage.from('farmer-photos').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

// admin
export const farmerApplications = async (status) => must(await supabase.rpc('farmer_applications', { p_status: status })) ?? []
export const setFarmerStatus = async (id, status, reason = null) => must(await supabase.rpc('set_farmer_status', { p_farmer: id, p_status: status, p_reason: reason }))

// center
export const myFarmerRequests = async () => must(await supabase.rpc('my_farmer_requests')) ?? []
export const answerFarmerRequest = async (id, accept, reason = null) => must(await supabase.rpc('answer_farmer_request', { p_request: id, p_accept: accept, p_reason: reason }))
export const myCenterReviews = async (centerId) => must(await supabase.from('center_reviews').select('id, rating, comment, created_at, updated_at').eq('area_manager_id', centerId).order('updated_at', { ascending: false }).limit(50))
