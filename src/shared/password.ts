import { z } from 'zod';

/** El mismo mínimo para todos (#19): alta, invitación, restablecimiento, cambio y root. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MIN_MESSAGE = `La contraseña debe tener al menos ${String(PASSWORD_MIN_LENGTH)} caracteres`;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_MESSAGE);
