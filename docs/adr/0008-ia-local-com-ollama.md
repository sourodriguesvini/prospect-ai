# ADR-0008 — IA local com Ollama como provedor padrão

- Status: **Aceito** (implementado e verificado na fatia IA-1; emendado na IA-1.1: escolha por capacidade, admissão por VRAM, `Origin` obrigatório, orçamento de contexto no servidor, configuração inválida sem erro 500; prompt `copilot/v2` avaliado e não promovido)
- Data: 2026-11-09
- Emenda: [ADR-0003](0003-runtime-de-agentes.md) (runtime de agentes) e a regra "modelo padrão `claude-opus-5-5`" do `CLAUDE.md`.
- Contexto completo: [13-auditoria-e-evolucao.md](../13-auditoria-e-evolucao.md).

## Contexto

O dono do produto pediu que o processamento de IA rode neste computador para reduzir ao máximo a dependência de APIs pagas. O computador também é usado para trabalho (Figma, navegadores, ferramentas de desenvolvimento), então a IA não pode monopolizar a GPU.

Ambiente medido em 2026-11-09: RTX 5060 Ti com 16 GB (≈ 11,9 GB livres em repouso), 39,9 GB de RAM, Ollama 0.40.15 já instalado em `D:\ollama` com `qwen3.5:4b` e `nemotron-3-nano:4b`. O app é de uso interno, local e sem login ([ADR-0007](0007-uso-interno-local-sem-login.md)).

## Decisão

1. **Provedor padrão: Ollama local**, acessado por HTTP em loopback (`http://127.0.0.1:11434`, configurável por `OLLAMA_BASE_URL`). A Claude API deixa de ser o padrão; continua possível como provedor adicional atrás do mesmo gateway, por capacidade e com decisão do usuário (D-AI-1).
2. **Gateway único em `packages/agents`.** Toda inferência passa por `createLocalAiRuntime` → `gateway`, que escolhe o modelo da tarefa, confere a VRAM antes de carregar, corta o histórico para caber no contexto, aplica fila e limites, mede tempos e traduz falhas para códigos de `AiErrorCode` (`@prospector/contracts`). O pacote não usa SDK de terceiros. Configuração `AI_*` inválida não derruba o app: a IA local fica fora do ar com `invalid_config` e a tela mostra o nome da variável (nunca o valor).
3. **Escolha de modelo por tarefa** (`AiTask`: `copilot`, `reasoning`, `vision`, `embedding`) com lista de preferência e fallback para o primeiro instalado **que tenha as capacidades da tarefa** (IA-1.1: `completion`, `vision`, `embedding` exigidas; `thinking` desejável com raciocínio ligado), lidas do `/api/show` com cache por digest; modelo sem a capacidade vira `model_unsupported`. Padrão do Copiloto: `qwen3.5:4b` (Apache 2.0, pt-BR, visão e ferramentas), reserva `nemotron-3-nano:4b` (NVIDIA Open Model License; cartão declara só inglês). Base: avaliação local de 2026-11-09 (recalculada com corretores corrigidos: 69% contra 56%, abaixo do limiar de 75%; Copiloto v1 experimental até o prompt v2 da IA-1.1) e leitura das respostas (doc 13 §9). Na IA-1.1 (13 casos × 3, corretores corrigidos depois da revisão), o `qwen3.5:4b` continuou à frente: 82% com o v1 contra 67% do `nemotron-3-nano:4b`. A reserva orientou guardar CPF e endereço de casa no caso de LGPD, nos dois prompts (KI-034); continua como reserva automática até o v3, com o risco registrado. A lista migra para `agent_configs` quando houver banco (KI-031).
4. **Recursos:** 1 inferência por vez (`AI_MAX_CONCURRENCY`, padrão 1), fila curta (`AI_MAX_QUEUE`, padrão 3, excedente recebe `busy`; quem espera mais de 5 min também recebe `busy`), `keep_alive` de 5 min, `num_ctx` 8192 (nunca acima do contexto de treino do modelo), no máximo 1.024 tokens gerados por resposta (4.096 com raciocínio), descarregar sob demanda. **Admissão por VRAM (IA-1.1):** antes de carregar um modelo que não está na memória, o gateway estima quanto ele ocupa (arquivo × 1,05 + cache K/V calculado dos metadados do `/api/show` + 512 MiB) e só carrega se sobrar a reserva `AI_VRAM_RESERVE_MIB` (padrão 3 GB) para os outros programas; se só couber tirando modelos ociosos do Ollama, descarrega esses antes e confere de novo; sem espaço, recusa com `insufficient_vram` e diz o que fazer (`model_too_large` quando o modelo nunca cabe na placa com a reserva, para a tela não oferecer "Tentar de novo"). A tarefa não espera vaga de memória: recusar com orientação é mais previsível que esperar um recurso que depende de outros programas. Sem GPU NVIDIA (sonda nula) carrega e avisa que a reserva não foi conferida. **Orçamento de contexto no servidor:** o histórico é cortado do mais antigo para o mais novo até caber em `num_ctx` menos o espaço da resposta, com aviso na conversa. O gateway quebra marcas de controle dos modelos (`<|im_start|>` e afins) no texto do usuário e o cliente recusa redirecionamentos. No Windows do usuário: `OLLAMA_MAX_LOADED_MODELS=1` e `OLLAMA_NUM_PARALLEL=1`. O sistema nunca encerra processos de outros programas.
5. **Transporte para a UI:** `POST /api/copiloto` devolve eventos NDJSON no contrato `CopilotEvent`, conferidos no servidor antes de sair e de novo no navegador; a rota só aceita pedidos de mesma origem **com cabeçalho `Origin`** (IA-1.1: o navegador sempre o envia em `fetch` POST; clientes sem ele, como `curl`, recebem 403), JSON e até 256 KB (contados em bytes). Processos locais ainda podem forjar cabeçalhos, como o ADR-0007 já admite.
6. **Prompts versionados** em `packages/agents/prompts/<agente>/vN.md`; cada resposta carrega o id do prompt (`copilot/v1`) e cada resultado de avaliação registra o id e o sha256. Versão avaliada não é editada: um teste fixa o sha256 de cada `copilot/vN.md` (IA-1.1). Promoção só com avaliação no mesmo conjunto e revisão do `avaliador-ia`; o `copilot/v2` (IA-1.1) não foi promovido porque, com os corretores corrigidos, ficou abaixo do v1 (77% contra 82% no `qwen3.5:4b`), recusou redigir mensagens e dobrou o p95 com raciocínio ligado (doc 13 §9).
7. **Avaliações locais** em `packages/agents/evals/<capacidade>/`, sem custo monetário; resultados em JSON versionado. Várias versões de prompt podem ser comparadas na mesma rodada (`EVAL_PROMPTS`), alternando as versões a cada pedido; corretores não podem procurar palavras que só um dos prompts ensina (KI-037).

