'use client';

import {
  PROPOSAL_MODE_LABELS,
  THESIS_CHOICE_LABELS,
  THESIS_RECOMMENDATION_LABELS,
  type ProposalMode,
  type ProposalOptions,
} from '@prospector/contracts';
import { Alert, Badge, Checkbox, FieldError, Label, NativeSelect, Well } from '@prospector/ui';
import { proposalBlockers } from '@prospector/domain';
import { useId, useState } from 'react';
import { FormMessage, SelectField, TextAreaField, fieldId } from '@/components/forms/fields';
import { PendingAnnouncement } from '@/components/forms/pending-announcement';
import { SubmitButton } from '@/components/forms/submit-button';
import { useActionForm, type FormAction } from '@/components/forms/use-action-form';
import { errorsFor, IDLE, type FormState } from '@/lib/form-state';
import { FIRST_MESSAGE_KIND_OPTIONS, TONE_OPTIONS } from '@/lib/relationship-labels';

/**
 * Preparar a mensagem (ajuste e correção de 27/11, ADR-0021). O que propor sai da tese da
 * investigação e do catálogo do perfil comercial: a recomendação vem pronta, com o motivo; dá para
 * ajustar as frentes ou só abrir uma conversa, sem oferta. A oferta da Estratégia é opcional e é o
 * único controle de oferta da tela (vale também para "Escrever sem a IA"). Quando a proposta não se
 * sustenta nas evidências, a tela mostra o motivo antes do clique e o servidor confere de novo.
 */

type Option = { value: string; label: string };

const AI_PENDING = 'Gerando com a IA local… (pode levar até 1 minuto)';
const MODES: readonly ProposalMode[] = ['recommended', 'custom', 'conversation'];

const NO_ACTION: FormAction = async () => IDLE;

function defaultMode(options: ProposalOptions | undefined): ProposalMode {
  const first = options?.angles[0];
  return first && first.blockers.length === 0 ? 'recommended' : 'conversation';
}

