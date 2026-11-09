import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PlannedModule } from '@/components/planned-module';
import { findPlaceholderModule } from '@/lib/modules';
import { loadOrgScope } from '@/server/org';

export async function generateMetadata({
  params,
}: PageProps<'/o/[slug]/[modulo]'>): Promise<Metadata> {
  const { modulo } = await params;
  return { title: findPlaceholderModule(modulo)?.label ?? 'Não encontrado' };
}

export default async function PlannedModulePage({ params }: PageProps<'/o/[slug]/[modulo]'>) {
  const { slug, modulo } = await params;
  await loadOrgScope(slug);
  const planned = findPlaceholderModule(modulo);
  if (!planned?.plannedSlice) notFound();
  return <PlannedModule title={planned.label} description={planned.description} />;
}
