import PageHeader from './PageHeader'

export default function ModuleSoon() {
  return (
    <>
      <PageHeader title="Page not found" />
      <div className="panel px-6 py-12 text-center">
        <p className="font-medium text-ink">This page does not exist.</p>
        <p className="mt-1 text-sm text-muted">Use the menu to find what you need.</p>
      </div>
    </>
  )
}
