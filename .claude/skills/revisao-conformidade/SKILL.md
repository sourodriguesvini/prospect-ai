---
name: revisao-conformidade
description: Checklist de LGPD, termos de provedores e regras de contato para qualquer funcionalidade do Prospector que colete, armazene, exiba ou use dados pessoais, ou que contate pessoas/empresas. Use antes de implementar e antes de concluir essas funcionalidades.
---

# Revisão de conformidade

Base: `docs/12-seguranca-e-conformidade.md` e `docs/research/03-canais-contato-e-conformidade.md`. Este checklist não substitui parecer jurídico; pontos marcados "validação jurídica" no doc continuam pendentes até um advogado validar.

## Dados pessoais

- [ ] Qual dado pessoal entra? É necessário para a finalidade (minimização)?
- [ ] Base legal registrada (`legal_basis`, `lia_id` quando legítimo interesse) e origem (`data_origin`).
- [ ] Nada de CPF, endereço residencial, dados sensíveis (art. 5º II LGPD).
- [ ] Retenção definida (`retention_until`) e coberta pelo job de expurgo.
- [ ] Exportação/acesso pelo titular e exclusão funcionam para esse dado (DSR).
- [ ] Logs e traces não carregam o dado em claro (redação de PII).
- [ ] Envio a suboperador (LLM, provedor) previsto no registro de operações e coberto por contrato/cláusulas.

## Contato externo

- [ ] Existe aprovação humana por item com `payload_hash`.
- [ ] Supressão checada no momento do envio (e-mail, domínio, telefone, CNPJ, contato).
- [ ] Remetente identificado; opt-out simples em toda mensagem que o canal permitir.
- [ ] Limites de volume por caixa e por domínio de destino; janela de envio.
- [ ] Canal permitido pelos termos (sem automação de LinkedIn; WhatsApp só com opt-in e API oficial).
- [ ] Pedido de opt-out detectado → supressão imediata e cancelamento de pendentes.

## Provedores

- [ ] Termos permitem o uso (prospecção, armazenamento, IA)?
- [ ] Cache respeita o prazo dos termos? Atribuição exigida está na UI?

## Saída

Liste: itens OK, itens com problema (com arquivo:linha), itens que exigem validação jurídica. Não aprove a funcionalidade com item bloqueante aberto.
