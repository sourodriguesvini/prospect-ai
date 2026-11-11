'use client';

import { useFormStatus } from 'react-dom';

/**
 * Avisa o leitor de tela que o pedido está em andamento. O rótulo do botão muda ("Gerando com a
 * IA local…"), mas a troca não é lida; numa espera longa (IA local), a pessoa precisa saber que
 * algo está acontecendo. Fica dentro do `<form>`, como o botão de enviar.
 */
export function PendingAnnouncement({ text }: { text: string }) {
  const { pending } = useFormStatus();
  return (
    <p role="status" className="sr-only">
      {pending ? text : ''}
    </p>
  );
}
