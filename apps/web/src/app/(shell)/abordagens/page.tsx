import { Button, Panel, Well } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ReadinessChecklist, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { findPlaceholderModule } from '@/lib/modules';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy } from '@/server/strategy';

export const metadata: Metadata = { title: 'Abordagens' };

/**
 * As condições para abordar existem desde a F2: sem LIA aprovada em vigor, oferta ativa e o
 * resto da estratégia, nenhuma ação de abordagem é liberada. O módulo chega na F10, e o serviço
 * dele chama `assertReadyToApproach({ offerId, icpId })` antes de qualquer ação. Esta tela
 * mostra a avaliação da oferta mais adiantada; cada ação é conferida com a própria oferta.
 */
async function ApproachConditions() {
  await connection();
  const result = await loadStrategy((strategy, ctx) => strategy.overview(ctx));
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const { snapshot, readiness } = result.data;
  const gate = readiness.approach;
  const offer = snapshot.offers.find((o) => o.id === gate.offerId);
  return (
    <div className="space-y-4">
      <StorageNotice storage={result.storage} />
      <Panel aria-label="Condições para abordar" className="space-y-4">
        <ReadinessChecklist
          gate={gate}
          title="Pode abordar?"
          titleId="condicoes-abordagem"
          headingLevel="h2"
          offerName={offer?.current?.content.name ?? null}
          readyText="A estratégia está pronta para abordar. O contato real ainda depende do módulo de abordagens e das checagens de envio: supressão, aviso de privacidade publicado e parecer jurídico."
          blockedText="As ações de abordagem ficam bloqueadas até cada item obrigatório abaixo estar atendido."
        />
        {gate.ready ? null : (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href={strategyRoutes.overview}>Abrir a estratégia</Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href={strategyRoutes.compliance}>Abrir a conformidade</Link>
            </Button>
          </div>
        )}
      </Panel>
    </div>
  );
}

export default function ApproachesPage() {
  const planned = findPlaceholderModule('abordagens');
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-4xl tracking-[-0.03em]">Abordagens</h1>
        <p className="max-w-3xl text-pretty text-sm text-muted-foreground">
          {planned?.description ?? 'Planos e revisão de mensagens.'} O módulo ainda não existe (em
          breve); nada aqui é simulado. Abaixo, o que já precisa estar pronto para abordar.
        </p>
      </div>
      <Suspense
        fallback={
          <Well role="status" className="py-6 text-center text-sm text-muted-foreground">
            Verificando se as abordagens podem ser liberadas…
          </Well>
        }
      >
        <ApproachConditions />
      </Suspense>
    </div>
  );
}
