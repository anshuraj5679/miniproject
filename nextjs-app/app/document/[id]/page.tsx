import { DocumentDetailScreen } from '@/components/document-detail-screen'

export default function DocumentDetailPage({ params }: { params: { id: string } }) {
  return <DocumentDetailScreen docId={params.id} />
}

