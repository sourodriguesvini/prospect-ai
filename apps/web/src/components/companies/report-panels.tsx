import type { ClaimView } from '@prospector/application';
import { BUSINESS_EVENT_LABELS, type CommercialThesis } from '@prospector/contracts';
import {
  brazilianPartialDate,
  eventsForTopic,
  type EventEvidence,
  type ExecutiveAnswer,
  type ExecutiveBasis,
} from '@prospector/domain';
import { Badge, Panel, PanelHeader, Well } from '@prospector/ui';
import { safeHref } from '@/components/companies/claim-card';
import { ClaimList, Section } from '@/components/companies/claim-list';
import { eventEvidenceOf } from '@/components/companies/timeline-section';
import { EPISTEMIC_LABELS } from '@/lib/company-labels';

/**
 * Seções do relatório da empresa que faltavam (diretriz 2026-11-26, Parte 7): o resumo executivo
 * com as cinco perguntas (seção 1), produto e tecnologia (6) e estrutura organizacional (8). Tudo
 * vem do ledger e da tese; onde não há base, a seção diz o que falta.
 */

const BASIS_LINKS: Partial<Record<ExecutiveBasis, { href: string; text: string }>> = {
  site: { href: '#mercado', text: 'Ver mercado e posicionamento' },
  events: { href: '#linha-do-tempo', text: 'Ver a linha do tempo' },
  thesis: { href: '#tese-comercial', text: 'Ver a tese comercial' },
  offers: { href: '#diagnostico', text: 'Ver os serviços' },
};

