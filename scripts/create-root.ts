/**
 * Root inicial del mini-erp (#3). Se corre una vez en el servidor, con el entorno del servicio:
 *   sudo -u minierp bash -c 'set -a; . /etc/mini-erp/env; cd /opt/mini-erp/current && node scripts/create-root.ts'
 * Pide email, nombre y contraseña (sin eco, dos veces). Si el email existe, lo promueve a root.
 */
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { dataDir } from '../src/server/db/data-dir.ts';
import { AuthService } from '../src/server/auth/auth-service.ts';
import { PASSWORD_MIN_LENGTH, passwordSchema } from '../src/shared/password.ts';

const rootSchema = z.object({
  email: z.string().trim().email('Email inválido'),
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres'),
  password: passwordSchema,
});

/** Lee una línea sin mostrarla. */
function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve, reject) => {
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    let value = '';
    const finish = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          finish();
          reject(new Error('Cancelado'));
          return;
        }
        value = ch === '\u007f' || ch === '\b' ? value.slice(0, -1) : value + ch;
      }
    };
    stdin.on('data', onData);
  });
}

if (!process.stdin.isTTY) {
  console.error('create-root necesita una terminal interactiva');
  process.exit(1);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const email = await rl.question('Email del root: ');
const name = await rl.question('Nombre: ');
rl.close();
const password = await askHidden(`Contraseña (mínimo ${String(PASSWORD_MIN_LENGTH)} caracteres): `);
const again = await askHidden('Repetila: ');
if (password !== again) {
  console.error('Las contraseñas no coinciden');
  process.exit(1);
}

const parsed = rootSchema.safeParse({ email, name, password });
if (!parsed.success) {
  console.error(parsed.error.errors[0]?.message ?? 'Datos inválidos');
  process.exit(1);
}

const db = openSystemDb(join(dataDir(), 'system.sqlite'));
const { user, created } = new AuthService(db).ensureRoot(parsed.data);
db.close();
console.log(`${created ? 'Root creado' : 'Usuario promovido a root'}: ${user.email}`);
