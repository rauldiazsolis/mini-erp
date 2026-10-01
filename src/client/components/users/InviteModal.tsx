import { assignableRoles } from '../../../shared/permissions.ts';
import { activeRoleSignal, ROLE_LABEL } from '../../state/permissions-state.ts';
import {
  inviteModalOpenSignal,
  inviteFormSignal,
  inviteErrorSignal,
  inviteSubmittingSignal,
  submitInvite,
  setInviteEmail,
  setInviteRole,
  closeInviteModal,
} from '../../state/users-state.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Modal } from '../ui/Modal.tsx';
import { Select } from '../ui/Select.tsx';

export function InviteModal() {
  const actorRole = activeRoleSignal.value;
  const options = actorRole === null ? [] : assignableRoles(actorRole);
  const form = inviteFormSignal.value;

  return (
    <Modal
      isOpen={inviteModalOpenSignal.value}
      onClose={closeInviteModal}
      title="Invitar a alguien"
      subtitle="Se genera un link de un solo uso que vence en 48 h. Lo compartís por WhatsApp o donde quieras."
      maxWidth="md"
      footer={
        <div class="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={closeInviteModal}>
            Cancelar
          </Button>
          <Button size="sm" loading={inviteSubmittingSignal.value} onClick={() => { void submitInvite(); }}>
            Crear link
          </Button>
        </div>
      }
    >
      <form
        class="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submitInvite();
        }}
      >
        <Input
          id="invite-email"
          label="Correo"
          type="email"
          placeholder="juan@ejemplo.com"
          value={form.email}
          onInput={(e) => { setInviteEmail((e.target as HTMLInputElement).value); }}
          error={inviteErrorSignal.value}
          autoFocus
        />
        <Select
          id="invite-role"
          label="Rol"
          value={form.role}
          onChange={(e) => {
            const value = (e.target as HTMLSelectElement).value;
            const role = options.find((r) => r === value);
            if (role !== undefined) setInviteRole(role);
          }}
        >
          {options.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </form>
    </Modal>
  );
}
