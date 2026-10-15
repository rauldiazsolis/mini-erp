import { assignableRoles, type TenantRole } from '../../../shared/permissions.ts';
import { currentUserSignal } from '../../state/auth-state.ts';
import { activeRoleSignal, canDo, ROLE_LABEL } from '../../state/permissions-state.ts';
import {
  membersSignal,
  changeRole,
  setMemberStatus,
  createResetLink,
  type MemberItem,
} from '../../state/users-state.ts';
import { Button } from '../ui/Button.tsx';
import { TableContainer, Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table.tsx';
import { formatDateTime } from '../../format.ts';
import { CardList, CardRow, DesktopOnly } from '../ui/CardList.tsx';

function RoleCell(props: { member: MemberItem; isSelf: boolean }) {
  const { member, isSelf } = props;
  const actorRole = activeRoleSignal.value;
  // Un owner solo lo cambia otro owner; la fila propia no se toca
  const editable = !isSelf && actorRole !== null && (member.role !== 'owner' || canDo('owners.manage'));
  if (!editable) {
    return <span class="font-semibold">{ROLE_LABEL[member.role]}</span>;
  }
  const options = assignableRoles(actorRole);
  return (
    <select
      aria-label={`Rol de ${member.name}`}
      value={member.role}
      onChange={(e: Event) => {
        const value = (e.currentTarget as HTMLSelectElement).value;
        const role = options.find((r) => r === value);
        if (role !== undefined && role !== member.role) void changeRole(member.userId, role);
      }}
      class="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs"
    >
      {options.map((r: TenantRole) => (
        <option key={r} value={r}>
          {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );
}

/** Desactivar o reactivar y el link para restablecer; las mismas en la tabla y en la tarjeta (#89). */
function MemberActions({ member, isSelf }: { member: MemberItem; isSelf: boolean }) {
  const ownerPowers = canDo('owners.manage');
  const canToggle = !isSelf && (member.role !== 'owner' || ownerPowers);
  return (
    <div class="flex justify-end gap-2">
      {canToggle && (
        <Button
          size="sm"
          variant={member.status === 'active' ? 'outline' : 'secondary'}
          onClick={() => {
            void setMemberStatus(member.userId, member.status === 'active' ? 'disabled' : 'active');
          }}
        >
          {member.status === 'active' ? 'Desactivar' : 'Reactivar'}
        </Button>
      )}
      {ownerPowers && !isSelf && (
        <Button
          size="sm"
          variant="ghost"
          disabled={!member.canReset}
          title={member.canReset ? 'Genera un link para elegir una contraseña nueva' : 'Este usuario también está en otro comercio: pedíselo a soporte'}
          onClick={() => {
            void createResetLink(member);
          }}
        >
          Link para restablecer
        </Button>
      )}
    </div>
  );
}

export function MembersTable() {
  const members = membersSignal.value;
  const selfId = currentUserSignal.value?.id;

  return (
    <TableContainer>
      <CardList label="Usuarios del comercio">
        {members.map((m) => {
          const isSelf = m.userId === selfId;
          return (
            <CardRow
              key={m.userId}
              class={m.status === 'disabled' ? 'opacity-60' : undefined}
              title={
                <>
                  {m.name} {isSelf && <span class="text-[10px] text-slate-400">(vos)</span>}
                </>
              }
              aside={
                m.status === 'active' ? (
                  <span class="text-xs text-emerald-600 dark:text-emerald-400">Activo</span>
                ) : (
                  <span class="text-xs text-rose-600 dark:text-rose-400">Desactivado</span>
                )
              }
              meta={
                <>
                  <div class="break-all">{m.email}</div>
                  <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <RoleCell member={m} isSelf={isSelf} />
                    <MemberActions member={m} isSelf={isSelf} />
                  </div>
                </>
              }
            />
          );
        })}
      </CardList>
      <DesktopOnly>
        <Table>
          <Thead>
            <Tr>
              <Th>Nombre</Th>
              <Th>Correo</Th>
              <Th>Rol</Th>
              <Th>Estado</Th>
              <Th>Desde</Th>
              <Th class="text-right">Acciones</Th>
            </Tr>
          </Thead>
          <Tbody>
            {members.map((m) => {
              const isSelf = m.userId === selfId;
              return (
                <Tr key={m.userId} class={m.status === 'disabled' ? 'opacity-60' : ''}>
                  <Td class="font-medium text-slate-900 dark:text-white">
                    {m.name} {isSelf && <span class="text-[10px] text-slate-400">(vos)</span>}
                  </Td>
                  <Td>{m.email}</Td>
                  <Td>
                    <RoleCell member={m} isSelf={isSelf} />
                  </Td>
                  <Td>
                    {m.status === 'active' ? (
                      <span class="text-emerald-600 dark:text-emerald-400 font-semibold">Activo</span>
                    ) : (
                      <span class="text-rose-600 dark:text-rose-400 font-semibold">Desactivado</span>
                    )}
                  </Td>
                  <Td>{formatDateTime(m.joinedAt)}</Td>
                  <Td class="text-right">
                    <MemberActions member={m} isSelf={isSelf} />
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      </DesktopOnly>
    </TableContainer>
  );
}
