# Deploy del mini-erp en AWS Lightsail

Guía paso a paso para publicar el mini-erp en internet (#3), pensada para alguien que **nunca usó
Ubuntu ni Lightsail**. Se hace una sola vez; después cada versión nueva se publica sola desde GitHub.

## Cómo queda armado

```
Internet ──https──▶ Caddy (puertos 80/443, certificado automático)
                      │
                      ▼
                   mini-erp (Node 24, puerto 4100, solo accesible desde la misma máquina)
                      │
                      ▼
                   /var/lib/mini-erp        (las bases SQLite)
                   /var/lib/mini-erp-backups (copia de cada noche, 7 días)
```

- **Lightsail** es el servicio de AWS que alquila una computadora virtual (una "instancia") a precio
  fijo: US$5 por mes.
- **Ubuntu** es el sistema operativo de esa computadora. Se maneja escribiendo comandos en una
  terminal; Lightsail trae una **terminal en el navegador**, así que no hace falta instalar nada.
- **Caddy** recibe las visitas por HTTPS y se las pasa al mini-erp. Pide y renueva solo el
  certificado.
- **sslip.io** es un servicio gratis que convierte una IP en un nombre: `203-0-113-10.sslip.io`
  apunta a `203.0.113.10`. Así hay HTTPS sin comprar un dominio.
- **GitHub Actions** arma cada versión, corre todos los tests y la sube a la instancia por SSH.

Hay dos usuarios en la instancia, además del tuyo (`ubuntu`, el administrador):

- `minierp` corre el servicio y es dueño de las bases.
- `deploy` es el que usa GitHub Actions para subir versiones. Solo puede eso y reiniciar el servicio.

## Lo que vas a necesitar

- Tu cuenta de AWS.
- Acceso de administrador al repo `rauldiazsolis/mini-erp` en GitHub.
- Una PowerShell en tu Windows (menú Inicio → escribir "PowerShell").
- Unos 30 a 45 minutos.

Convención de esta guía: donde dice `<IP>` va la IP estática de la instancia (por ejemplo
`203.0.113.10`) y donde dice `<HOST>`, la misma IP con guiones más `.sslip.io` (por ejemplo
`203-0-113-10.sslip.io`).

---

## Paso 1: crear la instancia en Lightsail

1. Entrá a <https://lightsail.aws.amazon.com/> con tu cuenta de AWS.
2. Botón **Create instance**.
3. **Instance location**: elegí la región. **Virginia (us-east-1)** es la de referencia de precios;
   si ves otra más cercana (por ejemplo São Paulo) con el mismo precio de US$5, también sirve. Para
   cambiarla: "Change AWS Region and Availability Zone".
4. **Pick your instance image**:
   - Platform: **Linux/Unix**.
   - Blueprint: pestaña **Operating System (OS) only** → **Ubuntu 24.04 LTS**.
5. **SSH key pair**: dejá la que viene por defecto. No la vas a usar: la terminal del navegador
   entra sola.
6. **Choose your instance plan**:
   - Tipo de red: **Dual-stack** (con IPv4). **No** elijas "IPv6-only": el POS y muchos
     navegadores necesitan IPv4.
   - Plan: el de **US$5 USD/month** (512 MB de memoria, 2 vCPU, 20 GB de SSD). Si dice "First 3
     months free", mejor todavía.
7. **Identify your instance**: nombre `mini-erp`.
8. Botón **Create instance**. Esperá a que el estado pase de "Pending" a **Running** (1 o 2 minutos).

## Paso 2: IP fija, puertos y snapshots

Entrá a la instancia (clic en su nombre, `mini-erp`).

**IP estática** (sin esto, la IP cambia si la instancia se reinicia y el nombre `sslip.io` deja de
andar):

1. Pestaña **Networking** → en "IPv4 networking", **Attach static IP** (o **Create static IP**).
2. Nombre: `mini-erp-ip` → **Create** (o **Attach**).
3. Anotá la IP que aparece: es tu `<IP>`. Armá tu `<HOST>` cambiando los puntos por guiones y
   agregando `.sslip.io`.

   > La IP estática es gratis **mientras esté asignada** a una instancia. Si algún día borrás la
   > instancia, borrá también la IP estática (pestaña Networking de la cuenta), porque suelta cobra.

**Puertos** (en la misma pestaña Networking, sección **IPv4 Firewall**):

1. Ya tienen que estar **SSH (22)** y **HTTP (80)**.
2. **Add rule** → Application: **HTTPS** (puerto 443) → **Create**.

**Snapshots automáticos** (copia diaria de todo el disco, que guarda AWS):

1. Pestaña **Snapshots** → **Automatic snapshots** → activarlo.
2. Horario: cualquiera (por ejemplo 06:00 UTC). AWS guarda los últimos 7. Cuestan centavos por mes.

## Paso 3: la llave de deploy (en tu Windows)

GitHub Actions necesita una llave para entrar a la instancia como `deploy`. Es un par de archivos: la
**privada** (secreta, va a GitHub) y la **pública** (va a la instancia).

En PowerShell:

```powershell
ssh-keygen -t ed25519 -f $HOME\mini-erp-deploy -C deploy@mini-erp
```

Cuando pregunte "Enter passphrase", apretá **Enter** dos veces (sin contraseña: GitHub la usa sin
nadie delante). Se crean `mini-erp-deploy` (privada) y `mini-erp-deploy.pub` (pública) en tu carpeta
de usuario.

Mostrá la pública; la vas a copiar en el paso 4:

```powershell
Get-Content $HOME\mini-erp-deploy.pub
```

Es una sola línea que empieza con `ssh-ed25519`.

## Paso 4: preparar la instancia

1. En Lightsail, pestaña **Connect** de la instancia → **Connect using SSH**. Se abre una ventana
   negra: es la terminal de la instancia, ya conectada como `ubuntu`.
2. **Para pegar** en esa terminal: botón del portapapeles abajo a la derecha de la ventana → pegar
   el texto en el cuadro → después, clic derecho en la terminal (o `Ctrl+Shift+V`).
3. Bajá el repo (en una línea):

   ```bash
   git clone -b main https://github.com/rauldiazsolis/mini-erp.git /tmp/mini-erp
   ```

   (La primera vez, antes del merge, se usa la rama del PR en lugar de `main`.)
4. Corré la preparación, reemplazando `<HOST>` y pegando **tu** clave pública entre las comillas:

   ```bash
   sudo bash /tmp/mini-erp/deploy/provision.sh <HOST> "ssh-ed25519 AAAA... deploy@mini-erp"
   ```

   Tarda unos minutos (instala Node, pnpm y Caddy). Tiene que terminar con:

   ```
   Listo: Node v24.x.x, Caddy v2.x.x, sitio https://<HOST>
   ```

   Si algo falla, se puede volver a correr: no rompe lo que ya hizo.

## Paso 5: los secretos en GitHub

1. En GitHub, el repo `rauldiazsolis/mini-erp` → **Settings** → **Environments** → **New
   environment** → nombre `production` → **Configure environment**.
2. En **Environment secrets**, **Add environment secret** cuatro veces:

   | Nombre | Valor |
   |---|---|
   | `SSH_HOST` | `<IP>` (solo la IP, con puntos) |
   | `SSH_USER` | `deploy` |
   | `SSH_PRIVATE_KEY` | el contenido de la llave **privada** (ver abajo) |
   | `SSH_KNOWN_HOSTS` | la huella de la instancia (ver abajo) |

   Para copiar la llave privada al portapapeles **sin mostrarla** en pantalla, en PowerShell:

   ```powershell
   Get-Content $HOME\mini-erp-deploy -Raw | Set-Clipboard
   ```

   y pegala en el valor de `SSH_PRIVATE_KEY`.

   Para la huella (le dice a GitHub que la instancia es la verdadera y no un impostor), en la
   **terminal de Lightsail**, reemplazando `<IP>`:

   ```bash
   echo "<IP> $(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"
   ```

   Imprime una línea que empieza con la IP y sigue con `ssh-ed25519 AAAA…`. Seleccionala entera,
   copiala (`Ctrl+Shift+C`) y pegala en `SSH_KNOWN_HOSTS`.

   > No uses `ssh-keyscan` desde Windows: su OpenSSH es viejo y falla con
   > `choose_kex: unsupported KEX method` contra Ubuntu 24.04.

3. En **Environment variables**, **Add environment variable**: nombre `PUBLIC_HOST`, valor `<HOST>`.

Después de cargar la llave privada en GitHub, guardá el archivo `mini-erp-deploy` en un lugar seguro
(o borralo: si hace falta, se genera otra y se repiten los pasos 3 a 5).

## Paso 6: publicar una versión

Las versiones se publican con un **tag** de git que empiece con `v` (por ejemplo `v0.1.0`), o a mano
desde GitHub: pestaña **Actions** → **Deploy** → **Run workflow** (sobre `main`).

El workflow tarda unos minutos: primero corre el CI entero (lint, tipos, tests, build y e2e) y
después sube la versión. Si el mini-erp nuevo no responde, **vuelve solo a la versión anterior** y el
workflow queda en rojo.

Cuando termine en verde, abrí `https://<HOST>/` en el navegador: tiene que aparecer el landing del
mini-erp con el candado de HTTPS.

## Paso 7: crear el root (una sola vez)

El root es la cuenta de administrador que ve todos los comercios. Nadie puede registrarse como root
desde la web.

En la terminal de Lightsail (paso 4.1), en una línea:

```bash
sudo -u minierp bash -c 'set -a; . /etc/mini-erp/env; cd /opt/mini-erp/current && node scripts/create-root.ts'
```

Te pide email, nombre y la contraseña dos veces (mínimo 12 caracteres). **La contraseña no se ve
mientras la escribís**: es normal. Termina con `Root creado: <tu email>`. Con eso entrás al admin en
`https://<HOST>/admin`.

Si te olvidás la contraseña, correr lo mismo con el mismo email le pone una nueva.

## Operación del día a día

Todo en la terminal de Lightsail.

| Para | Comando |
|---|---|
| Ver si el mini-erp está andando | `systemctl status mini-erp` (tecla `q` para salir) |
| Ver el log en vivo | `journalctl -u mini-erp -f` (`Ctrl+C` para salir) |
| Confirmar el barrido de demos | `journalctl -u mini-erp \| grep demos` |
| Ver cuándo corre el próximo backup | `systemctl list-timers mini-erp-backup.timer` |
| Ver los backups | `sudo ls /var/lib/mini-erp-backups` |
| Cambiar la configuración | `sudo nano /etc/mini-erp/env` (guardar: `Ctrl+O`, Enter, `Ctrl+X`) y después `sudo systemctl restart mini-erp` |
| Reiniciar el mini-erp | `sudo systemctl restart mini-erp` |

Las variables de `/etc/mini-erp/env` están explicadas en el README principal.

## Restaurar un backup

**Un comercio o el sistema, desde la copia nocturna** (por ejemplo, la del 2026-10-01):

```bash
sudo systemctl stop mini-erp
sudo cp /var/lib/mini-erp-backups/2026-10-01/tenants/<id-del-comercio>.sqlite /var/lib/mini-erp/tenants/
# y/o el sistema (usuarios, comercios, keys):
sudo cp /var/lib/mini-erp-backups/2026-10-01/system.sqlite /var/lib/mini-erp/
sudo chown -R minierp:minierp /var/lib/mini-erp
sudo systemctl start mini-erp
```

**La instancia entera, desde un snapshot** (si se rompió o se borró): en Lightsail, pestaña
**Snapshots** → el snapshot → **Create new instance** (mismo plan de US$5). Cuando esté en
"Running", en la pestaña **Networking** de la cuenta, pasá la IP estática a la instancia nueva.
Como la IP es la misma, el nombre `<HOST>` y los secretos de GitHub siguen sirviendo. Borrá la
instancia vieja si todavía existe.

## Dar de baja

1. Lightsail → la instancia → menú ⋮ → **Delete**.
2. Pestaña **Networking** de la cuenta → la IP estática → **Delete** (suelta cobra).
3. Pestaña **Snapshots** → borrar los snapshots que queden.
4. GitHub → Settings → Environments → `production` → **Delete environment**.
