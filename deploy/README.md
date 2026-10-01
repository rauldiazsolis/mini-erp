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
- **El nombre**: un dominio propio (hoy **`mini.contax.ar`**, con el DNS en DreamHost) que apunta a
  la IP de la instancia. Los sinónimos (`mini.contax.com.ar`) y el nombre viejo redirigen al
  principal. Sin dominio propio sirve **sslip.io**, un servicio gratis que convierte una IP en un
  nombre (`203-0-113-10.sslip.io` apunta a `203.0.113.10`), aunque algunos proveedores de internet
  no lo resuelven (#11).
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
`203.0.113.10`) y donde dice `<HOST>`, el nombre público principal: tu dominio (por ejemplo
`mini.contax.ar`) o, sin dominio, la IP con guiones más `.sslip.io` (por ejemplo
`203-0-113-10.sslip.io`). `<SINÓNIMOS>` son los nombres que redirigen al principal (por ejemplo
`mini.contax.com.ar`); pueden no ser ninguno.

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

**IP estática** (sin esto, la IP cambia si la instancia se reinicia y el nombre deja de apuntar a
ella):

1. Pestaña **Networking** → en "IPv4 networking", **Attach static IP** (o **Create static IP**).
2. Nombre: `mini-erp-ip` → **Create** (o **Attach**).
3. Anotá la IP que aparece: es tu `<IP>`.

   > La IP estática es gratis **mientras esté asignada** a una instancia. Si algún día borrás la
   > instancia, borrá también la IP estática (pestaña Networking de la cuenta), porque suelta cobra.

**Puertos** (en la misma pestaña Networking, sección **IPv4 Firewall**):

1. Ya tienen que estar **SSH (22)** y **HTTP (80)**.
2. **Add rule** → Application: **HTTPS** (puerto 443) → **Create**.

**Snapshots automáticos** (copia diaria de todo el disco, que guarda AWS):

1. Pestaña **Snapshots** → **Automatic snapshots** → activarlo.
2. Horario: cualquiera (por ejemplo 06:00 UTC). AWS guarda los últimos 7. Cuestan centavos por mes.

## Paso 2b: el nombre (DNS)

**Con dominio propio** (el DNS de `contax.ar` y `contax.com.ar` está en DreamHost):

1. En el panel de DreamHost, la sección de **DNS** del dominio (`contax.ar`).
2. Agregá un registro (**Add Record**): tipo **A**, nombre **`mini`**, valor **`<IP>`**.
3. Lo mismo en `contax.com.ar` para cada sinónimo (nombre `mini`, valor `<IP>`).
4. Esperá a que se publique (de minutos a un par de horas). Para saber si ya está, en PowerShell:

   ```powershell
   nslookup mini.contax.ar 8.8.8.8
   ```

   Tiene que responder con la `<IP>`. Recién entonces seguí: Caddy pide el certificado apenas
   arranca, y si el nombre todavía no apunta a la instancia, falla y reintenta más tarde.

**Sin dominio**: `<HOST>` es la IP con los puntos cambiados por guiones más `.sslip.io`. No hay que
cargar nada.

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
4. Corré la preparación, reemplazando `<HOST>`, pegando **tu** clave pública entre las comillas y
   agregando al final los `<SINÓNIMOS>`, si los hay:

   ```bash
   sudo bash /tmp/mini-erp/deploy/provision.sh <HOST> "ssh-ed25519 AAAA... deploy@mini-erp" <SINÓNIMOS>
   ```

   Por ejemplo: `… provision.sh mini.contax.ar "ssh-ed25519 AAAA…" mini.contax.com.ar`.

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

3. Más abajo, en **Environment variables** (no en los secretos: el workflow la lee como variable y,
   si está como secreto, le llega vacía), **Add environment variable**: nombre `PUBLIC_HOST`, valor
   `<HOST>`.
4. Opcional, también en **Environment variables**: `POS_URL`, el origen del POS al que lleva el botón
   "Probar la demo" (por ejemplo `https://pos.contax.ar`). Si no está, es
   `https://offline-pos.pages.dev`.

Después de cargar la llave privada en GitHub, guardá el archivo `mini-erp-deploy` en un lugar seguro
(o borralo: si hace falta, se genera otra y se repiten los pasos 3 a 5).

## Paso 6: publicar una versión

