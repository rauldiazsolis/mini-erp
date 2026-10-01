import { canDo } from '../../state/permissions-state.ts';
import { currentTenantName, openInviteModal, usersLoadingSignal, membersSignal } from '../../state/users-state.ts';
import { Button } from '../ui/Button.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';
import { MembersTable } from './MembersTable.tsx';
import { InvitationsTable } from './InvitationsTable.tsx';
import { InviteModal } from './InviteModal.tsx';
import { LinkReadyModal } from './LinkReadyModal.tsx';
import { ActivityList } from './ActivityList.tsx';

/** Usuarios del comercio (#19): owner y admin. */
export function UsersView() {
  return (
    <div class="space-y-6 animate-in fade-in duration-150">
      <PageHeader title="Usuarios" subtitle={`Quién entra a ${currentTenantName()} y con qué rol`}>
        <Button size="sm" onClick={openInviteModal}>
          Invitar
        </Button>
      </PageHeader>

      {usersLoadingSignal.value && membersSignal.value.length === 0 ? (
        <p class="text-xs text-slate-500 dark:text-slate-400">Cargando…</p>
      ) : (
        <MembersTable />
      )}
      <InvitationsTable />
      {canDo('owners.manage') && <ActivityList />}

      <InviteModal />
      <LinkReadyModal />
    </div>
  );
}