## Consequências

- (+) Custo de inferência zero em dinheiro; dados não saem do computador na inferência.
- (+) O contrato de eventos do Copiloto (`CopilotEvent`) não depende do provedor, então a conversa na tela não muda se o provedor mudar.
- (−) O gateway, o contrato de estado (`provider: 'ollama'`) e o painel "IA local" são específicos do Ollama. Somar a Claude API exige extrair uma porta `ModelProvider` e generalizar o estado (KI-031).
- (−) Modelos de 4B são menos capazes que os da nuvem, sobretudo em raciocínio longo e chamadas de ferramenta: cada capacidade precisa de avaliação própria antes de ser ativada.
- (−) Uma tarefa por vez: trabalhos longos (investigação, auditoria visual) precisam de fila durável (IA-3, D-AI-5) e competem com o uso pessoal da GPU.
- (−) O Ollama não tem autenticação: qualquer processo deste computador pode usá-lo. Aceitável pelo ADR-0007; não expor a porta na rede.
- As regras de Claude API do `CLAUDE.md` (thinking adaptativo, `stop_reason`, ferramentas de servidor) continuam valendo **se** e quando um provedor Claude for adicionado.

## Alternativas consideradas

| Alternativa | Por que não agora |
|---|---|
| Manter Claude API como padrão | Contraria o objetivo de reduzir APIs pagas |
| LM Studio, vLLM ou llama.cpp direto | Ollama já estava instalado e configurado; vLLM no Windows exige WSL; o gateway permite trocar depois |
| Modelos maiores (8B+) como padrão | Ocupam metade ou mais da VRAM livre e disputam com o uso pessoal; ficam para tarefas pontuais (visão) com execução sequencial |
| SDK de terceiros para Ollama | `fetch` + NDJSON cobre o necessário com menos dependência; o cliente tem 16 testes |