export function PrepareApproachForm({
  action,
  openAction,
  proposals,
  offers,
  defaultOfferId,
}: {
  action: FormAction;
  /** "Escrever sem a IA": abre a oportunidade com a mesma oferta escolhida aqui. */
  openAction?: FormAction;
  /** Opções por perfil comercial, calculadas no servidor (o padrão primeiro). */
  proposals: readonly ProposalOptions[];
  /** Ofertas ativas da Estratégia (opcionais). */
  offers: readonly Option[];
  defaultOfferId: string | null;
}) {
  const idScope = useId();
  const { state, values, formAction } = useActionForm(action, {
    kind: 'initial_email',
    tone: 'consultative',
  });
  const opened = useActionForm(openAction ?? NO_ACTION, {});
  const field = { state, values, idScope };

  const [profileId, setProfileId] = useState(proposals[0]?.profileId ?? '');
  const current = proposals.find((item) => item.profileId === profileId) ?? proposals[0];
  const [choice, setChoice] = useState(current?.angles[0]?.choice ?? '');
  const [mode, setMode] = useState<ProposalMode>(defaultMode(current));
  const [families, setFamilies] = useState<string[]>(
    current?.angles[0]?.recommendation.families.map((family) => family.code) ?? [],
  );
  const [offerId, setOfferId] = useState(
    defaultOfferId && offers.some((offer) => offer.value === defaultOfferId) ? defaultOfferId : '',
  );
  if (!current) return null;

  const angle = current.angles.find((item) => item.choice === choice) ?? null;
  const blockers = proposalBlockers(current, mode, angle?.choice ?? null, families);
  const blocked = blockers.length > 0;

  const pickProfile = (id: string) => {
    const next = proposals.find((item) => item.profileId === id);
    setProfileId(id);
    setChoice(next?.angles[0]?.choice ?? '');
    setMode(defaultMode(next));
    setFamilies(next?.angles[0]?.recommendation.families.map((family) => family.code) ?? []);
  };
  const pickAngle = (value: string) => {
    setChoice(value);
    const next = current.angles.find((item) => item.choice === value);
    setFamilies(next?.recommendation.families.map((family) => family.code) ?? []);
  };
  const toggleFamily = (code: string, on: boolean) =>
    setFamilies((list) => (on ? [...list, code] : list.filter((item) => item !== code)));

  const ids = {
    profile: fieldId('profileId', idScope),
    angle: fieldId('thesisAngle', idScope),
    offer: fieldId('offerId', idScope),
    mode: fieldId('proposalMode', idScope),
    blockers: fieldId('bloqueios', idScope),
  };
  const offerShown = offers.length > 0 && mode !== 'conversation';

  return (
    <div className="space-y-3">
      <form action={formAction} noValidate className="@container space-y-4">
        <FormMessage state={state} />
        {proposals.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor={ids.profile}>Em nome de</Label>
            <p id={`${ids.profile}-ajuda`} className="text-xs text-muted-foreground">
              A investigação ligou esta empresa ao público de mais de um perfil. Cada um tem o seu
              catálogo; eles não se misturam.
            </p>
            <NativeSelect
              id={ids.profile}
              name="profileId"
              value={profileId}
              onChange={(event) => pickProfile(event.target.value)}
              aria-describedby={`${ids.profile}-ajuda`}
            >
              {proposals.map((item) => (
                <option key={item.profileId} value={item.profileId}>
                  {item.profileName}
                  {item.profileKind === 'product' ? ' (produto)' : ''}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : (
          <input type="hidden" name="profileId" value={current.profileId} />
        )}

        {current.angles.length > 1 ? (
          <div className="space-y-1.5">
            <Label htmlFor={ids.angle}>Ângulo da tese</Label>
            {current.thesis ? (
              <p id={`${ids.angle}-ajuda`} className="text-xs text-muted-foreground">
                {THESIS_RECOMMENDATION_LABELS[current.thesis.recommendation]}:{' '}
                {current.thesis.reason}
              </p>
            ) : null}
            <NativeSelect
              id={ids.angle}
              name="thesisAngle"
              value={choice}
              onChange={(event) => pickAngle(event.target.value)}
              aria-describedby={current.thesis ? `${ids.angle}-ajuda` : undefined}
            >
              {current.angles.map((item) => (
                <option key={item.choice} value={item.choice}>
                  {THESIS_CHOICE_LABELS[item.choice]}: {item.title}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : angle ? (
          <input type="hidden" name="thesisAngle" value={angle.choice} />
        ) : null}

        <fieldset className="space-y-2" aria-describedby={blocked ? ids.blockers : undefined}>
          <legend className="text-sm font-medium">O que propor</legend>
          <div className="flex flex-col gap-2 @md:flex-row @md:flex-wrap @md:gap-x-5">
            {MODES.filter((value) => value !== 'custom' || current.customAllowed).map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="proposalMode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                {PROPOSAL_MODE_LABELS[value]}
              </label>
            ))}
          </div>

          {mode === 'recommended' && angle ? (
            <Well className="space-y-2 text-sm" data-proposal="recommended">
              <p className="font-medium">{angle.recommendation.title}</p>
              {angle.recommendation.families.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {angle.recommendation.families.map((family) => (
                    <Badge key={family.code} variant="outline">
                      {family.name}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {angle.recommendation.services.length > 0 ? (
                <p>
                  <span className="text-muted-foreground">Na conversa: </span>
                  {angle.recommendation.services.join(', ')}
                </p>
              ) : null}
              <p className="text-muted-foreground">{angle.recommendation.rationale}</p>
            </Well>
          ) : null}

          {mode === 'custom' ? (
            <div className="space-y-2" data-proposal="custom">
              <p className="text-xs text-muted-foreground">
                Combine frentes do catálogo de {current.profileName}.
                {angle
                  ? ` As marcadas como ligadas são as que o ângulo "${angle.title}" sustenta; ao menos uma precisa entrar.`
                  : ''}
              </p>
              <div className="grid gap-x-4 gap-y-2 @md:grid-cols-2">
                {current.families.map((family) => {
                  const linked = angle?.connectedFamilies.includes(family.code) ?? false;
                  return (
                    <label key={family.code} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        name="families"
                        value={family.code}
                        checked={families.includes(family.code)}
                        onChange={(event) => toggleFamily(family.code, event.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        {family.name}
                        {linked ? (
                          <span className="text-muted-foreground"> · ligada ao ângulo</span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
              <FieldError id={`${ids.mode}-erro`} messages={errorsFor(state, 'families')} />
            </div>
          ) : null}

          {mode === 'conversation' ? (
            <p className="text-sm text-muted-foreground" data-proposal="conversation">
              A primeira mensagem não apresenta serviço nem pede reunião: diz quem escreve, um
              motivo concreto e termina numa pergunta leve sobre o momento da empresa.
            </p>
          ) : null}
        </fieldset>

        {blocked ? (
          <Alert tone="warning" role="note" id={ids.blockers} data-proposal-blocked>
            <p className="font-medium">Assim a mensagem não se sustenta nas evidências:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {blockers.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {offerShown ? (
          <div className="space-y-1.5">
            <Label htmlFor={ids.offer}>Oferta da Estratégia (opcional)</Label>
            <p id={`${ids.offer}-ajuda`} className="text-xs text-muted-foreground">
              Complementa a proposta com uma oferta que você cadastrou. Não é preciso escolher.
            </p>
            <NativeSelect
              id={ids.offer}
              name="offerId"
              value={offerId}
              onChange={(event) => setOfferId(event.target.value)}
              aria-describedby={`${ids.offer}-ajuda`}
            >
              <option value="">Nenhuma</option>
              {offers.map((offer) => (
                <option key={offer.value} value={offer.value}>
                  {offer.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}

        <div className="grid gap-4 @md:grid-cols-2">
          <SelectField
            name="kind"
            label="Primeira mensagem"
            options={FIRST_MESSAGE_KIND_OPTIONS}
            {...field}
          />
          <SelectField name="tone" label="Tom" options={TONE_OPTIONS} {...field} />
        </div>
        <TextAreaField
          name="instruction"
          label="Pedido para a IA (opcional)"
          hint='Ex.: "cite a nova unidade em Campinas", "mais curto". Vale só para este texto.'
          rows={2}
          {...field}
        />
        <SubmitButton pendingLabel={AI_PENDING} disabled={blocked}>
          Preparar mensagem
        </SubmitButton>
        <PendingAnnouncement text={AI_PENDING} />
        <p className="text-xs text-muted-foreground">
          A IA usa só o dossiê da empresa, a proposta acima, a voz da agência e os cases
          autorizados. O resultado é um rascunho: nada é enviado.
        </p>
      </form>
      {openAction ? (
        <OpenWithoutAi
          state={opened.state}
          action={opened.formAction}
          offerId={mode === 'conversation' ? '' : offerId}
        />
      ) : null}
    </div>
  );
}

/** "Escrever sem a IA": abre a oportunidade com a oferta escolhida acima (ou nenhuma). */
function OpenWithoutAi({
  state,
  action,
  offerId,
}: {
  state: FormState;
  action: (formData: FormData) => void;
  offerId: string;
}) {
  return (
    <form action={action} noValidate className="space-y-2">
      <FormMessage state={state} />
      <input type="hidden" name="offerId" value={offerId} />
      <SubmitButton variant="secondary" pendingLabel="Abrindo…">
        Escrever sem a IA
      </SubmitButton>
    </form>
  );
}
