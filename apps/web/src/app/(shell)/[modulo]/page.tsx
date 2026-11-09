import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PlannedModule } from '@/components/planned-module';
import { PLACEHOLDER_MODULES, findPlaceholderModule } from '@/lib/modules';

// Só os módulos conhecidos existem; qualquer outro segmento é 404 já no roteamento.
export const dynamicParams = false;

// Módulos com página própria (ex.: /abordagens mostra a barreira da F2) ficam fora daqui.
const OWN_PAGE = new Set(['abordagens']);

export function generateStaticParams() {
  return PLACEHOLDER_MODULES.filter((item) => !OWN_PAGE.has(item.segment)).map((item) => ({
    modulo: item.segment,
  }));
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
