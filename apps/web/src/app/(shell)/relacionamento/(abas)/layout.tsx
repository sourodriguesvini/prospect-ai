import type { ReactNode } from 'react';
import { RelationshipTabs } from '@/components/relationship/tabs';

/**
 * Relacionamento (ADR-0014): Abordagens, Conversas e Pipeline num módulo só, cada aba com
 * endereço próprio. As Aprovações ficam à parte (/aprovacoes) e o detalhe da oportunidade
 * (`oportunidades/[id]`) tem cabeçalho próprio.
 */
export default function RelationshipTabsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h1 className="text-4xl tracking-[-0.03em]">Conversas</h1>
        <p className="max-w-3xl text-pretty text-sm text-muted-foreground">
          Nada sai do app sem você: toda mensagem passa por aprovação, você envia por conta própria
          e registra aqui.
        </p>
        <RelationshipTabs />
      </div>
      {children}
    </div>
  );
}
