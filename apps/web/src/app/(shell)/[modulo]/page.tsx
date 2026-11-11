import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PlannedModule } from '@/components/planned-module';
import { PLACEHOLDER_MODULES, findPlaceholderModule } from '@/lib/modules';

// Só os módulos conhecidos existem; qualquer outro segmento é 404 já no roteamento.
export const dynamicParams = false;

export function generateStaticParams() {
  return PLACEHOLDER_MODULES.map((item) => ({ modulo: item.segment }));
}

export async function generateMetadata({ params }: PageProps<'/[modulo]'>): Promise<Metadata> {
  const { modulo } = await params;
  return { title: findPlaceholderModule(modulo)?.label ?? 'Não encontrado' };
}

export default async function PlannedModulePage({ params }: PageProps<'/[modulo]'>) {
  const { modulo } = await params;
  const planned = findPlaceholderModule(modulo);
  if (!planned?.plannedSlice) notFound();
  return (
    <PlannedModule
      title={planned.label}
      description={planned.description}
      slice={planned.plannedSlice}
    />
  );
}
