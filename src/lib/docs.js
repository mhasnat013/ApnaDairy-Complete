import { supabase } from './supabase'

export const BUCKET = 'verification-docs'

export const docLabel = {
  cnic_front: 'CNIC (front)',
  cnic_back: 'CNIC (back)',
  business_registration: 'Business registration / licence',
  ntn_certificate: 'NTN certificate',
  bank_statement: 'Bank / e-statement',
  utility_bill: 'Utility bill of premises',
  shop_photo: 'Photo of center / shop',
  other: 'Other document',
}

// which slots each role sees. every slot is required except "other" (supabase/27_document_submit.sql)
export const docPlan = {
  area_manager: [
    { type: 'cnic_front', required: true },
    { type: 'cnic_back', required: true },
    { type: 'business_registration', required: true },
    { type: 'utility_bill', required: true },
    { type: 'shop_photo', required: true },
    { type: 'bank_statement', required: true },
  ],
  business: [
    { type: 'cnic_front', required: true },
    { type: 'cnic_back', required: true },
    { type: 'business_registration', required: true },
    { type: 'ntn_certificate', required: true },
    { type: 'other' },
  ],
}

export const requiredDocs = (role) => (docPlan[role] ?? []).filter((s) => s.required).map((s) => s.type)
export const missingDocs = (docs, role) => requiredDocs(role).filter((t) => !docs.some((d) => d.doc_type === t))
export const hasRequiredDocs = (docs, role = 'area_manager') => missingDocs(docs, role).length === 0

// send the documents for review: only when all required ones are uploaded; then they are locked
export async function submitDocuments() {
  const { data, error } = await supabase.rpc('submit_documents')
  if (error) throw error
  return data
}
// when this user sent their documents (null = not yet)
export async function mySubmission(role, userId) {
  const table = role === 'business' ? 'business_profiles' : 'area_managers'
  const { data, error } = await supabase.from(table).select('docs_submitted_at, rejection_reason').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data
}

export async function listDocs(userId) {
  const { data, error } = await supabase
    .from('verification_documents')
    .select('*')
    .eq('user_id', userId)
    .order('uploaded_at')
  if (error) throw error
  return data
}

export async function uploadDoc(userId, docType, file) {
  if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type)) throw new Error('Upload a photo (JPG, PNG) or a PDF.')
  if (file.size > 5 * 1024 * 1024) throw new Error('The file must be under 5 MB.')
  if (file.size < 1024) throw new Error('This file looks empty. Pick another one.')
  const ext = file.name.split('.').pop().toLowerCase()
  const path = `${userId}/${docType}-${Date.now()}.${ext}`

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type })
  if (upErr) throw upErr

  const { error } = await supabase.from('verification_documents').insert({
    user_id: userId, doc_type: docType, file_path: path,
    file_name: file.name, mime_type: file.type, size_bytes: file.size,
  })
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]) // keep storage clean
    throw error
  }
}

export async function removeDoc(doc) {
  const { error } = await supabase.from('verification_documents').delete().eq('id', doc.id)
  if (error) throw error
  await supabase.storage.from(BUCKET).remove([doc.file_path])
}

// private bucket → temporary link (60 s)
export async function openDoc(doc) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 60)
  if (error) throw error
  window.open(data.signedUrl, '_blank', 'noopener')
}