La versión de mini es **la de `package.json`**, y es la única (#40): la muestran el admin y el
landing, y la informan `/health` y `GET /connector/info`. Para publicar una:

1. En el PR de la etapa, subí la versión: `pnpm version minor --no-git-tag-version` para una etapa,
   `pnpm version patch --no-git-tag-version` para un arreglo. Cambia solo `package.json`.
2. Después del merge, desde `main` actualizado, creá el tag **desde `package.json`** y subilo:

   ```bash
   V="v$(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' package.json)" && echo "$V" && git tag -a "$V" -m "$V" && git push origin "$V"
   ```

   Lee la versión con `sed` y no con `node`: en Git Bash, `node` es un alias a `winpty` que dentro
   de `$(...)` se corta con "stdout is not a tty" y no crea el tag.

También se puede publicar a mano desde GitHub: pestaña **Actions** → **Deploy** → **Run workflow**
(sobre `main`). Despliega la versión que diga `package.json`.

El workflow tarda unos minutos:

- Primero compara el tag con `package.json`. Si no coinciden (por ejemplo `v0.3.0` con `0.2.1`), se
  frena ahí, sin tocar el servidor, y dice qué corregir.
- Después corre el CI entero (lint, tipos, tests, build y e2e) y sube la versión. Si el mini-erp
  nuevo no responde, **vuelve solo a la versión anterior** y el workflow queda en rojo.
- Al final pide `https://<HOST>/health` y comprueba que responda la versión que se acaba de subir.

Cuando termine en verde, abrí `https://<HOST>/` en el navegador: tiene que aparecer el landing del
mini-erp con el candado de HTTPS.

> Con `sslip.io`, si el navegador dice que no encuentra el sitio, puede ser tu proveedor de
> internet: algunos no lo resuelven (#11). En Chrome: Configuración → Privacidad y seguridad →
> Seguridad → "Usar DNS seguro" con Google o Cloudflare. Con dominio propio no pasa.

## Paso 7: crear el root (una sola vez)

El root es la cuenta de administrador que ve todos los comercios. Nadie puede registrarse como root
desde la web.

En la terminal de Lightsail (paso 4.1), en una línea:

```bash
sudo -u minierp bash -c 'set -a; . /etc/mini-erp/env; cd /opt/mini-erp/current && node scripts/create-root.ts'
```

Te pide email, nombre y la contraseña dos veces (mínimo 8 caracteres, el mismo de todas las cuentas). **La contraseña no se ve
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

**Cambiar a dónde abre el POS el botón "Probar la demo"** (por ejemplo, cuando el POS se mude a
`pos.contax.ar`), sin terminal: en GitHub, Settings → Environments → `production` → Environment
variables → `POS_URL` = `https://pos.contax.ar` (crearla si no está), y después Actions → **Deploy**
→ **Run workflow**. El valor queda dentro del landing al compilar, por eso hace falta el deploy.

## Cambiar el nombre (mudarse de dominio)

Por ejemplo, de `52-203-224-101.sslip.io` a `mini.contax.ar`:

1. Cargá el DNS del nombre nuevo (paso 2b) y esperá a que responda con la `<IP>`.
2. En la terminal de Lightsail, con la guía al día (`git -C /tmp/mini-erp pull`, o un `git clone`
   nuevo como en el paso 4), el nombre nuevo primero y después los sinónimos. Conviene incluir el
   nombre viejo, así los links que ya circulan siguen andando:

   ```bash
   sudo bash /tmp/mini-erp/deploy/set-host.sh mini.contax.ar mini.contax.com.ar 52-203-224-101.sslip.io
   ```

   Reescribe Caddy y `PUBLIC_URL`, y reinicia el mini-erp. Termina mostrando el host principal y a
   dónde redirige cada sinónimo.
3. En GitHub, la variable `PUBLIC_HOST` del environment `production` pasa al nombre nuevo.

Los sinónimos sirven para el navegador (landing, admin y alta). **Una caja ya conectada al nombre
viejo no sigue la redirección** (el navegador no sigue una redirección entre dominios en las llamadas
del POS): hay que volver a conectarla con el nombre nuevo. Las demos nuevas ya salen con el nombre
nuevo.

## Reiniciar producción (borrar todo)

Mientras el producto sea temprano, una etapa puede cambiar las bases sin migrarlas: entonces se
reinicia producción a cero. La primera vez fue con la **0.3.0** (M2, roles e invitaciones, #19), que
además se lleva las cuentas de prueba del deploy. Una versión que lo necesita no arranca sobre las
bases viejas: el log de `mini-erp` dice "La base de sistema es de una versión anterior".

**Se pierde todo**: comercios, cuentas (incluido el root), keys del POS y demos. Los backups de la
noche (`/var/lib/mini-erp-backups`) quedan con los datos viejos hasta que se reemplazan solos.

El orden importa: primero se borra, después se publica. Si se publica antes, la versión nueva no
arranca, el deploy vuelve solo a la anterior, y esa crea otra vez bases viejas.

1. Con el PR mergeado y antes de crear el tag, en la terminal de Lightsail, de a una línea (desde acá
   el sitio queda caído hasta el paso 2):

   ```bash
   sudo systemctl stop mini-erp
   sudo rm -rf /var/lib/mini-erp/*
   ```

2. Publicá la versión (paso 6: el tag desde `package.json`). El deploy arranca el mini-erp nuevo sobre
   la carpeta vacía, que crea las bases nuevas, y termina en verde.
3. Volvé a crear el root (paso 7) y comprobá la versión:

   ```bash
   sudo -u minierp bash -c 'set -a; . /etc/mini-erp/env; cd /opt/mini-erp/current && node scripts/create-root.ts'
   curl -s https://mini.contax.ar/health
   ```

Si el deploy falla con "no respondió /health" y vuelve a la versión anterior, la causa es una base
vieja (`sudo journalctl -u mini-erp -n 60 --no-pager | grep -i "versión anterior"`). Aunque la hayas
borrado, la versión anterior, al volver, crea otra base vieja. Repetí el paso 1 y corré **Actions** →
**Deploy** → **Run workflow** sobre `main` (el tag ya existe: no hace falta otro); después, el paso 3.

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
