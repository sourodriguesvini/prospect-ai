import type { LiaContent } from '@prospector/contracts';
import { formatCalendarDate, type EffectiveLia } from '@prospector/domain';
import { Alert, Badge, Button, Panel, PanelHeader, Well } from '@prospector/ui';
import { Pencil } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { ApproveLiaForm, RevokeLiaForm } from '@/components/strategy/decision-forms';
import { Loading } from '@/components/strategy/loading';
import {
  PageHeader,
  StorageNotice,
  TermList,
  Unavailable,
  VersionHistory,
} from '@/components/strategy/page-parts';
import { formatDateTime } from '@/lib/format';
import { LIA_CATEGORY_LABELS, LIA_SOURCE_LABELS, LIA_STATUS_VIEW } from '@/lib/strategy-labels';
import { strategyRoutes } from '@/lib/strategy-routes';
import { loadStrategy } from '@/server/strategy';
import { approveLiaAction, revokeLiaAction } from './actions';
import { COMPLIANCE_NOTICES, complianceNotice } from './notices';

export const metadata: Metadata = { title: 'Conformidade' };

const TRAIL = [{ href: '/configuracoes', label: 'Configuração' }];

type Props = PageProps<'/configuracoes/conformidade'>;

function effectiveText(effective: EffectiveLia): { tone: 'success' | 'warning'; text: string } {
  switch (effective.status) {
    case 'none':
      return { tone: 'warning', text: 'Nenhuma LIA registrada. As abordagens estão bloqueadas.' };
    case 'pending':
      return {
        tone: 'warning',
        text: 'Há LIA em rascunho, mas nenhuma aprovada. As abordagens estão bloqueadas.',
      };
    case 'approved':
      return {
        tone: 'success',
        text: `LIA v${effective.version.version} aprovada, com revisão até ${formatCalendarDate(effective.version.reviewDueOn ?? '')}.`,
      };
    case 'expired':
      return {
        tone: 'warning',
        text: `A revisão da LIA v${effective.version.version} venceu em ${formatCalendarDate(effective.version.reviewDueOn ?? '')}. Revise e aprove de novo para liberar as abordagens.`,
      };
    case 'revoked':
      return {
        tone: 'warning',
        text: `A LIA v${effective.version.version} foi revogada. As abordagens estão bloqueadas até uma nova aprovação.`,
      };
  }
}

