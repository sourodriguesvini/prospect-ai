import type { LiaContent, RubricContent, ScoringModelContent } from '@prospector/contracts';

/**
 * PADRÕES DO PROSPECTOR — decididos em 2026-11-10, por delegação do usuário (KI-046, docs/10
 * D-PROD-2). As telas mostram estes valores pré-preenchidos com o aviso "Padrão do Prospector";
 * nada é salvo sem enviar o formulário, e cada salvamento vira uma versão editável.
 * Rubrica e score ainda não foram calibrados com resultados reais (docs/08 §3.5). A LIA continua
 * dependendo de parecer jurídico antes do primeiro envio (D-LGPD-1): o texto não substitui isso.
 * Os nomes `DRAFT_*` ficam por compatibilidade.
 */

/**
 * Rubrica de auditoria visual para branding (escala 1–5). Critérios e pesos padrão, ainda sem
 * calibração com resultados reais.
 */
export const DRAFT_BRANDING_RUBRIC: RubricContent = {
  criteria: [
    {
      key: 'consistencia_canais',
      label: 'Consistência entre canais',
      description: 'Logotipo, cores e tipografia iguais no site e nas redes sociais.',
      weight: 20,
      evidenceRequired: ['site_desktop', 'social_grid'],
    },
    {
      key: 'sistema_visual',
      label: 'Sistema visual definido',
      description: 'Paleta, tipografia e elementos gráficos aplicados com regra, não peça a peça.',
      weight: 15,
      evidenceRequired: ['site_desktop', 'social_grid'],
    },
    {
      key: 'qualidade_logotipo',
      label: 'Qualidade do logotipo',
      description: 'Legível em tamanho pequeno, arquivo nítido, versões para fundo claro e escuro.',
      weight: 15,
      evidenceRequired: ['logo', 'favicon'],
    },
    {
      key: 'legibilidade_hierarquia',
      label: 'Legibilidade e hierarquia',
      description: 'Contraste, tamanho de texto e ordem de leitura claros no site.',
      weight: 15,
      evidenceRequired: ['site_desktop', 'site_mobile'],
    },
    {
      key: 'experiencia_celular',
      label: 'Experiência no celular',
      description: 'Layout adaptado, texto legível e botões fáceis de tocar.',
      weight: 15,
      evidenceRequired: ['site_mobile'],
    },
    {
      key: 'imagens_fotografia',
      label: 'Imagens e fotografia',
      description: 'Imagens próprias e coerentes com a marca, em vez de banco de imagens genérico.',
      weight: 10,
      evidenceRequired: ['site_desktop', 'social_grid'],
    },
    {
      key: 'acabamento_digital',
      label: 'Acabamento digital',
      description: 'Favicon e imagem de compartilhamento (og:image) definidos e coerentes.',
      weight: 10,
      evidenceRequired: ['favicon', 'og_image'],
    },
  ],
};

/**
 * Modelo de score: pesos e limiares de docs/08 §3 (padrão para branding, a calibrar).
 * `minEvidenceCoverage` não tem número em docs/08: 50 foi decidido sem base empírica (KI-046).
 */
export const DRAFT_SCORING_MODEL: ScoringModelContent = {
  weights: { fit: 25, need: 30, signal: 20, capacity: 15, timing: 10 },
  thresholds: {
    pursuePriority: 70,
    prepareAccessPotential: 70,
    discardPotential: 40,
    minEvidenceCoverage: 50,
  },
};

/**
 * LIA guiada para prospecção B2B (docs/12 §4). A base legal para prospecção fria B2B é o
 * principal ponto jurídico em aberto (docs/12 §7, D-LGPD-1): este texto NÃO substitui validação
 * jurídica. A conclusão fica em branco de propósito: quem aprova escreve a própria.
 * As salvaguardas separam o que já existe do que ainda falta construir antes do primeiro envio:
 * a LIA não pode descrever controles que o sistema ainda não tem. O QSA não vem marcado como
 * origem: é a origem mais contestável (docs/12 §7) e, se for usada, a expectativa precisa
 * tratar dela.
 */
export const DRAFT_LIA: LiaContent = {
  purpose:
    'Prospecção comercial B2B: identificar empresas com sinais de necessidade de branding e contatar, uma a uma, a pessoa responsável pela marca ou pelo marketing, com mensagem aprovada por humano. A IA que ajuda a pesquisar a empresa e a redigir a mensagem roda neste computador (Ollama, sem envio a provedores de IA); nenhuma mensagem sai sem revisão humana.',
  legitimateInterest:
    'Interesse da agência em oferecer serviços de identidade visual a empresas que podem se beneficiar deles, com base em sinais públicos e verificáveis (site, presença digital, cadastro CNPJ).',
  necessity:
    'Para oferecer o serviço é preciso chegar a quem decide sobre a marca. Quando não há responsável identificável, usamos o canal institucional da empresa (contato@ ou formulário do site); nos demais casos ele não basta, porque raramente chega a quem decide. Tratamos só nome, cargo e e-mail corporativo: mesmo profissionais, são dados pessoais, e por isso ficam limitados a essa lista. Nada de CPF, dado sensível ou contato pessoal. Pedir consentimento antes do primeiro contato exigiria o próprio contato.',
  dataCategories: ['name', 'role_title', 'work_email'],
  dataSources: ['company_website', 'user_input'],
  expectations:
    'A pessoa não tem relação prévia com a agência. Os dados vêm do site da própria empresa ou são informados pelo usuário a partir de fonte profissional pública. O contato trata do tema do cargo dela (a marca da empresa), compatível com o contexto em que o dado foi publicado. O quadro de sócios (QSA) da Receita Federal não é usado como origem nesta versão: ele é publicado para transparência, e usá-lo para prospecção seria uma finalidade nova.',
  risks:
    'Incômodo com mensagem não solicitada; contato com quem não é responsável pela marca; uso de dado desatualizado; conclusões erradas sobre a pessoa ou a empresa em texto gerado por IA; reunião de dados públicos num perfil; envio de dados a provedor de IA em nuvem, se um vier a ser adicionado (transferência internacional; hoje a IA roda neste computador); incidente de segurança com a base; falha em honrar um pedido de oposição; excesso de mensagens de acompanhamento.',
  safeguards:
    'Em vigor: aprovação humana de cada mensagem; contato 1:1 e em volume baixo; lista fechada de dados pessoais (sem CPF nem dado sensível); app só local, sem acesso público ao banco. A implementar antes do primeiro envio: aviso de oposição em toda mensagem, honrado assim que recebido e conferido no momento do envio; supressão do contato; origem e base legal registradas por contato; prazo de retenção com exclusão automática. Esta avaliação é revista até a data definida na aprovação, ou antes, se mudar a origem, a categoria de dado, o provedor (inclusive se a IA passar a rodar em nuvem) ou o canal.',
  conclusion: '',
};

/**
 * Texto de opt-out padrão para toda primeira mensagem (docs/12 §4, "Oposição e opt-out").
 * Promete só o que vale: parar de enviar (supressão), não "excluir" nem "na hora".
 */
export const DRAFT_OPT_OUT_TEXT =
  'Se não quiser receber novas mensagens nossas, é só responder dizendo isso (por exemplo, "remover") e não enviaremos mais nada.';
