import { ROLE_LABEL } from '../../state/permissions-state.ts';
import { invitationsSignal, reinvite, revokeInvitation } from '../../state/users-state.ts';
import { Button } from '../ui/Button.tsx';
import { TableContainer, Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table.tsx';
import { formatDateTime } from './format.ts';

export function InvitationsTable() {
  const invitations = invitationsSignal.value;
  if (invitations.length === 0) return null;

  return (
    <div class="space-y-2">
      <h2 class="text-sm font-bold text-slate-900 dark:text-white">Invitaciones pendientes</h2>
      <TableContainer>
        <Table>
          <Thead>
            <Tr>
              <Th>Correo</Th>
              <Th>Rol</Th>
              <Th>Vence</Th>
              <Th>Invitó</Th>
              <Th class="text-right">Acciones</Th>
            </Tr>
          </Thead>
          <Tbody>
            {invitations.map((inv) => (
              <Tr key={inv.id}>
                <Td class="font-medium text-slate-900 dark:text-white">{inv.email}</Td>
                <Td>{ROLE_LABEL[inv.role]}</Td>
                <Td>{formatDateTime(inv.expiresAt)}</Td>
                <Td>{inv.invitedByName}</Td>
                <Td class="text-right">
                  <div class="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => { void reinvite(inv); }}>
                      Generar link nuevo
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { void revokeInvitation(inv.id); }}>
                      Revocar
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </TableContainer>
    </div>
  );
}
