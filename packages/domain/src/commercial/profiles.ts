import type { Capability, CommercialProfile, DeliveryMode } from '@prospector/contracts';

/**
 * Perfis comerciais (diretriz 2026-11-26, Parte 1). Dado versionado no código até a migração de
 * `commercial_profiles` ser autorizada (doc 15 §7.1); o teste de contrato garante o formato.
 *
 * Modo de entrega (Parte 1.4) é PROVISÓRIO e conservador: "direto" só onde há portfólio publicado
 * (branding em branding.foundstudio.com.br; produto e UI/UX em foundstudio.com.br, ver
 * `PORTFOLIO_LINKS`); "dirigido" onde o trabalho é de direção; "com parceiros" onde a execução
 * costuma depender de equipe externa; "não comprovado" onde não há case publicado. O usuário
 * confirma cada um (está em `unknowns`).
 */

const cap = (id: string, name: string, deliveryMode: DeliveryMode): Capability => ({
  id,
  name,
  deliveryMode,
});

export const FOUND_STUDIO_PROFILE: CommercialProfile = {
  id: 'found-studio',
  name: 'Found Studio',
  kind: 'services',
  description:
    'Estúdio multidisciplinar que conecta estratégia, marca, produto, comunicação, tecnologia, inovação e operação.',
  positioning:
    'Não é uma agência de logotipos e sites: atua em Brand & Product Design, direção de arte e criativa, Product Management, direção de projetos, estratégia de marca, estruturação de produtos, tecnologia e IA, experiência digital, inovação e automação. Um mesmo projeto pode combinar várias dessas capacidades.',
  premise: 'Entender. Estruturar. Construir.',
  audience: [
    'Empresas em momento de crescimento, mudança ou lançamento',
    'Startups e scale-ups com produto digital',
    'Marcas que precisam alinhar estratégia, identidade e comunicação',
  ],
  icps: [
    {
      name: 'Empresa em crescimento',
      description:
        'Recebeu investimento, expandiu, lançou ou mudou de liderança; precisa estruturar marca, produto ou operação para a nova fase.',
      roles: ['buyer', 'influencer'],
    },
    {
      name: 'Empresa com produto digital',
      description:
        'Tem plataforma, aplicativo ou SaaS próprio e time que precisa evoluir o produto.',
      roles: ['buyer', 'influencer'],
    },
  ],
  valueProposition:
    'O trabalho começa pela compreensão do problema, passa pela estruturação de uma solução e termina na direção, construção e evolução do que precisa existir.',
  differentiators: [
    'Conecta estratégia, marca, produto e tecnologia no mesmo projeto',
    'Direção do começo ao fim: do diagnóstico à implementação',
  ],
  language:
    'Profissional que entende o negócio e quer começar uma conversa: direta, sem elogio vazio, sem jargão técnico desnecessário e sem apresentação exagerada.',
  avoidAfterEvents: [
    {
      type: 'brand_change',
      item: 'Rebranding',
      reason: 'A empresa mudou a marca recentemente.',
    },
  ],
  restrictions: [
    'Não apresentar experiência, cases, equipes ou resultados inexistentes (Parte 1.4).',
    'Não apresentar o portfólio inteiro numa abordagem: um ângulo principal e até duas alternativas.',
    'Não tratar investimento recebido pela empresa como orçamento para serviços.',
    'Não abrir a conversa por um defeito técnico do site quando há um momento empresarial relevante.',
    'Nunca misturar com produtos de outros perfis (Blummy).',
  ],
  unknowns: [
    'Confirmar o modo de entrega de cada capacidade (hoje provisório, a partir dos portfólios publicados)',
    'Cases autorizados por capacidade (hoje nenhum)',
    'Parceiros e equipes com quem executa desenvolvimento, audiovisual e pesquisa',
  ],
  keywords: [
    'found studio',
    'found',
    'branding',
    'marca',
    'identidade visual',
    'rebranding',
    'naming',
    'site',
    'website',
    'produto digital',
    'ux',
    'ui',
    'design system',
    'campanha',
    'direcao de arte',
    'product management',
    'startup',
    'startups',
    'agencia',
    'automacao',
    'ia aplicada',
    'rodada',
    'investimento',
    'expansao',
  ],
  families: [
    {
      code: 'A',
      name: 'Estratégia e Inteligência de Marca',
      capabilities: [
        cap('diagnostico-marca', 'Diagnóstico de marca', 'direct'),
        cap('pesquisa-mercado', 'Pesquisa de mercado', 'directed'),
        cap('pesquisa-publico', 'Pesquisa de público', 'directed'),
        cap('analise-competitiva', 'Análise competitiva', 'direct'),
        cap('posicionamento', 'Posicionamento', 'direct'),
        cap('proposta-valor', 'Proposta de valor', 'direct'),
        cap('personalidade-territorio', 'Personalidade e território de marca', 'direct'),
        cap('naming', 'Naming', 'direct'),
        cap('arquitetura-marca', 'Arquitetura de marca', 'direct'),
        cap('estrategia-comunicacao', 'Estratégia de comunicação', 'directed'),
      ],
    },
    {
      code: 'B',
      name: 'Branding e Sistemas de Identidade',
      capabilities: [
        cap('identidade-visual', 'Identidade visual', 'direct'),
        cap('rebranding', 'Rebranding', 'direct'),
        cap('sistemas-graficos', 'Sistemas gráficos', 'direct'),
        cap('sistema-tipografico', 'Sistema tipográfico', 'direct'),
        cap('sistema-cromatico', 'Sistema cromático', 'direct'),
        cap('direcao-visual', 'Direção visual', 'direct'),
        cap('brandbook', 'Brandbook', 'direct'),
        cap('guidelines', 'Guidelines', 'direct'),
        cap('aplicacoes-marca', 'Aplicações de marca', 'direct'),
        cap('consistencia-pontos-contato', 'Consistência entre pontos de contato', 'direct'),
      ],
    },
    {
      code: 'C',
      name: 'Direção Criativa e Comunicação',
      capabilities: [
        cap('direcao-arte', 'Direção de arte', 'direct'),
        cap('campanhas', 'Campanhas', 'directed'),
        cap('key-visuals', 'Key visuals', 'direct'),
        cap('direcao-fotografica', 'Direção fotográfica', 'partners'),
        cap('direcao-audiovisual', 'Direção audiovisual', 'partners'),
        cap('comunicacao-institucional', 'Comunicação institucional', 'directed'),
        cap('narrativas', 'Narrativas', 'directed'),
        cap('conteudo', 'Conteúdo', 'directed'),
        cap('materiais-comerciais', 'Materiais comerciais e publicitários', 'direct'),
      ],
    },
    {
      code: 'D',
      name: 'Produto e Experiência Digital',
      capabilities: [
        cap('product-discovery', 'Product Discovery', 'direct'),
        cap('product-design', 'Product Design', 'direct'),
        cap('ux-ui', 'UX/UI', 'direct'),
        cap('arquitetura-informacao', 'Arquitetura da informação', 'direct'),
        cap('user-flows', 'User flows', 'direct'),
        cap('wireframes', 'Wireframes', 'direct'),
        cap('design-system', 'Design Systems', 'direct'),
        cap('prototipagem', 'Prototipagem', 'direct'),
        cap('product-management', 'Product Management', 'directed'),
        cap('roadmaps', 'Roadmaps', 'directed'),
        cap('mvps', 'MVPs', 'partners'),
        cap('websites', 'Websites', 'direct'),
        cap('plataformas', 'Plataformas', 'partners'),
        cap('aplicativos', 'Aplicativos', 'partners'),
        cap('portais', 'Portais', 'partners'),
        cap('e-commerce', 'E-commerce', 'partners'),
      ],
    },
    {
      code: 'E',
      name: 'Tecnologia, Inteligência Artificial e Inovação',
      capabilities: [
        cap('consultoria-ia', 'Consultoria de IA aplicada', 'unproven'),
        cap('workflows-inteligentes', 'Workflows inteligentes', 'unproven'),
        cap('agentes-ia', 'Agentes de IA', 'unproven'),
        cap('integracoes-api', 'Integrações com APIs', 'unproven'),
        cap('automacao', 'Automação', 'unproven'),
        cap('sistemas-internos', 'Sistemas internos', 'unproven'),
        cap('ferramentas-saas', 'Ferramentas SaaS', 'unproven'),
        cap('ia-comunicacao', 'IA para comunicação e produção', 'unproven'),
        cap('ia-operacoes', 'IA para operações', 'unproven'),
        cap('estruturacao-tecnologica', 'Estruturação de soluções tecnológicas', 'directed'),
      ],
    },
    {
      code: 'F',
      name: 'Direção de Projetos e Estruturação Operacional',
      capabilities: [
        cap('gestao-projetos', 'Gestão de projetos', 'direct'),
        cap('coordenacao-multidisciplinar', 'Coordenação multidisciplinar', 'direct'),
        cap('arquitetura-processos', 'Arquitetura de processos', 'directed'),
        cap('gestao-demandas', 'Gestão de demandas', 'directed'),
        cap('fluxos-aprovacao', 'Fluxos de aprovação', 'directed'),
        cap('centrais-projetos', 'Centrais de projetos', 'unproven'),
        cap('dashboards', 'Dashboards', 'unproven'),
        cap('documentacao', 'Documentação', 'direct'),
        cap('organizacao-operacoes', 'Organização de operações', 'directed'),
        cap('governanca-entregas', 'Governança e acompanhamento de entregas', 'direct'),
      ],
    },
  ],
  problems: [
    {
      id: 'produto-em-estruturacao',
      statement:
        'Produto digital em fase de crescimento, que pode precisar de discovery, roadmap, experiência e design system para evoluir sem perder consistência.',
      signals: ['funding', 'launch', 'hiring', 'leadership', 'new_market', 'acquisition'],
      capabilityIds: [
        'product-discovery',
        'product-management',
        'roadmaps',
        'ux-ui',
        'design-system',
        'gestao-projetos',
      ],
      toConfirm: [
        'Se a empresa tem produto digital próprio e quem lidera essa área',
        'Se há time interno de produto e design e o que ele já cobre',
      ],
      approachRole: 'Liderança de produto ou tecnologia (CPO, head de produto, CTO)',
      openingArea: 'produto e time',
      terms: [
        'produto',
        'product',
        'tecnologia',
        'engenharia',
        'engenheiro',
        'desenvolvedor',
        'desenvolvimento',
        'design',
        'designer',
        'ux',
        'ui',
        'plataforma',
        'aplicativo',
        'app',
        'cpo',
        'cto',
        'software',
        'dados',
        'tech',
      ],
    },
    {
      id: 'marca-apos-mudanca-estrutural',
      statement:
        'Marca e arquitetura de marca que podem não acompanhar uma aquisição, fusão, parceria ou entrada em novo mercado.',
      signals: ['acquisition', 'merger', 'new_market', 'partnership', 'expansion'],
      capabilityIds: [
        'arquitetura-marca',
        'posicionamento',
        'estrategia-comunicacao',
        'consistencia-pontos-contato',
        'brandbook',
      ],
      toConfirm: [
        'Como as marcas envolvidas vão conviver depois do acontecimento',
        'Se a empresa já tem agência ou time de marca cuidando disso',
      ],
      approachRole: 'Marketing ou marca (CMO, head de marca)',
      openingArea: 'marca e identidade',
      terms: [
        'marca',
        'marcas',
        'branding',
        'marketing',
        'comunicacao',
        'cmo',
        'posicionamento',
        'integracao',
      ],
    },
    {
      id: 'comunicacao-de-lancamento',
      statement:
        'Lançamento ou expansão que pede campanha, key visual e materiais para chegar ao público certo.',
      signals: ['launch', 'expansion', 'new_market', 'award'],
      capabilityIds: [
        'campanhas',
        'key-visuals',
        'direcao-arte',
        'comunicacao-institucional',
        'materiais-comerciais',
      ],
      toConfirm: ['Se a comunicação do lançamento já está contratada ou é feita internamente'],
      approachRole: 'Marketing ou comunicação (CMO, gerente de marketing)',
      openingArea: 'comunicação do lançamento',
      terms: [
        'campanha',
        'marketing',
        'comunicacao',
        'lancamento',
        'publicidade',
        'cmo',
        'conteudo',
      ],
    },
    {
      id: 'operacao-em-crescimento',
      statement:
        'Operação que cresce mais rápido que os processos: demandas, aprovações e projetos sem estrutura de acompanhamento.',
      signals: ['expansion', 'funding', 'restructuring', 'hiring', 'merger', 'acquisition'],
      capabilityIds: [
        'gestao-projetos',
        'arquitetura-processos',
        'gestao-demandas',
        'fluxos-aprovacao',
        'governanca-entregas',
      ],
      toConfirm: [
        'Se existe PMO ou responsável por processos',
        'Que gargalos a empresa admite publicamente',
      ],
      approachRole: 'Operações ou PMO (COO, gerente de projetos)',
      openingArea: 'processos e operação',
      terms: [
        'operacoes',
        'operacao',
        'processos',
        'pmo',
        'projetos',
        'coo',
        'gestao',
        'eficiencia',
      ],
    },
    {
      id: 'ia-aplicada-a-operacao',
      statement:
        'Processos manuais ou repetitivos que poderiam ganhar com automação e IA aplicada.',
      signals: ['restructuring', 'funding', 'launch'],
      capabilityIds: [
        'consultoria-ia',
        'workflows-inteligentes',
        'agentes-ia',
        'automacao',
        'estruturacao-tecnologica',
      ],
      toConfirm: [
        'Quais processos a empresa quer automatizar',
        'Se há time de tecnologia para manter a solução',
      ],
      approachRole: 'Operações ou tecnologia (COO, CTO)',
      openingArea: 'processos e uso de IA',
      terms: ['ia', 'inteligencia artificial', 'automacao', 'dados', 'eficiencia', 'agentes'],
    },
    {
      id: 'marca-desalinhada-ao-momento',
      statement:
        'Identidade que pode não acompanhar um novo posicionamento, liderança ou fase da empresa.',
      signals: ['leadership', 'restructuring', 'expansion', 'anniversary'],
      capabilityIds: [
        'diagnostico-marca',
        'posicionamento',
        'rebranding',
        'identidade-visual',
        'sistemas-graficos',
      ],
      toConfirm: [
        'Se a empresa vê a marca atual como um problema',
        'Quando foi a última revisão da marca',
      ],
      approachRole: 'Marketing ou marca (CMO, head de marca) ou fundadores',
      openingArea: 'marca e posicionamento',
      terms: [
        'marca',
        'branding',
        'marketing',
        'identidade',
        'cmo',
        'posicionamento',
        'reposicionamento',
      ],
    },
    {
      id: 'experiencia-digital-com-falhas',
      statement:
        'Site com falhas de leitura ou de uso no celular, que podem atrapalhar quem visita.',
      signals: ['site_accessibility', 'site_mobile', 'site_inconsistency'],
      capabilityIds: ['websites', 'ux-ui'],
      toConfirm: [
        'Se o site é prioridade para a empresa agora',
        'Quem cuida do site (time interno ou fornecedor)',
      ],
      approachRole: 'Responsável pelo site ou pelo marketing digital',
      openingArea: 'experiência digital',
      terms: ['site', 'website', 'ecommerce', 'e-commerce', 'digital'],
    },
  ],
  services: [
    {
      id: 'diagnostico-produto',
      name: 'Diagnóstico de produto',
      capabilityIds: ['product-discovery', 'product-management'],
      deliverables: ['Mapa do produto atual e dos problemas', 'Prioridades e próximos passos'],
    },
    {
      id: 'product-discovery',
      name: 'Product Discovery',
      capabilityIds: ['product-discovery', 'pesquisa-publico'],
      deliverables: ['Entrevistas e síntese', 'Oportunidades priorizadas'],
    },
    {
      id: 'roadmap',
      name: 'Estruturação de roadmap',
      capabilityIds: ['roadmaps', 'product-management'],
      deliverables: ['Roadmap priorizado'],
    },
    {
      id: 'ux-ui',
      name: 'UX/UI',
      capabilityIds: ['ux-ui', 'user-flows', 'wireframes', 'prototipagem'],
      deliverables: ['Fluxos', 'Wireframes', 'Interfaces', 'Protótipo'],
    },
    {
      id: 'design-system',
      name: 'Design System',
      capabilityIds: ['design-system'],
      deliverables: ['Biblioteca de componentes', 'Documentação de uso'],
    },
    {
      id: 'direcao-implementacao',
      name: 'Direção de implementação',
      capabilityIds: ['gestao-projetos', 'coordenacao-multidisciplinar', 'governanca-entregas'],
      deliverables: ['Acompanhamento da implementação', 'Governança das entregas'],
    },
    {
      id: 'estrategia-marca',
      name: 'Estratégia e arquitetura de marca',
      capabilityIds: ['diagnostico-marca', 'posicionamento', 'proposta-valor', 'arquitetura-marca'],
      deliverables: ['Diagnóstico', 'Posicionamento', 'Arquitetura de marca'],
    },
    {
      id: 'identidade-visual',
      name: 'Identidade visual ou rebranding',
      capabilityIds: ['identidade-visual', 'rebranding', 'sistemas-graficos', 'brandbook'],
      deliverables: ['Sistema de identidade', 'Brandbook'],
    },
    {
      id: 'campanha',
      name: 'Campanha e key visual',
      capabilityIds: ['campanhas', 'key-visuals', 'direcao-arte'],
      deliverables: ['Conceito', 'Key visual', 'Peças da campanha'],
    },
    {
      id: 'comunicacao-institucional',
      name: 'Comunicação institucional',
      capabilityIds: ['comunicacao-institucional', 'narrativas', 'materiais-comerciais'],
      deliverables: ['Narrativa institucional', 'Materiais comerciais'],
    },
    {
      id: 'estruturacao-operacional',
      name: 'Estruturação operacional',
      capabilityIds: ['arquitetura-processos', 'gestao-demandas', 'fluxos-aprovacao', 'dashboards'],
      deliverables: ['Mapa de processos', 'Fluxos de aprovação', 'Painel de acompanhamento'],
    },
    {
      id: 'ia-aplicada',
      name: 'IA aplicada e automação',
      capabilityIds: ['consultoria-ia', 'workflows-inteligentes', 'agentes-ia', 'automacao'],
      deliverables: ['Mapa de oportunidades de automação', 'Protótipo de fluxo com IA'],
    },
    {
      id: 'website',
      name: 'Site',
      capabilityIds: ['websites', 'ux-ui'],
      deliverables: ['Arquitetura do site', 'Interfaces', 'Site publicado'],
    },
  ],
  solutions: [
    {
      id: 'estruturacao-produto-digital',
      name: 'Estruturação e evolução do produto digital',
      problemIds: ['produto-em-estruturacao'],
      serviceIds: [
        'diagnostico-produto',
        'product-discovery',
        'roadmap',
        'ux-ui',
        'design-system',
        'direcao-implementacao',
      ],
      rationale:
        'Uma fase de crescimento costuma exigir que o produto evolua com método: entender o que existe, priorizar, desenhar e manter a consistência enquanto o time cresce. A oportunidade não se reduz a criar interfaces.',
    },
    {
      id: 'marca-para-nova-estrutura',
      name: 'Marca para a nova estrutura da empresa',
      problemIds: ['marca-apos-mudanca-estrutural', 'marca-desalinhada-ao-momento'],
      serviceIds: ['estrategia-marca', 'identidade-visual'],
      rationale:
        'Quando a empresa muda de estrutura, de mercado ou de liderança, a marca precisa dizer a mesma coisa em todos os pontos de contato; começa pela estratégia, não pelo logotipo.',
    },
    {
      id: 'comunicacao-do-momento',
      name: 'Comunicação do lançamento ou da expansão',
      problemIds: ['comunicacao-de-lancamento'],
      serviceIds: ['campanha', 'comunicacao-institucional'],
      rationale:
        'Um lançamento ou uma expansão só rende se chega ao público certo com uma ideia clara; campanha e materiais saem da mesma direção criativa.',
    },
    {
      id: 'estruturacao-da-operacao',
      name: 'Estruturação da operação de projetos',
      problemIds: ['operacao-em-crescimento'],
      serviceIds: ['estruturacao-operacional', 'direcao-implementacao'],
      rationale:
        'Crescer aumenta demandas e aprovações; processos, responsáveis e acompanhamento claros evitam que o time perca velocidade.',
    },
    {
      id: 'ia-na-operacao',
      name: 'IA aplicada à operação',
      problemIds: ['ia-aplicada-a-operacao'],
      serviceIds: ['ia-aplicada', 'estruturacao-operacional'],
      rationale:
        'Automação só ajuda quando o processo está claro: primeiro mapear, depois automatizar o que é repetitivo.',
    },
    {
      id: 'ajustes-de-site',
      name: 'Ajustes de experiência no site',
      problemIds: ['experiencia-digital-com-falhas'],
      serviceIds: ['website'],
      rationale:
        'Falhas de leitura e de uso no celular são concretas e corrigíveis, mas sozinhas raramente justificam um projeto estratégico.',
    },
  ],
  version: 1,
};

