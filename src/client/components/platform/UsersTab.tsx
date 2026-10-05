import { signal } from '@preact/signals';
import {
  createPlatformResetLink,
  platformUsersLoadingSignal,
  platformUsersSignal,
  setUserStatus,
} from '../../state/platform-panel-state.ts';
import { currentUserSignal } from '../../state/auth-state.ts';
import { openEnterTab } from '../../state/impersonation-state.ts';
import { ROLE_LABEL } from '../../state/permissions-state.ts';
import { routeSignal, setPlatformFilters } from '../../state/route-state.ts';
import { platformTenantUrl } from '../../routing/admin-routes.ts';
import { Button } from '../ui/Button.tsx';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';
import { Input } from '../ui/Input.tsx';
import { Link } from '../ui/Link.tsx';
import { Modal } from '../ui/Modal.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import { AccountStatusBadge, Badge } from './platform-badges.tsx';
import type { PlatformUserItem } from '../../../shared/platform-types.ts';

const confirmSignal = signal<PlatformUserItem | null>(null);
const busySignal = signal<boolean>(false);

/** Quién puede tocar la cuenta: nadie a root ni a sí mismo; al equipo de soporte, solo root. */
export function canManageAccount(actor: { id: string; globalRole: string } | null, target: PlatformUserItem): boolean {
  if (actor === null || target.id === actor.id || target.globalRole === 'root') return false;
  return target.globalRole === 'user' || actor.globalRole === 'root';
}

/** "Entrar como" (#23): cuentas user activas con algún comercio activo. */
export function canEnterAs(user: PlatformUserItem): boolean {
  return user.globalRole === 'user' && user.status === 'active' && user.tenants.some((t) => t.status === 'active');
}

async function confirmDisable(): Promise<void> {
  const user = confirmSignal.value;
  if (user === null) return;
  busySignal.value = true;
  const ok = await setUserStatus(user.id, 'disabled').finally(() => {
    busySignal.value = false;
  });
  if (ok) confirmSignal.value = null;
}

function DisableModal() {
  const user = confirmSignal.value;
  if (user === null) return null;
  const close = () => {
    confirmSignal.value = null;
  };
  return (
    <Modal
      isOpen
      onClose={close}
      title={`Desactivar a ${user.name}`}
      subtitle="Se cierran todas sus sesiones y no puede volver a entrar hasta que la reactives."
      maxWidth="md"
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancelar
          </Button>
          <Button variant="danger" loading={busySignal.value} onClick={() => void confirmDisable()}>
            Desactivar cuenta
          </Button>
        </>
      }
    >
      <p class="text-sm text-slate-600 dark:text-slate-300">{user.email}</p>
    </Modal>
  );
}

function UserActions(props: { user: PlatformUserItem }) {
  const { user } = props;
  const manage = canManageAccount(currentUserSignal.value, user);
  if (!manage && !canEnterAs(user)) return null;
  return (
    <div class="flex flex-wrap justify-end gap-2">
      {canEnterAs(user) && (
        <Button size="sm" onClick={() => { openEnterTab(user.id); }}>
          Entrar como
        </Button>
      )}
      {manage && user.globalRole === 'user' && (
        <Button size="sm" variant="secondary" onClick={() => void createPlatformResetLink({ id: user.id, email: user.email })}>
          Link de restablecimiento
        </Button>
      )}
      {manage &&
        (user.status === 'active' ? (
          <Button size="sm" variant="outline" onClick={() => { confirmSignal.value = user; }}>
            Desactivar
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => void setUserStatus(user.id, 'active')}>
            Activar
          </Button>
        ))}
    </div>
  );
}

/** Usuarios de la plataforma (#23): todas las cuentas con sus comercios; desactivar y restablecer. */
export function UsersTab() {
  const route = routeSignal.value;
  const q = route.kind === 'plataforma' ? (route.params['q'] ?? '') : '';
  const users = platformUsersSignal.value;
  return (
    <div class="space-y-4">
      <FilterToolbar>
        <Input
          aria-label="Buscar usuario"
          placeholder="Buscar por nombre o correo"
          value={q}
          onInput={(e) => { setPlatformFilters({ q: e.currentTarget.value }); }}
        />
      </FilterToolbar>
      <TableContainer>
        {users.length === 0 ? (
          <TableEmptyState message={platformUsersLoadingSignal.value ? 'Cargando…' : 'Sin usuarios'} />
        ) : (
          <div class="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Nombre</Th>
                  <Th>Correo</Th>
                  <Th>WhatsApp</Th>
                  <Th>Comercios</Th>
                  <Th>Estado</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {users.map((u) => (
                  <Tr key={u.id}>
                    <Td>
                      <span class="font-semibold">{u.name}</span>{' '}
                      {u.globalRole === 'root' && <Badge tone="neutral">Root</Badge>}
                      {u.globalRole === 'support' && <Badge tone="neutral">Soporte</Badge>}
                    </Td>
                    <Td>{u.email}</Td>
                    <Td>{u.whatsapp ?? '—'}</Td>
                    <Td>
                      {u.tenants.length === 0
                        ? '—'
                        : u.tenants.map((t) => (
                            <div key={t.id}>
                              <Link href={platformTenantUrl(t.slug)} class="text-indigo-600 dark:text-indigo-400 hover:underline">
                                {t.name}
                              </Link>{' '}
                              <span class="text-slate-500">· {ROLE_LABEL[t.role]}</span>
                            </div>
                          ))}
                    </Td>
                    <Td>
                      <AccountStatusBadge status={u.status} />
                    </Td>
                    <Td class="text-right">
                      <UserActions user={u} />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </TableContainer>
      <DisableModal />
    </div>
  );
}