/** As cinco perguntas do topo, cada uma com o caminho para a seção completa. */
export function ExecutiveSummaryList({ answers }: { answers: readonly ExecutiveAnswer[] }) {
  return (
    <section aria-labelledby="resumo-executivo" className="space-y-2">
      <h3 id="resumo-executivo" className="text-sm font-medium">
        Resumo executivo
      </h3>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {answers.map((answer) => {
          const link = answer.basis ? BASIS_LINKS[answer.basis] : undefined;
          return (
            <div
              key={answer.question}
              className={`min-w-0 space-y-0.5${answer.question === 'how' ? ' sm:col-span-2' : ''}`}
              data-question={answer.question}
            >
              <dt className="text-xs text-muted-foreground">{answer.label}</dt>
              <dd
                className={`text-sm text-pretty [overflow-wrap:anywhere]${answer.known ? '' : ' text-muted-foreground'}`}
              >
                {answer.text}
                {link ? (
                  <>
                    {' '}
                    <a
                      href={link.href}
                      className="text-xs text-muted-foreground underline underline-offset-4"
                    >
                      {link.text}
                    </a>
                  </>
                ) : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/** Acontecimentos de um tema, com data, tipo, fonte e se é fato ou hipótese. */
function EventList({ items }: { items: readonly EventEvidence[] }) {
  return (
    <ul className="divide-y text-sm">
      {items.map(({ claimId, epistemicType, event }) => {
        const href = safeHref(event.url);
        const purpose = event.funding?.purpose.status === 'declared' ? event.funding.purpose : null;
        return (
          <li key={claimId} className="space-y-1 py-2">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">
                {event.occurredOn ? brazilianPartialDate(event.occurredOn) : 'Sem data'}
              </span>
              <span>{BUSINESS_EVENT_LABELS[event.type]}</span>
              <Badge variant="neutral">{EPISTEMIC_LABELS[epistemicType]}</Badge>
            </p>
            <p className="[overflow-wrap:anywhere]">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline underline-offset-4"
                >
                  {event.headline}
                  <span className="sr-only"> (abre em outra aba)</span>
                </a>
              ) : (
                event.headline
              )}{' '}
              <span className="text-muted-foreground">({event.host})</span>
            </p>
            {purpose ? (
              <p className="text-muted-foreground [overflow-wrap:anywhere]">
                Destino declarado na fonte: {purpose.value.text}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Seção 6: o que a empresa oferece (site) e os acontecimentos ligados a produto. */
export function ProductTechnologyPanel({
  views,
  analyzed,
}: {
  views: readonly ClaimView[];
  /** Há análise concluída: sem dado, o painel diz o que falta em vez de sumir. */
  analyzed: boolean;
}) {
  const offerings = views.filter((view) => view.claim.key.startsWith('positioning.offering.'));
  const events = eventsForTopic(eventEvidenceOf(views), 'product_technology');
  if (!analyzed && offerings.length + events.length === 0) return null;
  return (
    <Panel aria-labelledby="produto-tecnologia">
      <PanelHeader
        titleId="produto-tecnologia"
        title="Produto e tecnologia"
        description="O que a empresa oferece, segundo o site, e lançamentos, parcerias e investimentos ligados a produto. A análise não levanta as ferramentas e linguagens que a empresa usa."
      />
      <div className="space-y-6">
        {offerings.length > 0 ? (
          <Section title="O que oferece">
            <ClaimList views={offerings} support={views} />
          </Section>
        ) : null}
        {events.length > 0 ? (
          <Section title="Acontecimentos de produto">
            <EventList items={events} />
          </Section>
        ) : null}
        {offerings.length + events.length === 0 ? (
          <Well className="py-4 text-sm text-muted-foreground">
            O site não mostrou produtos ou serviços de forma clara, e nenhum lançamento, parceria ou
            investimento em produto apareceu nas fontes consultadas.
          </Well>
        ) : null}
      </div>
    </Panel>
  );
}

const ORGANIZATION_KEYS = [
  'registry.legal_nature',
  'registry.size',
  'registry.establishment_type',
  'registry.activity_start',
  'registry.share_capital',
  'registry.location',
] as const;

/** Seção 8: forma jurídica, porte e sede (Receita) e mudanças de estrutura e liderança. */
export function OrganizationPanel({
  views,
  thesis,
  analyzed,
  contactBlocked = false,
}: {
  views: readonly ClaimView[];
  thesis: CommercialThesis | null;
  analyzed: boolean;
  /** Há pedido de não contato em vigor: nenhum papel a procurar é sugerido. */
  contactBlocked?: boolean;
}) {
  const registry = ORGANIZATION_KEYS.flatMap((key) =>
    views.filter((view) => view.claim.key === key),
  );
  const events = eventsForTopic(eventEvidenceOf(views), 'organization');
  if (!analyzed && registry.length + events.length === 0) return null;
  const role = thesis?.principal?.approachRole ?? null;
  return (
    <Panel aria-labelledby="estrutura-organizacional">
      <PanelHeader
        titleId="estrutura-organizacional"
        title="Estrutura organizacional"
        description="Forma jurídica, porte e sede pela Receita, e mudanças de liderança, equipe e estrutura que apareceram nas fontes."
      />
      <div className="space-y-6">
        {registry.length > 0 ? (
          <Section title="Pela Receita Federal">
            <ClaimList views={registry} support={views} />
          </Section>
        ) : (
          <Well className="py-4 text-sm text-muted-foreground">
            Sem dados da Receita nesta análise. Natureza jurídica, porte e sede vêm do painel{' '}
            <a href="#receita" className="underline underline-offset-4">
              Receita Federal
            </a>
            .
          </Well>
        )}
        {events.length > 0 ? (
          <Section title="Liderança, equipe e estrutura">
            <EventList items={events} />
          </Section>
        ) : null}
        <p className="text-sm text-muted-foreground">
          A análise não monta lista de pessoas; títulos de matérias podem citar nomes.
          {contactBlocked
            ? ' Não abordar: a empresa pediu para não ser contatada.'
            : role
              ? ` Papel a procurar, pela tese: ${role}.`
              : ''}
        </p>
      </div>
    </Panel>
  );
}