/** Texto da LIA em leitura, para quem vai aprovar ver exatamente o que aprova. */
function LiaContentView({ content }: { content: LiaContent }) {
  const sections: { label: string; value: string }[] = [
    { label: 'Finalidade', value: content.purpose },
    { label: 'Interesse legítimo', value: content.legitimateInterest },
    { label: 'Necessidade', value: content.necessity },
    { label: 'Expectativa do titular', value: content.expectations },
    { label: 'Riscos e impactos', value: content.risks },
    { label: 'Salvaguardas', value: content.safeguards },
    { label: 'Conclusão', value: content.conclusion },
  ];
  return (
    <div className="space-y-4 text-sm">
      <dl className="space-y-4">
        {sections.map((s) => (
          <div key={s.label} className="space-y-1">
            <dt className="font-semibold">{s.label}</dt>
            <dd className="whitespace-pre-line text-pretty text-muted-foreground">{s.value}</dd>
          </div>
        ))}
      </dl>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="font-semibold">Dados pessoais tratados</dt>
          <dd>
            <TermList items={content.dataCategories.map((c) => LIA_CATEGORY_LABELS[c])} />
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="font-semibold">Origem dos dados</dt>
          <dd>
            <TermList items={content.dataSources.map((s) => LIA_SOURCE_LABELS[s])} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Confirmação que sobrevive ao redirecionamento: o formulário some depois de aprovar ou revogar. */
async function Notice({ searchParams }: { searchParams: Props['searchParams'] }) {
  const notice = complianceNotice((await searchParams).aviso);
  if (!notice) return null;
  const view = COMPLIANCE_NOTICES[notice];
  return (
    <Alert tone={view.tone} role="status" data-aviso={notice}>
      {view.text}
    </Alert>
  );
}

async function Compliance() {
  await connection();
  const result = await loadStrategy((strategy, ctx) => strategy.compliance(ctx));
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const {
    effectiveLia,
    liaVersions,
    contactPolicyVersions,
    suggestedReviewDueOn,
    minReviewDueOn,
    maxReviewDueOn,
  } = result.data;
  const latest = liaVersions[0] ?? null;
  const pendingApproval = latest && latest.status === 'draft' ? latest : null;
  const inForce = effectiveLia.status === 'approved' ? effectiveLia.version : null;
  const policy = contactPolicyVersions[0] ?? null;
  const summary = effectiveText(effectiveLia);

  return (
    <>
      <StorageNotice storage={result.storage} />
      <Alert tone="warning" role="note">
        O texto sugerido pelo sistema é um ponto de partida e{' '}
        <strong>não substitui validação jurídica</strong>. Usar o legítimo interesse para prospectar
        empresas sem contato prévio ainda precisa do parecer de um advogado antes do primeiro envio.
      </Alert>

      <Panel aria-labelledby="lia">
        <PanelHeader
          titleId="lia"
          title="LIA: avaliação de legítimo interesse"
          description="Sem LIA aprovada e dentro do prazo de revisão, nenhuma ação de abordagem é liberada."
          actions={
            <Button asChild size="sm" variant={latest ? 'secondary' : 'primary'}>
              <Link href={strategyRoutes.lia}>
                <Pencil aria-hidden="true" className="size-4" />
                {latest ? 'Editar (nova versão)' : 'Preencher LIA'}
              </Link>
            </Button>
          }
        />
        <Alert
          tone={summary.tone}
          role="status"
          className="mb-4"
          data-lia-status={effectiveLia.status}
        >
          {summary.text}
        </Alert>
        {liaVersions.length === 0 ? (
          <Well className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma versão ainda. Há um modelo guiado com texto sugerido para você revisar.
          </Well>
        ) : (
          <ol className="divide-y">
            {liaVersions.map((v) => {
              // Rascunho que não é a versão mais recente nunca mais pode ser aprovado.
              const view =
                v.status === 'draft' && v.id !== latest?.id
                  ? { label: 'Não aprovada (substituída)', badge: 'outline' as const }
                  : LIA_STATUS_VIEW[v.status];
              return (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">v{v.version}</span>
                    <Badge variant={view.badge}>{view.label}</Badge>
                  </span>
                  <span className="text-muted-foreground">
                    {v.revokedAt
                      ? `Revogada em ${formatDateTime(v.revokedAt)}`
                      : v.approvedAt
                        ? `Aprovada em ${formatDateTime(v.approvedAt)} · revisão até ${formatCalendarDate(v.reviewDueOn ?? '')}`
                        : `Criada em ${formatDateTime(v.createdAt)}`}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      {pendingApproval ? (
        <Panel aria-labelledby="lia-aprovar">
          <PanelHeader
            titleId="lia-aprovar"
            title={`Aprovar a LIA v${pendingApproval.version}`}
            description={`Leia o texto abaixo. Aprovar registra data e hora; o texto aprovado não pode mais ser alterado.${
              inForce
                ? ` Ao aprovar, a v${pendingApproval.version} substitui a v${inForce.version} em vigor.`
                : ''
            }`}
          />
          <div className="space-y-6">
            <LiaContentView content={pendingApproval.content} />
            <ApproveLiaForm
              action={approveLiaAction.bind(null, pendingApproval.id)}
              version={pendingApproval.version}
              suggestedReviewDueOn={suggestedReviewDueOn}
              minReviewDueOn={minReviewDueOn}
              maxReviewDueOn={maxReviewDueOn}
            />
          </div>
        </Panel>
      ) : null}

      {inForce ? (
        <Panel aria-labelledby="lia-revogar">
          <PanelHeader
            titleId="lia-revogar"
            title={`Revogar a LIA v${inForce.version}`}
            description="Use se a avaliação deixou de valer. As abordagens ficam bloqueadas na hora, até outra versão ser aprovada."
          />
          <div className="space-y-6">
            <details className="rounded-lg border p-4 text-sm">
              <summary className="cursor-pointer font-medium">
                Ver o texto da LIA v{inForce.version} em vigor
              </summary>
              <div className="mt-4">
                <LiaContentView content={inForce.content} />
              </div>
            </details>
            <RevokeLiaForm
              action={revokeLiaAction.bind(null, inForce.id)}
              version={inForce.version}
            />
          </div>
        </Panel>
      ) : null}

      <Panel aria-labelledby="opt-out">
        <PanelHeader
          titleId="opt-out"
          title="Identificação e opt-out"
          description="Toda primeira mensagem diz quem é a agência, de onde veio o contato e como deixar de receber."
          actions={
            <Button asChild size="sm" variant={policy ? 'secondary' : 'primary'}>
              <Link href={strategyRoutes.contactPolicy}>
                <Pencil aria-hidden="true" className="size-4" />
                {policy ? 'Editar (nova versão)' : 'Definir opt-out'}
              </Link>
            </Button>
          }
        />
        {policy ? (
          <dl className="space-y-3 text-sm">
            <div className="space-y-1">
              <dt className="font-semibold">Agência</dt>
              <dd className="text-muted-foreground">{policy.content.agencyName}</dd>
            </div>
            <div className="space-y-1">
              <dt className="font-semibold">Canal do titular</dt>
              <dd className="text-muted-foreground">{policy.content.privacyContact}</dd>
            </div>
            <div className="space-y-1">
              <dt className="font-semibold">Texto de opt-out</dt>
              <dd className="whitespace-pre-line text-muted-foreground">
                {policy.content.optOutText}
              </dd>
            </div>
          </dl>
        ) : (
          <Well className="py-6 text-center text-sm text-muted-foreground">
            Ainda não definido. Sem isto, as abordagens ficam bloqueadas.
          </Well>
        )}
        {contactPolicyVersions.length > 0 ? (
          <div className="mt-6 space-y-2">
            <h3 className="text-sm font-semibold">Versões</h3>
            <VersionHistory versions={contactPolicyVersions} />
          </div>
        ) : null}
      </Panel>
    </>
  );
}

export default function CompliancePage({ searchParams }: Props) {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={TRAIL}
        title="Conformidade"
        description="LIA e opt-out: as condições de LGPD para abordar pessoas. Cada mudança cria uma versão nova e fica no histórico."
      />
      <Suspense fallback={null}>
        <Notice searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<Loading label="Carregando a conformidade…" />}>
        <Compliance />
      </Suspense>
    </div>
  );
}
