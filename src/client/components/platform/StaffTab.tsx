import { signal } from '@preact/signals';
import { inviteStaff, revokeStaffInvitation, setUserStatus, staffSignal } from '../../state/platform-panel-state.ts';
import { currentUserSignal } from '../../state/auth-state.ts';
import { formatDateTime } from '../../format.ts';
import { Button } from '../ui/Button.tsx';
import { Card, CardHeader } from '../ui/Card.tsx';
import { Input } from '../ui/Input.tsx';
import { Modal } from '../ui/Modal.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import { AccountStatusBadge, Badge } from './platform-badges.tsx';

const inviteOpenSignal = signal<boolean>(false);
const emailSignal = signal<string>('');
const busySignal = signal<boolean>(false);

async function submitInvite(): Promise<void> {
  if (emailSignal.value.trim() === '') return;
  busySignal.value = true;
  const ok = await inviteStaff(emailSignal.value.trim()).finally(() => {
    busySignal.value = false;
  });
  if (ok) inviteOpenSignal.value = false;
}

function InviteStaffModal() {
  if (!inviteOpenSignal.value) return null;
  const close = () => {
    inviteOpenSignal.value = false;
  };
  return (
    <Modal
      isOpen
      onClose={close}
      title="Invitar a soporte"
      subtitle="Se genera un link de un solo uso que vence en 48 h. Una cuenta de un comercio no puede pasar a soporte."
      maxWidth="md"
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancelar
          </Button>
          <Button loading={busySignal.value} onClick={() => void submitInvite()}>
            Crear link
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitInvite();
        }}
      >
        <Input label="Correo" type="email" value={emailSignal.value} onInput={(e) => { emailSignal.value = e.currentTarget.value; }} />
      </form>
    </Modal>
  );
}

/** El equipo de soporte (#23), solo para root: miembros, invitaciones pendientes, invitar y desactivar. */
export function StaffTab() {
  const staff = staffSignal.value;
  const me = currentUserSignal.value;
  return (
    <div class="space-y-6">
      <div class="flex justify-end">
        <Button
          onClick={() => {
            emailSignal.value = '';
            inviteOpenSignal.value = true;
          }}
        >
          Invitar a soporte
        </Button>
      </div>
      <TableContainer>
        {staff === null || staff.members.length === 0 ? (
          <TableEmptyState message={staff === null ? 'Cargando…' : 'Sin equipo'} />
        ) : (
          <div class="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Nombre</Th>
                  <Th>Correo</Th>
                  <Th>Rol</Th>
                  <Th>Estado</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {staff.members.map((m) => (
                  <Tr key={m.id}>
                    <Td>{m.name}</Td>
                    <Td>{m.email}</Td>
                    <Td>
                      <Badge tone="neutral">{m.globalRole === 'root' ? 'Root' : 'Soporte'}</Badge>
                    </Td>
                    <Td>
                      <AccountStatusBadge status={m.status} />
                    </Td>
                    <Td class="text-right">
                      {m.globalRole === 'support' && m.id !== me?.id && (
                        <Button size="sm" variant="outline" onClick={() => void setUserStatus(m.id, m.status === 'active' ? 'disabled' : 'active')}>
                          {m.status === 'active' ? 'Desactivar' : 'Activar'}
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </TableContainer>
      {staff !== null && staff.invitations.length > 0 && (
        <Card>
          <CardHeader title="Invitaciones pendientes" description="Cada link sirve una vez y vence en 48 h." />
          <ul class="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {staff.invitations.map((i) => (
              <li key={i.id} class="py-2 flex items-center justify-between gap-3">
                <span>
                  <strong>{i.email}</strong> <span class="text-slate-500">· vence {formatDateTime(i.expiresAt)}</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => void revokeStaffInvitation(i.id)}>
                  Revocar
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <InviteStaffModal />
    </div>
  );
}