export const BLUMMY_PROFILE: CommercialProfile = {
  id: 'blummy',
  name: 'Blummy',
  kind: 'product',
  description:
    'Produto SaaS de gestão inteligente para profissionais e clínicas da área terapêutica.',
  positioning:
    'Gestão inteligente para quem atende na área terapêutica, de profissionais independentes a clínicas (posicionamento detalhado a confirmar com o usuário).',
  premise: null,
  audience: [
    'Profissionais da área terapêutica que atendem de forma independente',
    'Clínicas da área terapêutica',
    'Gestores e sócios de clínicas',
  ],
  icps: [
    {
      name: 'Profissional independente',
      description:
        'Atende em consultório próprio ou compartilhado; em geral usa e decide a compra.',
      roles: ['user', 'buyer'],
    },
    {
      name: 'Clínica terapêutica',
      description: 'Equipe de terapeutas; quem usa é o terapeuta, quem compra é o gestor ou sócio.',
      roles: ['user', 'buyer', 'influencer'],
    },
    {
      name: 'Terapeuta em clínica',
      description: 'Usa o sistema no dia a dia e influencia a escolha, mas não compra.',
      roles: ['user', 'influencer'],
    },
  ],
  valueProposition:
    'Gestão inteligente da rotina de atendimento na área terapêutica (proposta detalhada a confirmar com o usuário).',
  differentiators: [],
  language:
    'Próxima, clara e respeitosa com a prática clínica, sem jargão de tecnologia (tom definitivo a confirmar).',
  avoidAfterEvents: [],
  restrictions: [
    'Não presumir que todo terapeuta tem clínica ou orçamento para contratar um SaaS (Parte 6.5).',
    'Só dados profissionais públicos; não deduzir e-mails nem coletar dados pessoais desnecessários (LGPD).',
    'Não citar funcionalidades, preços, planos ou resultados que não estejam no perfil.',
    'Nunca misturar com os serviços da Found Studio.',
  ],
  unknowns: [
    'Funcionalidades do produto',
    'Planos e preços',
    'Profissões atendidas além de terapia ocupacional',
    'Cases e clientes que podem ser citados',
    'Linguagem e tom da marca',
  ],
  keywords: [
    'blummy',
    'terapeuta',
    'terapeutas',
    'terapia',
    'terapia ocupacional',
    'terapeuta ocupacional',
    'terapeutas ocupacionais',
    'fonoaudiologo',
    'fonoaudiologa',
    'fonoaudiologos',
    'fonoaudiologia',
    'psicologo',
    'psicologa',
    'psicologos',
    'psicologia',
    'fisioterapeuta',
    'fisioterapeutas',
    'fisioterapia',
    'psicopedagogo',
    'psicopedagoga',
    'clinica terapeutica',
    'clinicas terapeuticas',
    'consultorio',
    'consultorios',
    'area terapeutica',
  ],
  families: [
    {
      code: 'G',
      name: 'Gestão para a área terapêutica',
      capabilities: [
        cap(
          'gestao-rotina-terapeutica',
          'Gestão inteligente da rotina de atendimento (funcionalidades a confirmar)',
          'direct',
        ),
      ],
    },
  ],
  problems: [
    {
      id: 'clinica-em-crescimento',
      statement:
        'Clínica que cresce (nova unidade, mais terapeutas) e pode precisar organizar a gestão do atendimento.',
      signals: ['expansion', 'hiring', 'move'],
      capabilityIds: ['gestao-rotina-terapeutica'],
      toConfirm: [
        'Quantos terapeutas atendem e quem decide sobre sistemas',
        'Que sistema a clínica usa hoje',
      ],
      approachRole: 'Gestor ou sócio da clínica (comprador)',
      openingArea: 'rotina da clínica',
      terms: ['clinica', 'unidade', 'terapeutas', 'equipe', 'atendimento'],
    },
    {
      id: 'rotina-do-profissional',
      statement:
        'Profissional independente cuja rotina administrativa pode tomar tempo do atendimento.',
      signals: ['move', 'launch', 'expansion'],
      capabilityIds: ['gestao-rotina-terapeutica'],
      toConfirm: [
        'Se atende de forma independente ou em clínica',
        'Que ferramenta usa hoje para agenda e registros',
      ],
      approachRole: 'O próprio profissional (usuário e comprador)',
      openingArea: 'rotina de atendimento',
      terms: ['consultorio', 'atendimento', 'agenda', 'pacientes'],
    },
  ],
  services: [
    {
      id: 'assinatura-blummy',
      name: 'Assinatura da Blummy',
      capabilityIds: ['gestao-rotina-terapeutica'],
      deliverables: ['Acesso ao produto (planos a confirmar)'],
    },
  ],
  solutions: [
    {
      id: 'blummy-para-clinicas',
      name: 'Blummy para clínicas',
      problemIds: ['clinica-em-crescimento'],
      serviceIds: ['assinatura-blummy'],
      rationale:
        'Quem compra é o gestor; quem usa é a equipe. A conversa começa pelo momento da clínica, não pela lista de funções.',
    },
    {
      id: 'blummy-para-profissionais',
      name: 'Blummy para profissionais independentes',
      problemIds: ['rotina-do-profissional'],
      serviceIds: ['assinatura-blummy'],
      rationale:
        'Para quem atende sozinho, o valor é tempo de volta para o atendimento; não presumir clínica nem orçamento.',
    },
  ],
  version: 1,
};

export const COMMERCIAL_PROFILES: readonly CommercialProfile[] = Object.freeze([
  FOUND_STUDIO_PROFILE,
  BLUMMY_PROFILE,
]);

/** Perfil da investigação de empresas enquanto não há seleção por empresa (doc 15 §7.1). */
export const DEFAULT_COMMERCIAL_PROFILE_ID = FOUND_STUDIO_PROFILE.id;

export function commercialProfileById(
  id: string,
  profiles: readonly CommercialProfile[] = COMMERCIAL_PROFILES,
): CommercialProfile | null {
  return profiles.find((profile) => profile.id === id) ?? null;
}

/** Capacidades do perfil por id (para validar o catálogo e ler o modo de entrega). */
export function capabilityIndex(profile: CommercialProfile): ReadonlyMap<string, Capability> {
  return new Map(
    profile.families.flatMap((family) =>
      family.capabilities.map((capability) => [capability.id, capability] as const),
    ),
  );
}

/**
 * Problemas do catálogo que não fecham (capacidade, serviço ou problema inexistente). Vazio =
 * catálogo coerente; o teste de contrato exige vazio para todo perfil.
 */
export function catalogIssues(profile: CommercialProfile): string[] {
  const issues: string[] = [];
  const capabilities = capabilityIndex(profile);
  const problems = new Set(profile.problems.map((problem) => problem.id));
  const services = new Set(profile.services.map((service) => service.id));
  const seen = new Set<string>();
  for (const family of profile.families) {
    for (const capability of family.capabilities) {
      if (seen.has(capability.id)) issues.push(`capacidade repetida: ${capability.id}`);
      seen.add(capability.id);
    }
  }
  for (const problem of profile.problems) {
    for (const id of problem.capabilityIds) {
      if (!capabilities.has(id)) issues.push(`problema ${problem.id}: capacidade ${id}`);
    }
  }
  for (const service of profile.services) {
    for (const id of service.capabilityIds) {
      if (!capabilities.has(id)) issues.push(`serviço ${service.id}: capacidade ${id}`);
    }
  }
  for (const solution of profile.solutions) {
    for (const id of solution.problemIds) {
      if (!problems.has(id)) issues.push(`solução ${solution.id}: problema ${id}`);
    }
    for (const id of solution.serviceIds) {
      if (!services.has(id)) issues.push(`solução ${solution.id}: serviço ${id}`);
    }
  }
  return issues;
}
